import {
  LATCH_DEPLOYMENTS,
  LATCH_HOOK_REGISTRY_ABI,
  LAUNCHPAD_KIT_ABI,
  LATCH_PROTOCOL_EVENT_ABIS,
  getDeployment,
  type LatchDeployment,
} from "@latchprotocol/sdk";
import { createHash } from "node:crypto";
import { toEventSelector, type Abi, type AbiEvent, type Address, type Hex } from "viem";
import {
  FEE_CONTROLLER_V2_EVENTS_ABI,
  LAUNCH_REGISTRY_EVENTS_ABI,
  POOL_MANAGER_OWNER_EVENTS_ABI,
  REVSHARE_EVENTS_ABI,
  TIMELOCK_EVENTS_ABI,
} from "./abis.js";

/**
 * What the indexer watches on a chain, derived ENTIRELY from the SDK address
 * book. Nothing here restates an address: a redeploy is an SDK edit, and the
 * changed address-set hash makes the indexer re-read history for it.
 *
 * Deliberately NOT watched:
 *   * Vault claim-token Transfer/Approval/OperatorSet — high volume, not asked for.
 *   * Anything on a contract not in the address book. A third-party contract
 *     can emit an identical event signature with any numbers it likes.
 */

export type WatchRole =
  | "vault"
  | "clPoolManager"
  | "binPoolManager"
  | "feeController"
  | "launchpadKit"
  | "registry"
  | "launchRegistry"
  | "timelockCustody"
  | "timelockPolicy"
  | "clPoolManagerOwner"
  | "binPoolManagerOwner"
  | "revShareHook";

export interface WatchedContract {
  readonly role: WatchRole;
  /** Lowercased. */
  readonly address: Hex;
  /** Event names indexed from this contract. */
  readonly events: readonly string[];
  readonly abi: Abi;
}

export const CORE_EVENTS = {
  vault: ["AppRegistered"],
  clPoolManager: ["Initialize", "Swap", "ModifyLiquidity", "ProtocolFeeUpdated", "DynamicLPFeeUpdated"],
  binPoolManager: ["Initialize", "Swap", "Mint", "Burn", "ProtocolFeeUpdated", "DynamicLPFeeUpdated"],
  feeController: ["ProtocolFeesCollected"],
  launchpadKit: ["LaunchCreated", "LaunchSeeded", "LaunchReconfigured", "HookListed"],
  registry: [
    "LatchRegistered",
    "LatchListingChanged",
    "LatchVerificationChanged",
    "LatchMetadataUpdated",
    "LatchStewardTransferred",
    "RoleGranted",
    "RoleRevoked",
  ],
  launchRegistry: ["LaunchRegistered", "LaunchTokenInfoUpdated", "LaunchMetadataUpdated", "LaunchListingChanged"],
  // RoleGranted/RoleRevoked: the admin panel enumerates PROPOSER/EXECUTOR/CANCELLER
  // holders from these. Adding them changed addressSetHash, so the first pass after
  // this change re-reads history from deployedAtBlock (by design; see indexPass).
  timelockCustody: ["CallScheduled", "CallExecuted", "CallSalt", "Cancelled", "MinDelayChange", "RoleGranted", "RoleRevoked"],
  timelockPolicy: ["CallScheduled", "CallExecuted", "CallSalt", "Cancelled", "MinDelayChange", "RoleGranted", "RoleRevoked"],
  // PausableRole holders on the pool-manager owner wrappers (CLAUDE.md: Ops tier).
  clPoolManagerOwner: ["PausableRoleGranted", "PausableRoleRevoked"],
  binPoolManagerOwner: ["PausableRoleGranted", "PausableRoleRevoked"],
  revShareHook: ["RevShareTaken", "Claimed"],
} as const satisfies Record<WatchRole, readonly string[]>;

const ABI: Record<WatchRole, Abi> = {
  vault: LATCH_PROTOCOL_EVENT_ABIS.Vault as unknown as Abi,
  clPoolManager: LATCH_PROTOCOL_EVENT_ABIS.CLPoolManager as unknown as Abi,
  binPoolManager: LATCH_PROTOCOL_EVENT_ABIS.BinPoolManager as unknown as Abi,
  feeController: FEE_CONTROLLER_V2_EVENTS_ABI as unknown as Abi,
  launchpadKit: LAUNCHPAD_KIT_ABI as unknown as Abi,
  registry: LATCH_HOOK_REGISTRY_ABI as unknown as Abi,
  launchRegistry: LAUNCH_REGISTRY_EVENTS_ABI as unknown as Abi,
  timelockCustody: TIMELOCK_EVENTS_ABI as unknown as Abi,
  timelockPolicy: TIMELOCK_EVENTS_ABI as unknown as Abi,
  clPoolManagerOwner: POOL_MANAGER_OWNER_EVENTS_ABI as unknown as Abi,
  binPoolManagerOwner: POOL_MANAGER_OWNER_EVENTS_ABI as unknown as Abi,
  revShareHook: REVSHARE_EVENTS_ABI as unknown as Abi,
};

export function abiForRole(role: WatchRole): Abi {
  return ABI[role];
}

/** topic0 for each named event of a role, read from the ABI (throws if an event is missing). */
export function topicsForRole(role: WatchRole): Hex[] {
  const abi = ABI[role];
  return CORE_EVENTS[role].map((name) => {
    const ev = abi.find((x): x is AbiEvent => x.type === "event" && x.name === name);
    if (!ev) throw new Error(`ABI for ${role} has no event ${name}`);
    return toEventSelector(ev);
  });
}

const lower = (a: string) => a.toLowerCase() as Hex;

function watched(role: WatchRole, address: Address | null): WatchedContract[] {
  if (address === null) return [];
  return [{ role, address: lower(address), events: CORE_EVENTS[role], abi: ABI[role] }];
}

/**
 * Phase-one contracts: everything whose address is in the book.
 * RevShareHooks are phase two (see `revShareHooksFor`), because one of them is
 * only discoverable from a pool key.
 */
export function staticContractsFor(d: LatchDeployment): WatchedContract[] {
  return [
    ...watched("vault", d.vault),
    ...watched("clPoolManager", d.clPoolManager),
    ...watched("binPoolManager", d.binPoolManager),
    ...watched("feeController", d.feeController),
    ...watched("launchpadKit", d.launchpadKit),
    ...watched("registry", d.registry),
    ...watched("launchRegistry", d.launchRegistry),
    ...watched("timelockCustody", d.timelockCustody),
    ...watched("timelockPolicy", d.timelockPolicy),
    ...watched("clPoolManagerOwner", d.clPoolManagerOwner),
    ...watched("binPoolManagerOwner", d.binPoolManagerOwner),
  ];
}

/**
 * Latch's OWN RevShareHook deployments, the same rule `apps/web/src/lib/
 * protocolActivity.ts` applies: the one in the address book, plus the hook the
 * SDK reference pool is bound to — read from the pool's Initialize, never typed
 * out (on Robinhood that is the retired 0x23CE…E446).
 */
export function revShareHooksFor(d: LatchDeployment, demoPoolHooks: string | null): Hex[] {
  const set = new Set<Hex>();
  set.add(lower(d.revShareHook));
  if (demoPoolHooks && !/^0x0{40}$/i.test(demoPoolHooks)) set.add(lower(demoPoolHooks));
  return [...set].sort();
}

/**
 * Hash of what phase one watches. A change means the SDK now names a contract
 * the database has never read, so history must be re-read for it.
 */
export function addressSetHash(d: LatchDeployment): string {
  const parts = staticContractsFor(d)
    .map((c) => `${c.role}:${c.address}:${c.events.join("|")}`)
    .concat(`revShareHook:${lower(d.revShareHook)}`, `demoPool:${d.demoPool?.id ?? "none"}`)
    .sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function requireIndexedDeployment(chainId: number): LatchDeployment {
  const d = getDeployment(chainId);
  if (!d) throw new Error(`chain ${chainId} is not in the @latchprotocol/sdk address book`);
  return d;
}

export { LATCH_DEPLOYMENTS };

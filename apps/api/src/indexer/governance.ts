import type { LatchDeployment } from "@latchprotocol/sdk";
import { Prisma, type PrismaClient } from "@prisma/client";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { ACCESS_CONTROL_VIEWS_ABI, CHAINLINK_AGGREGATOR_ABI, OWNABLE_VIEWS_ABI } from "../chain/abis.js";
import { requireIndexedDeployment } from "../chain/deployments.js";
import type { ChainRpc } from "../chain/rpc.js";
import { chainConfig } from "../config/chainConfig.js";
import { logger } from "../config/logger.js";
import { mapLimit } from "./indexer.js";
import { isRevert } from "./snapshots.js";

/**
 * Governance-facing snapshots for the admin panel: ownership vs the CLAUDE.md
 * Ownership table, ops-account gas balances, and Chainlink feed staleness.
 * Read-only. Worker-only.
 */

const ZERO = "0x0000000000000000000000000000000000000000";
const role = (name: string): Hex => keccak256(toHex(name));
export const ROLES = {
  DEFAULT_ADMIN_ROLE: `0x${"0".repeat(64)}` as Hex,
  PROPOSER_ROLE: role("PROPOSER_ROLE"),
  EXECUTOR_ROLE: role("EXECUTOR_ROLE"),
  CANCELLER_ROLE: role("CANCELLER_ROLE"),
};

type Expected = { tier: string; address: string | null };

export interface OwnershipCheck {
  contractKey: string;
  address: string;
  check: "owner" | "pendingOwner" | `hasRole:${string}:${string}`;
  expected: Expected;
  /** For hasRole checks: the account whose role is asked about. */
  account?: string;
  roleHash?: Hex;
}

/**
 * The CLAUDE.md "Ownership: decided here" table, as checks. Expectations name
 * TIERS and resolve them to SDK addresses; nothing here restates an address
 * except the canceller, which lives in config/chains/<id>.json.
 */
export function ownershipChecks(d: LatchDeployment, canceller: string | null): OwnershipCheck[] {
  const custody = { tier: "Custody (48h timelock)", address: d.timelockCustody.toLowerCase() };
  const safe = { tier: "Safe", address: d.governanceSafe.toLowerCase() };
  const noPending = { tier: "none pending", address: ZERO };
  const out: OwnershipCheck[] = [];
  const owned = (key: string, addr: Address | null, exp: Expected) => {
    if (!addr) return;
    const a = addr.toLowerCase();
    out.push({ contractKey: key, address: a, check: "owner", expected: exp });
    out.push({ contractKey: key, address: a, check: "pendingOwner", expected: noPending });
  };
  owned("vault", d.vault, custody);
  owned("clPoolManagerOwner", d.clPoolManagerOwner, custody);
  owned("binPoolManagerOwner", d.binPoolManagerOwner, custody);
  if (d.clPoolManagerOwner) owned("clPoolManager", d.clPoolManager, { tier: "CLPoolManagerOwner wrapper", address: d.clPoolManagerOwner.toLowerCase() });
  if (d.binPoolManagerOwner) owned("binPoolManager", d.binPoolManager, { tier: "BinPoolManagerOwner wrapper", address: d.binPoolManagerOwner.toLowerCase() });
  owned("feeController", d.feeController, safe);
  owned("revShareHook", d.revShareHook, safe);
  owned("clPositionDescriptor", d.clPositionDescriptor, safe);

  const hasRole = (key: string, addr: Address | null, name: keyof typeof ROLES, account: string, tier: string) => {
    if (!addr) return;
    out.push({
      contractKey: key,
      address: addr.toLowerCase(),
      check: `hasRole:${name}:${account}`,
      expected: { tier, address: "true" },
      account,
      roleHash: ROLES[name],
    });
  };
  hasRole("registry", d.registry, "DEFAULT_ADMIN_ROLE", safe.address, "Safe holds DEFAULT_ADMIN_ROLE");
  for (const [key, tl] of [["timelockCustody", d.timelockCustody], ["timelockPolicy", d.timelockPolicy]] as const) {
    hasRole(key, tl, "PROPOSER_ROLE", safe.address, "Safe is proposer");
    hasRole(key, tl, "EXECUTOR_ROLE", ZERO, "address(0) is executor (permissionless execution)");
    if (canceller) hasRole(key, tl, "CANCELLER_ROLE", canceller, "dedicated canceller holds CANCELLER_ROLE");
  }
  return out;
}

export async function governancePass(prisma: PrismaClient, rpc: ChainRpc, chainId: number): Promise<{ ownership: number; mismatches: number; balances: number }> {
  const d = requireIndexedDeployment(chainId);
  const cfg = chainConfig(chainId);
  const B = await rpc.reads.getBlockNumber();
  const canceller = cfg.opsAccounts.find((a) => a.label === "canceller")?.address ?? null;
  const checks = ownershipChecks(d, canceller);
  let mismatches = 0;

  await mapLimit(checks, 4, async (c) => {
    const id = `${chainId}-${c.contractKey}-${c.check}`;
    let observed: string | null = null;
    let readError: string | null = null;
    try {
      if (c.check === "owner" || c.check === "pendingOwner") {
        observed = String(await rpc.reads.readContract({ address: c.address as Address, abi: OWNABLE_VIEWS_ABI, functionName: c.check, blockNumber: B })).toLowerCase();
      } else {
        observed = String(await rpc.reads.readContract({ address: c.address as Address, abi: ACCESS_CONTROL_VIEWS_ABI, functionName: "hasRole", args: [c.roleHash!, c.account as Address], blockNumber: B }));
      }
    } catch (e) {
      // A contract with no pendingOwner (plain Ownable) reverts: that is "none pending".
      if (c.check === "pendingOwner" && isRevert(e)) observed = ZERO;
      else readError = e instanceof Error ? e.message.split("\n")[0]!.slice(0, 300) : "read failed";
    }
    const matches = observed === null ? null : observed === c.expected.address;
    if (matches === false) mismatches += 1;
    const row = {
      chainId,
      contractKey: c.contractKey,
      address: c.address,
      check: c.check,
      observed,
      expectedTier: c.expected.tier,
      expectedAddress: c.expected.address,
      matches,
      readError,
      readAtBlock: B,
      readAt: new Date(),
    };
    await prisma.ownershipSnapshot.upsert({ where: { id }, create: { id, ...row }, update: row });
  });

  let balances = 0;
  await mapLimit(cfg.opsAccounts, 4, async (acct) => {
    try {
      const wei = await rpc.reads.getBalance({ address: acct.address as Address, blockNumber: B });
      const min = acct.minWei === undefined ? null : BigInt(acct.minWei);
      const row = {
        chainId,
        label: acct.label,
        address: acct.address,
        purpose: acct.purpose,
        balanceWei: new Prisma.Decimal(wei.toString()),
        minWei: min === null ? null : new Prisma.Decimal(min.toString()),
        belowMin: min === null ? null : wei < min,
        readAtBlock: B,
        readAt: new Date(),
      };
      const id = `${chainId}-${acct.label}`;
      await prisma.opsBalance.upsert({ where: { id }, create: { id, ...row }, update: row });
      balances += 1;
    } catch (e) {
      logger.warn({ chainId, label: acct.label }, "ops balance read failed");
    }
  });

  return { ownership: checks.length, mismatches, balances };
}

/** Chainlink staleness, the same rule as packages/keeper/src/feeds.ts (`updatedAt + heartbeat < now`). */
export function staleness(blockTimestamp: number, updatedAt: number, heartbeatSeconds: number) {
  return { stalenessSeconds: blockTimestamp - updatedAt, heartbeatViolation: updatedAt + heartbeatSeconds < blockTimestamp };
}

export async function feedsPass(prisma: PrismaClient, rpc: ChainRpc, chainId: number): Promise<number> {
  const cfg = chainConfig(chainId);
  if (cfg.feeds.length === 0) return 0;
  const block = await rpc.reads.getBlock();
  const B = block.number;
  if (B === null) throw new Error("latest block has no number");
  const blockTs = Number(block.timestamp);
  let written = 0;

  await mapLimit(cfg.feeds, 4, async (f) => {
    const base = { chainId, label: f.label, proxy: f.proxy, readAtBlock: B, blockTimestamp: new Date(blockTs * 1000), heartbeatSeconds: f.heartbeatSeconds };
    try {
      const p = f.proxy as Address;
      const [description, decimals, round] = await Promise.all([
        rpc.reads.readContract({ address: p, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "description", blockNumber: B }),
        rpc.reads.readContract({ address: p, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "decimals", blockNumber: B }),
        rpc.reads.readContract({ address: p, abi: CHAINLINK_AGGREGATOR_ABI, functionName: "latestRoundData", blockNumber: B }),
      ]);
      // Decoy guard: a contract answering the aggregator shape is not the feed we named.
      if (f.expectedDescription !== undefined && description !== f.expectedDescription) {
        throw new Error(`description() is "${description}", config expects "${f.expectedDescription}"`);
      }
      const updatedAt = Number(round[3]);
      const st = staleness(blockTs, updatedAt, f.heartbeatSeconds);
      await prisma.feedObservation.create({
        data: {
          ...base,
          description,
          roundId: new Prisma.Decimal(round[0].toString()),
          answer: new Prisma.Decimal(round[1].toString()),
          decimals: Number(decimals),
          feedUpdatedAt: new Date(updatedAt * 1000),
          stalenessSeconds: st.stalenessSeconds,
          heartbeatViolation: st.heartbeatViolation,
        },
      });
      written += 1;
    } catch (e) {
      // A row is written for failures too: a gap means "not running", never "failed quietly".
      await prisma.feedObservation.create({ data: { ...base, error: e instanceof Error ? e.message.split("\n")[0]!.slice(0, 300) : "read failed" } });
    }
  });
  return written;
}

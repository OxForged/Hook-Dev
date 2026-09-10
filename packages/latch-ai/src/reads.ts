// SPDX-License-Identifier: MIT
/**
 * Every chain read this package performs, in one file.
 *
 * Two rules hold throughout:
 *
 * 1. **An unreachable RPC throws.** It is never reported as "not found". Those
 *    are opposite answers, and an agent that treats a rate-limited endpoint as
 *    proof of absence will confidently tell a user a contract is unlisted.
 *
 * 2. **A zeroed struct is never returned.** `LatchRegistry.getLatch` reverts for
 *    an unregistered address rather than returning a zeroed record, precisely
 *    because a zeroed record decodes to "Unverified, Active, no permissions" -
 *    the most reassuring thing that could possibly be said about a contract
 *    nobody has ever looked at. {@link lookupLatch} preserves that distinction
 *    by asking `isRegistered` first and returning a different shape entirely.
 */

import { getAddress, isAddress, type Address } from "viem";
import {
  LATCH_HOOK_REGISTRY_ABI,
  decodeLatchRecord,
  type LatchRecord,
  type RawLatchRecord,
} from "@latchprotocol/sdk";

import {
  CL_INITIALIZE_EVENT,
  FEE_CONTROLLER_ABI,
  HOOK_BITMAP_ABI,
  TIMELOCK_ABI,
  VAULT_ABI,
} from "./abi.js";
import type { LatchContext } from "./context.js";

/** Normalises to a checksummed address or throws. */
export function requireAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new TypeError(`${field} must be a 20-byte hex address, received: ${String(value)}`);
  }
  return getAddress(value);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type LatchLookup =
  | {
      readonly found: true;
      readonly record: LatchRecord;
      readonly blockNumber: bigint;
    }
  | {
      readonly found: false;
      readonly address: Address;
      /** Distinguishes an unlisted contract from an EOA or a typo. */
      readonly hasCode: boolean;
      /**
       * Present when the contract answered `getHooksRegistrationBitmap()`. An
       * unlisted hook still has a bitmap, and the pool manager enforces it just
       * as strictly, so this is worth reporting.
       */
      readonly onChainBitmap?: number;
      readonly blockNumber: bigint;
    };

/**
 * Look one address up in the registry.
 *
 * `isRegistered` is asked first and on its own: it is the registry's own answer
 * to exactly this question and it is the gate everything else sits behind.
 */
export async function lookupLatch(ctx: LatchContext, address: Address): Promise<LatchLookup> {
  const { publicClient: c, deployment: d } = ctx;

  const [registered, blockNumber] = await Promise.all([
    c.readContract({
      address: d.registry,
      abi: LATCH_HOOK_REGISTRY_ABI,
      functionName: "isRegistered",
      args: [address],
    }) as Promise<boolean>,
    c.getBlockNumber(),
  ]);

  if (!registered) {
    const code = await c.getCode({ address });
    const hasCode = Boolean(code && code !== "0x");
    const onChainBitmap = hasCode ? await tryReadHookBitmap(ctx, address) : undefined;
    return onChainBitmap === undefined
      ? { found: false, address, hasCode, blockNumber }
      : { found: false, address, hasCode, onChainBitmap, blockNumber };
  }

  const raw = (await c.readContract({
    address: d.registry,
    abi: LATCH_HOOK_REGISTRY_ABI,
    functionName: "getLatch",
    args: [address],
  })) as unknown as RawLatchRecord;

  return { found: true, record: decodeLatchRecord(address, raw), blockNumber };
}

/**
 * Read a contract's own permission bitmap.
 *
 * Returns undefined when the call reverts or the address is not a hook - which
 * is the common case and not an error. A revert here says "this contract does
 * not present a hook interface", nothing more.
 */
export async function tryReadHookBitmap(
  ctx: LatchContext,
  address: Address,
): Promise<number | undefined> {
  try {
    const bitmap = (await ctx.publicClient.readContract({
      address,
      abi: HOOK_BITMAP_ABI,
      functionName: "getHooksRegistrationBitmap",
    })) as number;
    return Number(bitmap);
  } catch {
    return undefined;
  }
}

export interface LatchPage {
  readonly total: number;
  readonly offset: number;
  readonly records: readonly LatchRecord[];
  readonly blockNumber: bigint;
}

/**
 * A page of listings.
 *
 * `listLatches(offset, limit)` is the contract's own paginator, so the page
 * boundary is the chain's rather than one this package invented. Records are
 * fetched individually because the registry stores them in a mapping; the
 * address array is the index.
 */
export async function listLatchRecords(
  ctx: LatchContext,
  offset: number,
  limit: number,
): Promise<LatchPage> {
  const { publicClient: c, deployment: d } = ctx;

  const [total, blockNumber] = await Promise.all([
    c.readContract({
      address: d.registry,
      abi: LATCH_HOOK_REGISTRY_ABI,
      functionName: "latchCount",
    }) as Promise<bigint>,
    c.getBlockNumber(),
  ]);

  if (total === 0n || offset >= Number(total)) {
    return { total: Number(total), offset, records: [], blockNumber };
  }

  const addresses = (await c.readContract({
    address: d.registry,
    abi: LATCH_HOOK_REGISTRY_ABI,
    functionName: "listLatches",
    args: [BigInt(offset), BigInt(limit)],
  })) as readonly Address[];

  const records = await Promise.all(
    addresses.map(async (a) => {
      const raw = (await c.readContract({
        address: d.registry,
        abi: LATCH_HOOK_REGISTRY_ABI,
        functionName: "getLatch",
        args: [a],
      })) as unknown as RawLatchRecord;
      return decodeLatchRecord(a, raw);
    }),
  );

  return { total: Number(total), offset, records, blockNumber };
}

// ---------------------------------------------------------------------------
// Protocol status
// ---------------------------------------------------------------------------

export interface PoolCensus {
  readonly poolCount: number;
  readonly hookedPoolCount: number;
}

/**
 * Count pools from `Initialize` logs on the CL pool manager.
 *
 * Scoped by emitting address deliberately. Latch declares 34 events across only
 * 22 unique signatures because `ProtocolFees` is a shared base, so a filter on
 * topic0 alone silently merges CL and Bin activity into one wrong number.
 *
 * Returns undefined when the endpoint refuses the range - a public RPC capping
 * `eth_getLogs` is an ordinary occurrence, and reporting "unknown" is correct
 * where reporting zero would be a lie.
 */
export async function tryCountPools(ctx: LatchContext): Promise<PoolCensus | undefined> {
  try {
    const logs = await ctx.publicClient.getLogs({
      address: ctx.deployment.clPoolManager,
      event: CL_INITIALIZE_EVENT[0],
      fromBlock: ctx.deployment.deployedAtBlock,
      toBlock: "latest",
    });
    const zero = "0x0000000000000000000000000000000000000000";
    let hooked = 0;
    for (const l of logs) {
      if ((l.args.hooks as string | undefined)?.toLowerCase() !== zero) hooked++;
    }
    return { poolCount: logs.length, hookedPoolCount: hooked };
  } catch {
    return undefined;
  }
}

export interface ProtocolStatusRead {
  readonly blockNumber: bigint;
  readonly vaultOwner: Address;
  readonly clPoolManagerRegistered: boolean;
  readonly binPoolManagerRegistered: boolean;
  readonly defaultProtocolFeePips: number;
  readonly maxProtocolFeePips: number;
  readonly protocolFeesDisabled: boolean;
  readonly feeControllerGuardian: Address;
  readonly feeControllerOwner: Address;
  readonly custodyTimelockSeconds: bigint;
  readonly policyTimelockSeconds: bigint;
  readonly latchCount: number;
  readonly pools: PoolCensus | undefined;
}

export async function readProtocolStatus(ctx: LatchContext): Promise<ProtocolStatusRead> {
  const { publicClient: c, deployment: d } = ctx;

  const [
    blockNumber,
    vaultOwner,
    clReg,
    binReg,
    defaultFee,
    maxFee,
    disabled,
    guardian,
    feeOwner,
    custody,
    policy,
    latchCount,
    pools,
  ] = await Promise.all([
    c.getBlockNumber(),
    c.readContract({ address: d.vault, abi: VAULT_ABI, functionName: "owner" }) as Promise<Address>,
    c.readContract({
      address: d.vault,
      abi: VAULT_ABI,
      functionName: "isAppRegistered",
      args: [d.clPoolManager],
    }) as Promise<boolean>,
    c.readContract({
      address: d.vault,
      abi: VAULT_ABI,
      functionName: "isAppRegistered",
      args: [d.binPoolManager],
    }) as Promise<boolean>,
    c.readContract({
      address: d.feeController,
      abi: FEE_CONTROLLER_ABI,
      functionName: "DEFAULT_FEE_PIPS",
    }) as Promise<number>,
    c.readContract({
      address: d.feeController,
      abi: FEE_CONTROLLER_ABI,
      functionName: "MAX_PROTOCOL_FEE",
    }) as Promise<number>,
    c.readContract({
      address: d.feeController,
      abi: FEE_CONTROLLER_ABI,
      functionName: "feesDisabled",
    }) as Promise<boolean>,
    c.readContract({
      address: d.feeController,
      abi: FEE_CONTROLLER_ABI,
      functionName: "guardian",
    }) as Promise<Address>,
    c.readContract({
      address: d.feeController,
      abi: FEE_CONTROLLER_ABI,
      functionName: "owner",
    }) as Promise<Address>,
    c.readContract({
      address: d.timelockCustody,
      abi: TIMELOCK_ABI,
      functionName: "getMinDelay",
    }) as Promise<bigint>,
    c.readContract({
      address: d.timelockPolicy,
      abi: TIMELOCK_ABI,
      functionName: "getMinDelay",
    }) as Promise<bigint>,
    c.readContract({
      address: d.registry,
      abi: LATCH_HOOK_REGISTRY_ABI,
      functionName: "latchCount",
    }) as Promise<bigint>,
    tryCountPools(ctx),
  ]);

  return {
    blockNumber,
    vaultOwner,
    clPoolManagerRegistered: clReg,
    binPoolManagerRegistered: binReg,
    defaultProtocolFeePips: Number(defaultFee),
    maxProtocolFeePips: Number(maxFee),
    protocolFeesDisabled: disabled,
    feeControllerGuardian: guardian,
    feeControllerOwner: feeOwner,
    custodyTimelockSeconds: custody,
    policyTimelockSeconds: policy,
    latchCount: Number(latchCount),
    pools,
  };
}

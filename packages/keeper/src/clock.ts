/* ============================================================================
   The block number CONTRACTS see — which on Robinhood is not eth_blockNumber.

   Robinhood Chain (4663) is Arbitrum Nitro. Inside the EVM `block.number` is
   Ethereum L1's block number (~26M, ~12 s per block); `eth_blockNumber` and
   `getBlock().number` are the L2 block (~62M, ~0.1 s). `RevShareHook` stores
   `effectiveBlock` and `expiryBlock` on the EVM clock. Comparing them against
   the L2 number made every proposal look expired, so this keeper would have
   refused, forever, to apply any proposal on 4663. Measured and proven against
   mined state on 2026-09-13; see `packages/sdk/src/chains/clock.ts`.

   WHY A COPY AND NOT AN IMPORT. The keeper image builds from this package
   directory alone (see Dockerfile) and does not depend on `@latchprotocol/sdk`.
   This file mirrors `readContractClock` from `packages/sdk/src/chains/clock.ts`
   — same probe bytecode, same fallback order, same refusal to substitute the L2
   number — and `test/clock.test.mjs` pins the same fixtures the SDK's test does.
   If the two ever disagree, the SDK is the reference.

   Two clocks, two jobs:
     contractBlockNumber   compare against anything a contract STORED
     blockNumber (L2)      log ranges and the tick banner, nothing else
   ============================================================================ */

import type { Hex } from 'viem'

export type ContractBlockClock = 'parent-l1' | 'native'

/** Chains whose clock is known. Anything else is probed. */
export const KNOWN_CONTRACT_CLOCKS: Readonly<Record<number, ContractBlockClock>> = {
  4663: 'parent-l1',
  11155111: 'native',
}

/** NUMBER, MSTORE 0, TIMESTAMP, MSTORE 32, RETURN 64 — run as a contract-creation eth_call. */
export const CONTRACT_CLOCK_PROBE_CALLDATA: Hex = '0x436000524260205260406000f3'

export interface ContractClockClient {
  call(args: { data: Hex }): Promise<{ data?: Hex | undefined }>
  getBlock(): Promise<{ number: bigint | null; timestamp: bigint }>
}

export type ContractClockMethod = 'eth_call NUMBER' | 'header l1BlockNumber' | 'eth_blockNumber'

export interface ContractClockReading {
  readonly clock: ContractBlockClock
  /** `block.number` as a contract executing now sees it. */
  readonly contractBlockNumber: bigint
  /** `eth_blockNumber`. The log clock. */
  readonly rpcBlockNumber: bigint
  readonly timestamp: bigint
  readonly method: ContractClockMethod
}

export function decodeContractClockProbe(data: Hex): { number: bigint; timestamp: bigint } {
  const hex = data.startsWith('0x') ? data.slice(2) : data
  if (hex.length !== 128) throw new Error(`clock probe returned ${hex.length / 2} bytes, expected 64`)
  return { number: BigInt(`0x${hex.slice(0, 64)}`), timestamp: BigInt(`0x${hex.slice(64)}`) }
}

function headerL1BlockNumber(block: unknown): bigint | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const v = (block as { l1BlockNumber?: unknown }).l1BlockNumber
  if (typeof v === 'bigint') return v
  if (typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v)
  return undefined
}

/**
 * Reads both clocks. Never returns the L2 number as the contract number on a
 * chain that is not known to be native: it throws, and the tick fails loudly,
 * which is the honest outcome.
 */
export async function readContractClock(client: ContractClockClient, chainId: number): Promise<ContractClockReading> {
  const known = KNOWN_CONTRACT_CLOCKS[chainId]
  const block = await client.getBlock()
  if (block.number === null) throw new Error('latest block has no number')

  if (known === 'native') {
    return {
      clock: 'native',
      contractBlockNumber: block.number,
      rpcBlockNumber: block.number,
      timestamp: block.timestamp,
      method: 'eth_blockNumber',
    }
  }

  let probe: { number: bigint; timestamp: bigint } | undefined
  try {
    const { data } = await client.call({ data: CONTRACT_CLOCK_PROBE_CALLDATA })
    if (data) probe = decodeContractClockProbe(data)
  } catch {
    probe = undefined
  }
  if (probe !== undefined) {
    return {
      clock: known ?? (probe.number === block.number ? 'native' : 'parent-l1'),
      contractBlockNumber: probe.number,
      rpcBlockNumber: block.number,
      timestamp: probe.timestamp,
      method: 'eth_call NUMBER',
    }
  }

  const l1 = headerL1BlockNumber(block)
  if (l1 !== undefined) {
    return {
      clock: known ?? 'parent-l1',
      contractBlockNumber: l1,
      rpcBlockNumber: block.number,
      timestamp: block.timestamp,
      method: 'header l1BlockNumber',
    }
  }

  throw new Error(
    `cannot read the contract-visible block number on chain ${chainId}: the NUMBER probe failed and the ` +
      'header has no l1BlockNumber. eth_blockNumber is a different clock here and is not used as a substitute.',
  )
}

/* ------------------------------------------------------------------------- */
/*  Pending-config verdict, judged on the contract clock                      */
/* ------------------------------------------------------------------------- */

export type PendingPhase = 'none' | 'not-due' | 'applicable' | 'expired'

/**
 * Mirrors `RevShareHook.applyPendingConfig`'s own guards:
 *   effectiveBlock == 0                       NoPendingConfig
 *   block.number <  effectiveBlock            PendingConfigNotDue
 *   block.number >  expiryBlock               PendingConfigExpired   (current shape only)
 *
 * `contractBlockNumber` MUST come from `readContractClock`. Passing the L2
 * number is the bug this file exists to prevent, and the test pins it.
 */
export function pendingPhase(
  pending: { readonly effectiveBlock: bigint; readonly expiryBlock: bigint | null },
  contractBlockNumber: bigint,
): PendingPhase {
  if (pending.effectiveBlock === 0n) return 'none'
  if (contractBlockNumber < pending.effectiveBlock) return 'not-due'
  if (pending.expiryBlock !== null && pending.expiryBlock !== 0n && contractBlockNumber > pending.expiryBlock) {
    return 'expired'
  }
  return 'applicable'
}

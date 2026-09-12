// SPDX-License-Identifier: MIT
/**
 * Launch call path.
 *
 * ## A Latch launch is a pool, and buying into one is a swap
 *
 * There is no Latch sale contract. No `buy`, no soft cap, no hard cap, no
 * allocation, no claim, no per-wallet limit. A launch is an ordinary
 * concentrated-liquidity pool with `LaunchGuardHook` named in its `PoolKey`,
 * a **dynamic** LP fee, and a fee schedule that decays from `initialFeeBips`
 * to `finalFeeBips` over `decayBlocks` blocks starting at `startBlock`.
 *
 * That single design decision is what shapes this file. From the hook's own
 * source (`packages/hooks/src/launch/LaunchGuardHook.sol`):
 *
 * > THE `sender` ARGUMENT OF EVERY HOOK CALLBACK IS THE LOCKER, NOT THE END
 * > USER. […] Consequence: NO identity-based protection is implementable at
 * > this layer. There are no per-wallet caps, no allowlists, and no "one buy
 * > per address" rules in this hook, because none of them could be enforced
 * > honestly.
 *
 * So there is nothing per-account to read and nothing per-account to display.
 * Everything the hook knows is keyed by `PoolId`, and the only write path is
 * a swap through the router — which this package already encodes correctly in
 * {@link ./swap.js}. {@link buildLaunchBuyCall} therefore does not invent a
 * second call path: it checks the gates the hook will check, and then delegates
 * to `buildSwapCall`.
 *
 * ## What this file reads
 *
 * `LAUNCH_GUARD_HOOK_ABI` comes from `@latchprotocol/sdk`, which generates it
 * from compiled artifacts rather than from the GPL Solidity sources, so nothing
 * here puts an MIT consumer inside the core contracts' licence.
 *
 * Three views on the hook matter to a UI, all keyed by pool id:
 *
 * ```solidity
 * function getLaunch(PoolId poolId) external view returns (Launch memory);
 * function currentFee(PoolId poolId) external view returns (uint24);
 * function feeAt(PoolId poolId, uint256 blockNumber) external view returns (uint24);
 * ```
 *
 * ## A naming trap worth stating once
 *
 * The struct fields are called `initialFeeBips` and `finalFeeBips`, but the
 * hook's own denominator is
 *
 * ```solidity
 * uint24 public constant FEE_DENOMINATOR = LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE; // 1_000_000
 * ```
 *
 * so the unit is **pips** (hundredths of a basis point), not bips: `3_000` is
 * 0.30%, not 30%. The ABI keeps the contract's spelling because that is the
 * ABI; the TypeScript below says `Pips`, because that is what the number means.
 * Rendering these with a bps formatter would overstate every launch fee 100x.
 */

import { isAddressEqual, type Address } from "viem";
import { LAUNCH_GUARD_HOOK_ABI } from "@latchprotocol/sdk";
import {
  buildSwapCall,
  type BuildSwapCallArgs,
  type EncodedSwapCall,
  type SwapHop,
} from "./swap.js";

/** The hook's ABI, re-exported so callers need not depend on the SDK directly. */
export { LAUNCH_GUARD_HOOK_ABI };

/**
 * `LaunchGuardHook.FEE_DENOMINATOR`. 1_000_000 == 100%.
 *
 * Identical to the protocol-wide pips denominator, which is why a launch fee
 * can be rendered with the same formatter as any other LP fee.
 */
export const LAUNCH_FEE_DENOMINATOR = 1_000_000;

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * A decoded `LaunchGuardHook.Launch` record.
 *
 * Field-for-field the struct, with two changes and no additions: `startBlock`
 * is widened to `bigint` so it can be compared with a block number without a
 * lossy cast, and the fee fields are renamed to the unit they are actually in.
 */
export interface LaunchGuard {
  /** Launch owner. The zero address means the pool id has never been claimed. */
  readonly owner: Address;
  /** First block at which swaps are permitted. */
  readonly startBlock: bigint;
  /** Length of the decay window in blocks, from `startBlock`. */
  readonly decayBlocks: number;
  /**
   * When false the hook applies no gate and no tax: it overrides the fee with
   * `finalFeePips` and nothing else. It does NOT mean "no hook".
   */
  readonly enabled: boolean;
  /** Fee at `startBlock`, in pips. */
  readonly initialFeePips: number;
  /** Fee at and after `startBlock + decayBlocks`, in pips. */
  readonly finalFeePips: number;
  /**
   * Per-TRANSACTION cap on the input amount of a buy, in the quote currency.
   * `0` disables it. This is not a per-wallet cap and cannot be made into one.
   */
  readonly maxBuyPerTx: bigint;
  /** Which side of the pool is the token being launched. */
  readonly launchTokenIsCurrency0: boolean;
  /** Set by the hook on the first swap at or after `startBlock`. */
  readonly launched: boolean;
}

/** The tuple shape `getLaunch` returns, as viem decodes it. */
export interface RawLaunchGuard {
  readonly owner: Address;
  readonly startBlock: number | bigint;
  readonly decayBlocks: number;
  readonly enabled: boolean;
  readonly initialFeeBips: number;
  readonly finalFeeBips: number;
  readonly maxBuyPerTx: bigint;
  readonly launchTokenIsCurrency0: boolean;
  readonly launched: boolean;
}

/** Normalises a `getLaunch` result into a {@link LaunchGuard}. */
export function decodeLaunchGuard(raw: RawLaunchGuard): LaunchGuard {
  return {
    owner: raw.owner,
    startBlock: BigInt(raw.startBlock),
    decayBlocks: raw.decayBlocks,
    enabled: raw.enabled,
    initialFeePips: raw.initialFeeBips,
    finalFeePips: raw.finalFeeBips,
    maxBuyPerTx: raw.maxBuyPerTx,
    launchTokenIsCurrency0: raw.launchTokenIsCurrency0,
    launched: raw.launched,
  };
}

/** `false` when the pool id has never been claimed, i.e. there is no launch. */
export function isLaunchConfigured(guard: LaunchGuard): boolean {
  return !isAddressEqual(guard.owner, ZERO_ADDRESS);
}

/**
 * Where a launch is in its schedule.
 *
 * - `unclaimed` — no launch record. Every view on the hook reverts
 *   `LaunchNotConfigured`, and the pool could not have been initialized.
 * - `disabled` — `enabled == false`. No gate, no tax; the hook only pins the
 *   fee at `finalFeePips`. Trading is open.
 * - `pending` — `block.number < startBlock`. Every swap reverts
 *   `TradingNotOpen`. The owner may still move `startBlock`.
 * - `decaying` — inside `[startBlock, startBlock + decayBlocks)`. The fee is
 *   above `finalFeePips` and `maxBuyPerTx` is enforced if it is set.
 * - `settled` — at or past `startBlock + decayBlocks`. The fee is exactly
 *   `finalFeePips` and the per-transaction cap no longer applies.
 */
export type LaunchPhase = "unclaimed" | "disabled" | "pending" | "decaying" | "settled";

/** The schedule as of one specific block. Pure; nothing here is interpolated. */
export interface LaunchSchedule {
  readonly phase: LaunchPhase;
  /** The block this view was computed for. */
  readonly blockNumber: bigint;
  readonly startBlock: bigint | null;
  /** `startBlock + decayBlocks`, the first block at the final fee. */
  readonly endBlock: bigint | null;
  /** Blocks until trading opens, or `null` when it already has. */
  readonly blocksUntilOpen: bigint | null;
  /** Blocks left in the decay window, or `null` outside it. */
  readonly blocksRemaining: bigint | null;
  /** Progress through the decay window in bps, or `null` outside it. */
  readonly decayProgressBps: number | null;
  /** Fee a swap in this block pays, in pips. `null` when unclaimed. */
  readonly feePips: number | null;
  readonly initialFeePips: number | null;
  readonly finalFeePips: number | null;
  /** `true` when a swap in this block would be accepted by the hook. */
  readonly tradingOpen: boolean;
  /** The configured cap, or `null` when none is set. */
  readonly maxBuyPerTx: bigint | null;
  /** `true` only while the hook would actually check that cap. */
  readonly maxBuyPerTxEnforced: boolean;
}

/**
 * The fee a swap in `blockNumber` pays, in pips — an exact mirror of
 * `LaunchGuardHook.feeAt` including its rounding.
 *
 * The subtracted discount is floored, so the fee rounds **up**, toward the LPs
 * and away from the sniper. Reproducing that direction matters: a UI that
 * rounded the other way would quote a fee lower than the one charged.
 *
 * Returns `null` for an unclaimed pool, where the contract reverts. For a block
 * before `startBlock` it returns `initialFeePips`, matching the contract —
 * though such a swap would in fact revert, so read that value as "the fee at
 * the open" rather than as a fee anyone can pay.
 */
export function launchFeeAtBlock(guard: LaunchGuard, blockNumber: bigint): number | null {
  if (!isLaunchConfigured(guard)) return null;
  if (!guard.enabled) return guard.finalFeePips;
  if (blockNumber < guard.startBlock) return guard.initialFeePips;
  const decayBlocks = BigInt(guard.decayBlocks);
  const elapsed = blockNumber - guard.startBlock;
  if (decayBlocks <= 0n || elapsed >= decayBlocks) return guard.finalFeePips;
  const spread = BigInt(guard.initialFeePips - guard.finalFeePips);
  const discount = (spread * elapsed) / decayBlocks;
  return guard.initialFeePips - Number(discount);
}

/** Derives the whole schedule for one block. Pure. */
export function launchScheduleAt(guard: LaunchGuard, blockNumber: bigint): LaunchSchedule {
  if (!isLaunchConfigured(guard)) {
    return {
      phase: "unclaimed",
      blockNumber,
      startBlock: null,
      endBlock: null,
      blocksUntilOpen: null,
      blocksRemaining: null,
      decayProgressBps: null,
      feePips: null,
      initialFeePips: null,
      finalFeePips: null,
      tradingOpen: false,
      maxBuyPerTx: null,
      maxBuyPerTxEnforced: false,
    };
  }

  const decayBlocks = BigInt(guard.decayBlocks);
  const endBlock = guard.startBlock + decayBlocks;
  const feePips = launchFeeAtBlock(guard, blockNumber);
  const maxBuyPerTx = guard.maxBuyPerTx === 0n ? null : guard.maxBuyPerTx;

  // A disabled launch is not gated and not taxed. `beforeSwap` returns the
  // final fee and returns early, so neither the start block nor the cap is
  // consulted - reporting a countdown here would be describing a gate that
  // does not run.
  if (!guard.enabled) {
    return {
      phase: "disabled",
      blockNumber,
      startBlock: guard.startBlock,
      endBlock,
      blocksUntilOpen: null,
      blocksRemaining: null,
      decayProgressBps: null,
      feePips,
      initialFeePips: guard.initialFeePips,
      finalFeePips: guard.finalFeePips,
      tradingOpen: true,
      maxBuyPerTx,
      maxBuyPerTxEnforced: false,
    };
  }

  if (blockNumber < guard.startBlock) {
    return {
      phase: "pending",
      blockNumber,
      startBlock: guard.startBlock,
      endBlock,
      blocksUntilOpen: guard.startBlock - blockNumber,
      blocksRemaining: null,
      decayProgressBps: 0,
      feePips,
      initialFeePips: guard.initialFeePips,
      finalFeePips: guard.finalFeePips,
      tradingOpen: false,
      maxBuyPerTx,
      maxBuyPerTxEnforced: false,
    };
  }

  const elapsed = blockNumber - guard.startBlock;
  if (decayBlocks > 0n && elapsed < decayBlocks) {
    return {
      phase: "decaying",
      blockNumber,
      startBlock: guard.startBlock,
      endBlock,
      blocksUntilOpen: null,
      blocksRemaining: decayBlocks - elapsed,
      decayProgressBps: Number((elapsed * 10_000n) / decayBlocks),
      feePips,
      initialFeePips: guard.initialFeePips,
      finalFeePips: guard.finalFeePips,
      tradingOpen: true,
      maxBuyPerTx,
      maxBuyPerTxEnforced: maxBuyPerTx !== null,
    };
  }

  return {
    phase: "settled",
    blockNumber,
    startBlock: guard.startBlock,
    endBlock,
    blocksUntilOpen: null,
    blocksRemaining: null,
    decayProgressBps: 10_000,
    feePips,
    initialFeePips: guard.initialFeePips,
    finalFeePips: guard.finalFeePips,
    tradingOpen: true,
    maxBuyPerTx,
    maxBuyPerTxEnforced: false,
  };
}

/**
 * Why the hook would reject this buy. `null` means it would not.
 *
 * Each value names an actual revert in `LaunchGuardHook`, so a blocked button
 * here corresponds to a transaction that would have failed rather than to a
 * rule the widget made up.
 */
export type LaunchBuyBlockReason =
  | "not-configured"
  | "trading-not-open"
  | "exceeds-max-buy-per-tx"
  | null;

/** Result of {@link evaluateLaunchBuy}. */
export interface LaunchBuyGate {
  readonly reason: LaunchBuyBlockReason;
  /** A message suitable for a disabled button, or `null` when not blocked. */
  readonly message: string | null;
  /** The contract error this would surface as, or `null`. */
  readonly revert: string | null;
}

/**
 * Evaluates the gates `LaunchGuardHook._beforeSwap` will evaluate.
 *
 * `amountIn` is the input amount of the swap, denominated in the **quote**
 * currency, which is the denomination `maxBuyPerTx` uses. Pass `null` while the
 * amount field is empty: the schedule gates are still checked, the cap is not.
 *
 * This covers only the hook. Balance, allowance and slippage are the swap
 * path's business and are evaluated there.
 */
export function evaluateLaunchBuy(args: {
  readonly guard: LaunchGuard;
  readonly blockNumber: bigint;
  readonly amountIn: bigint | null;
}): LaunchBuyGate {
  const schedule = launchScheduleAt(args.guard, args.blockNumber);

  if (schedule.phase === "unclaimed") {
    return {
      reason: "not-configured",
      message: "No launch is configured for this pool",
      revert: "LaunchNotConfigured",
    };
  }
  if (!schedule.tradingOpen) {
    return {
      reason: "trading-not-open",
      message: "Trading has not opened yet",
      revert: "TradingNotOpen",
    };
  }
  if (
    schedule.maxBuyPerTxEnforced &&
    schedule.maxBuyPerTx !== null &&
    args.amountIn !== null &&
    args.amountIn > schedule.maxBuyPerTx
  ) {
    return {
      reason: "exceeds-max-buy-per-tx",
      message: "Amount is over the per-transaction cap for this launch",
      revert: "BuyExceedsMaxPerTx",
    };
  }
  return { reason: null, message: null, revert: null };
}

/**
 * `true` when this hop buys the launch token, i.e. its input is the quote
 * currency.
 *
 * Mirrors the hook: `isBuy = launchTokenIsCurrency0 ? !zeroForOne : zeroForOne`.
 * Only a buy is subject to `maxBuyPerTx`; a sell is uncapped by design.
 */
export function hopIsLaunchBuy(hop: SwapHop, guard: LaunchGuard): boolean {
  const zeroForOne = isAddressEqual(hop.poolKey.currency0, hop.currencyIn);
  return guard.launchTokenIsCurrency0 ? !zeroForOne : zeroForOne;
}

/** Arguments for {@link buildLaunchBuyCall}. */
export interface BuildLaunchBuyArgs extends Omit<BuildSwapCallArgs, "hops"> {
  /**
   * The launch pool. A single hop: the hook governs one pool, and routing a
   * launch buy through an intermediate pool would leave the guard un-consulted
   * on the leg that matters.
   */
  readonly hop: SwapHop;
  /** The launch record read from the hook, used to check the gates. */
  readonly guard: LaunchGuard;
  /** Block the gates are evaluated against — the latest one read from chain. */
  readonly blockNumber: bigint;
}

/**
 * Encodes a launch buy.
 *
 * This is {@link buildSwapCall} with the hook's preconditions checked first. It
 * is not a different transaction and there is no launch-specific calldata: the
 * router, the action plan and the integrator fee step are all exactly the swap
 * path's, because buying into a launch is a swap.
 *
 * Throws rather than encoding when the hook would revert. A launch fails in
 * `beforeSwap`, which is inside the vault lock, so the user pays gas for the
 * whole plan before finding out — refusing here is strictly cheaper than
 * letting them send it.
 *
 * Exact-output is not encodable at all: `beforeSwap` cannot know the input
 * amount of an exact-output swap, so the hook rejects one outright while the
 * cap is live (`ExactOutputBuyBlockedDuringLaunch`). This package only encodes
 * exact-input swaps, so the case cannot arise here.
 */
export function buildLaunchBuyCall(args: BuildLaunchBuyArgs): EncodedSwapCall {
  if (args.hop.poolType !== "CL") {
    throw new Error(
      "[@latchprotocol/widgets] LaunchGuardHook governs concentrated-liquidity pools only; " +
        `received a ${args.hop.poolType} hop. BinLaunchGuardHook is a separate contract with a ` +
        "different call path.",
    );
  }
  if (isAddressEqual(args.hop.poolKey.hooks, ZERO_ADDRESS)) {
    // A pool key naming no hook has no guard to consult, so the whole schedule
    // this function just validated would apply to nothing.
    throw new Error(
      "[@latchprotocol/widgets] the pool key names no hook, so it is not a launch pool",
    );
  }
  if (!hopIsLaunchBuy(args.hop, args.guard)) {
    throw new Error(
      "[@latchprotocol/widgets] this hop sells the launch token rather than buying it. " +
        "Sells are ordinary swaps: use buildSwapCall directly.",
    );
  }

  const gate = evaluateLaunchBuy({
    guard: args.guard,
    blockNumber: args.blockNumber,
    amountIn: args.amountIn,
  });
  if (gate.reason !== null) {
    throw new Error(
      `[@latchprotocol/widgets] refusing to encode a launch buy: ${gate.message} ` +
        `(the hook would revert ${gate.revert})`,
    );
  }

  const { hop, guard, blockNumber, ...swapArgs } = args;
  void guard;
  void blockNumber;
  return buildSwapCall({ ...swapArgs, hops: [hop] });
}

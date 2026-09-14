// SPDX-License-Identifier: MIT
/**
 * Launches, read from the configured `LaunchpadKit` and its `LaunchGuardHook`.
 *
 * ---------------------------------------------------------------------------
 * WHAT A LATCH LAUNCH IS, BECAUSE IT IS NOT A TOKEN SALE
 * ---------------------------------------------------------------------------
 *
 * There is no sale contract, no soft cap, no allocation and no claim. A launch
 * is a POOL with a hook attached whose LP fee starts high and decays, over a
 * window, to a final rate — plus an optional per-transaction buy cap while it
 * decays. The tax is an LP-fee override, so it accrues to in-range liquidity
 * providers through core rather than to the launchpad, the hook, or you.
 *
 * That matters for anything built on this module: do not render a progress bar
 * against a hard cap, because there is no cap to progress toward. What exists
 * is a schedule, a current fee, and whether the first swap has happened.
 *
 * ---------------------------------------------------------------------------
 * TWO HOOK GENERATIONS, TWO CLOCKS
 * ---------------------------------------------------------------------------
 *
 * The first kit and hook deployed on Robinhood Chain count durations in
 * `block.number` (`startBlock`, `decayBlocks`). On an Arbitrum chain that is
 * Ethereum's block number, ~12 s a block, not the ~0.1 s L2 block the RPC
 * shows, so every block-denominated window runs on a clock the kit's own
 * `blockTimeCentis` misdescribed. The redeployed pair counts in
 * `block.timestamp` (`startTime`, `decaySeconds`) and answers ERC-6372
 * `CLOCK_MODE()` with `"mode=timestamp"`.
 *
 * A tenant may point `chain.launchpadKit` at either, so this module resolves
 * the clock per kit — from the SDK address book when the kit is Latch's own,
 * otherwise by probing `CLOCK_MODE()` (a REVERT means the block-numbered
 * build; a transport failure is thrown, never read as a revert) — and then
 * reads through the matching ABI. The two `LaunchCreated` events have
 * different topics, so reading one generation through the other's ABI finds
 * no logs rather than wrong ones; the struct reads are what would silently
 * reinterpret, and the clock is resolved before any of them.
 *
 * `@latchprotocol/widgets` also exports a `LaunchWidget` that reads
 * LaunchGuardHook directly; this module is the unpackaged version for anyone
 * who wants to render the schedule their own way. Everything below is against
 * the real ABIs from `@latchprotocol/sdk`.
 */

import {
  CLOCK_MODE_CALLDATA,
  LAUNCHPAD_KIT_ABI,
  LAUNCHPAD_KIT_BLOCK_ABI,
  LAUNCH_GUARD_HOOK_ABI,
  LAUNCH_GUARD_HOOK_BLOCK_ABI,
  TIMESTAMP_CLOCK_MODE,
  readContractClock,
  type DurationClock,
} from "@latchprotocol/sdk";
import type { TokenInfo } from "@latchprotocol/widgets";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  decodeAbiParameters,
  getAbiItem,
  isAddressEqual,
  type Address,
  type Hex,
} from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";
import { readTokenMeta } from "./tokens";

/**
 * Presets `LaunchpadKit` accepts, in ENUM ORDER — and the order is the whole
 * point, because the index is sent straight to the contract as the preset.
 *
 * This array previously put `Custom` last, which rotated every value by one
 * against `LaunchPresets.Preset` (`0 Custom, 1 FairLaunch, 2
 * AntiSniperAggressive, 3 Stealth, 4 NoTax`). The comment already claimed
 * "in enum order", which is how it survived.
 *
 * Nothing reverted. Choosing FairLaunch launched the pool as `Custom` with
 * default fees, and choosing Custom launched it as `NoTax` while silently
 * discarding the fee and decay fields the user had just filled in — a launch
 * that opens with the wrong tax schedule and cannot be re-launched, because
 * `createLaunch` is first-come for a pool key. The read path mislabelled every
 * existing launch by one on the way back out, so the UI agreed with itself.
 *
 * If a preset is ever added to the Solidity enum it goes at the END there and
 * here, never inserted, or every launch created before the change is
 * retroactively mislabelled.
 */
export const PRESETS = [
  "Custom",
  "FairLaunch",
  "AntiSniperAggressive",
  "Stealth",
  "NoTax",
] as const;
export type PresetName = (typeof PRESETS)[number];

export function presetLabel(index: number): string {
  return PRESETS[index] ?? `Preset ${index}`;
}

export type LaunchPhase = "scheduled" | "decaying" | "settled";

/** Thrown by `readLaunches` when `chain.launchpadKit` is null. */
export class LaunchpadNotConfiguredError extends Error {
  constructor() {
    super(
      "No LaunchpadKit is configured. Set chain.launchpadKit in latch.config.ts, " +
        "or turn features.launchpad off.",
    );
    this.name = "LaunchpadNotConfiguredError";
  }
}

/** Thrown when a kit reports a `CLOCK_MODE()` this template does not understand. */
export class UnknownKitClockError extends Error {
  constructor(kit: Address, mode: string) {
    super(
      `LaunchpadKit ${kit} reports CLOCK_MODE "${mode}", which is neither the timestamp ` +
        "build nor the block-numbered one. Refusing to read its schedule through a guessed ABI.",
    );
    this.name = "UnknownKitClockError";
  }
}

function isRevert(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return (
    error.walk(
      (x) =>
        x instanceof ExecutionRevertedError ||
        x instanceof ContractFunctionRevertedError ||
        (x instanceof CallExecutionError && /revert/i.test(x.shortMessage)),
    ) !== null
  );
}

/**
 * The duration clock of `kit` (and therefore of the hook it is welded to —
 * the timestamp kit's constructor refuses a hook whose `CLOCK_MODE()` differs).
 *
 * The SDK address book is authoritative for Latch's own kit. Any other kit is
 * probed: only the timestamp build answers `CLOCK_MODE()`.
 */
export async function resolveKitClock(kit: Address): Promise<DurationClock> {
  const cfg = resolveConfig();
  const known = cfg.core.launchpadKit;
  if (known !== null && isAddressEqual(known, kit)) {
    const recorded = cfg.core.durationClocks.launchpadKit;
    if (recorded !== null) return recorded;
  }
  try {
    const { data } = await publicClient().call({ to: kit, data: CLOCK_MODE_CALLDATA });
    if (data === undefined || data === "0x") return "contract-block";
    const [mode] = decodeAbiParameters([{ type: "string" }], data);
    if (mode === TIMESTAMP_CLOCK_MODE) return "timestamp";
    throw new UnknownKitClockError(kit, mode);
  } catch (error) {
    if (isRevert(error)) return "contract-block";
    throw error;
  }
}

export interface LaunchRecord {
  readonly poolId: Hex;
  readonly launchToken: Address;
  readonly quoteToken: Address;
  readonly launchTokenMeta: TokenInfo | null;
  readonly quoteTokenMeta: TokenInfo | null;
  /** Sole holder of `reconfigureLaunch`, and only until the launch starts. */
  readonly operator: Address;
  /** Which clock `start`, `window` and `remaining` are on. */
  readonly durationClock: DurationClock;
  /** `startTime` (unix seconds) on a timestamp kit; `startBlock` (hook block) on a block kit. */
  readonly start: bigint;
  /** `decaySeconds` on a timestamp kit; `decayBlocks` on a block kit. */
  readonly window: number;
  readonly initialFeeBips: number;
  readonly finalFeeBips: number;
  /** Zero means uncapped. */
  readonly maxBuyPerTx: bigint;
  readonly preset: number;
  readonly createdAtBlock: bigint;

  /* --- read live off LaunchGuardHook, not from the creation event --- */

  /** The hook's current LP fee for this pool, in pips. */
  readonly currentFeePips: number | null;
  /** `false` when the launch owner disabled the schedule. */
  readonly enabled: boolean;
  /** True once the first swap has happened; the config is frozen from then on. */
  readonly launched: boolean;
  readonly phase: LaunchPhase;
  /** Seconds (timestamp kit) or HOOK blocks (block kit) until the decay finishes; null once it has. */
  readonly remaining: bigint | null;
}

export interface LaunchScan {
  readonly launches: readonly LaunchRecord[];
  /** Log-scan range start, on the RPC (log) clock. */
  readonly fromBlock: bigint;
  /** `eth_blockNumber` when scanned — the log clock. Not comparable to any schedule value. */
  readonly atBlock: bigint;
  /** The clock every record's schedule is on. */
  readonly durationClock: DurationClock;
  /**
   * "Now" on that clock: `block.timestamp` for a timestamp kit, the hook's
   * `block.number` for a block kit. On Robinhood the latter is Ethereum's
   * block number, not the L2 head; comparing against the L2 head showed every
   * launch as settled.
   */
  readonly now: bigint;
  /** `block.number` as the hook sees it, for provenance. */
  readonly contractBlockNumber: bigint;
  /** The hook the configured kit is welded to. Read off the kit, not assumed. */
  readonly hook: Address;
}

const LAUNCH_CREATED = getAbiItem({ abi: LAUNCHPAD_KIT_ABI, name: "LaunchCreated" });
const LAUNCH_CREATED_BLOCK = getAbiItem({ abi: LAUNCHPAD_KIT_BLOCK_ABI, name: "LaunchCreated" });

/** A creation event normalised across both generations. */
interface CreatedLaunch {
  readonly poolId: Hex;
  readonly launchToken: Address;
  readonly quoteToken: Address;
  readonly operator: Address;
  readonly start: bigint;
  readonly window: number;
  readonly initialFeeBips: number;
  readonly finalFeeBips: number;
  readonly maxBuyPerTx: bigint;
  readonly preset: number;
  readonly createdAtBlock: bigint;
}

async function readCreated(
  kit: Address,
  clock: DurationClock,
  fromBlock: bigint,
): Promise<CreatedLaunch[]> {
  const client = publicClient();
  if (clock === "timestamp") {
    const logs = await client.getLogs({ address: kit, event: LAUNCH_CREATED, fromBlock, toBlock: "latest" });
    return logs.map((log) => ({
      poolId: log.args.poolId as Hex,
      launchToken: log.args.launchToken as Address,
      quoteToken: log.args.quoteToken as Address,
      operator: log.args.operator as Address,
      start: BigInt(log.args.startTime ?? 0),
      window: Number(log.args.decaySeconds ?? 0),
      initialFeeBips: Number(log.args.initialFeeBips ?? 0),
      finalFeeBips: Number(log.args.finalFeeBips ?? 0),
      maxBuyPerTx: BigInt(log.args.maxBuyPerTx ?? 0n),
      preset: Number(log.args.preset ?? 0),
      createdAtBlock: log.blockNumber,
    }));
  }
  const logs = await client.getLogs({ address: kit, event: LAUNCH_CREATED_BLOCK, fromBlock, toBlock: "latest" });
  return logs.map((log) => ({
    poolId: log.args.poolId as Hex,
    launchToken: log.args.launchToken as Address,
    quoteToken: log.args.quoteToken as Address,
    operator: log.args.operator as Address,
    start: BigInt(log.args.startBlock ?? 0),
    window: Number(log.args.decayBlocks ?? 0),
    initialFeeBips: Number(log.args.initialFeeBips ?? 0),
    finalFeeBips: Number(log.args.finalFeeBips ?? 0),
    maxBuyPerTx: BigInt(log.args.maxBuyPerTx ?? 0n),
    preset: Number(log.args.preset ?? 0),
    createdAtBlock: log.blockNumber,
  }));
}

/** `launchPhase` on either clock: `start`, `end` and `now` must all be on the same one. */
export function launchPhase(start: bigint, window: number, now: bigint): LaunchPhase {
  const end = start + BigInt(window);
  return now < start ? "scheduled" : now < end ? "decaying" : "settled";
}

/**
 * Every launch the configured kit has created.
 *
 * Throws when no kit is configured. The caller must render that as
 * "not configured" — a distinct state from "no launches yet", because one means
 * the tenant has work to do and the other means the product is simply new.
 */
export async function readLaunches(): Promise<LaunchScan> {
  const cfg = resolveConfig();
  if (cfg.launchpadKit === null) {
    throw new LaunchpadNotConfiguredError();
  }
  const kit = cfg.launchpadKit;
  const client = publicClient();
  const fromBlock = cfg.core.deployedAtBlock;

  const durationClock = await resolveKitClock(kit);
  const [hook, created, clock] = await Promise.all([
    /* `hook()` has the same selector and return in both generations. */
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_ABI, functionName: "hook" }),
    readCreated(kit, durationClock, fromBlock),
    /* Every clock at once. Logs are indexed by the RPC's block; a timestamp
       schedule is on block.timestamp; a block schedule is on the EVM's
       block.number, which differs from the RPC block on Arbitrum chains. */
    readContractClock(client, cfg.core.chainId),
  ]);
  const now = durationClock === "timestamp" ? clock.timestamp : clock.contractBlockNumber;

  const launches = await Promise.all(
    created.map(async (c): Promise<LaunchRecord> => {
      const [launchTokenMeta, quoteTokenMeta, live, currentFeePips] = await Promise.all([
        readTokenMeta(c.launchToken),
        readTokenMeta(c.quoteToken),
        readHookLaunch(hook, c.poolId, durationClock),
        readCurrentFee(hook, c.poolId),
      ]);
      const phase = launchPhase(c.start, c.window, now);
      return {
        poolId: c.poolId,
        launchToken: c.launchToken,
        quoteToken: c.quoteToken,
        launchTokenMeta,
        quoteTokenMeta,
        operator: c.operator,
        durationClock,
        start: c.start,
        window: c.window,
        initialFeeBips: c.initialFeeBips,
        finalFeeBips: c.finalFeeBips,
        maxBuyPerTx: c.maxBuyPerTx,
        preset: c.preset,
        createdAtBlock: c.createdAtBlock,
        currentFeePips,
        enabled: live?.enabled ?? false,
        launched: live?.launched ?? false,
        phase,
        remaining: phase === "settled" ? null : c.start + BigInt(c.window) - now,
      };
    }),
  );

  launches.sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
  return {
    launches,
    fromBlock,
    atBlock: clock.rpcBlockNumber,
    durationClock,
    now,
    contractBlockNumber: clock.contractBlockNumber,
    hook,
  };
}

interface HookLaunch {
  readonly enabled: boolean;
  readonly launched: boolean;
}

async function readHookLaunch(hook: Address, poolId: Hex, clock: DurationClock): Promise<HookLaunch | null> {
  try {
    /* The two `Launch` structs share a word layout, so either ABI would decode
       either struct without error. The ABI is chosen by the resolved clock
       anyway, so the field names always mean what they say. */
    const launch =
      clock === "timestamp"
        ? await publicClient().readContract({
            address: hook,
            abi: LAUNCH_GUARD_HOOK_ABI,
            functionName: "getLaunch",
            args: [poolId],
          })
        : await publicClient().readContract({
            address: hook,
            abi: LAUNCH_GUARD_HOOK_BLOCK_ABI,
            functionName: "getLaunch",
            args: [poolId],
          });
    return { enabled: launch.enabled, launched: launch.launched };
  } catch {
    return null;
  }
}

async function readCurrentFee(hook: Address, poolId: Hex): Promise<number | null> {
  try {
    /* `currentFee(bytes32)` is identical in both generations. */
    const fee = await publicClient().readContract({
      address: hook,
      abi: LAUNCH_GUARD_HOOK_ABI,
      functionName: "currentFee",
      args: [poolId],
    });
    return Number(fee);
  } catch {
    return null;
  }
}

interface FeeBounds {
  readonly maxInitialFeeBips: number;
  readonly maxFinalFeeBips: number;
}

/** Bounds of a timestamp kit. Every duration is in seconds of `block.timestamp`. */
export interface TimestampLaunchBounds extends FeeBounds {
  readonly durationClock: "timestamp";
  /** `MIN_DECAY_SECONDS`: the shortest enabled decay window the hook accepts. */
  readonly minDecaySeconds: number;
  /** `MAX_DECAY_SECONDS`. */
  readonly maxDecaySeconds: number;
  /** `MAX_START_DELAY_SECONDS`. */
  readonly maxStartDelaySeconds: bigint;
}

/**
 * Bounds of a block-numbered kit. `MAX_DECAY_BLOCKS` and `MAX_START_DELAY` are
 * block counts, so their wall-clock meaning depends on how fast the HOOK's
 * `block.number` advances — on Robinhood Chain (Arbitrum) that is Ethereum's
 * block number, ~12 s per block, while the RPC's own blocks are ~0.1 s.
 */
export interface BlockLaunchBounds extends FeeBounds {
  readonly durationClock: "contract-block";
  readonly maxDecayBlocks: number;
  /** In hook blocks. */
  readonly maxStartDelay: bigint;
  /** Hundredths of a second per block AS THE KIT WAS CONFIGURED. Not a fact about the chain. */
  readonly blockTimeCentis: number;
  /** Hundredths of a second per block as the hook REALLY experiences it (SDK address book). */
  readonly contractBlockTimeCentis: number;
}

export type LaunchBounds = TimestampLaunchBounds | BlockLaunchBounds;

/** The kit's own bounds, read off the deployed contracts — never hardcoded here. */
export async function readLaunchBounds(): Promise<LaunchBounds> {
  const cfg = resolveConfig();
  if (cfg.launchpadKit === null) throw new LaunchpadNotConfiguredError();
  const kit = cfg.launchpadKit;
  const client = publicClient();

  const [durationClock, hook] = await Promise.all([
    resolveKitClock(kit),
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_ABI, functionName: "hook" }),
  ]);
  const [maxInitialFee, maxFinalFee] = await Promise.all([
    client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_INITIAL_FEE" }),
    client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_FINAL_FEE" }),
  ]);
  const fees = { maxInitialFeeBips: Number(maxInitialFee), maxFinalFeeBips: Number(maxFinalFee) };

  if (durationClock === "timestamp") {
    const [minDecay, maxDecay, maxStartDelay] = await Promise.all([
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MIN_DECAY_SECONDS" }),
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_DECAY_SECONDS" }),
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_START_DELAY_SECONDS" }),
    ]);
    return {
      durationClock,
      ...fees,
      minDecaySeconds: Number(minDecay),
      maxDecaySeconds: Number(maxDecay),
      maxStartDelaySeconds: BigInt(maxStartDelay),
    };
  }

  const [maxDecayBlocks, maxStartDelay, blockTimeCentis] = await Promise.all([
    client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_BLOCK_ABI, functionName: "MAX_DECAY_BLOCKS" }),
    client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_BLOCK_ABI, functionName: "MAX_START_DELAY" }),
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_BLOCK_ABI, functionName: "blockTimeCentis" }),
  ]);
  return {
    durationClock,
    ...fees,
    maxDecayBlocks: Number(maxDecayBlocks),
    maxStartDelay: BigInt(maxStartDelay),
    blockTimeCentis: Number(blockTimeCentis),
    contractBlockTimeCentis: cfg.core.contractBlockTimeCentis,
  };
}

/**
 * A schedule value converted to real seconds. On a timestamp kit the value is
 * already seconds. On a block kit pass `contractBlockTimeCentis` for real time;
 * pass the kit's `blockTimeCentis` only to show what the kit believes.
 */
export function windowToSeconds(
  value: number | bigint,
  bounds: LaunchBounds,
  centis: number = bounds.durationClock === "contract-block" ? bounds.contractBlockTimeCentis : 100,
): number {
  if (bounds.durationClock === "timestamp") return Number(value);
  return blocksToSeconds(value, centis);
}

/** Blocks converted to a rough duration at `blockTimeCentis` hundredths of a second each. */
export function blocksToSeconds(blocks: number | bigint, blockTimeCentis: number): number {
  return (Number(blocks) * blockTimeCentis) / 100;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

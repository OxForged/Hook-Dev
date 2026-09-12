// SPDX-License-Identifier: MIT
/**
 * Launches, read from the configured `LaunchpadKit` and its `LaunchGuardHook`.
 *
 * ---------------------------------------------------------------------------
 * WHAT A LATCH LAUNCH IS, BECAUSE IT IS NOT A TOKEN SALE
 * ---------------------------------------------------------------------------
 *
 * There is no sale contract, no soft cap, no allocation and no claim. A launch
 * is a POOL with a hook attached whose LP fee starts high and decays, block by
 * block, to a final rate — plus an optional per-transaction buy cap while it
 * decays. The tax is an LP-fee override, so it accrues to in-range liquidity
 * providers through core rather than to the launchpad, the hook, or you.
 *
 * That matters for anything built on this module: do not render a progress bar
 * against a hard cap, because there is no cap to progress toward. What exists
 * is a schedule, a current fee, and whether the first swap has happened.
 *
 * `@latchprotocol/widgets` also exports a `LaunchWidget`. It USED to be bound
 * to a proposed sale interface that no deployed Latch contract implements,
 * which is why this file exists. That has since been fixed — the widget now
 * reads LaunchGuardHook directly — so a tenant who wants the packaged surface
 * can use it, and this module stays as the unpackaged version for anyone who
 * wants to render the schedule their own way. Everything below is against the real
 * `LAUNCHPAD_KIT_ABI` and `LAUNCH_GUARD_HOOK_ABI` from `@latchprotocol/sdk`.
 */

import { LAUNCHPAD_KIT_ABI, LAUNCH_GUARD_HOOK_ABI } from "@latchprotocol/sdk";
import type { TokenInfo } from "@latchprotocol/widgets";
import { getAbiItem, type Address, type Hex } from "viem";

import { resolveConfig } from "../config/resolve";
import { publicClient } from "./client";
import { readTokenMeta } from "./tokens";

/** Presets `LaunchpadKit` accepts, in enum order. `Custom` passes raw parameters. */
export const PRESETS = [
  "FairLaunch",
  "AntiSniperAggressive",
  "Stealth",
  "NoTax",
  "Custom",
] as const;
export type PresetName = (typeof PRESETS)[number];

export function presetLabel(index: number): string {
  return PRESETS[index] ?? `Preset ${index}`;
}

export type LaunchPhase = "scheduled" | "decaying" | "settled";

export interface LaunchRecord {
  readonly poolId: Hex;
  readonly launchToken: Address;
  readonly quoteToken: Address;
  readonly launchTokenMeta: TokenInfo | null;
  readonly quoteTokenMeta: TokenInfo | null;
  /** Sole holder of `reconfigureLaunch`, and only until `startBlock`. */
  readonly operator: Address;
  readonly startBlock: bigint;
  readonly decayBlocks: number;
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
  /** Blocks until the decay finishes, or null once it has. */
  readonly blocksRemaining: bigint | null;
}

export interface LaunchScan {
  readonly launches: readonly LaunchRecord[];
  readonly fromBlock: bigint;
  readonly atBlock: bigint;
  /** The hook the configured kit is welded to. Read off the kit, not assumed. */
  readonly hook: Address;
}

const LAUNCH_CREATED = getAbiItem({ abi: LAUNCHPAD_KIT_ABI, name: "LaunchCreated" });

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

  const [hook, logs, atBlock] = await Promise.all([
    client.readContract({ address: kit, abi: LAUNCHPAD_KIT_ABI, functionName: "hook" }),
    client.getLogs({ address: kit, event: LAUNCH_CREATED, fromBlock, toBlock: "latest" }),
    client.getBlockNumber(),
  ]);

  const launches = await Promise.all(
    logs.map(async (log): Promise<LaunchRecord> => {
      const poolId = log.args.poolId as Hex;
      const launchToken = log.args.launchToken as Address;
      const quoteToken = log.args.quoteToken as Address;
      const startBlock = BigInt(log.args.startBlock ?? 0n);
      const decayBlocks = Number(log.args.decayBlocks ?? 0);
      const endBlock = startBlock + BigInt(decayBlocks);

      const [launchTokenMeta, quoteTokenMeta, live, currentFeePips] = await Promise.all([
        readTokenMeta(launchToken),
        readTokenMeta(quoteToken),
        readHookLaunch(hook, poolId),
        readCurrentFee(hook, poolId),
      ]);

      const phase: LaunchPhase =
        atBlock < startBlock ? "scheduled" : atBlock < endBlock ? "decaying" : "settled";

      return {
        poolId,
        launchToken,
        quoteToken,
        launchTokenMeta,
        quoteTokenMeta,
        operator: log.args.operator as Address,
        startBlock,
        decayBlocks,
        initialFeeBips: Number(log.args.initialFeeBips ?? 0),
        finalFeeBips: Number(log.args.finalFeeBips ?? 0),
        maxBuyPerTx: BigInt(log.args.maxBuyPerTx ?? 0n),
        preset: Number(log.args.preset ?? 0),
        createdAtBlock: log.blockNumber,
        currentFeePips,
        enabled: live?.enabled ?? false,
        launched: live?.launched ?? false,
        phase,
        blocksRemaining: phase === "settled" ? null : endBlock - atBlock,
      };
    }),
  );

  launches.sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
  return { launches, fromBlock, atBlock, hook };
}

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

interface HookLaunch {
  readonly enabled: boolean;
  readonly launched: boolean;
}

async function readHookLaunch(hook: Address, poolId: Hex): Promise<HookLaunch | null> {
  try {
    const launch = await publicClient().readContract({
      address: hook,
      abi: LAUNCH_GUARD_HOOK_ABI,
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

/**
 * The kit's own bounds, read off the deployed contract.
 *
 * These are NOT hardcoded here, and the reason is specific: `MAX_DECAY_BLOCKS`
 * and `MAX_START_DELAY` are block counts, so their wall-clock meaning depends
 * entirely on the chain's block time. A million blocks is about 139 days at
 * 12 seconds and about 28 hours at a tenth of a second. A wizard that assumed
 * one of those would silently offer schedules the contract rejects.
 */
export interface LaunchBounds {
  readonly maxDecayBlocks: number;
  readonly maxStartDelay: bigint;
  readonly maxInitialFeeBips: number;
  readonly maxFinalFeeBips: number;
  /** Hundredths of a second per block, as the kit was configured with. */
  readonly blockTimeCentis: number;
}

export async function readLaunchBounds(): Promise<LaunchBounds> {
  const cfg = resolveConfig();
  if (cfg.launchpadKit === null) throw new LaunchpadNotConfiguredError();
  const client = publicClient();

  const hook = await client.readContract({
    address: cfg.launchpadKit,
    abi: LAUNCHPAD_KIT_ABI,
    functionName: "hook",
  });

  const [maxDecayBlocks, maxStartDelay, maxInitialFee, maxFinalFee, blockTimeCentis] =
    await Promise.all([
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_DECAY_BLOCKS" }),
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_START_DELAY" }),
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_INITIAL_FEE" }),
      client.readContract({ address: hook, abi: LAUNCH_GUARD_HOOK_ABI, functionName: "MAX_FINAL_FEE" }),
      client.readContract({
        address: cfg.launchpadKit,
        abi: LAUNCHPAD_KIT_ABI,
        functionName: "blockTimeCentis",
      }),
    ]);

  return {
    maxDecayBlocks: Number(maxDecayBlocks),
    maxStartDelay: BigInt(maxStartDelay),
    maxInitialFeeBips: Number(maxInitialFee),
    maxFinalFeeBips: Number(maxFinalFee),
    blockTimeCentis: Number(blockTimeCentis),
  };
}

/** Blocks converted to a rough duration, using the kit's own block time. */
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

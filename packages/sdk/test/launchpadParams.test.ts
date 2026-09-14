// SPDX-License-Identifier: MIT
/**
 * `validateLaunchParams` earns its place on two cases the CHAIN ACCEPTS:
 *
 *   1. a Custom preset with empty fields — what an unset preset decays to;
 *   2. a preset whose custom fields were filled in and will be ignored.
 *
 * Neither reverts. Both produce a launch that is not the one the launcher
 * described. Everything else here is a local restatement of a contract check,
 * tested to name the right field and cite the right custom error.
 *
 * Two kit generations are exercised: the timestamp kit (Option B) and the
 * block-numbered kit still deployed on Robinhood, whose windows run 120x long.
 */
import { describe, expect, it } from "vitest";

import {
  PRESET,
  Q96,
  assertLaunchParams,
  buildLaunchParams,
  describeLaunch,
  launchParamsToBlockTuple,
  launchParamsToTuple,
  sqrtPriceForLaunch,
  validateLaunchParams,
  type BlockLaunchLimits,
  type LaunchLimits,
  type LaunchParams,
  type SeedParams,
} from "../src/index.js";

const LAUNCH = "0x1111111111111111111111111111111111111111" as const;
const QUOTE = "0x2222222222222222222222222222222222222222" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** The timestamp kit: nothing about the chain's cadence is declared. */
const LIMITS: LaunchLimits = { durationClock: "timestamp" };

/**
 * The LIVE Robinhood kit and hook as read on 2026-09-13: they declare 10 centis
 * (0.1 s) and MAX_DECAY_BLOCKS 26,000,000, but the hook's block.number is
 * Ethereum's (~12 s). Every window runs 120x longer than declared.
 */
const ROBINHOOD_LIVE: BlockLaunchLimits = {
  durationClock: "contract-block",
  blockTimeCentis: 10,
  contractBlockTimeCentis: 1200,
  maxDecayBlocks: 26_000_000n,
  maxStartDelayBlocks: 26_000_000n,
};

const SEED: SeedParams = {
  tickLower: -60,
  tickUpper: 60,
  launchTokenAmount: 1_000n * 10n ** 18n,
  quoteTokenAmount: 1_000n * 10n ** 6n,
  positionRecipient: ZERO,
  deadline: 0n,
};

function params(over: Partial<LaunchParams> = {}): LaunchParams {
  const base = buildLaunchParams({
    launchToken: LAUNCH,
    quoteToken: QUOTE,
    tickSpacing: 60,
    sqrtPriceX96: Q96,
    preset: "FairLaunch",
    seed: SEED,
  });
  return { ...base, ...over };
}

const custom = (over: Partial<LaunchParams> = {}): LaunchParams =>
  params({ preset: PRESET.Custom, initialFeeBips: 100_000, finalFeeBips: 3_000, decaySeconds: 300, enabled: true, ...over });

const errorsOf = (p: LaunchParams, l: LaunchLimits = LIMITS) =>
  validateLaunchParams(p, l).filter((i) => i.severity === "error");
const fieldsOf = (p: LaunchParams) => validateLaunchParams(p, LIMITS).map((i) => i.field);

describe("the zero-value trap", () => {
  it("Custom with every field empty is an ERROR, not a launch", () => {
    const issues = errorsOf(params({ preset: PRESET.Custom }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe("preset");
    expect(issues[0]?.message).toContain("ZERO value");
  });

  it("a coherent Custom is accepted", () => {
    expect(errorsOf(custom())).toHaveLength(0);
  });

  it("buildLaunchParams refuses Custom without a schedule at construction time", () => {
    expect(() =>
      buildLaunchParams({
        launchToken: LAUNCH,
        quoteToken: QUOTE,
        tickSpacing: 60,
        sqrtPriceX96: Q96,
        preset: "Custom",
        seed: SEED,
      }),
    ).toThrow(/no `custom` schedule/);
  });

  it("warns when a named preset will silently overwrite custom fields", () => {
    const p = params({ preset: PRESET.FairLaunch, initialFeeBips: 250_000 });
    const issues = validateLaunchParams(p, LIMITS);
    const warn = issues.find((i) => i.severity === "warning" && i.field === "preset");
    expect(warn?.message).toContain("OVERWRITES");
    expect(errorsOf(p)).toHaveLength(0);
  });
});

describe("checks that mirror a contract revert (timestamp kit)", () => {
  it("AntiSniperAggressive without a cap cites MaxBuyRequiredByPreset", () => {
    const p = params({ preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 0n });
    const issue = errorsOf(p).find((i) => i.field === "maxBuyPerTx");
    expect(issue?.contractError).toBe("MaxBuyRequiredByPreset(uint8)");
  });

  it("AntiSniperAggressive with a cap passes", () => {
    expect(errorsOf(params({ preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 10n ** 6n }))).toHaveLength(0);
  });

  it("a native launch token is refused", () => {
    const issue = errorsOf(params({ launchToken: ZERO })).find((i) => i.field === "launchToken");
    expect(issue?.contractError).toBe("LaunchTokenCannotBeNative()");
  });

  it("an identical pair is refused", () => {
    const issue = errorsOf(params({ quoteToken: LAUNCH })).find((i) => i.field === "quoteToken");
    expect(issue?.contractError).toBe("IdenticalCurrencies(address)");
  });

  it("an inverted tick range is refused", () => {
    expect(errorsOf(params({ seed: { ...SEED, tickLower: 60, tickUpper: -60 } })).some((i) => i.field === "seed.tickLower")).toBe(true);
  });

  it("ticks off the spacing grid are refused", () => {
    expect(errorsOf(params({ seed: { ...SEED, tickLower: -61, tickUpper: 60 } })).some((i) => i.field === "seed.tickLower")).toBe(true);
  });

  it("a sqrtPriceX96 outside TickMath's range is refused", () => {
    expect(errorsOf(params({ sqrtPriceX96: 1n })).some((i) => i.field === "sqrtPriceX96")).toBe(true);
  });

  it("a fee schedule that rises instead of decaying is refused", () => {
    const issue = errorsOf(custom({ initialFeeBips: 3_000, finalFeeBips: 100_000 })).find((i) => i.field === "initialFeeBips");
    expect(issue?.contractError).toBe("InvalidFeeSchedule(uint24,uint24)");
  });

  it("fees above the hook's ceilings are refused", () => {
    const fields = errorsOf(custom({ initialFeeBips: 600_000, finalFeeBips: 200_000 })).map((i) => i.field);
    expect(fields).toContain("initialFeeBips");
    expect(fields).toContain("finalFeeBips");
  });

  it("a decay window under the 60 s sequencer-skew floor is refused", () => {
    const issue = errorsOf(custom({ decaySeconds: 59 })).find((i) => i.field === "decaySeconds");
    expect(issue?.contractError).toBe("InvalidDecaySeconds(uint32)");
    expect(errorsOf(custom({ decaySeconds: 60 }))).toHaveLength(0);
  });

  it("a decay window over 30 days is refused", () => {
    const issue = errorsOf(custom({ decaySeconds: 30 * 86_400 + 1 })).find((i) => i.field === "decaySeconds");
    expect(issue?.contractError).toBe("InvalidDecaySeconds(uint32)");
  });

  it("a start delay past MAX_START_DELAY_SECONDS is refused", () => {
    const issue = errorsOf(params({ startDelaySeconds: 30 * 86_400 + 1 })).find((i) => i.field === "startDelaySeconds");
    expect(issue?.contractError).toBe("StartDelayTooLong(uint256)");
    expect(errorsOf(params({ startDelaySeconds: 30 * 86_400 }))).toHaveLength(0);
  });
});

describe("the block-numbered kit still deployed on Robinhood", () => {
  it("warns when a named preset's window is stretched by a clock mismatch", () => {
    const warns = validateLaunchParams(params({ preset: PRESET.FairLaunch }), ROBINHOOD_LIVE).filter(
      (i) => i.severity === "warning" && i.field === "preset",
    );
    expect(warns.some((w) => w.message.includes("really lasts 10h") && w.message.includes("120x longer"))).toBe(true);
    expect(errorsOf(params(), ROBINHOOD_LIVE)).toHaveLength(0);
  });

  it("warns that a start delay really opens later on a mismatched clock", () => {
    const warn = validateLaunchParams(params({ startDelaySeconds: 60 }), ROBINHOOD_LIVE).find(
      (i) => i.field === "startDelaySeconds",
    );
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("really opens after 2h");
  });

  it("a Custom window past that hook's immutable is refused", () => {
    // 3 days at the declared 0.1 s is 2,592,000 blocks; cap it below that.
    const issue = errorsOf(custom({ decaySeconds: 3 * 86_400 }), { ...ROBINHOOD_LIVE, maxDecayBlocks: 1_000_000n }).find(
      (i) => i.field === "decaySeconds",
    );
    expect(issue?.contractError).toBe("InvalidDecayBlocks(uint32)");
  });

  it("stays quiet about clocks on a timestamp kit", () => {
    const warns = validateLaunchParams(params({ startDelaySeconds: 60 }), LIMITS).filter((i) => i.message.includes("declared"));
    expect(warns).toHaveLength(0);
  });

  it("launchParamsToBlockTuple converts at the kit's DECLARED block time, like the kit does", () => {
    const tuple = launchParamsToBlockTuple(custom({ decaySeconds: 300 }), ROBINHOOD_LIVE);
    expect(tuple.decayBlocks).toBe(3_000);
    expect(tuple).not.toHaveProperty("decaySeconds");
  });
});

describe("warnings the chain will not give you", () => {
  it("warns that maxBuyPerTx is per transaction, not per wallet", () => {
    const warn = validateLaunchParams(params({ maxBuyPerTx: 1n }), LIMITS).find((i) => i.field === "maxBuyPerTx");
    expect(warn?.message).toContain("not one wallet");
  });

  it("warns about an incidental launchOperator", () => {
    expect(fieldsOf(params())).toContain("launchOperator");
  });

  it("warns when the seed adds no liquidity", () => {
    expect(fieldsOf(params({ seed: { ...SEED, launchTokenAmount: 0n, quoteTokenAmount: 0n } }))).toContain("seed");
  });
});

describe("describeLaunch", () => {
  it("on a timestamp kit the preset is exactly its label", () => {
    const s = describeLaunch(params({ preset: PRESET.FairLaunch, startDelaySeconds: 120 }), LIMITS);
    expect(s.preset).toBe("FairLaunch");
    expect(s.durationClock).toBe("timestamp");
    expect(s.initialFee).toBe("10%");
    expect(s.finalFee).toBe("0.3%");
    expect(s.decaySeconds).toBe(300);
    expect(s.decayBlocks).toBeNull();
    expect(s.decayWindow).toBe("5m");
    expect(s.declaredDecayWindow).toBe("5m");
    expect(s.opensAfter).toBe("2m");
    expect(s.clockStretch).toBeNull();
    expect(s.gated).toBe(true);
    expect(s.doesNotProtectAgainst).not.toBe("");
  });

  it("on the live Robinhood block kit the FairLaunch 5m window really lasts 10h", () => {
    const s = describeLaunch(params({ preset: PRESET.FairLaunch, startDelaySeconds: 60 }), ROBINHOOD_LIVE);
    expect(s.durationClock).toBe("contract-block");
    expect(s.decayBlocks).toBe(3_000n);
    expect(s.declaredDecayWindow).toBe("5m");
    expect(s.decayWindow).toBe("10h");
    expect(s.opensAfter).toBe("2h"); // 60 s -> 600 blocks -> 7,200 s
    expect(s.clockStretch).toBe(120);
  });

  it("a Custom window on a block kit is judged at the real cadence", () => {
    const s = describeLaunch(custom({ decaySeconds: 300 }), ROBINHOOD_LIVE);
    expect(s.declaredDecayWindow).toBe("5m");
    expect(s.decayWindow).toBe("10h");
  });

  it("NoTax is honest about protecting against nothing", () => {
    const s = describeLaunch(params({ preset: PRESET.NoTax }), LIMITS);
    expect(s.gated).toBe(false);
    expect(s.doesNotProtectAgainst).toContain("anything");
  });
});

describe("assertLaunchParams", () => {
  it("throws with the offending fields named", () => {
    expect(() => assertLaunchParams(params({ preset: PRESET.Custom }), LIMITS)).toThrow(/preset/);
  });

  it("passes a valid launch silently", () => {
    expect(() => assertLaunchParams(params(), LIMITS)).not.toThrow();
  });

  it("does not throw on warnings alone", () => {
    expect(() => assertLaunchParams(params({ maxBuyPerTx: 1n }), LIMITS)).not.toThrow();
  });
});

describe("end to end, the way an integrator would use it", () => {
  it("price -> params -> validate -> tuple", () => {
    const price = sqrtPriceForLaunch({
      launchToken: LAUNCH,
      quoteToken: QUOTE,
      launchDecimals: 18,
      quoteDecimals: 6,
      quotePerLaunchToken: "0.05",
    });
    const p = buildLaunchParams({
      launchToken: LAUNCH,
      quoteToken: QUOTE,
      tickSpacing: 60,
      sqrtPriceX96: price.sqrtPriceX96,
      preset: "FairLaunch",
      seed: SEED,
      startDelaySeconds: 3600,
      launchOperator: QUOTE,
    });
    expect(errorsOf(p)).toHaveLength(0);

    const tuple = launchParamsToTuple(p);
    expect(tuple.preset).toBe(PRESET.FairLaunch);
    expect(tuple.sqrtPriceX96).toBe(price.sqrtPriceX96);
    expect(tuple.seed.launchTokenAmount).toBe(SEED.launchTokenAmount);
    expect(tuple.listing.register).toBe(false);
    expect(tuple).toHaveProperty("decaySeconds");
    expect(Object.keys(tuple)).toHaveLength(14);
  });
});

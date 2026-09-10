// SPDX-License-Identifier: MIT
/**
 * Integrator fee attribution.
 *
 * This is the module that makes the widgets worth embedding. An integrator -
 * the team whose app hosts the widget - names a `referrer` address and a fee in
 * basis points, and that fee is taken out of the swap's **output** currency and
 * paid to the referrer inside the same transaction as the swap.
 *
 * The fee is not an accounting entry we settle later. It is an action in the
 * swap plan (`TAKE_PORTION`), or a command in the router plan (`PAY_PORTION`),
 * so it either happens atomically with the swap or the whole transaction
 * reverts. Nothing is trusted, escrowed or owed.
 *
 * ## Invariants enforced here
 *
 * 1. `feeBps` is an integer in `[0, MAX_INTEGRATOR_FEE_BPS]`.
 * 2. A non-zero `feeBps` requires a syntactically valid, non-zero `referrer`.
 *    Configuring a fee with no destination is a loud failure, never a silent
 *    zero: the alternative is a widget that quietly earns the embedder nothing.
 * 3. The predicted fee uses the same arithmetic as the contracts
 *    (`amount * bps / 10_000`, truncating), so the number shown in the UI is
 *    the number the chain pays out - not an estimate.
 */

import { getAddress, isAddress, type Address } from "viem";

/** Basis-point denominator. 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000;

/**
 * Largest integrator fee the widgets will encode, in basis points (1.00%).
 *
 * The on-chain `BipsLibrary.calculatePortion` only rejects values above
 * 10_000 bps, so this ceiling is a client-side policy, not a contract limit.
 * It exists so an embedder cannot ship a widget that quietly takes a third of
 * a user's output, which would poison the widget for every other integrator.
 * Anything above this is a configuration error, not a business decision.
 */
export const MAX_INTEGRATOR_FEE_BPS = 100;

/** The zero address, rejected as a fee destination. */
export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * Where the integrator fee is taken in the call path.
 *
 * - `take-portion` - a `TAKE_PORTION` action inside the swap plan. The vault
 *   credit is split before anything leaves the singleton, so the router never
 *   custodies the fee. This is the default.
 * - `pay-portion` - the swap takes its full output to the router, then a
 *   router-level `PAY_PORTION` command forwards the fee and `SWEEP` returns the
 *   remainder. Needed when the fee must be taken across a multi-command plan.
 */
export type IntegratorFeeMode = "take-portion" | "pay-portion";

/** Integrator fee configuration, as an embedder writes it. */
export interface IntegratorConfig {
  /** Address that receives the fee. Required whenever `feeBps > 0`. */
  readonly referrer: Address;
  /** Fee in basis points of the swap output, `0 .. MAX_INTEGRATOR_FEE_BPS`. */
  readonly feeBps: number;
  /** Where in the call path the fee is taken. Defaults to `take-portion`. */
  readonly feeMode?: IntegratorFeeMode;
  /**
   * Free-form label recorded in widget analytics events. Never sent on-chain.
   */
  readonly label?: string;
}

/** Machine-readable reasons an integrator config can be rejected. */
export type IntegratorConfigErrorCode =
  | "FEE_BPS_NOT_A_NUMBER"
  | "FEE_BPS_NOT_AN_INTEGER"
  | "FEE_BPS_NEGATIVE"
  | "FEE_BPS_ABOVE_MAX"
  | "REFERRER_MISSING"
  | "REFERRER_MALFORMED"
  | "REFERRER_ZERO_ADDRESS"
  | "FEE_MODE_UNKNOWN";

/** Thrown when an integrator config cannot be used to build a call path. */
export class IntegratorConfigError extends Error {
  readonly code: IntegratorConfigErrorCode;

  constructor(code: IntegratorConfigErrorCode, message: string) {
    super(`[@latchprotocol/widgets] integrator config rejected (${code}): ${message}`);
    this.name = "IntegratorConfigError";
    this.code = code;
  }
}

/**
 * A validated integrator config.
 *
 * Only this type reaches the call-path builders. There is no way to construct
 * one except through {@link validateIntegratorConfig}, so an unvalidated fee can
 * never be encoded into a transaction.
 */
export interface ResolvedIntegratorConfig {
  readonly referrer: Address;
  readonly feeBps: number;
  readonly feeMode: IntegratorFeeMode;
  readonly label: string | null;
  /** `true` when `feeBps > 0`, i.e. the call path gains a fee step. */
  readonly active: boolean;
  /** Non-fatal configuration remarks worth surfacing in a dev console. */
  readonly warnings: readonly string[];
}

const FEE_MODES: readonly IntegratorFeeMode[] = ["take-portion", "pay-portion"];

function isKnownFeeMode(value: string): value is IntegratorFeeMode {
  return (FEE_MODES as readonly string[]).includes(value);
}

/**
 * Validates and normalises an integrator config.
 *
 * @throws {IntegratorConfigError} on any violation of the documented rules.
 */
export function validateIntegratorConfig(config: IntegratorConfig): ResolvedIntegratorConfig {
  const { feeBps } = config;

  if (typeof feeBps !== "number" || Number.isNaN(feeBps)) {
    throw new IntegratorConfigError(
      "FEE_BPS_NOT_A_NUMBER",
      `feeBps must be a number, received ${JSON.stringify(feeBps)}`,
    );
  }
  if (!Number.isFinite(feeBps) || !Number.isInteger(feeBps)) {
    throw new IntegratorConfigError(
      "FEE_BPS_NOT_AN_INTEGER",
      `feeBps must be a whole number of basis points, received ${feeBps}. ` +
        "There is no sub-basis-point precision on-chain.",
    );
  }
  if (feeBps < 0) {
    throw new IntegratorConfigError(
      "FEE_BPS_NEGATIVE",
      `feeBps must not be negative, received ${feeBps}`,
    );
  }
  if (feeBps > MAX_INTEGRATOR_FEE_BPS) {
    throw new IntegratorConfigError(
      "FEE_BPS_ABOVE_MAX",
      `feeBps ${feeBps} exceeds MAX_INTEGRATOR_FEE_BPS (${MAX_INTEGRATOR_FEE_BPS} bps = ` +
        `${MAX_INTEGRATOR_FEE_BPS / 100}%). Raise it only by forking this package and ` +
        "owning the consequences for your users.",
    );
  }

  const feeMode = config.feeMode ?? "take-portion";
  if (!isKnownFeeMode(feeMode)) {
    throw new IntegratorConfigError(
      "FEE_MODE_UNKNOWN",
      `feeMode must be one of ${FEE_MODES.join(" | ")}, received ${JSON.stringify(feeMode)}`,
    );
  }

  const warnings: string[] = [];
  const rawReferrer: unknown = config.referrer;
  const active = feeBps > 0;

  if (rawReferrer === undefined || rawReferrer === null || rawReferrer === "") {
    if (active) {
      throw new IntegratorConfigError(
        "REFERRER_MISSING",
        `feeBps is ${feeBps} but no referrer address was provided. A fee with no ` +
          "destination would be silently forfeited; refusing to build the call path.",
      );
    }
    return {
      referrer: ZERO_ADDRESS,
      feeBps: 0,
      feeMode,
      label: config.label ?? null,
      active: false,
      warnings,
    };
  }

  if (typeof rawReferrer !== "string" || !isAddress(rawReferrer)) {
    throw new IntegratorConfigError(
      "REFERRER_MALFORMED",
      `referrer is not a valid EVM address: ${JSON.stringify(rawReferrer)}`,
    );
  }

  const referrer = getAddress(rawReferrer);

  if (referrer === ZERO_ADDRESS) {
    if (active) {
      throw new IntegratorConfigError(
        "REFERRER_ZERO_ADDRESS",
        `feeBps is ${feeBps} but referrer is the zero address. The fee would be burned.`,
      );
    }
    return {
      referrer: ZERO_ADDRESS,
      feeBps: 0,
      feeMode,
      label: config.label ?? null,
      active: false,
      warnings,
    };
  }

  if (!active) {
    warnings.push(
      `referrer ${referrer} is configured but feeBps is 0, so this widget will earn ` +
        "the integrator nothing. Set feeBps to start collecting.",
    );
  }

  return {
    referrer,
    feeBps,
    feeMode,
    label: config.label ?? null,
    active,
    warnings,
  };
}

/** The resolved config used when an embedder configures no integrator at all. */
export const NO_INTEGRATOR_FEE: ResolvedIntegratorConfig = {
  referrer: ZERO_ADDRESS,
  feeBps: 0,
  feeMode: "take-portion",
  label: null,
  active: false,
  warnings: [],
};

/** Validates an optional config, falling back to {@link NO_INTEGRATOR_FEE}. */
export function resolveIntegratorConfig(
  config: IntegratorConfig | undefined | null,
): ResolvedIntegratorConfig {
  if (config === undefined || config === null) return NO_INTEGRATOR_FEE;
  return validateIntegratorConfig(config);
}

/**
 * The integrator's cut of `grossAmount`, in the output currency's smallest unit.
 *
 * Mirrors `BipsLibrary.calculatePortion`: multiply first, then divide, so the
 * rounding matches the chain exactly. Integer division truncates, which favours
 * the user by at most one wei.
 */
export function calculateIntegratorFee(grossAmount: bigint, feeBps: number): bigint {
  if (grossAmount < 0n) {
    throw new RangeError(`calculateIntegratorFee: grossAmount must not be negative: ${grossAmount}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > BPS_DENOMINATOR) {
    throw new RangeError(
      `calculateIntegratorFee: feeBps must be an integer in [0, ${BPS_DENOMINATOR}]: ${feeBps}`,
    );
  }
  return (grossAmount * BigInt(feeBps)) / BigInt(BPS_DENOMINATOR);
}

/** A gross output amount split into the integrator's cut and the user's. */
export interface IntegratorFeeSplit {
  /** Output before the integrator fee. */
  readonly grossAmount: bigint;
  /** Amount routed to the referrer. Zero when no fee is active. */
  readonly integratorFee: bigint;
  /** Amount the user actually receives. */
  readonly netAmount: bigint;
  readonly feeBps: number;
  /** Fee destination, or `null` when no fee is active. */
  readonly referrer: Address | null;
}

/** Splits a gross output amount according to a validated integrator config. */
export function splitIntegratorFee(
  grossAmount: bigint,
  config: ResolvedIntegratorConfig,
): IntegratorFeeSplit {
  if (!config.active) {
    return {
      grossAmount,
      integratorFee: 0n,
      netAmount: grossAmount,
      feeBps: 0,
      referrer: null,
    };
  }
  const integratorFee = calculateIntegratorFee(grossAmount, config.feeBps);
  return {
    grossAmount,
    integratorFee,
    netAmount: grossAmount - integratorFee,
    feeBps: config.feeBps,
    referrer: config.referrer,
  };
}

/** Human-readable percentage for a bps value, e.g. `25 -> "0.25%"`. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toString() : percent.toFixed(2)}%`;
}

// SPDX-License-Identifier: MIT
/**
 * What a Latch (a hook contract) is ABLE to do, in plain language.
 *
 * Derived from the permission bitmap by `@latchprotocol/sdk`, which mirrors
 * `LatchRegistry.classify` — the same `pure` function the contract exposes, so
 * two surfaces cannot end up describing one bitmap two ways.
 *
 * The wording matters and is deliberate. Every claim is about capability, never
 * about intent or safety: "can take a share of every swap" is a fact about the
 * bytecode, whereas "takes 1% of every swap" would be a claim this app cannot
 * substantiate and "is safe" is a claim nobody can. A registry listing is not
 * an audit and a bitmap is not a review.
 */

import { describeCapabilities, type HookCapabilities, type RiskClass } from "@latchprotocol/sdk";

export interface CapabilityReport {
  readonly bitmap: number;
  readonly riskClass: RiskClass;
  readonly claims: readonly string[];
  /** False when the pool managers would reject this bitmap outright. */
  readonly valid: boolean;
  /** True when the bitmap could not be interpreted at all. */
  readonly unreadable: boolean;
}

const UNREADABLE: CapabilityReport = {
  bitmap: 0,
  riskClass: "Passive",
  claims: ["this hook's permission bitmap could not be read"],
  valid: false,
  unreadable: true,
};

export function capabilityReport(bitmap: number): CapabilityReport {
  let caps: HookCapabilities;
  try {
    caps = describeCapabilities(bitmap);
  } catch {
    return UNREADABLE;
  }

  const claims: string[] = [];
  if (caps.takesSwapCut) claims.push("can take a share of every swap");
  else if (caps.returnsDelta) claims.push("can take a share of a liquidity movement");
  if (caps.canBlockSwaps) claims.push("can block or reprice a swap");
  if (caps.canTrapLiquidity) claims.push("can refuse a liquidity withdrawal");
  if (claims.length === 0) claims.push("observes only — cannot move funds or block trading");

  return {
    bitmap,
    riskClass: caps.riskClass,
    claims,
    valid: caps.valid,
    unreadable: false,
  };
}

export const RISK_LABEL: Readonly<Record<RiskClass, string>> = {
  Passive: "Passive",
  Restrictive: "Restrictive",
  ValueExtracting: "Value-extracting",
};

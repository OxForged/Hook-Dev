// SPDX-License-Identifier: MIT
/**
 * A structured trust summary, and the one thing it must never produce.
 *
 * ## It never says "safe"
 *
 * That is not a stylistic preference. The registry is a permissionless, free
 * listing whose curation is three independent axes maintained by humans; the
 * bitmap is a statement about capability. Neither is an audit, and neither can
 * become one by being summarised. An agent that reads "this Latch is safe" and
 * routes a user's funds accordingly is the precise failure this package exists
 * to prevent, so this module has no vocabulary for it: there is no "safe"
 * verdict, no numeric score, and no green state.
 *
 * What it produces instead is a report of what the registry says, what the
 * bitmap says, and - in a required, non-empty field - what neither of them
 * covers. See {@link RiskAssessment.doesNotCover}.
 *
 * ## It never collapses the three axes
 *
 * `Verification` (what a human attested), `Listing` (whether the registry still
 * recommends it) and `RiskClass` (what the code can do) move independently. A
 * hook can be genuinely `Audited` and also `ValueExtracting` - a fee hook doing
 * exactly what it says. Collapsing that into one number is how a green tick
 * ends up next to a contract that drains the pool, so all three are reported
 * side by side, exactly as the SDK models them.
 */

import {
  summarizeLatch,
  type HookWarning,
  type LatchRecord,
  type Listing,
  type RiskClass,
  type Verification,
} from "@latchprotocol/sdk";

import { explainPermissions, type PermissionExplanation } from "./permissions.js";

/** How loudly to surface a warning. Ordering, not a score. */
export type WarningSeverity = "critical" | "high" | "medium" | "info";

export interface AssessedWarning {
  readonly code: HookWarning;
  readonly severity: WarningSeverity;
  readonly message: string;
}

/**
 * The registry's answer, in the only three shapes it has.
 *
 * `not-registered` is a RESULT and the most common one: the registry is
 * permissionless and free, so absence means nobody listed it, which is neither
 * an accusation nor a reassurance. Most contracts on any chain are not in it.
 */
export type RegistryStanding = "not-registered" | "listed" | "flagged-malicious";

export interface RiskAssessment {
  readonly address: string;
  readonly standing: RegistryStanding;
  /** One sentence for a person. Reports; never recommends. */
  readonly headline: string;
  /** The three axes, side by side, never merged. */
  readonly axes: {
    /** null when not registered - there is nothing to have attested. */
    readonly verification: Verification | null;
    readonly listing: Listing | null;
    /** Derived from the bitmap, so it exists whenever a bitmap does. */
    readonly riskClass: RiskClass | null;
    /** How far the recorded bitmap can still be relied on. */
    readonly permissionState: "Fresh" | "Stale" | "Invalid" | null;
  };
  /**
   * True only when audited AND active AND the bitmap is readable and valid.
   * Mirrors `LatchRegistry.isAudited`. Note what it does not say: an audited
   * hook may still be `ValueExtracting`.
   */
  readonly auditBadge: boolean;
  /** Most severe first. */
  readonly warnings: readonly AssessedWarning[];
  /** Full bitmap explanation, when a bitmap is known. */
  readonly permissions: PermissionExplanation | null;
  /** Required, always non-empty. The limits of this assessment. */
  readonly doesNotCover: readonly string[];
}

const SEVERITY: Readonly<Record<HookWarning, WarningSeverity>> = {
  FlaggedMalicious: "critical",
  ValueExtracting: "high",
  CanTrapLiquidity: "high",
  CanBlockSwaps: "medium",
  PermissionsStale: "high",
  PermissionsInvalid: "medium",
  Deprecated: "medium",
  Unverified: "info",
};

const WARNING_TEXT: Readonly<Record<HookWarning, string>> = {
  FlaggedMalicious:
    "A guardian has flagged this listing as harmful to users. The registry never deletes a record, so this tombstone IS the warning - do not interact.",
  ValueExtracting:
    "Its permission bitmap allows it to take a share of swaps or liquidity, or to refuse withdrawals. Whether it does is a question about its source, not its bitmap.",
  CanTrapLiquidity:
    "It can refuse liquidity withdrawals, so funds deposited into a pool it governs may not be removable.",
  CanBlockSwaps:
    "It can refuse a swap before the trade is priced, so it can reject a specific caller or halt trading entirely.",
  PermissionsStale:
    "The registry could not re-read this contract's bitmap on its last refresh. The bitmap shown is the last value successfully read and may no longer be true. Read `getHooksRegistrationBitmap()` from the contract directly before relying on it.",
  PermissionsInvalid:
    "The recorded bitmap is one no pool manager would accept, so it cannot be a working pool configuration. Treat the record as broken rather than as a description of live behaviour.",
  Deprecated:
    "The listing is marked superseded or abandoned. This is not an accusation; a genuine audit of an old version is deliberately retained.",
  Unverified:
    "No curator has attested anything about this listing. This is the state every listing starts in - it is the default, not a finding.",
};

const UNIVERSAL_LIMITS: readonly string[] = [
  "A registry listing is not an audit. Listing is permissionless and free, and only the permission bitmap is read from chain - every other field was typed in by the submitter.",
  "This assessment cannot tell you whether the contract's code is correct, whether it has an owner who can change its behaviour, or whether it sits behind an upgradeable proxy.",
  "It covers only this address on this chain at this block. The same address on another chain is a different contract.",
  "Nothing here is a recommendation to interact. Reading the source and any audit report is the only way to answer whether this contract does what it claims.",
];

/** Input for an address the registry has never heard of. */
export interface UnregisteredInput {
  readonly registered: false;
  readonly address: string;
  /**
   * Whether the address has code. Separates "a contract nobody listed" from "an
   * EOA, a typo, or a contract on some other chain" - neither is a Latch, but
   * saying which one spares the reader from guessing.
   */
  readonly hasCode: boolean;
  /**
   * Bitmap read directly from the contract, if `getHooksRegistrationBitmap()`
   * answered. An unlisted hook still has a bitmap, and it is exactly as
   * trustworthy as a listed one's - the pool manager enforces it either way.
   */
  readonly onChainBitmap?: number;
}

export interface RegisteredInput {
  readonly registered: true;
  readonly record: LatchRecord;
}

export type RiskAssessmentInput = UnregisteredInput | RegisteredInput;

/**
 * Build a trust summary.
 *
 * Pure: it performs no I/O and makes no network call, so it is fully testable
 * and its output depends only on its input.
 */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  if (!input.registered) {
    const permissions =
      input.onChainBitmap === undefined ? null : explainPermissions(input.onChainBitmap);

    const headline = !input.hasCode
      ? "This address has no code on this chain. It is not a Latch, and it is not in the registry - it may be an ordinary wallet, a typo, or a contract deployed somewhere else."
      : permissions
        ? "This contract is not in the Latch registry, but it does report a hook permission bitmap, so it can be used as a Latch. Nobody has listed or reviewed it; judge it from its bitmap and its source."
        : "This contract is not in the Latch registry. That is the normal state for most contracts and is neither an accusation nor a reassurance - the registry is an opt-in listing, not a whitelist.";

    return {
      address: input.address,
      standing: "not-registered",
      headline,
      axes: {
        verification: null,
        listing: null,
        riskClass: permissions?.riskClass ?? null,
        permissionState: null,
      },
      auditBadge: false,
      warnings: [],
      permissions,
      doesNotCover: [
        "Absence from the registry says nothing about this contract. Listing is opt-in, so an unlisted contract has simply never been submitted.",
        ...UNIVERSAL_LIMITS,
      ],
    };
  }

  const summary = summarizeLatch(input.record);
  const permissions = explainPermissions(input.record.permissions);

  const warnings: AssessedWarning[] = summary.warnings.map((code) => ({
    code,
    severity: SEVERITY[code],
    message: WARNING_TEXT[code],
  }));

  const standing: RegistryStanding =
    summary.listing === "Malicious" ? "flagged-malicious" : "listed";

  const headline =
    standing === "flagged-malicious"
      ? "Flagged malicious by a registry guardian. Do not interact."
      : `Listed as ${summary.listing}, ${summary.verification} by a curator, and its bitmap classes it ${summary.riskClass}. ` +
        (summary.riskClass === "ValueExtracting"
          ? "That class means it can take a share of swaps or liquidity, or refuse withdrawals - which may be exactly its stated purpose, or may not."
          : summary.riskClass === "Restrictive"
            ? "That class means it can refuse actions in its pool, but cannot take a share of them."
            : "That class means its bitmap holds only observing callbacks, so it cannot take a share of swaps or liquidity. It can still revert, which would block the action for everyone.");

  const doesNotCover = [...UNIVERSAL_LIMITS];
  if (summary.verification === "Audited") {
    doesNotCover.unshift(
      "The Audited badge records that a curator confirmed an audit report covers this exact deployment. It does not mean the audit found nothing, and it does not extend to a redeployment at another address.",
    );
  }
  if (summary.permissionState !== "Fresh") {
    doesNotCover.unshift(
      "The recorded bitmap is not fresh, so the capability findings below describe the last state the registry could read - not necessarily the current one.",
    );
  }

  return {
    address: input.record.hook,
    standing,
    headline,
    axes: {
      verification: summary.verification,
      listing: summary.listing,
      riskClass: summary.riskClass,
      permissionState: summary.permissionState,
    },
    auditBadge: summary.badgeEarned,
    warnings,
    permissions,
    doesNotCover,
  };
}

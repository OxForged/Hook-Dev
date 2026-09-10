// SPDX-License-Identifier: MIT
/**
 * Turning a 16-bit number into sentences an agent can act on.
 *
 * This is the single most useful question an agent can ask before it routes a
 * user's funds through a pool: *what is the contract attached to this pool
 * allowed to do to me?* The bitmap answers it exactly, with no trust assumption
 * at all - the pool manager cross-checks the pool key's bitmap against the
 * hook's own `getHooksRegistrationBitmap()` at initialization, so a hook cannot
 * hold a callback the bitmap does not declare.
 *
 * ## What this module is careful about
 *
 * The bitmap is an upper bound on behaviour, not a prediction of it. A hook
 * with `beforeSwapReturnsDelta` *can* take a cut of every swap; it might take
 * zero. A hook with an empty bitmap cannot take a cut - but it can still be
 * the wrong pool, the wrong token, or a pool with no liquidity. So every
 * explanation carries an explicit `doesNotCover` list, and the word "safe"
 * appears nowhere in the output vocabulary. A bitmap cannot establish safety;
 * it can only establish the absence of specific powers.
 *
 * All bit-level work is delegated to `@latchprotocol/sdk`. There is exactly one
 * definition of what bit 10 means and it is not in this file.
 */

import {
  CL_HOOK_FLAGS,
  BIN_HOOK_FLAGS,
  classifyRiskClass,
  describeCapabilities,
  enabledHookNames,
  hasHookPermission,
  HOOK_BITMAP_MAX,
  validateHookRegistrationBitmap,
  type PoolType,
  type RiskClass,
} from "@latchprotocol/sdk";

/** One power, and whether this bitmap grants it. */
export interface PermissionFinding {
  /** Stable machine key. Safe to branch on. */
  readonly capability:
    | "takeSwapCut"
    | "takeLiquidityCut"
    | "blockSwaps"
    | "trapLiquidity"
    | "blockDeposits"
    | "gatePoolCreation"
    | "setDynamicFee"
    | "observeOnly";
  /** Whether the bitmap grants it. */
  readonly granted: boolean;
  /** The callback bits that decide it, by name. */
  readonly bits: readonly string[];
  /** One sentence, written for a person, in the present tense. */
  readonly meaning: string;
}

export interface PermissionExplanation {
  readonly bitmap: number;
  readonly bitmapHex: string;
  readonly poolType: PoolType;
  /** Callbacks the bitmap declares, in bit order. */
  readonly declaredCallbacks: readonly string[];
  /** `Passive` | `Restrictive` | `ValueExtracting`, derived by the SDK. */
  readonly riskClass: RiskClass;
  /** False when no pool manager would accept this bitmap. */
  readonly acceptedByPoolManagers: boolean;
  /** Why not, when `acceptedByPoolManagers` is false. */
  readonly validationIssues: readonly string[];
  /** Every power, granted or not. An agent should read the `false` rows too. */
  readonly findings: readonly PermissionFinding[];
  /** The granted powers as plain sentences, most consequential first. */
  readonly plainLanguage: readonly string[];
  /** What this bitmap cannot tell you. Never empty. */
  readonly doesNotCover: readonly string[];
}

const NEVER_ESTABLISHED: readonly string[] = [
  "A bitmap is an upper bound on what the contract MAY do, not a description of what it DOES do. Reading the source or an audit is the only way to learn the latter.",
  "It says nothing about the hook's own admin powers - who can pause it, change its fee, or upgrade it behind a proxy.",
  "It says nothing about the tokens in the pool, which can be fee-on-transfer, rebasing, pausable, or blocklisting.",
  "It says nothing about liquidity depth or price, so a pool with a harmless bitmap can still return a terrible quote.",
];

/**
 * Explain a permission bitmap.
 *
 * @param bitmap the `uint16` the pool key carries and the hook reports.
 * @param poolType which naming scheme to use. Bit OFFSETS are identical for
 * both pool types, so the classification never changes; only bits 2-5, 12 and
 * 13 are named differently (`addLiquidity`/`removeLiquidity` vs `mint`/`burn`).
 * @throws if `bitmap` is not a `uint16`. An out-of-range bitmap is a caller bug
 * and must not be silently masked into something that looks meaningful.
 */
export function explainPermissions(bitmap: number, poolType: PoolType = "CL"): PermissionExplanation {
  if (!Number.isInteger(bitmap) || bitmap < 0 || bitmap > HOOK_BITMAP_MAX) {
    throw new RangeError(
      `hook permission bitmap must be an integer in [0, ${HOOK_BITMAP_MAX}], received: ${bitmap}`,
    );
  }

  const caps = describeCapabilities(bitmap, poolType);
  const validation = validateHookRegistrationBitmap(poolType, bitmap);
  const flags: Record<string, number> = poolType === "CL" ? CL_HOOK_FLAGS : BIN_HOOK_FLAGS;
  /** Bit offset by callback name. Throws on a name this pool type does not have,
   * which would otherwise silently read as "permission not granted". */
  const offsetOf = (name: string): number => {
    const offset = flags[name];
    if (offset === undefined) throw new Error(`no callback named "${name}" for pool type ${poolType}`);
    return offset;
  };
  const has = (name: string): boolean => hasHookPermission(bitmap, offsetOf(name));

  const liquidityCutBits =
    poolType === "CL"
      ? ["afterAddLiquidityReturnsDelta", "afterRemoveLiquidityReturnsDelta"]
      : ["afterMintReturnsDelta", "afterBurnReturnsDelta"];
  const takesLiquidityCut = liquidityCutBits.some((b) => has(b));

  const depositBit = poolType === "CL" ? "beforeAddLiquidity" : "beforeMint";
  const withdrawBit = poolType === "CL" ? "beforeRemoveLiquidity" : "beforeBurn";

  const findings: PermissionFinding[] = [
    {
      capability: "takeSwapCut",
      granted: caps.takesSwapCut,
      bits: ["beforeSwapReturnsDelta", "afterSwapReturnsDelta"],
      meaning: caps.takesSwapCut
        ? "Takes a share of every swap in its pool. The amount is set by the hook, not by the pool, and is bounded only by the size of the swap itself."
        : "Cannot take a share of a swap. It holds no returns-delta bit on the swap path, so the pool manager will reject any delta it tries to return.",
    },
    {
      capability: "takeLiquidityCut",
      granted: takesLiquidityCut,
      bits: liquidityCutBits,
      meaning: takesLiquidityCut
        ? "Takes a share of liquidity as it is added or removed, so a deposit or withdrawal can return less than the position is worth."
        : "Cannot take a share of a deposit or a withdrawal.",
    },
    {
      capability: "blockSwaps",
      granted: caps.canBlockSwaps,
      bits: ["beforeSwap"],
      meaning: caps.canBlockSwaps
        ? "Can refuse a swap. It runs before the trade is priced, so it can reject any caller, any size, or every trade at once - trading in this pool exists at its discretion."
        : "Cannot refuse a swap before it is priced.",
    },
    {
      capability: "trapLiquidity",
      granted: caps.canTrapLiquidity,
      bits: [withdrawBit],
      meaning: caps.canTrapLiquidity
        ? "Can refuse a liquidity withdrawal. If it reverts, or is upgraded to revert, deposited funds cannot be taken out of the pool. This is the bit that turns a deposit into a one-way door."
        : "Cannot refuse a liquidity withdrawal.",
    },
    {
      capability: "blockDeposits",
      granted: has(depositBit),
      bits: [depositBit],
      meaning: has(depositBit)
        ? "Can refuse a deposit, so the pool may be permissioned or closed to new liquidity."
        : "Cannot refuse a deposit.",
    },
    {
      capability: "gatePoolCreation",
      granted: has("beforeInitialize"),
      bits: ["beforeInitialize"],
      meaning: has("beforeInitialize")
        ? "Can refuse the creation of a pool that names it, so which pools exist is its decision."
        : "Cannot gate pool creation.",
    },
    {
      capability: "setDynamicFee",
      granted: caps.canBlockSwaps,
      bits: ["beforeSwap"],
      meaning: caps.canBlockSwaps
        ? "May also set the LP fee per swap if the pool was created with the dynamic-fee marker. The fee you were quoted is not necessarily the fee you pay - re-quote immediately before trading."
        : "Cannot change the fee on a per-swap basis; it holds no beforeSwap callback.",
    },
    {
      capability: "observeOnly",
      granted: caps.riskClass === "Passive",
      bits: [],
      meaning:
        caps.riskClass === "Passive"
          ? "Holds only after-callbacks that cannot return a delta: it observes and records. Note it can still revert, which would block the action for EVERY user of the pool - a denial of service rather than a selective one."
          : "Holds at least one callback that can refuse an action or move value; it does more than observe.",
    },
  ];

  const plainLanguage = findings
    .filter((f) => f.granted && f.capability !== "observeOnly")
    .map((f) => f.meaning);
  if (plainLanguage.length === 0) {
    plainLanguage.push(
      findings.find((f) => f.capability === "observeOnly")?.meaning ??
        "This bitmap declares no callbacks at all: the pool behaves as an ordinary pool with nothing attached.",
    );
  }

  const doesNotCover = [...NEVER_ESTABLISHED];
  if (!validation.valid) {
    doesNotCover.unshift(
      "This bitmap is not one any pool manager will accept, so it cannot be the live configuration of a working pool. Treat it as a typo or a stale record until you have re-read it from chain.",
    );
  }

  return {
    bitmap,
    bitmapHex: `0x${bitmap.toString(16).padStart(4, "0")}`,
    poolType,
    declaredCallbacks: enabledHookNames(poolType, bitmap),
    riskClass: classifyRiskClass(bitmap),
    acceptedByPoolManagers: validation.valid,
    validationIssues: validation.issues.map((i) => i.message),
    findings,
    plainLanguage,
    doesNotCover,
  };
}

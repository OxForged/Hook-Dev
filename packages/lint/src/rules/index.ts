// SPDX-License-Identifier: MIT
/** The rule set. */

import { bitmapDependenciesRule } from "./bitmapDependencies.js";
import { bitmapMatchesImplementationRule } from "./bitmapMatchesImplementation.js";
import { hotPathRevertRule } from "./hotPathRevert.js";
import { managerReentrancyRule } from "./managerReentrancy.js";
import { poolManagerAuthRule } from "./poolManagerAuth.js";
import { selectorReturnRule } from "./selectorReturn.js";
import { senderIsNotTheUserRule } from "./senderIsNotTheUser.js";
import { staticFeeOverrideRule } from "./staticFeeOverride.js";
import { unboundedGasRule } from "./unboundedGas.js";
import { unguardedStateRule } from "./unguardedState.js";
import type { Rule } from "./rule.js";

/** Every rule, in id order. */
export const ALL_RULES: readonly Rule[] = [
  poolManagerAuthRule,
  bitmapMatchesImplementationRule,
  bitmapDependenciesRule,
  staticFeeOverrideRule,
  senderIsNotTheUserRule,
  hotPathRevertRule,
  unboundedGasRule,
  selectorReturnRule,
  unguardedStateRule,
  managerReentrancyRule,
];

export { type Rule, type RuleContext, type FindingDraft, materialise } from "./rule.js";

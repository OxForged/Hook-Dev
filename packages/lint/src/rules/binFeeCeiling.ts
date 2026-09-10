// SPDX-License-Identifier: MIT
/** LATCH-012 - a bin LP fee above the ceiling core accepts for bin pools. */

import { OVERRIDE_FEE_FLAG, TEN_PERCENT_FEE } from "@latchprotocol/sdk";
import { returnComponent } from "../analysis/fee.js";
import { foldConstant } from "../ast/constfold.js";
import { collect, getNode, type AstNode } from "../ast/node.js";
import { FEE_RETURN_INDEX, feeBearingCallbacks } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const OVERRIDE_MASK = ~BigInt(OVERRIDE_FEE_FLAG);
const CEILING = BigInt(TEN_PERCENT_FEE);

export const binFeeCeilingRule: Rule = {
  id: "LATCH-012",
  title: "Bin LP fee above core's 10% ceiling",
  basis:
    "Source AST plus constant folding. The value is a compile-time constant in the code and nowhere else: the ABI has no fee, and the bytecode has lost which `uint24` was the fee. Only constants are reported - a fee computed at runtime is left to LATCH-004's neighbours rather than guessed at.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    if (hook.poolType !== "BIN") return [];

    const resolve = (id: number): AstNode | undefined => compilation.nodesById.get(id);
    const drafts: FindingDraft[] = [];

    for (const name of feeBearingCallbacks(hook.poolType)) {
      const index = FEE_RETURN_INDEX[name];
      if (index === undefined) continue;
      const binding = hook.callbacks.get(name);
      const body = getNode(binding?.impl, "body");
      if (binding?.status !== "implemented" || body === undefined) continue;

      for (const returnStatement of collect(body, "Return")) {
        const fee = returnComponent(returnStatement, index);
        const folded = foldConstant(fee, resolve);
        if (folded === undefined) continue;
        const bare = folded & OVERRIDE_MASK;
        if (bare <= CEILING) continue;

        drafts.push({
          severity: "high",
          confidence: "high",
          at: fee,
          message:
            `\`${name}\` returns an LP fee of ${bare} on a bin pool. Core validates a bin LP fee against ` +
            `\`LPFeeLibrary.TEN_PERCENT_FEE\` (${TEN_PERCENT_FEE}), not \`ONE_HUNDRED_PERCENT_FEE\`, and reverts ` +
            `with \`LPFeeTooLarge\` above it - so every operation this fee applies to fails. A launch tax ` +
            `ported from a CL hook, where the ceiling is 1,000,000, hits this immediately.`,
          fix:
            `Cap the returned fee at ${TEN_PERCENT_FEE}. A bin launch tax is a weaker deterrent than a CL one ` +
            `by construction; that is a property of the pool type, not a parameter to tune around.`,
        });
      }
    }

    return drafts;
  },
};

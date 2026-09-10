// SPDX-License-Identifier: MIT
/** LATCH-007 - unbounded work inside a callback that runs in someone else's transaction. */

import { externalCallTarget, reachableFunctions } from "../analysis/reach.js";
import { stateVariableIds } from "../analysis/state.js";
import { foldConstant } from "../ast/constfold.js";
import { collect, getNode, getString, referencedDeclaration, type AstNode } from "../ast/node.js";
import { HOT_PATH_CALLBACKS } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const LOOPS = ["ForStatement", "WhileStatement", "DoWhileStatement"] as const;

type Bound =
  | { readonly kind: "constant" }
  | { readonly kind: "infinite" }
  | { readonly kind: "state"; readonly name: string }
  | { readonly kind: "parameter"; readonly name: string }
  | { readonly kind: "unknown" };

/**
 * Classifies what a loop's continuation condition depends on.
 *
 * Only the confident answers are reported; "unknown" is deliberately dropped so
 * the rule does not degenerate into "you wrote a loop".
 */
function classifyBound(
  loop: AstNode,
  context: RuleContext,
  parameterIds: ReadonlySet<number>,
  stateIds: ReadonlySet<number>,
): Bound {
  const condition = getNode(loop, "condition");
  if (condition === undefined) return { kind: "infinite" };
  if (condition.nodeType === "Literal" && getString(condition, "value") === "true") {
    return { kind: "infinite" };
  }

  const resolve = (id: number): AstNode | undefined => context.compilation.nodesById.get(id);
  let sawConstantBound = false;

  for (const side of [getNode(condition, "leftExpression"), getNode(condition, "rightExpression")]) {
    if (side === undefined) continue;
    if (foldConstant(side, resolve) !== undefined) {
      sawConstantBound = true;
      continue;
    }
    // `x.length` over storage, or a bare state variable, is attacker-growable.
    for (const identifier of collect(side, "Identifier")) {
      const id = referencedDeclaration(identifier);
      if (id === undefined) continue;
      const name = getString(identifier, "name") ?? "?";
      if (stateIds.has(id)) return { kind: "state", name };
      if (parameterIds.has(id)) return { kind: "parameter", name };
    }
  }

  return sawConstantBound ? { kind: "constant" } : { kind: "unknown" };
}

export const unboundedGasRule: Rule = {
  id: "LATCH-007",
  title: "Unbounded work inside a hook callback",
  basis:
    "Source AST. Gas is a property of the loop's bound, not of the ABI, and the bytecode has already lost the distinction between `i < 8` and `i < holders.length`. Constant folding resolves a bound written as a named constant; the state-variable and parameter cases are reported and an unresolvable bound is not, so the rule stays quiet on ordinary fixed-size arithmetic.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];
    const stateIds = new Set(stateVariableIds(hook.chain).keys());

    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented") continue;
      if (!HOT_PATH_CALLBACKS.has(binding.spec.name)) continue;
      if (binding.impl === undefined) continue;

      for (const reached of reachableFunctions(compilation, hook.chain, [binding.impl], 3)) {
        const body = getNode(reached.fn, "body");
        if (body === undefined) continue;

        const parameterIds = new Set<number>();
        for (const parameter of collect(getNode(reached.fn, "parameters") ?? reached.fn, "VariableDeclaration")) {
          const id = parameter["id"];
          if (typeof id === "number") parameterIds.add(id);
        }

        const where =
          reached.depth === 0
            ? `\`${binding.spec.name}\``
            : `\`${getString(reached.fn, "name") ?? "?"}\`, called from \`${binding.spec.name}\``;

        for (const loop of collect(body, ...LOOPS)) {
          const bound = classifyBound(loop, context, parameterIds, stateIds);

          if (bound.kind === "infinite") {
            drafts.push({
              severity: "medium",
              confidence: "high",
              at: loop,
              message: `${where} contains a loop with no static exit condition. It runs until it exhausts the gas of whoever's transaction the hook is running inside.`,
              fix: "Give the loop a bound that cannot be influenced from outside the hook, and cap the iteration count.",
            });
            continue;
          }

          if (bound.kind === "state" || bound.kind === "parameter") {
            const source =
              bound.kind === "state"
                ? `the stored value \`${bound.name}\``
                : `the argument \`${bound.name}\``;
            drafts.push({
              severity: "medium",
              confidence: "medium",
              at: loop,
              message:
                `${where} loops a number of times determined by ${source}. This callback executes inside ` +
                `another account's swap, so the gas it burns is charged to a trader who did not choose to ` +
                `run it. Once ${source} grows past what a block can afford, every swap on the pool fails - ` +
                `a griefing vector that anyone able to grow it can trigger.`,
              fix:
                "Bound the iteration count with a constant cap, or restructure so the work is O(1) per " +
                "callback (accumulate incrementally, or move the sweep to a separate permissionless " +
                "function that is not on the swap path).",
            });
          }

          const externalInLoop = collect(loop, "FunctionCall")
            .map(externalCallTarget)
            .find((target) => target !== undefined);
          if (externalInLoop !== undefined) {
            drafts.push({
              severity: "medium",
              confidence: "medium",
              at: externalInLoop,
              message:
                `${where} makes an external call inside a loop. Each iteration hands control to another ` +
                `contract, so the gas cost of the swap this hook is riding on is set by code the hook does ` +
                `not control.`,
              fix: "Move external calls out of the loop, or cap both the iteration count and the gas forwarded per call.",
            });
          }
        }
      }
    }

    return drafts;
  },
};

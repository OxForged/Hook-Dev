// SPDX-License-Identifier: MIT
/** LATCH-006 - a revert on the swap path that makes the pool untradeable. */

import { externalCallTarget, reachableFunctions } from "../analysis/reach.js";
import { collect, getNode, getNodes, getString, walk, type AstNode } from "../ast/node.js";
import { isTxOrigin } from "../ast/query.js";
import { HOT_CALLBACKS } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const BRANCHING = new Set([
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "DoWhileStatement",
  "TryStatement",
  "Conditional",
]);

/** Parent links for one function body, so a revert's guards can be recovered. */
function parentMap(root: AstNode): Map<AstNode, AstNode> {
  const parents = new Map<AstNode, AstNode>();
  walk(root, (node) => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (
          typeof child === "object" &&
          child !== null &&
          !Array.isArray(child) &&
          typeof (child as { nodeType?: unknown }).nodeType === "string"
        ) {
          parents.set(child as AstNode, node);
        }
      }
    }
  });
  return parents;
}

interface RevertSite {
  readonly at: AstNode;
  /** Conditions of the enclosing `if`s / loops, innermost first. */
  readonly guards: AstNode[];
}

function revertSites(body: AstNode): RevertSite[] {
  const parents = parentMap(body);
  const sites: RevertSite[] = [];

  const record = (node: AstNode, seedGuard?: AstNode): void => {
    const guards: AstNode[] = seedGuard === undefined ? [] : [seedGuard];
    let current: AstNode | undefined = parents.get(node);
    let depth = 0;
    while (current !== undefined && current !== body && depth++ < 40) {
      if (BRANCHING.has(current.nodeType)) {
        const condition = getNode(current, "condition");
        if (condition !== undefined) guards.push(condition);
        else guards.push(current);
      }
      current = parents.get(current);
    }
    sites.push({ at: node, guards });
  };

  for (const node of collect(body, "RevertStatement")) record(node);

  for (const call of collect(body, "FunctionCall")) {
    const callee = getString(getNode(call, "expression"), "name");
    if (callee !== "require" && callee !== "revert") continue;
    // `require(cond, ...)` carries its own guard; `revert("...")` has none.
    const conditions = getNodes(call, "arguments");
    record(call, callee === "require" ? conditions[0] : undefined);
  }

  return sites;
}

function guardUsesExternalCall(guard: AstNode): AstNode | undefined {
  for (const call of collect(guard, "FunctionCall")) {
    const target = externalCallTarget(call);
    if (target !== undefined) return target;
  }
  return undefined;
}

function guardUsesTxOrigin(guard: AstNode): boolean {
  let found = false;
  walk(guard, (node) => {
    if (isTxOrigin(node)) found = true;
    return !found;
  });
  return found;
}

export const hotPathRevertRule: Rule = {
  id: "LATCH-006",
  title: "Revert on the swap path that can make the pool untradeable",
  basis:
    "Source AST with enclosing-condition recovery. A revert on the swap path is legitimate for a launch gate and a denial-of-service bug everywhere else, and nothing in the code says which. Rather than report every revert and be ignored, the rule fires only where the *reason* the pool would stop trading is outside the hook's control: an unconditional revert, or a gate on another contract's answer, or a gate on `tx.origin`. A gate on the hook's own configuration is a deliberate policy choice and is not reported - which is why this rule is silent on a correct launch hook, and why its recall is deliberately incomplete.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];

    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented") continue;
      if (!HOT_CALLBACKS.has(binding.spec.name)) continue;
      if (binding.impl === undefined) continue;

      for (const reached of reachableFunctions(compilation, hook.chain, [binding.impl], 2)) {
        const body = getNode(reached.fn, "body");
        if (body === undefined) continue;
        const where =
          reached.depth === 0
            ? `\`${binding.spec.name}\``
            : `\`${getString(reached.fn, "name") ?? "?"}\`, called from \`${binding.spec.name}\``;

        for (const site of revertSites(body)) {
          if (site.guards.length === 0) {
            drafts.push({
              severity: "medium",
              confidence: "high",
              at: site.at,
              message:
                `${where} reverts unconditionally. Every swap against a pool using this hook fails, ` +
                `permanently: the pool holds liquidity that cannot be traded.`,
              fix:
                "Return the callback's selector instead, or guard the revert behind the condition it was " +
                "meant to enforce. If the callback is genuinely not implemented, drop its permission bit " +
                "from `getHooksRegistrationBitmap()` so the pool manager never calls it.",
            });
            continue;
          }

          const external = site.guards.map(guardUsesExternalCall).find((t) => t !== undefined);
          if (external !== undefined) {
            drafts.push({
              severity: "medium",
              confidence: "medium",
              at: site.at,
              message:
                `${where} reverts on a condition read from another contract. The hook runs inside someone ` +
                `else's swap, so whoever controls that contract - or anything that makes the call revert, ` +
                `pause or return an unexpected value - can make this pool untradeable at will. A launch ` +
                `gate on the hook's own configuration is a deliberate policy; a gate on an external ` +
                `answer is a denial-of-service dependency.`,
              fix:
                "Fail open on the swap path: catch the external failure and continue with a safe default, " +
                "or move the dependency to a callback that is not on the swap path. If trading really " +
                "must stop, make the condition state this hook owns and can be reasoned about.",
            });
            continue;
          }

          if (site.guards.some(guardUsesTxOrigin)) {
            drafts.push({
              severity: "medium",
              confidence: "high",
              at: site.at,
              message:
                `${where} reverts based on \`tx.origin\`. In a hook, \`tx.origin\` is the EOA that started ` +
                `the transaction, which for an aggregated or batched trade is not the party this hook ` +
                `means to judge - and it blocks every legitimate contract-initiated swap.`,
              fix:
                "Remove the `tx.origin` condition. Identity cannot be established inside a hook callback; " +
                "price the behaviour instead of trying to name the actor.",
            });
          }
        }
      }
    }

    return drafts;
  },
};

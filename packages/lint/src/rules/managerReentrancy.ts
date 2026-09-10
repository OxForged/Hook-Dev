// SPDX-License-Identifier: MIT
/** LATCH-010 - re-entering the pool manager, or an arbitrary contract, from inside a callback. */

import { reachableFunctions } from "../analysis/reach.js";
import { collect, getNode, getString, type AstNode } from "../ast/node.js";
import { resolveNamedDeclaration } from "../ast/query.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

/** Manager entry points that re-enter the pool the callback is already inside. */
const REENTRANT_MANAGER_CALLS = new Set([
  "swap",
  "modifyLiquidity",
  "donate",
  "initialize",
  "lock",
  "unlock",
]);

const MANAGER_TYPE = /\b(I?CL|I?Bin)?Pool[Mm]anager\b|\bIVault\b/;
const MANAGER_NAME = /^_?(cl|bin)?(pool)?manager$|^_?vault$/i;

const LOW_LEVEL = new Set(["call", "delegatecall", "staticcall"]);

function targetsPoolManager(context: RuleContext, base: AstNode | undefined): boolean {
  if (base === undefined) return false;
  const inlineType = getString(getNode(base, "typeDescriptions"), "typeString");
  if (inlineType !== undefined && MANAGER_TYPE.test(inlineType)) return true;
  const declaration = resolveNamedDeclaration(context.compilation, base);
  const name = getString(declaration, "name");
  if (name !== undefined && MANAGER_NAME.test(name)) return true;
  const declaredType = getString(getNode(declaration, "typeDescriptions"), "typeString");
  return declaredType !== undefined && MANAGER_TYPE.test(declaredType);
}

export const managerReentrancyRule: Rule = {
  id: "LATCH-010",
  title: "Callback re-enters the pool manager or calls out to an arbitrary address",
  basis:
    "Source AST. Which contract a call goes to is a type-and-declaration question that solc has already answered in the AST (`typeDescriptions` plus `referencedDeclaration`); recovering the same fact from the ABI or the bytecode is not possible.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];

    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented" || binding.impl === undefined) continue;

      for (const reached of reachableFunctions(compilation, hook.chain, [binding.impl], 3)) {
        const body = getNode(reached.fn, "body");
        if (body === undefined) continue;
        const where =
          reached.depth === 0
            ? `\`${binding.spec.name}\``
            : `\`${getString(reached.fn, "name") ?? "?"}\`, called from \`${binding.spec.name}\``;

        for (const call of collect(body, "FunctionCall")) {
          if (getString(call, "kind") !== "functionCall") continue;
          const member = getNode(call, "expression");
          if (member?.nodeType !== "MemberAccess") continue;
          const memberName = getString(member, "memberName");
          if (memberName === undefined) continue;
          const base = getNode(member, "expression");

          if (REENTRANT_MANAGER_CALLS.has(memberName) && targetsPoolManager(context, base)) {
            drafts.push({
              severity: "high",
              confidence: "medium",
              at: call,
              message:
                `${where} calls \`${memberName}\` back into the pool manager while the manager is part-way ` +
                `through the operation that invoked this hook. The pool's state is mid-update and the ` +
                `Vault lock is already held, so the nested operation reads inconsistent reserves and the ` +
                `deltas of the two operations settle against each other in an order the hook does not control.`,
              fix:
                "Do not call back into the manager from a callback. Express the hook's effect as the delta " +
                "the callback returns (with the matching `*ReturnsDelta` permission), or queue the work and " +
                "perform it from a separate transaction outside the lock.",
            });
            continue;
          }

          if (LOW_LEVEL.has(memberName)) {
            drafts.push({
              severity: "high",
              confidence: "medium",
              at: call,
              message:
                `${where} performs a low-level \`${memberName}\`. A hook callback runs inside another ` +
                `account's swap with the Vault lock held; handing control to an address chosen at runtime ` +
                `lets the callee re-enter the hook, re-enter the manager, or consume the trader's remaining gas.`,
              fix:
                "Remove the arbitrary call, or restrict the target to an immutable, audited address and " +
                "cap the gas forwarded. Never derive the target from `hookData`: any caller can set it.",
            });
          }
        }
      }
    }

    return drafts;
  },
};

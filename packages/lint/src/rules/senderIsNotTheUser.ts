// SPDX-License-Identifier: MIT
/** LATCH-005 - treating a callback's `sender` as the end user. */

import {
  collect,
  getNode,
  getNodes,
  getString,
  referencedDeclaration,
  typeStringOf,
  type AstNode,
} from "../ast/node.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

/** Local aliases of the `sender` parameter, so `address u = sender;` is followed. */
function taintedIds(body: AstNode, seedId: number): Set<number> {
  const tainted = new Set<number>([seedId]);
  const references = (node: AstNode | undefined): boolean => {
    if (node === undefined) return false;
    for (const identifier of collect(node, "Identifier")) {
      const id = referencedDeclaration(identifier);
      if (id !== undefined && tainted.has(id)) return true;
    }
    return false;
  };

  for (let pass = 0; pass < 3; pass++) {
    for (const statement of collect(body, "VariableDeclarationStatement")) {
      if (!references(getNode(statement, "initialValue"))) continue;
      for (const declaration of getNodes(statement, "declarations")) {
        const id = declaration["id"];
        if (typeof id === "number") tainted.add(id);
      }
    }
    for (const assignment of collect(body, "Assignment")) {
      if (!references(getNode(assignment, "rightHandSide"))) continue;
      const id = referencedDeclaration(getNode(assignment, "leftHandSide"));
      if (id !== undefined) tainted.add(id);
    }
  }
  return tainted;
}

function isTainted(node: AstNode | undefined, tainted: ReadonlySet<number>): boolean {
  if (node === undefined) return false;
  for (const identifier of collect(node, "Identifier")) {
    const id = referencedDeclaration(identifier);
    if (id !== undefined && tainted.has(id)) return true;
  }
  return false;
}

interface Misuse {
  readonly at: AstNode;
  readonly kind: string;
}

function findMisuses(body: AstNode, tainted: ReadonlySet<number>): Misuse[] {
  const out: Misuse[] = [];

  // 1. keyed storage: `balances[sender]`, `claimed[sender][id]`
  for (const access of collect(body, "IndexAccess")) {
    if (isTainted(getNode(access, "indexExpression"), tainted)) {
      out.push({ at: access, kind: "used as a mapping/array key" });
    }
  }

  // 2. identity comparison: an allowlist, a "one buy per address" test
  for (const comparison of collect(body, "BinaryOperation")) {
    const operator = getString(comparison, "operator");
    if (operator !== "==" && operator !== "!=") continue;
    const left = getNode(comparison, "leftExpression");
    const right = getNode(comparison, "rightExpression");
    if (isTainted(left, tainted) || isTainted(right, tainted)) {
      out.push({ at: comparison, kind: "compared against another address" });
    }
  }

  // 3. persisted: `lastBuyer = sender`
  for (const assignment of collect(body, "Assignment")) {
    if (isTainted(getNode(assignment, "rightHandSide"), tainted)) {
      const target = getNode(assignment, "leftHandSide");
      if (target !== undefined && !isTainted(target, tainted)) {
        out.push({ at: assignment, kind: "stored as an identity" });
      }
    }
  }

  return out;
}

export const senderIsNotTheUserRule: Rule = {
  id: "LATCH-005",
  title: "`sender` treated as the end user",
  basis:
    "Source AST, with local alias tracking. The distinction that matters - forwarding `sender` to an inner function (harmless) versus keying storage on it (broken) - is a use-site property, so the rule looks only at terminal uses: a mapping key, an identity comparison, a store. A hook that names the parameter `/* sender */` and never uses it is, correctly, invisible to this rule.",

  run(context: RuleContext): FindingDraft[] {
    const { hook } = context;
    const drafts: FindingDraft[] = [];

    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented") continue;

      for (const fn of binding.path) {
        const parameters = getNodes(getNode(fn, "parameters"), "parameters");
        const first = parameters[0];
        if (first === undefined) continue;
        const parameterName = getString(first, "name");
        if (parameterName === undefined || parameterName.length === 0) continue;
        if (typeStringOf(first) !== "address") continue;
        const parameterId = first["id"];
        if (typeof parameterId !== "number") continue;

        const body = getNode(fn, "body");
        if (body === undefined) continue;

        const tainted = taintedIds(body, parameterId);
        for (const misuse of findMisuses(body, tainted)) {
          drafts.push({
            severity: "high",
            confidence: "medium",
            at: misuse.at,
            message:
              `\`${binding.spec.name}\` ${misuse.kind} its \`${parameterName}\` argument. The pool manager ` +
              `passes the address that locked the Vault - the router - not the account whose swap this is. ` +
              `Every trade routed through one router arrives with the same value, so a per-wallet cap, an ` +
              `allowlist, or per-user accounting keyed on it is consumed by the first caller on everyone's ` +
              `behalf, and anyone can bypass the router entirely by locking the Vault themselves.`,
            fix:
              `Do not key protection on identity at this layer - it cannot be enforced honestly. Price the ` +
              `behaviour instead (a decaying fee, a per-transaction size cap), which is a function of the ` +
              `swap and the block rather than of the caller. \`hookData\` is not a substitute: any caller ` +
              `can supply it. If the value genuinely is meant to be the router, rename it to say so.`,
          });
        }
      }
    }

    return drafts;
  },
};

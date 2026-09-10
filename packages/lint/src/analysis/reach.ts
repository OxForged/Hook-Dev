// SPDX-License-Identifier: MIT
/**
 * Intra-contract call-graph reachability.
 *
 * A hook's dangerous work is rarely in the callback body itself - the callback
 * calls `_enforceCap`, which calls `_price`, which loops. Rules about gas,
 * reverts and state therefore have to look at everything the callback can
 * reach, resolved virtually so an overridden helper is analysed as the
 * subclass wrote it, not as the base declared it.
 */

import type { Compilation } from "../ast/compilation.js";
import { collect, getNode, getString, referencedDeclaration, type AstNode } from "../ast/node.js";
import { resolveVirtual } from "../ast/query.js";

/** A function reached from a callback, with how far away it is. */
export interface ReachedFunction {
  readonly fn: AstNode;
  readonly depth: number;
}

/**
 * Every function reachable from `roots` through internal calls.
 *
 * `maxDepth` keeps a deep utility library from dominating a run; three levels
 * covers the shapes real hooks use and stops well short of `FullMath`.
 */
export function reachableFunctions(
  compilation: Compilation,
  chain: readonly AstNode[],
  roots: readonly AstNode[],
  maxDepth = 3,
): ReachedFunction[] {
  const out: ReachedFunction[] = [];
  const seen = new Set<number>();
  let frontier: AstNode[] = [];

  for (const root of roots) {
    const id = root["id"];
    if (typeof id === "number") {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push({ fn: root, depth: 0 });
    frontier.push(root);
  }

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: AstNode[] = [];
    for (const fn of frontier) {
      const body = getNode(fn, "body");
      if (body === undefined) continue;
      for (const call of collect(body, "FunctionCall")) {
        if (getString(call, "kind") !== "functionCall") continue;
        const target = getNode(call, "expression");
        if (target?.nodeType !== "Identifier") continue;
        const declId = referencedDeclaration(target);
        if (declId === undefined) continue;
        const decl = compilation.nodesById.get(declId);
        if (decl?.nodeType !== "FunctionDefinition") continue;
        const visibility = getString(decl, "visibility");
        if (visibility !== "internal" && visibility !== "private") continue;

        const name = getString(decl, "name");
        const resolved = (name === undefined ? undefined : resolveVirtual(chain, name)) ?? decl;
        const id = resolved["id"];
        if (typeof id === "number") {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        out.push({ fn: resolved, depth });
        next.push(resolved);
      }
    }
    frontier = next;
  }

  return out;
}

/** True when the expression is an external call on a contract-typed value. */
export function externalCallTarget(call: AstNode): AstNode | undefined {
  if (call.nodeType !== "FunctionCall") return undefined;
  if (getString(call, "kind") !== "functionCall") return undefined;
  const target = getNode(call, "expression");
  if (target?.nodeType !== "MemberAccess") return undefined;
  const base = getNode(target, "expression");
  const baseType = getString(getNode(base, "typeDescriptions"), "typeString");
  if (baseType === undefined) return undefined;
  // solc renders a contract instance as `contract IFoo` and an address as `address`.
  if (!baseType.startsWith("contract ") && !baseType.startsWith("address")) return undefined;
  return target;
}

/** True when the subtree performs any external call. */
export function containsExternalCall(root: AstNode): boolean {
  for (const call of collect(root, "FunctionCall")) {
    if (externalCallTarget(call) !== undefined) return true;
  }
  const lowLevel = collect(root, "FunctionCallOptions").length > 0;
  return lowLevel;
}

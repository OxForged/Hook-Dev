// SPDX-License-Identifier: MIT
/**
 * Which storage a function reads and which it writes.
 *
 * Storage pointers are the reason this needs more than a name scan.
 * `Launch storage l = _launches[poolId]; l.owner = msg.sender;` writes
 * `_launches`, but the assignment's base identifier is a local. Following the
 * pointer back to the state variable it was bound from is what lets the
 * "unguarded write to callback-critical state" rule fire on the real thing and
 * stay quiet on a local temporary.
 */

import type { Compilation } from "../ast/compilation.js";
import { collect, getNode, getNodes, getString, referencedDeclaration, type AstNode } from "../ast/node.js";
import { stateVariablesInChain } from "../ast/query.js";

/** Storage touched by a function. */
export interface StateAccess {
  readonly reads: ReadonlySet<number>;
  readonly writes: ReadonlySet<number>;
}

/** Ids of the state variables declared across a chain. */
export function stateVariableIds(chain: readonly AstNode[]): Map<number, AstNode> {
  const out = new Map<number, AstNode>();
  for (const declaration of stateVariablesInChain(chain)) {
    const id = declaration["id"];
    if (typeof id === "number") out.set(id, declaration);
  }
  return out;
}

/** Peels `a.b[c].d` down to the identifier at its root. */
function rootIdentifier(expression: AstNode | undefined): AstNode | undefined {
  let current = expression;
  for (let i = 0; i < 12 && current !== undefined; i++) {
    switch (current.nodeType) {
      case "Identifier":
        return current;
      case "MemberAccess":
      case "IndexAccess":
      case "IndexRangeAccess":
        current = getNode(current, "expression") ?? getNode(current, "baseExpression");
        break;
      case "TupleExpression":
        current = getNodes(current, "components")[0];
        break;
      case "FunctionCall":
        current = getNodes(current, "arguments")[0];
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

/**
 * Maps storage-pointer locals back to the state variable they alias.
 *
 * Returns declaration id -> state variable id.
 */
function storagePointerAliases(
  body: AstNode,
  stateVars: ReadonlyMap<number, AstNode>,
): Map<number, number> {
  const aliases = new Map<number, number>();
  for (let pass = 0; pass < 3; pass++) {
    for (const statement of collect(body, "VariableDeclarationStatement")) {
      const declarations = getNodes(statement, "declarations");
      const declaration = declarations[0];
      if (declaration === undefined) continue;
      if (getString(declaration, "storageLocation") !== "storage") continue;
      const localId = declaration["id"];
      if (typeof localId !== "number" || aliases.has(localId)) continue;

      const root = rootIdentifier(getNode(statement, "initialValue"));
      const rootId = referencedDeclaration(root);
      if (rootId === undefined) continue;
      if (stateVars.has(rootId)) aliases.set(localId, rootId);
      else {
        const via = aliases.get(rootId);
        if (via !== undefined) aliases.set(localId, via);
      }
    }
  }
  return aliases;
}

function resolveToStateVar(
  expression: AstNode | undefined,
  stateVars: ReadonlyMap<number, AstNode>,
  aliases: ReadonlyMap<number, number>,
): number | undefined {
  const root = rootIdentifier(expression);
  const id = referencedDeclaration(root);
  if (id === undefined) return undefined;
  if (stateVars.has(id)) return id;
  return aliases.get(id);
}

/** Storage read and written by a function body. */
export function stateAccessOf(
  _compilation: Compilation,
  chain: readonly AstNode[],
  fn: AstNode,
  stateVars: ReadonlyMap<number, AstNode> = stateVariableIds(chain),
): StateAccess {
  const reads = new Set<number>();
  const writes = new Set<number>();
  const body = getNode(fn, "body");
  if (body === undefined) return { reads, writes };

  const aliases = storagePointerAliases(body, stateVars);

  for (const assignment of collect(body, "Assignment")) {
    const target = resolveToStateVar(getNode(assignment, "leftHandSide"), stateVars, aliases);
    if (target !== undefined) writes.add(target);
  }

  for (const unary of collect(body, "UnaryOperation")) {
    const operator = getString(unary, "operator");
    if (operator !== "++" && operator !== "--" && operator !== "delete") continue;
    const target = resolveToStateVar(getNode(unary, "subExpression"), stateVars, aliases);
    if (target !== undefined) writes.add(target);
  }

  // `arr.push(x)` / `arr.pop()` mutate without an Assignment node.
  for (const call of collect(body, "FunctionCall")) {
    const member = getNode(call, "expression");
    if (member?.nodeType !== "MemberAccess") continue;
    const name = getString(member, "memberName");
    if (name !== "push" && name !== "pop") continue;
    const target = resolveToStateVar(getNode(member, "expression"), stateVars, aliases);
    if (target !== undefined) writes.add(target);
  }

  for (const identifier of collect(body, "Identifier")) {
    const id = referencedDeclaration(identifier);
    if (id === undefined) continue;
    if (stateVars.has(id)) reads.add(id);
    else {
      const via = aliases.get(id);
      if (via !== undefined) reads.add(via);
    }
  }

  return { reads, writes };
}

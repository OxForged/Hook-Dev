// SPDX-License-Identifier: MIT
/** Reusable queries over a loaded compilation. */

import type { Compilation } from "./compilation.js";
import {
  collect,
  getNode,
  getNodes,
  getString,
  referencedDeclaration,
  walk,
  type AstNode,
} from "./node.js";

/** A contract together with the file it was declared in. */
export interface ContractRef {
  readonly node: AstNode;
  readonly name: string;
  readonly kind: string;
  readonly sourceIndex: number;
  readonly unitPath: string;
}

/** Every contract/interface/library in the compilation. */
export function allContracts(compilation: Compilation): ContractRef[] {
  const out: ContractRef[] = [];
  for (const source of compilation.sources.values()) {
    for (const node of getNodes(source.ast, "nodes")) {
      if (node.nodeType !== "ContractDefinition") continue;
      const name = getString(node, "name");
      if (name === undefined) continue;
      out.push({
        node,
        name,
        kind: getString(node, "contractKind") ?? "contract",
        sourceIndex: source.sourceIndex,
        unitPath: source.unitPath,
      });
    }
  }
  return out;
}

/**
 * The C3-linearized inheritance chain, most-derived first.
 *
 * This is what makes virtual dispatch resolvable: a callback declared in a base
 * and overridden two levels down is found by scanning this list in order.
 */
export function linearizedChain(compilation: Compilation, contract: AstNode): AstNode[] {
  const ids = contract["linearizedBaseContracts"];
  if (Array.isArray(ids)) {
    const chain: AstNode[] = [];
    for (const id of ids) {
      if (typeof id !== "number") continue;
      const node = compilation.nodesById.get(id);
      if (node?.nodeType === "ContractDefinition") chain.push(node);
    }
    if (chain.length > 0) return chain;
  }
  return [contract];
}

/** Members of one contract with the given node type. */
export function membersOf(contract: AstNode, nodeType: string): AstNode[] {
  return getNodes(contract, "nodes").filter((node) => node.nodeType === nodeType);
}

/** All function definitions across a linearized chain, most-derived first. */
export function functionsInChain(chain: readonly AstNode[]): AstNode[] {
  const out: AstNode[] = [];
  for (const contract of chain) out.push(...membersOf(contract, "FunctionDefinition"));
  return out;
}

/** True when the function has a body (an abstract declaration does not). */
export function isImplemented(fn: AstNode): boolean {
  return getNode(fn, "body") !== undefined;
}

/**
 * Resolves a call to `name` the way the EVM would at runtime: the most-derived
 * contract in `chain` that provides a body wins.
 */
export function resolveVirtual(chain: readonly AstNode[], name: string, kind = "FunctionDefinition"): AstNode | undefined {
  for (const contract of chain) {
    for (const member of membersOf(contract, kind)) {
      if (getString(member, "name") !== name) continue;
      if (kind === "FunctionDefinition" && !isImplemented(member)) continue;
      return member;
    }
  }
  return undefined;
}

/** Declaration of `name` anywhere in the chain, implemented or not. */
export function findDeclaration(chain: readonly AstNode[], name: string, kind: string): AstNode | undefined {
  for (const contract of chain) {
    for (const member of membersOf(contract, kind)) {
      if (getString(member, "name") === name) return member;
    }
  }
  return undefined;
}

/** State variables declared across the chain. */
export function stateVariablesInChain(chain: readonly AstNode[]): AstNode[] {
  const out: AstNode[] = [];
  for (const contract of chain) {
    for (const member of membersOf(contract, "VariableDeclaration")) {
      if (member["constant"] === true) continue;
      out.push(member);
    }
  }
  return out;
}

/** True when the expression is `msg.sender`. */
export function isMsgSender(node: AstNode | undefined): boolean {
  if (node?.nodeType !== "MemberAccess") return false;
  if (getString(node, "memberName") !== "sender") return false;
  const base = getNode(node, "expression");
  return base?.nodeType === "Identifier" && getString(base, "name") === "msg";
}

/** True when the expression is `tx.origin`. */
export function isTxOrigin(node: AstNode | undefined): boolean {
  if (node?.nodeType !== "MemberAccess") return false;
  if (getString(node, "memberName") !== "origin") return false;
  const base = getNode(node, "expression");
  return base?.nodeType === "Identifier" && getString(base, "name") === "tx";
}

/** True when the subtree contains `msg.sender`. */
export function containsMsgSender(root: AstNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found) return false;
    if (isMsgSender(node)) found = true;
    return !found;
  });
  return found;
}

/** True when the subtree can abort the transaction. */
export function containsRevert(root: AstNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found) return false;
    if (node.nodeType === "RevertStatement") {
      found = true;
      return false;
    }
    if (node.nodeType === "FunctionCall") {
      const target = getNode(node, "expression");
      const name = getString(target, "name");
      if (name === "require" || name === "revert" || name === "assert") found = true;
    }
    return !found;
  });
  return found;
}

/** Equality/inequality comparisons of `msg.sender` in the subtree. */
export interface SenderComparison {
  readonly node: AstNode;
  /** The expression `msg.sender` is compared against. */
  readonly against: AstNode | undefined;
}

export function msgSenderComparisons(root: AstNode): SenderComparison[] {
  const out: SenderComparison[] = [];
  for (const node of collect(root, "BinaryOperation")) {
    const op = getString(node, "operator");
    if (op !== "==" && op !== "!=") continue;
    const left = getNode(node, "leftExpression");
    const right = getNode(node, "rightExpression");
    if (left !== undefined && containsMsgSender(left)) out.push({ node, against: right });
    else if (right !== undefined && containsMsgSender(right)) out.push({ node, against: left });
  }
  return out;
}

/** The declaration an expression ultimately names, unwrapping casts and member access. */
export function resolveNamedDeclaration(
  compilation: Compilation,
  expression: AstNode | undefined,
): AstNode | undefined {
  let current = expression;
  for (let i = 0; i < 8 && current !== undefined; i++) {
    if (current.nodeType === "FunctionCall") {
      // address(x) / ICLPoolManager(x)
      const args = getNodes(current, "arguments");
      current = args[0];
      continue;
    }
    if (current.nodeType === "TupleExpression") {
      current = getNodes(current, "components")[0];
      continue;
    }
    const declId = referencedDeclaration(current);
    if (declId !== undefined) return compilation.nodesById.get(declId);
    if (current.nodeType === "MemberAccess") {
      current = getNode(current, "expression");
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** Function definitions called (statically) from within `root`. */
export function calleesOf(compilation: Compilation, root: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const call of collect(root, "FunctionCall")) {
    if (getString(call, "kind") !== "functionCall") continue;
    const target = getNode(call, "expression");
    const declId = referencedDeclaration(target);
    if (declId === undefined) continue;
    const decl = compilation.nodesById.get(declId);
    if (decl?.nodeType === "FunctionDefinition") out.push(decl);
  }
  return out;
}

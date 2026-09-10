// SPDX-License-Identifier: MIT
/**
 * Does a callback hand an LP fee back to the pool manager?
 *
 * Shared by the two fee rules. The return-tuple position is callback-specific -
 * `beforeSwap` returns `(bytes4, BeforeSwapDelta, uint24)` and bin's
 * `beforeMint` returns `(bytes4, uint24)` - so the index comes from a table
 * rather than being assumed.
 */

import type { Compilation } from "../ast/compilation.js";
import { foldConstant } from "../ast/constfold.js";
import { collect, getNode, getNodes, type AstNode } from "../ast/node.js";
import { FEE_RETURN_INDEX } from "../model/callbacks.js";
import type { HookContract } from "../model/hook.js";
import { reachableFunctions } from "./reach.js";

const OVERRIDE_FLAG = 0x400000n;

/** Nth component of a `return` (a bare expression counts as component 0). */
export function returnComponent(returnStatement: AstNode, index: number): AstNode | undefined {
  const expression = getNode(returnStatement, "expression");
  if (expression === undefined) return undefined;
  if (expression.nodeType === "TupleExpression") return getNodes(expression, "components")[index];
  return index === 0 ? expression : undefined;
}

/** Bodies of a callback's implementation and the internal helpers it calls. */
export function callbackBodies(
  compilation: Compilation,
  hook: HookContract,
  callbackName: string,
  depth = 2,
): AstNode[] {
  const binding = hook.callbacks.get(callbackName);
  if (binding === undefined || binding.status !== "implemented" || binding.impl === undefined) return [];
  return reachableFunctions(compilation, hook.chain, [binding.impl], depth)
    .map((reached) => getNode(reached.fn, "body"))
    .filter((body): body is AstNode => body !== undefined);
}

/** Where the callback produces a non-zero fee, if it does. */
export interface FeeReturn {
  readonly returns: boolean;
  readonly at: AstNode | undefined;
}

/**
 * True when `callbackName` returns an LP fee that is not statically zero.
 *
 * A hook that returns a literal `0` is declining to override, which is the
 * correct way to say "no opinion" and must not be reported.
 */
export function returnsFeeOverride(
  compilation: Compilation,
  hook: HookContract,
  callbackName: string,
): FeeReturn {
  const index = FEE_RETURN_INDEX[callbackName];
  if (index === undefined) return { returns: false, at: undefined };

  const binding = hook.callbacks.get(callbackName);
  if (binding?.status !== "implemented") return { returns: false, at: undefined };

  const resolve = (id: number): AstNode | undefined => compilation.nodesById.get(id);
  const ownBody = getNode(binding.impl, "body");
  const bodies = callbackBodies(compilation, hook, callbackName);

  if (ownBody !== undefined) {
    for (const returnStatement of collect(ownBody, "Return")) {
      const fee = returnComponent(returnStatement, index);
      if (fee === undefined) continue;
      if (foldConstant(fee, resolve) === 0n) continue;
      return { returns: true, at: fee };
    }
  }

  // A hook may assemble the fee in a helper and return a local. The override
  // flag appearing anywhere on the path is decisive on its own.
  for (const body of bodies) {
    for (const node of collect(body, "Identifier", "MemberAccess")) {
      if (foldConstant(node, resolve) === OVERRIDE_FLAG) return { returns: true, at: node };
    }
  }

  return { returns: false, at: undefined };
}

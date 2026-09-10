// SPDX-License-Identifier: MIT
/** LATCH-004 - a fee override that a static-fee pool silently throws away. */

import { DYNAMIC_FEE_FLAG, OVERRIDE_FEE_FLAG, hasHookPermission } from "@latchprotocol/sdk";
import { reachableFunctions } from "../analysis/reach.js";
import { foldConstant } from "../ast/constfold.js";
import { collect, getNode, getNodes, getString, type AstNode } from "../ast/node.js";
import { containsRevert } from "../ast/query.js";
import type { CallbackBinding, HookContract } from "../model/hook.js";
import type { Compilation } from "../ast/compilation.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const DYNAMIC_FLAG = BigInt(DYNAMIC_FEE_FLAG);
const OVERRIDE_FLAG = BigInt(OVERRIDE_FEE_FLAG);

/** Nth component of a `return` (a bare expression counts as component 0). */
function returnComponent(returnStatement: AstNode, index: number): AstNode | undefined {
  const expression = getNode(returnStatement, "expression");
  if (expression === undefined) return undefined;
  if (expression.nodeType === "TupleExpression") return getNodes(expression, "components")[index];
  return index === 0 ? expression : undefined;
}

function bodiesOf(
  compilation: Compilation,
  hook: HookContract,
  binding: CallbackBinding | undefined,
): AstNode[] {
  if (binding === undefined || binding.impl === undefined) return [];
  return reachableFunctions(compilation, hook.chain, [binding.impl], 2)
    .map((reached) => getNode(reached.fn, "body"))
    .filter((body): body is AstNode => body !== undefined);
}

/** Does the hook hand a fee back from `beforeSwap`? */
function returnsFeeOverride(
  compilation: Compilation,
  bodies: readonly AstNode[],
): { returns: boolean; at: AstNode | undefined } {
  const resolve = (id: number): AstNode | undefined => compilation.nodesById.get(id);

  for (const body of bodies) {
    for (const returnStatement of collect(body, "Return")) {
      const fee = returnComponent(returnStatement, 2);
      if (fee === undefined) continue;
      const folded = foldConstant(fee, resolve);
      if (folded === 0n) continue;
      return { returns: true, at: fee };
    }
    // A hook may build the fee elsewhere and return a local; the override flag
    // appearing anywhere on the swap path is decisive on its own.
    for (const node of collect(body, "Identifier", "MemberAccess")) {
      if (foldConstant(node, resolve) === OVERRIDE_FLAG) return { returns: true, at: node };
    }
  }
  return { returns: false, at: undefined };
}

/** Is there a revert-backed assertion that the pool's fee is the dynamic marker? */
function assertsDynamicFee(compilation: Compilation, bodies: readonly AstNode[]): boolean {
  const resolve = (id: number): AstNode | undefined => compilation.nodesById.get(id);

  for (const body of bodies) {
    if (!containsRevert(body)) continue;

    for (const call of collect(body, "FunctionCall")) {
      const target = getNode(call, "expression");
      const name = getString(target, "memberName") ?? getString(target, "name");
      if (name === "isDynamicLPFee") return true;
    }

    for (const comparison of collect(body, "BinaryOperation")) {
      const operator = getString(comparison, "operator");
      if (operator !== "==" && operator !== "!=") continue;
      const left = foldConstant(getNode(comparison, "leftExpression"), resolve);
      const right = foldConstant(getNode(comparison, "rightExpression"), resolve);
      if (left === DYNAMIC_FLAG || right === DYNAMIC_FLAG) return true;
    }
  }
  return false;
}

/** `fee & 0x800000` - a bitmask test where core does an exact equality. */
function findBitmaskTests(compilation: Compilation, bodies: readonly AstNode[]): AstNode[] {
  const resolve = (id: number): AstNode | undefined => compilation.nodesById.get(id);
  const out: AstNode[] = [];
  for (const body of bodies) {
    for (const node of collect(body, "BinaryOperation")) {
      if (getString(node, "operator") !== "&") continue;
      const left = foldConstant(getNode(node, "leftExpression"), resolve);
      const right = foldConstant(getNode(node, "rightExpression"), resolve);
      if (left === DYNAMIC_FLAG || right === DYNAMIC_FLAG) out.push(node);
    }
  }
  return out;
}

export const staticFeeOverrideRule: Rule = {
  id: "LATCH-004",
  title: "Fee override with no guarantee the pool is dynamic-fee",
  basis:
    "Source AST. The question is whether a *particular* revert-backed assertion exists on the initialize path, which is a control-flow property; neither the ABI nor the bytecode can answer it. Constant folding is what lets the check recognise `0x800000` however it was spelled - a literal, `LPFeeLibrary.DYNAMIC_FEE_FLAG`, or a local constant.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];

    const swap = hook.callbacks.get("beforeSwap");
    const initialize = hook.callbacks.get("beforeInitialize");
    const swapBodies = bodiesOf(compilation, hook, swap);
    const initBodies = bodiesOf(compilation, hook, initialize);

    for (const node of findBitmaskTests(compilation, [...swapBodies, ...initBodies])) {
      drafts.push({
        severity: "medium",
        confidence: "high",
        at: node,
        message:
          `A pool's fee is tested against the dynamic-fee marker with a bitmask (\`& 0x${DYNAMIC_FEE_FLAG.toString(16)}\`). ` +
          `Core's \`LPFeeLibrary.isDynamicLPFee\` is \`self == 0x${DYNAMIC_FEE_FLAG.toString(16)}\` exactly - the marker ` +
          `is a sentinel value, not a flag bit within a fee. A bitmask test accepts values core would treat ` +
          `as static, so this check does not mean what it appears to mean.`,
        fix: "Use `LPFeeLibrary.isDynamicLPFee(key.fee)`, or compare for exact equality.",
      });
    }

    if (swap?.status !== "implemented") return drafts;

    const fee = returnsFeeOverride(compilation, swapBodies);
    if (!fee.returns) return drafts;

    if (assertsDynamicFee(compilation, [...initBodies, ...swapBodies])) return drafts;

    const bitmap = hook.declaredBitmap;
    const declaresInitialize = bitmap === undefined ? undefined : hasHookPermission(bitmap, 0);

    const reason =
      declaresInitialize === false
        ? "this hook does not register `beforeInitialize` at all, so it never sees the pool's fee configuration"
        : initialize?.status !== "implemented"
          ? "this hook has no `beforeInitialize` implementation, so it never sees the pool's fee configuration"
          : "`beforeInitialize` never asserts it";

    drafts.push({
      severity: "high",
      confidence: "medium",
      at: fee.at ?? swap.impl,
      message:
        `\`beforeSwap\` returns an LP fee, but nothing guarantees the pool is a dynamic-fee pool: ${reason}. ` +
        `Core applies a hook-returned fee only when \`LPFeeLibrary.isDynamicLPFee(key.fee)\` holds - that is, ` +
        `when \`key.fee == 0x${DYNAMIC_FEE_FLAG.toString(16)}\` exactly. On a static-fee pool the returned fee is ` +
        `discarded with no revert and no event, so anyone can create a static-fee pool against this hook and ` +
        `trade it with whatever protection the fee was providing silently switched off.`,
      fix:
        "Reject the pool at initialization:\n\n" +
        "    function _beforeInitialize(address, PoolKey calldata key, uint160)\n" +
        "        internal view override returns (bytes4)\n" +
        "    {\n" +
        "        if (!key.fee.isDynamicLPFee()) revert PoolMustUseDynamicFee(key.fee);\n" +
        "        return IHooks.beforeInitialize.selector;\n" +
        "    }\n\n" +
        "and set bit 0 (`beforeInitialize`) in `getHooksRegistrationBitmap()`.",
    });

    return drafts;
  },
};

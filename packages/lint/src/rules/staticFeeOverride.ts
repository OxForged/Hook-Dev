// SPDX-License-Identifier: MIT
/** LATCH-004 - a fee override that a static-fee pool silently throws away. */

import { DYNAMIC_FEE_FLAG, hasHookPermission } from "@latchprotocol/sdk";
import { callbackBodies, returnsFeeOverride } from "../analysis/fee.js";
import { foldConstant } from "../ast/constfold.js";
import { collect, getNode, getString, type AstNode } from "../ast/node.js";
import { containsRevert } from "../ast/query.js";
import { feeBearingCallbacks } from "../model/callbacks.js";
import type { Compilation } from "../ast/compilation.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const DYNAMIC_FLAG = BigInt(DYNAMIC_FEE_FLAG);

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
      // `&` is the wrong test, but it *is* an attempt: reporting both "you have
      // no assertion" and "your assertion is a bitmask" on the same line is
      // noise. The bitmask finding below says what to change.
      if (operator !== "==" && operator !== "!=" && operator !== "&") continue;
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
    "Source AST. The question is whether a *particular* revert-backed assertion exists on the initialize path, which is a control-flow property; neither the ABI nor the bytecode can answer it. Constant folding is what lets the check recognise `0x800000` however it was spelled - a literal, `LPFeeLibrary.DYNAMIC_FEE_FLAG`, or a local constant. The fee's position in the return tuple is read from a per-callback table, because bin's `beforeMint` returns `(bytes4, uint24)` where `beforeSwap` returns `(bytes4, BeforeSwapDelta, uint24)`.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];

    const initBodies = callbackBodies(compilation, hook, "beforeInitialize");
    const feeCallbacks = feeBearingCallbacks(hook.poolType);
    const feeBodies = feeCallbacks.flatMap((name) => callbackBodies(compilation, hook, name));

    for (const node of findBitmaskTests(compilation, [...feeBodies, ...initBodies])) {
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

    const asserted = assertsDynamicFee(compilation, [...initBodies, ...feeBodies]);
    if (asserted) return drafts;

    const bitmap = hook.declaredBitmap;
    const declaresInitialize = bitmap === undefined ? undefined : hasHookPermission(bitmap, 0);
    const initialize = hook.callbacks.get("beforeInitialize");
    const reason =
      declaresInitialize === false
        ? "this hook does not register `beforeInitialize` at all, so it never sees the pool's fee configuration"
        : initialize?.status !== "implemented"
          ? "this hook has no `beforeInitialize` implementation, so it never sees the pool's fee configuration"
          : "`beforeInitialize` never asserts it";

    for (const name of feeCallbacks) {
      const fee = returnsFeeOverride(compilation, hook, name);
      if (!fee.returns) continue;

      drafts.push({
        severity: "high",
        confidence: "medium",
        at: fee.at ?? hook.callbacks.get(name)?.impl,
        message:
          `\`${name}\` returns an LP fee, but nothing guarantees the pool is a dynamic-fee pool: ${reason}. ` +
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
    }

    return drafts;
  },
};

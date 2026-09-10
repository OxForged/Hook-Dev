// SPDX-License-Identifier: MIT
/** LATCH-008 - a callback that returns the wrong selector, or none. */

import { collect, getNode, getNodes, getString, referencedDeclaration, type AstNode } from "../ast/node.js";
import { ALL_CALLBACK_NAMES } from "../model/callbacks.js";
import { isRevertOnly } from "../model/hook.js";
import type { Compilation } from "../ast/compilation.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

/** The first value a `return` yields (a bare expression counts as the first). */
function firstReturnValue(returnStatement: AstNode): AstNode | undefined {
  const expression = getNode(returnStatement, "expression");
  if (expression === undefined) return undefined;
  if (expression.nodeType === "TupleExpression") return getNodes(expression, "components")[0];
  return expression;
}

/** `X.someCallback.selector` -> `"someCallback"`. */
function selectorCallbackName(node: AstNode | undefined): string | undefined {
  if (node?.nodeType !== "MemberAccess") return undefined;
  if (getString(node, "memberName") !== "selector") return undefined;
  const inner = getNode(node, "expression");
  if (inner?.nodeType !== "MemberAccess") return undefined;
  return getString(inner, "memberName");
}

type Verdict =
  | { readonly kind: "correct" }
  | { readonly kind: "wrong"; readonly actual: string }
  | { readonly kind: "unverifiable" };

function verdictFor(
  compilation: Compilation,
  value: AstNode | undefined,
  expected: string,
  depth: number,
): Verdict {
  if (value === undefined) return { kind: "unverifiable" };

  const named = selectorCallbackName(value);
  if (named !== undefined) {
    if (named === expected) return { kind: "correct" };
    if (ALL_CALLBACK_NAMES.has(named)) return { kind: "wrong", actual: named };
    return { kind: "unverifiable" };
  }

  if (value.nodeType === "FunctionCall" && depth < 3) {
    // `return _passthroughSwap();` or `return _pass(IHooks.afterSwap.selector);`
    for (const argument of getNodes(value, "arguments")) {
      const fromArgument = verdictFor(compilation, argument, expected, depth + 1);
      if (fromArgument.kind === "correct") return fromArgument;
      if (fromArgument.kind === "wrong") return fromArgument;
    }
    const declId = referencedDeclaration(getNode(value, "expression"));
    const callee = declId === undefined ? undefined : compilation.nodesById.get(declId);
    const body = getNode(callee, "body");
    if (body !== undefined) {
      let sawUnverifiable = false;
      for (const nested of collect(body, "Return")) {
        const inner = verdictFor(compilation, firstReturnValue(nested), expected, depth + 1);
        if (inner.kind === "wrong") return inner;
        if (inner.kind === "correct") return inner;
        sawUnverifiable = true;
      }
      if (sawUnverifiable) return { kind: "unverifiable" };
    }
  }

  return { kind: "unverifiable" };
}

export const selectorReturnRule: Rule = {
  id: "LATCH-008",
  title: "Callback returns a missing or incorrect selector",
  basis:
    "Source AST. The property is per-return-path (one branch can be right and another wrong), which only the AST expresses; the ABI records the return *type* and is silent on the value. Returns through a helper are followed one level so a base hook's passthrough is not misreported.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    const drafts: FindingDraft[] = [];

    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented") continue;
      const impl = binding.impl;
      const body = getNode(impl, "body");
      if (impl === undefined || body === undefined) continue;

      const expected = binding.spec.name;
      const returns = collect(body, "Return").filter((node) => getNode(node, "expression") !== undefined);

      if (returns.length === 0 && !isRevertOnly(body)) {
        drafts.push({
          severity: "high",
          confidence: "medium",
          at: impl,
          message:
            `\`${expected}\` never returns a value explicitly, so it yields the zero selector. Core compares ` +
            `the returned selector against \`IHooks.${expected}.selector\` and reverts with ` +
            `\`InvalidHookResponse\`, which takes down every operation that triggers this callback.`,
          fix: `Return \`IHooks.${expected}.selector\` (plus the delta/fee values the signature requires) on every path.`,
        });
        continue;
      }

      for (const returnStatement of returns) {
        const verdict = verdictFor(compilation, firstReturnValue(returnStatement), expected, 0);

        if (verdict.kind === "wrong") {
          drafts.push({
            severity: "high",
            confidence: "high",
            at: returnStatement,
            message:
              `\`${expected}\` returns \`${verdict.actual}\`'s selector. Core checks the returned selector ` +
              `against \`IHooks.${expected}.selector\` and reverts with \`InvalidHookResponse\` on a ` +
              `mismatch, so this path bricks the operation every time it is taken.`,
            fix: `Return \`IHooks.${expected}.selector\` here.`,
          });
          continue;
        }

        if (verdict.kind === "unverifiable") {
          drafts.push({
            severity: "medium",
            confidence: "low",
            at: returnStatement,
            message:
              `\`${expected}\` returns a first value that is not recognisably ` +
              `\`IHooks.${expected}.selector\`. If it is not exactly that selector, core reverts with ` +
              `\`InvalidHookResponse\`.`,
            fix: `Return the selector literally - \`IHooks.${expected}.selector\` - rather than through an indirection, so the value is obvious at the return site.`,
          });
        }
      }
    }

    return drafts;
  },
};

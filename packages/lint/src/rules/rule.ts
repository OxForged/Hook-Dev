// SPDX-License-Identifier: MIT
/** The rule interface and the helpers every rule shares. */

import { positionOf, type Compilation } from "../ast/compilation.js";
import type { AstNode } from "../ast/node.js";
import type { Confidence, Finding, Severity } from "../finding.js";
import type { HookContract } from "../model/hook.js";

/** Everything a rule is given. */
export interface RuleContext {
  readonly compilation: Compilation;
  readonly hook: HookContract;
  /** ABIs from `out/`, keyed by contract name. Empty when artifacts are unreadable. */
  readonly abis: ReadonlyMap<string, readonly Record<string, unknown>[]>;
}

/** Everything a rule needs to emit. */
export interface FindingDraft {
  readonly severity: Severity;
  readonly confidence: Confidence;
  readonly at: AstNode | undefined;
  readonly message: string;
  readonly fix: string;
}

/** A single check. */
export interface Rule {
  readonly id: string;
  readonly title: string;
  /**
   * Which analysis input the rule uses and why. Surfaced by `--explain`, and
   * the reason each choice is defensible rather than incidental.
   */
  readonly basis: string;
  run(context: RuleContext): FindingDraft[];
}

/** Materialises drafts into findings, resolving source positions. */
export function materialise(rule: Rule, context: RuleContext, drafts: readonly FindingDraft[]): Finding[] {
  return drafts.map((draft) => {
    const position = positionOf(context.compilation, draft.at ?? context.hook.ref.node);
    return {
      rule: rule.id,
      title: rule.title,
      severity: draft.severity,
      confidence: draft.confidence,
      contract: context.hook.ref.name,
      file: position.file,
      line: position.line,
      column: position.column,
      message: draft.message,
      fix: draft.fix,
      snippet: position.snippet,
    };
  });
}

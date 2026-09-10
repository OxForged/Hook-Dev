// SPDX-License-Identifier: MIT
/** LATCH-009 - state the callbacks depend on, writable by anyone outside the lock. */

import { analyseGuard } from "../analysis/access.js";
import { reachableFunctions } from "../analysis/reach.js";
import { stateAccessOf, stateVariableIds } from "../analysis/state.js";
import { getString } from "../ast/node.js";
import { functionsInChain, isImplemented } from "../ast/query.js";
import { ALL_CALLBACK_NAMES } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

export const unguardedStateRule: Rule = {
  id: "LATCH-009",
  title: "Callback-critical state is writable by anyone",
  basis:
    "Source AST, with storage-pointer aliasing followed so `Launch storage l = _launches[id]; l.owner = ...` is attributed to `_launches`. The rule needs three things the ABI cannot supply: which storage a callback reads, which storage an external function writes, and whether that function restricts its caller.",

  run(context: RuleContext): FindingDraft[] {
    const { compilation, hook } = context;
    if (hook.isAbstract) return [];

    const stateVars = stateVariableIds(hook.chain);
    if (stateVars.size === 0) return [];

    // Storage every implemented callback depends on.
    const callbackReads = new Set<number>();
    for (const binding of hook.callbacks.values()) {
      if (binding.status !== "implemented" || binding.impl === undefined) continue;
      for (const reached of reachableFunctions(compilation, hook.chain, [binding.impl], 3)) {
        for (const id of stateAccessOf(compilation, hook.chain, reached.fn, stateVars).reads) {
          callbackReads.add(id);
        }
      }
    }
    if (callbackReads.size === 0) return [];

    const drafts: FindingDraft[] = [];
    const seen = new Set<number>();

    for (const fn of functionsInChain(hook.chain)) {
      if (getString(fn, "kind") !== "function") continue;
      if (!isImplemented(fn)) continue;
      const visibility = getString(fn, "visibility");
      if (visibility !== "external" && visibility !== "public") continue;
      const mutability = getString(fn, "stateMutability");
      if (mutability === "view" || mutability === "pure") continue;

      const name = getString(fn, "name");
      if (name === undefined || ALL_CALLBACK_NAMES.has(name)) continue;

      const id = fn["id"];
      if (typeof id === "number") {
        if (seen.has(id)) continue;
        seen.add(id);
      }

      const writes = stateAccessOf(compilation, hook.chain, fn, stateVars).writes;
      const shared = [...writes].filter((varId) => callbackReads.has(varId));
      if (shared.length === 0) continue;

      const guard = analyseGuard(compilation, hook.chain, [fn]);
      if (guard.guarded) continue;

      const names = shared
        .map((varId) => getString(stateVars.get(varId), "name") ?? "?")
        .join("`, `");

      drafts.push({
        severity: "high",
        confidence: "medium",
        at: fn,
        message:
          `\`${name}\` is callable by anyone and writes \`${names}\`, which the hook's callbacks read while ` +
          `the pool manager holds the lock. Nothing serialises the two: an attacker can rewrite the ` +
          `parameters a swap is about to be judged against - immediately before it, in the same block, or ` +
          `from inside a callback via a reentrant call - and the callback will act on the new values.`,
        fix:
          `Restrict \`${name}\` to an authorised caller (\`if (msg.sender != owner) revert ...\`), and ` +
          `freeze the parameters once they can affect a live pool. If the write must stay open, make the ` +
          `callback read a value that was committed before the operation started rather than the current one.`,
      });
    }

    return drafts;
  },
};

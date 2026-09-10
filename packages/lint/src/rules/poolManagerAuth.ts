// SPDX-License-Identifier: MIT
/** LATCH-001 - a hook callback that any address can call. */

import { analyseGuard } from "../analysis/access.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

export const poolManagerAuthRule: Rule = {
  id: "LATCH-001",
  title: "Hook callback is callable by anyone",
  basis:
    "Source AST. The check is structural - which modifier actually runs on this function after inheritance and overriding, and what that modifier's body compares `msg.sender` to. A name scan would accept `onlyOwner` on `beforeSwap`, and the ABI says nothing about access control at all.",

  run(context: RuleContext): FindingDraft[] {
    const drafts: FindingDraft[] = [];
    const { compilation, hook } = context;

    for (const binding of hook.callbacks.values()) {
      // A callback that only reverts cannot have its accounting corrupted.
      if (binding.status !== "implemented") continue;
      if (binding.entry === undefined) continue;

      const guard = analyseGuard(compilation, hook.chain, binding.path);

      if (!guard.guarded) {
        drafts.push({
          severity: "critical",
          confidence: "high",
          at: binding.entry,
          message:
            `\`${binding.spec.name}\` is reachable by any caller: neither it nor the internal function it ` +
            `forwards to restricts \`msg.sender\`. The pool manager is the only party that has actually ` +
            `performed the swap/liquidity operation this callback is told about, so an attacker can call ` +
            `it directly with fabricated arguments and drive the hook's state out of sync with the pool - ` +
            `tripping a launch cap, replaying a fee decay, or poisoning volume counters, for free.`,
          fix:
            `Add a pool-manager-only guard to \`${binding.spec.name}\` (or to the base callback it ` +
            `forwards through):\n\n` +
            `    modifier onlyPoolManager() {\n` +
            `        if (msg.sender != address(poolManager)) revert NotPoolManager();\n` +
            `        _;\n` +
            `    }\n\n` +
            `Deriving from \`BaseCLHook\`, which applies \`onlyPoolManager\` to every callback, is the ` +
            `safer route than hand-rolling it per callback.`,
        });
        continue;
      }

      if (!guard.guardsPoolManager) {
        drafts.push({
          severity: "high",
          confidence: "medium",
          at: guard.at ?? binding.entry,
          message:
            `\`${binding.spec.name}\` restricts its caller with ${guard.description}. The pool manager ` +
            `will therefore be rejected too, unless it happens to be the address being checked - and any ` +
            `other address that passes the check can forge a callback. A hook callback's caller must be ` +
            `the pool manager, nothing else.`,
          fix:
            `Compare \`msg.sender\` against the pool manager this hook serves ` +
            `(\`if (msg.sender != address(poolManager)) revert NotPoolManager();\`). If the intent was an ` +
            `owner-only administrative function, move it out of the callback surface.`,
        });
      }
    }

    return drafts;
  },
};

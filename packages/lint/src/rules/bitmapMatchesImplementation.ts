// SPDX-License-Identifier: MIT
/** LATCH-002 - the declared permission bitmap does not match the code. */

import { formatHookPermissions, hasHookPermission } from "@latchprotocol/sdk";
import { callbackFunctions } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

function abiHasFunction(
  abis: ReadonlyMap<string, readonly Record<string, unknown>[]>,
  contract: string,
  name: string,
): boolean | undefined {
  const abi = abis.get(contract);
  if (abi === undefined) return undefined;
  return abi.some((entry) => entry["type"] === "function" && entry["name"] === name);
}

export const bitmapMatchesImplementationRule: Rule = {
  id: "LATCH-002",
  title: "Registration bitmap does not match the implemented callbacks",
  basis:
    "Source AST for the bitmap value (constant-folded out of `getHooksRegistrationBitmap()`, which resolves named constants across inheritance without needing a deployment or an RPC) and for whether a callback really does anything. The compiled ABI is used only as a one-way cross-check: a declared callback that is absent from the ABI is a certainty, whereas the ABI's presence proves nothing, because a base hook contributes all ten entry points whether or not the subclass implements them.",

  run(context: RuleContext): FindingDraft[] {
    const { hook, abis } = context;
    const bitmap = hook.declaredBitmap;
    if (bitmap === undefined) return [];
    if (hook.isAbstract) return [];

    const drafts: FindingDraft[] = [];

    for (const spec of callbackFunctions(hook.poolType)) {
      const declared = hasHookPermission(bitmap, spec.bit);
      const binding = hook.callbacks.get(spec.name);
      const status = binding?.status ?? "absent";

      if (declared && status !== "implemented") {
        const inAbi = abiHasFunction(abis, hook.ref.name, spec.name);
        const detail =
          status === "absent"
            ? `no \`${spec.name}\` function exists on this contract or its bases`
            : `\`${spec.name}\` resolves to a body that only reverts (the base hook's "not implemented" default)`;
        const abiNote =
          inAbi === false ? " The compiled ABI confirms the function is not exposed at all." : "";

        drafts.push({
          severity: "high",
          confidence: "high",
          at: hook.permissionExpression ?? hook.permissionFn,
          message:
            `The bitmap declares \`${spec.name}\` (bit ${spec.bit}), but ${detail}.${abiNote} ` +
            `The pool manager cross-checks this value against the pool key at initialization and will ` +
            `call the callback for real once a pool exists, so every swap or liquidity operation on that ` +
            `pool reverts. Declared: ${formatHookPermissions(hook.poolType, bitmap)}.`,
          fix:
            `Either implement \`${spec.name}\` (override the base's \`_${spec.name}\` and return ` +
            `\`IHooks.${spec.name}.selector\`), or drop bit ${spec.bit} from ` +
            `\`getHooksRegistrationBitmap()\`.`,
        });
        continue;
      }

      if (!declared && status === "implemented") {
        drafts.push({
          severity: "medium",
          confidence: "high",
          at: binding?.impl ?? binding?.entry,
          message:
            `\`${spec.name}\` is implemented but bit ${spec.bit} is not set in ` +
            `\`getHooksRegistrationBitmap()\`, so the pool manager never calls it. Whatever protection or ` +
            `accounting this callback performs is dead code on every pool this hook is attached to. ` +
            `Declared: ${formatHookPermissions(hook.poolType, bitmap)}.`,
          fix:
            `Add the permission - \`return ... | ${spec.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()};\` ` +
            `(bit ${spec.bit}) - or delete the callback if it was not meant to run.`,
        });
      }
    }

    // Sanity: a permission set with nothing in it means the hook is never called.
    if (bitmap === 0 && [...hook.callbacks.values()].some((b) => b.status === "implemented")) {
      drafts.push({
        severity: "high",
        confidence: "high",
        at: hook.permissionExpression ?? hook.permissionFn,
        message:
          `\`getHooksRegistrationBitmap()\` returns 0, so the pool manager will never invoke this hook, ` +
          `yet callbacks are implemented. Any pool created with this hook behaves as if it had none.`,
        fix: "Return the bits for the callbacks this hook implements.",
      });
    }

    return drafts;
  },
};

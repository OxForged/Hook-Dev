// SPDX-License-Identifier: MIT
/** LATCH-003 - returns-delta permissions without their base callback, and reserved bits. */

import {
  formatHookPermissions,
  hasHookPermission,
  validateHookRegistrationBitmap,
  HOOK_PERMISSION_DEPENDENCIES,
} from "@latchprotocol/sdk";
import { callbackSpecs } from "../model/callbacks.js";
import type { FindingDraft, Rule, RuleContext } from "./rule.js";

const CODE_SEVERITY = {
  UNASSIGNED_BIT_SET: "high",
  MISSING_DEPENDENCY: "high",
  BITMAP_OUT_OF_RANGE: "high",
} as const;

export const bitmapDependenciesRule: Rule = {
  id: "LATCH-003",
  title: "Invalid permission bitmap (delta dependency or reserved bit)",
  basis:
    "Source AST for the value; the rules themselves come from `@latchprotocol/sdk`'s `validateHookRegistrationBitmap`, which already encodes the pool managers' dependency table (10->6, 11->7, 12->3, 13->5) and the reserved bits 14-15. Re-deriving those offsets here would be a second copy to keep in sync, and the SDK's copy is the one the rest of the protocol is tested against.",

  run(context: RuleContext): FindingDraft[] {
    const { hook } = context;
    const bitmap = hook.declaredBitmap;
    if (bitmap === undefined) return [];

    const result = validateHookRegistrationBitmap(hook.poolType, bitmap);
    if (result.valid) return [];

    const specs = callbackSpecs(hook.poolType);
    const nameOfBit = (bit: number): string => specs.find((s) => s.bit === bit)?.name ?? `bit ${bit}`;

    return result.issues.map((issue) => {
      const severity = CODE_SEVERITY[issue.code as keyof typeof CODE_SEVERITY] ?? "high";

      if (issue.code === "MISSING_DEPENDENCY") {
        const pair = HOOK_PERMISSION_DEPENDENCIES[hook.poolType].find(
          ([dependent, required]) =>
            hasHookPermission(bitmap, dependent) && !hasHookPermission(bitmap, required),
        );
        const dependent = pair?.[0] ?? -1;
        const required = pair?.[1] ?? -1;
        return {
          severity,
          confidence: "high" as const,
          at: hook.permissionExpression ?? hook.permissionFn,
          message:
            `${issue.message}. The bitmap is ${formatHookPermissions(hook.poolType, bitmap)}. ` +
            `A returns-delta permission tells the pool manager to read a delta back from a callback it ` +
            `is not registered to call, so the pool manager rejects the configuration and the pool can ` +
            `never be initialized - a deploy-time brick, not a runtime bug.`,
          fix:
            `Set \`${nameOfBit(required)}\` (bit ${required}) as well, or drop ` +
            `\`${nameOfBit(dependent)}\` (bit ${dependent}).`,
        };
      }

      if (issue.code === "UNASSIGNED_BIT_SET") {
        return {
          severity,
          confidence: "high" as const,
          at: hook.permissionExpression ?? hook.permissionFn,
          message:
            `${issue.message}. The bitmap is 0x${bitmap.toString(16)}. Bits 14 and 15 carry no meaning ` +
            `and the pool manager rejects a bitmap that sets them, so no pool using this hook can be ` +
            `initialized.`,
          fix: `Mask the returned value to the assigned bits: \`return bitmap & 0x3FFF;\`, or remove the stray bit.`,
        };
      }

      return {
        severity,
        confidence: "high" as const,
        at: hook.permissionExpression ?? hook.permissionFn,
        message: issue.message,
        fix: "Return a uint16 in [0, 0x3FFF] whose set bits match the callbacks this hook implements.",
      };
    });
  },
};

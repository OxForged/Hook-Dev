// SPDX-License-Identifier: MIT
/**
 * `latch_explain_permissions` - the tool an agent should reach for first.
 *
 * Pure: no chain access, no key, no network. It turns the 16-bit number that
 * governs a pool into sentences, and it is the cheapest possible answer to the
 * only question that matters before touching a pool.
 */

import { toJson } from "../json.js";
import { explainPermissions } from "../explain/permissions.js";
import { ok, type LatchTool } from "../types.js";
import { asRecord, requireBitmapField, requireEnumField, toToolError } from "./common.js";

const CAVEATS: readonly string[] = [
  "A bitmap is a ceiling on behaviour, not a description of it. It proves which powers a contract does NOT have; it cannot prove what it does with the ones it has.",
  "This tool does not check that the bitmap belongs to any particular contract. Read `getHooksRegistrationBitmap()` from the hook, or use latch_lookup, to bind a bitmap to an address.",
];

export function explainPermissionsTool(): LatchTool {
  return {
    name: "latch_explain_permissions",
    access: "read",
    returnsUntrustedText: false,
    description:
      "Explain, in plain language, what a Latch hook's permission bitmap allows it to do to a pool: " +
      "whether it can take a share of every swap, refuse trades, block or trap liquidity, set the fee " +
      "per swap, or only observe. Takes the uint16 bitmap (from a pool key's `parameters`, from the " +
      "hook's `getHooksRegistrationBitmap()`, or from latch_lookup) and needs no network access. " +
      "Use this before routing funds through any pool that has a hook attached. " +
      "It reports capability only. A bitmap says what the contract MAY do, not what it does: it " +
      "establishes which powers the contract does NOT have, and cannot tell you whether it uses the " +
      "powers it does have, who controls it, or whether its code is correct.",
    inputSchema: {
      type: "object",
      properties: {
        bitmap: {
          type: "string",
          description:
            "The uint16 permission bitmap, as a decimal number or a 0x-prefixed hex string (e.g. 64, \"0x0040\"). Range 0-65535.",
        },
        poolType: {
          type: "string",
          description:
            "Which naming scheme to use for bits 2-5, 12 and 13. \"CL\" is concentrated liquidity (addLiquidity/removeLiquidity), \"BIN\" is liquidity book (mint/burn). Bit OFFSETS are identical for both, so the risk classification never depends on this. Defaults to CL.",
          enum: ["CL", "BIN"],
          default: "CL",
        },
      },
      required: ["bitmap"],
      additionalProperties: false,
    },
    async handler(input) {
      try {
        const raw = asRecord(input);
        const bitmap = requireBitmapField(raw, "bitmap");
        const poolType =
          raw["poolType"] === undefined ? "CL" : requireEnumField(raw, "poolType", ["CL", "BIN"] as const);
        return ok(toJson(explainPermissions(bitmap, poolType)), CAVEATS);
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}

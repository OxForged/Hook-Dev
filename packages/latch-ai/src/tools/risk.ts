// SPDX-License-Identifier: MIT
/**
 * `latch_assess_risk` - what is known, what is claimed, and what neither covers.
 *
 * This tool has no positive verdict. There is no "safe", no score, no green
 * state, and there never will be, because nothing this tool can read is capable
 * of establishing one: the registry is a permissionless listing curated by
 * humans on three independent axes, and the bitmap is a statement about
 * capability. An agent that reads "this Latch is safe" and routes a user's
 * funds accordingly is exactly the failure this package is built to prevent.
 *
 * What it does produce: the three axes side by side, the warnings the SDK
 * derives, the full bitmap explanation, and a required, non-empty list of what
 * the assessment does not cover.
 */

import { toJson } from "../json.js";
import type { LatchContext } from "../context.js";
import { assessRisk } from "../explain/risk.js";
import { lookupLatch } from "../reads.js";
import { ok, UNTRUSTED_TEXT_CAVEAT, sanitizeUntrusted, type LatchTool } from "../types.js";
import { asRecord, requireAddressField, toToolError } from "./common.js";

const CAVEATS: readonly string[] = [
  "This is not a safety verdict and this tool has no way to produce one. It reports what the registry records and what the permission bitmap permits - neither is an audit.",
  "A registry listing is permissionless and free. Only the permission bitmap is read from chain; the name, description, source URI and audit URI were typed in by the submitter.",
  "Nothing here covers the hook's own admin powers, its upgradeability, the behaviour of the pool's tokens, or the correctness of its code. Reading the source and any audit report is the only way to answer those.",
];

export function assessRiskTool(ctx: LatchContext): LatchTool {
  return {
    name: "latch_assess_risk",
    access: "read",
    returnsUntrustedText: true,
    description:
      "Produce a structured trust summary for one address: its registry standing, the three independent " +
      "axes (what a curator attested, whether the registry still recommends it, what its bitmap allows), " +
      "a severity-ordered warning list, and an explicit statement of what the assessment does not cover. " +
      "Use it before deciding whether to interact with a pool governed by a hook. " +
      "IMPORTANT: this tool never returns a verdict of 'safe' and cannot be made to. A registry listing " +
      "is not an audit, and a permission bitmap describes what a contract MAY do, not what it does. " +
      "Report its findings and its limits together; do not summarise them into a recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The contract address to assess, 0x-prefixed and 20 bytes.",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    async handler(input) {
      try {
        const address = requireAddressField(asRecord(input), "address");
        const result = await lookupLatch(ctx, address);

        const assessment = result.found
          ? assessRisk({ registered: true, record: result.record })
          : assessRisk({
              registered: false,
              address: result.address,
              hasCode: result.hasCode,
              ...(result.onChainBitmap === undefined ? {} : { onChainBitmap: result.onChainBitmap }),
            });

        // Submitter-authored strings are attached separately and labelled, so
        // they can be shown without being mistaken for part of the assessment.
        const untrusted = result.found
          ? {
              name: sanitizeUntrusted(result.record.metadata.name, 128),
              description: sanitizeUntrusted(result.record.metadata.description, 1024),
              sourceURI: sanitizeUntrusted(result.record.metadata.sourceURI, 256),
              auditURI: sanitizeUntrusted(result.record.metadata.auditURI, 256),
            }
          : null;

        return ok(
          toJson({
            chainId: ctx.chainId,
            ...assessment,
            /** Always false. Present so the field cannot be inferred as absent-
             * because-true: this tool structurally cannot assert safety. */
            safetyVerdictAvailable: false,
            untrusted,
          }),
          result.found ? [...CAVEATS, UNTRUSTED_TEXT_CAVEAT] : CAVEATS,
          {
            chainId: ctx.chainId,
            blockNumber: result.blockNumber.toString(10),
            contract: ctx.deployment.registry,
          },
        );
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}

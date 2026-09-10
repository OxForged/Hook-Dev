// SPDX-License-Identifier: MIT
/**
 * `latch_list` - enumerate and filter the registry.
 *
 * This is also the search tool. There is deliberately no second `latch_search`
 * name: two tool names for one capability makes an LLM's routing decision
 * harder, not easier, and the filters below are what a search would have been.
 *
 * ## Filtering, not ranking
 *
 * The filters narrow; they never sort by "trust". There is no ordering of these
 * listings that is honest - `Audited` and `ValueExtracting` is a normal, common
 * combination (a fee hook doing exactly what it says), and any ranking that put
 * it below an `Unverified` `Passive` hook would be inventing a judgement the
 * registry does not make. Listings come back in registry order, which is
 * submission order, and the caller decides what matters.
 */

import { enabledHookNames } from "@latchprotocol/sdk";
// The rank/caution/severity helpers are exported from the registry entry point
// rather than the SDK root. Imported from there rather than reimplemented: the
// ordering of these enums is the contract's, and one copy of it is the point.
import { listingCaution, riskClassSeverity, verificationRank } from "@latchprotocol/sdk/registry";

import { toJson } from "../json.js";
import type { LatchContext } from "../context.js";
import { listLatchRecords } from "../reads.js";
import { ok, UNTRUSTED_TEXT_CAVEAT, type LatchTool } from "../types.js";
import { asRecord, requireEnumField, requireIntField, toToolError } from "./common.js";
import { shapeRecord } from "./record.js";

const MAX_LIMIT = 50;

const CAVEATS: readonly string[] = [
  "The registry is an opt-in directory. This list is what has been submitted, not the set of Latch hooks that exist, and certainly not the set that is worth using.",
  "Results are in registry (submission) order. They are not ranked by trust, because there is no honest ordering: an Audited hook may still be ValueExtracting.",
  "Nothing is ever deleted from the registry. A record flagged Malicious stays visible on purpose - the tombstone IS the warning.",
];

export function listTool(ctx: LatchContext): LatchTool {
  return {
    name: "latch_list",
    access: "read",
    returnsUntrustedText: true,
    description:
      "List and search the Latch registry: every listed hook with its risk class (Passive, Restrictive, " +
      "ValueExtracting), verification level (Unverified, SourceVerified, Audited) and listing state " +
      "(Active, Deprecated, Malicious). Supports paging and filtering by any of those three axes, plus a " +
      "text match over the submitter-supplied name and description. " +
      "Use it to discover what hooks exist, or to find every listing of a given class. " +
      "Results are in submission order and are NOT ranked by trust - the three axes are independent and " +
      "an audited hook can still be value-extracting. An empty result means nothing matching has been " +
      "submitted, not that nothing exists.",
    inputSchema: {
      type: "object",
      properties: {
        offset: {
          type: "integer",
          description: "Index to start at, 0-based. Default 0.",
          minimum: 0,
          default: 0,
        },
        limit: {
          type: "integer",
          description: `How many listings to return, 1-${MAX_LIMIT}. Default 20.`,
          minimum: 1,
          maximum: MAX_LIMIT,
          default: 20,
        },
        riskClass: {
          type: "string",
          description:
            "Return only listings of this capability class. Derived from the bitmap, never curated.",
          enum: ["Passive", "Restrictive", "ValueExtracting"],
        },
        minVerification: {
          type: "string",
          description:
            "Return only listings at or above this attestation level. `Audited` means a curator confirmed an audit report covers this exact deployment - it does not mean the audit found nothing.",
          enum: ["Unverified", "SourceVerified", "Audited"],
        },
        listing: {
          type: "string",
          description:
            "Return only listings in this state. `Malicious` records are retained deliberately as warnings.",
          enum: ["Active", "Deprecated", "Malicious"],
        },
        query: {
          type: "string",
          description:
            "Case-insensitive substring match against the submitter-supplied name and description. Those fields are self-declared and unverified, so a match is a hint about what the submitter called it, not evidence about what it does.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    async handler(input) {
      try {
        const raw = asRecord(input);
        const offset = requireIntField(raw, "offset", 0, Number.MAX_SAFE_INTEGER, 0);
        const limit = requireIntField(raw, "limit", 1, MAX_LIMIT, 20);
        const riskClass =
          raw["riskClass"] === undefined
            ? undefined
            : requireEnumField(raw, "riskClass", ["Passive", "Restrictive", "ValueExtracting"] as const);
        const minVerification =
          raw["minVerification"] === undefined
            ? undefined
            : requireEnumField(raw, "minVerification", ["Unverified", "SourceVerified", "Audited"] as const);
        const listing =
          raw["listing"] === undefined
            ? undefined
            : requireEnumField(raw, "listing", ["Active", "Deprecated", "Malicious"] as const);
        const query = typeof raw["query"] === "string" ? raw["query"].toLowerCase().trim() : undefined;

        const page = await listLatchRecords(ctx, offset, limit);

        const shaped = page.records
          .map((r) => shapeRecord(r, ctx.deployment, enabledHookNames("CL", r.permissions)))
          .filter((r) => {
            if (riskClass !== undefined && r.riskClass !== riskClass) return false;
            if (listing !== undefined && r.listing !== listing) return false;
            if (
              minVerification !== undefined &&
              verificationRank(r.verification as "Unverified" | "SourceVerified" | "Audited") <
                verificationRank(minVerification)
            ) {
              return false;
            }
            if (query !== undefined && query.length > 0) {
              const hay = `${r.untrusted.name} ${r.untrusted.description}`.toLowerCase();
              if (!hay.includes(query)) return false;
            }
            return true;
          });

        const counts = {
          byRiskClass: tally(shaped.map((r) => r.riskClass)),
          byVerification: tally(shaped.map((r) => r.verification)),
          byListing: tally(shaped.map((r) => r.listing)),
        };

        return ok(
          toJson({
            chainId: ctx.chainId,
            registry: ctx.deployment.registry,
            totalListedOnChain: page.total,
            offset: page.offset,
            returned: shaped.length,
            /** True when this page was cut short by `limit`, so there is more. */
            hasMore: page.offset + page.records.length < page.total,
            filtersApplied: {
              riskClass: riskClass ?? null,
              minVerification: minVerification ?? null,
              listing: listing ?? null,
              query: query && query.length > 0 ? query : null,
            },
            counts,
            listings: shaped,
            note:
              page.total === 0
                ? "The registry currently holds no listings at all. This is the true count read from chain, not a failed query."
                : shaped.length === 0
                  ? "This page of the registry contains no listing matching the filters. Try a wider offset or fewer filters before concluding nothing matches."
                  : null,
            // Reported so a caller can see the axes are independent rather than
            // inferring an ordering that does not exist.
            severityScales: {
              riskClass: ["Passive", "Restrictive", "ValueExtracting"].map((k) => ({
                value: k,
                severity: riskClassSeverity(k as "Passive" | "Restrictive" | "ValueExtracting"),
              })),
              listingCaution: ["Active", "Deprecated", "Malicious"].map((k) => ({
                value: k,
                caution: listingCaution(k as "Active" | "Deprecated" | "Malicious"),
              })),
            },
          }),
          [...CAVEATS, UNTRUSTED_TEXT_CAVEAT],
          {
            chainId: ctx.chainId,
            blockNumber: page.blockNumber.toString(10),
            contract: ctx.deployment.registry,
          },
        );
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

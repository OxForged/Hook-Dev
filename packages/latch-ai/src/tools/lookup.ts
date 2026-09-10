// SPDX-License-Identifier: MIT
/**
 * `latch_lookup` - one address, one answer.
 *
 * ## The distinction this tool exists to preserve
 *
 * There are three different things an address can be, and they must never be
 * flattened into one:
 *
 * | result                             | what it means                                  |
 * |------------------------------------|------------------------------------------------|
 * | `registered: true`                 | the registry holds a record for it              |
 * | `registered: false, hasCode: true` | a real contract nobody has listed               |
 * | `registered: false, hasCode: false`| no code here at all - a wallet, or a wrong chain|
 *
 * And a fourth outcome that is not a result at all: an unreachable RPC, which
 * comes back as `ok: false, error.code: "rpc_unavailable"`.
 *
 * The registry contract takes this seriously enough that `getLatch` REVERTS for
 * an unregistered address instead of returning a zeroed struct - because a
 * zeroed struct decodes to "Unverified, Active, no permissions", which is the
 * most reassuring possible description of a contract nobody has ever looked at.
 * This tool preserves that: an unregistered address never produces a record
 * object with empty fields.
 */

import { toJson } from "../json.js";
import { enabledHookNames } from "@latchprotocol/sdk";
import { explainPermissions } from "../explain/permissions.js";
import type { LatchContext } from "../context.js";
import { lookupLatch } from "../reads.js";
import { ok, UNTRUSTED_TEXT_CAVEAT, type LatchTool } from "../types.js";
import { asRecord, requireAddressField, toToolError } from "./common.js";
import { shapeRecord } from "./record.js";

const BASE_CAVEATS: readonly string[] = [
  "A registry listing is not an audit. Listing is permissionless and free; only the permission bitmap is read from chain, and every other field was typed in by the submitter.",
  "`registered: false` means nobody submitted this address. It is not a finding about the contract, and it is the normal state for most contracts.",
];

export function lookupTool(ctx: LatchContext): LatchTool {
  return {
    name: "latch_lookup",
    access: "read",
    returnsUntrustedText: true,
    description:
      "Look up one address in the Latch registry and return its record, its curation status " +
      "(verification level, listing state), and the capabilities its permission bitmap grants. " +
      "Use it to answer 'what is this hook and what can it do?' before interacting with a pool that " +
      "uses it. " +
      "Distinguishes three outcomes precisely: registered; a real contract that nobody has listed; and " +
      "an address with no code at all. It never returns a record with blank fields to mean 'not found'. " +
      "Being listed is not an endorsement and being absent is not an accusation - the registry is an " +
      "opt-in directory, not a whitelist. Text under `untrusted` was written by the submitter.",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "The hook contract address to look up, 0x-prefixed and 20 bytes.",
        },
      },
      required: ["address"],
      additionalProperties: false,
    },
    async handler(input) {
      try {
        const address = requireAddressField(asRecord(input), "address");
        const result = await lookupLatch(ctx, address);
        const source = {
          chainId: ctx.chainId,
          blockNumber: result.blockNumber.toString(10),
          contract: ctx.deployment.registry,
        };

        if (!result.found) {
          const explanation =
            result.onChainBitmap === undefined ? null : explainPermissions(result.onChainBitmap);
          return ok(
            toJson({
              address: result.address,
              chainId: ctx.chainId,
              registered: false,
              hasCode: result.hasCode,
              // Present only when the contract answered the hook interface. An
              // unlisted hook still has a bitmap, and the pool manager enforces
              // it exactly as strictly as a listed one's.
              reportsHookInterface: result.onChainBitmap !== undefined,
              onChainPermissions: explanation,
              explorerUrl: `${ctx.deployment.explorer}/address/${result.address}`,
              summary: result.hasCode
                ? result.onChainBitmap !== undefined
                  ? "Not in the Latch registry, but this contract does report a hook permission bitmap, so it can be attached to a pool. Nobody has listed or reviewed it."
                  : "Not in the Latch registry, and this contract does not report a hook permission bitmap. It may not be a Latch hook at all."
                : "No code at this address on this chain. It is not a contract here - check the chain, or whether this is a wallet address.",
            }),
            BASE_CAVEATS,
            source,
          );
        }

        const record = result.record;
        return ok(
          toJson({
            address: record.hook,
            chainId: ctx.chainId,
            registered: true,
            record: shapeRecord(
              record,
              ctx.deployment,
              enabledHookNames("CL", record.permissions),
            ),
            permissions: explainPermissions(record.permissions),
          }),
          [...BASE_CAVEATS, UNTRUSTED_TEXT_CAVEAT],
          source,
        );
      } catch (e) {
        return toToolError(e);
      }
    },
  };
}

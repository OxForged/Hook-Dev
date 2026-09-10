// SPDX-License-Identifier: MIT
/**
 * One registry record, shaped for a model.
 *
 * The shape enforces two separations that the rest of this package depends on.
 *
 * **Chain-read versus submitter-typed.** Only `permissions` and `codehash` are
 * read from the contract itself; every string in a listing was typed in by
 * whoever submitted it. Those strings live under `untrusted` and nowhere else,
 * so a consumer cannot accidentally treat a self-declared name as a fact.
 *
 * **Attestation versus capability.** `verification`, `listing` and `riskClass`
 * are three independent fields and are never combined into a score. See
 * `explain/risk.ts`.
 */

import { hookPermissionState, riskClassOf, summarizeLatch, type LatchRecord } from "@latchprotocol/sdk";

import type { LatchDeployment } from "../deployments.js";
import { sanitizeUntrusted } from "../types.js";
import { unixToIso } from "./common.js";

export interface ShapedRecord {
  readonly address: string;
  readonly explorerUrl: string;
  readonly submitter: string;
  readonly steward: string;
  readonly submittedAt: string | null;
  readonly updatedAt: string | null;
  readonly permissions: {
    readonly bitmap: number;
    readonly bitmapHex: string;
    /** `Fresh` | `Stale` | `Invalid`. Anything but Fresh means re-read from chain. */
    readonly state: string;
    readonly readable: boolean;
    readonly acceptedByPoolManagers: boolean;
    readonly declaredCallbacks: readonly string[];
  };
  readonly verification: string;
  readonly listing: string;
  readonly riskClass: string;
  readonly auditBadge: boolean;
  readonly codehash: string;
  /** Chain ids the SUBMITTER claims. Informational, never verified on chain. */
  readonly claimedChainIds: readonly string[];
  readonly untrusted: {
    readonly name: string;
    readonly description: string;
    readonly sourceURI: string;
    readonly auditURI: string;
  };
}

export function shapeRecord(
  record: LatchRecord,
  deployment: LatchDeployment,
  declaredCallbacks: readonly string[],
): ShapedRecord {
  const summary = summarizeLatch(record);
  return {
    address: record.hook,
    explorerUrl: `${deployment.explorer}/address/${record.hook}`,
    submitter: record.submitter,
    steward: record.steward,
    submittedAt: unixToIso(record.submittedAt),
    updatedAt: unixToIso(record.updatedAt),
    permissions: {
      bitmap: record.permissions,
      bitmapHex: `0x${record.permissions.toString(16).padStart(4, "0")}`,
      state: hookPermissionState(record),
      readable: record.permissionsReadable,
      acceptedByPoolManagers: record.permissionsValid,
      declaredCallbacks,
    },
    verification: record.verification,
    listing: record.listing,
    riskClass: riskClassOf(record),
    auditBadge: summary.badgeEarned,
    codehash: record.codehash,
    claimedChainIds: record.metadata.chainIds.map((c) => c.toString(10)),
    untrusted: {
      name: sanitizeUntrusted(record.metadata.name, 128),
      description: sanitizeUntrusted(record.metadata.description, 1024),
      sourceURI: sanitizeUntrusted(record.metadata.sourceURI, 256),
      auditURI: sanitizeUntrusted(record.metadata.auditURI, 256),
    },
  };
}

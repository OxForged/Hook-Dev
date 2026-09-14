import type { Response } from "express";
import { toJsonSafe } from "./serialize.js";

/**
 * Response envelope: `{ data, provenance, page? }`.
 *
 * Every response says which chain, which block range the data covers, how far
 * the indexer is behind the chain head (as the WORKER last observed it — the API
 * never asks a chain), and whether the numbers were reconciled against an
 * on-chain counter. "Summed from logs since block N" is the difference between a
 * total and an estimate, so it is never optional.
 */

export type ReconciledState =
  /** Every check covering this data passed at `atBlock`. */
  | "verified"
  /** At least one check failed. The data is served, labelled, and must not be presented as a total. */
  | "mismatch"
  /** A counter exists for some of it and not for the rest (e.g. a hook predating totalTaken). */
  | "partial"
  /** No on-chain counter covers this kind of data. */
  | "not-applicable"
  /** Checks exist but have not run yet. */
  | "pending";

export interface Provenance {
  chainId: number;
  source: "latch-indexer";
  /** First L2 block the data could include (the deployment block for aggregates). */
  fromBlock: string | null;
  /** Last fully indexed L2 block. */
  toBlock: string | null;
  toBlockTimestamp: string | null;
  indexerLag: {
    blocks: string | null;
    headBlock: string | null;
    headObservedAt: string | null;
  };
  reconciled: { state: ReconciledState; atBlock: string | null; checks: number };
  generatedAt: string;
  notes?: string[];
}

export function send(res: Response, body: { data: unknown; provenance: Provenance; page?: unknown }, status = 200): void {
  res.status(status).json(toJsonSafe(body));
}

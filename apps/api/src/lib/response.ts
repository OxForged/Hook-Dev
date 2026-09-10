import type { Response } from "express";
import { toJsonSafe } from "./serialize.js";

/**
 * Response envelope.
 *
 * Every payload carries a `meta.dataSource`. This is not decoration: nothing is
 * deployed, so almost everything this API returns is derived from fixtures, and
 * a consumer must be able to tell without reading the docs. The same fact is
 * repeated in the `X-LatchProtocol-Data-Source` header so it survives logging
 * and proxying.
 */

export type DataSourceLabel = "fixture" | "onchain" | "mixed" | "curated" | "empty";

export interface ResponseMeta {
  dataSource: DataSourceLabel;
  /** Present whenever any part of the payload is fabricated. */
  disclaimer?: string;
  generatedAt: string;
  [key: string]: unknown;
}

export interface Envelope<T> {
  data: T;
  meta: ResponseMeta;
}

const FIXTURE_DISCLAIMER =
  "Sample data. LatchProtocol is not deployed on any chain; these rows were produced by the " +
  "fixture chain-log provider and describe no real activity.";

const CURATED_DISCLAIMER =
  "Curated listing metadata. Entries marked kind=EXAMPLE are illustrative and do not describe " +
  "real projects.";

export function metaFor(
  dataSource: DataSourceLabel,
  extra: Record<string, unknown> = {},
): ResponseMeta {
  const meta: ResponseMeta = {
    dataSource,
    generatedAt: new Date().toISOString(),
    ...extra,
  };
  if (dataSource === "fixture" || dataSource === "mixed") meta.disclaimer = FIXTURE_DISCLAIMER;
  else if (dataSource === "curated") meta.disclaimer = CURATED_DISCLAIMER;
  return meta;
}

/**
 * Collapse the per-row `dataSource` values of a result set into one label.
 * `mixed` is deliberately loud: it means at least one fabricated row is present.
 */
export function labelFor(rows: readonly { dataSource?: string | null }[]): DataSourceLabel {
  if (rows.length === 0) return "empty";
  const kinds = new Set(rows.map((r) => (r.dataSource ?? "FIXTURE").toLowerCase()));
  if (kinds.size > 1) return "mixed";
  const only = [...kinds][0];
  if (only === "onchain") return "onchain";
  if (only === "curated") return "curated";
  return "fixture";
}

export function send<T>(res: Response, data: T, meta: ResponseMeta, status = 200): void {
  res.setHeader("X-LatchProtocol-Data-Source", meta.dataSource);
  res.status(status).json(toJsonSafe({ data, meta }));
}

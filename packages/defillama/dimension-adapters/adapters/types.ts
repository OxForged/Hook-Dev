/**
 * LOCAL HARNESS STUB - do not submit this file upstream.
 *
 * A trimmed, faithful copy of the parts of
 *   https://github.com/DefiLlama/dimension-adapters/blob/master/adapters/types.ts
 * that `dexs/latch.ts` touches, so the adapter typechecks and runs here without
 * cloning the whole repo. Field names, optionality and defaults match upstream as
 * read on 2026-09-09; anything the adapter does not use has been dropped rather
 * than invented.
 *
 * If upstream's types change, this file is the thing that goes stale - the adapter
 * itself is written against the real API.
 */

import type { Balances } from "../../harness/balances.js";

export type { Balances };

/** Upstream: `FetchGetLogsOptions`. */
export type FetchGetLogsOptions = {
  eventAbi?: string;
  topic?: string;
  target?: string;
  targets?: string[];
  /** Upstream default is `true`: you get decoded args only. */
  onlyArgs?: boolean;
  fromBlock?: number;
  toBlock?: number;
  /** Upstream default is `true`; `false` returns one array per target. */
  flatten?: boolean;
  /** Sanctioned only for small, slowly-changing config scans (pool lists). */
  cacheInCloud?: boolean;
  entireLog?: boolean;
  skipCacheRead?: boolean;
  skipCache?: boolean;
  skipIndexer?: boolean;
  topics?: string[];
  noTarget?: boolean;
  parseLog?: boolean;
};

/** Upstream: `ChainApi` from @defillama/sdk. Only what the adapter needs. */
export type ChainApi = {
  chain: string;
  block?: number;
  multiCall: (params: any) => Promise<any[]>;
  call: (params: any) => Promise<any>;
};

/** Upstream: `FetchOptions`. */
export type FetchOptions = {
  createBalances: () => Balances;
  getLogs: (params: FetchGetLogsOptions) => Promise<any[]>;
  chain: string;
  api: ChainApi;
  fromApi: ChainApi;
  toApi: ChainApi;
  fromTimestamp: number;
  toTimestamp: number;
  startTimestamp: number;
  endTimestamp: number;
  startOfDay: number;
  dateString: string;
  getFromBlock: () => Promise<number>;
  getToBlock: () => Promise<number>;
  preFetchedResults?: any;
};

export type FetchResultV2 = { [key: string]: string | number | Balances | undefined };
export type FetchV2 = (options: FetchOptions) => Promise<FetchResultV2>;

/** Upstream: `BaseAdapterChainConfig`. `start` is a 'YYYY-MM-DD' string. */
export type BaseAdapterChainConfig = {
  start?: string;
  deadFrom?: string;
  fetch?: FetchV2;
  runAtCurrTime?: boolean;
  /** Upstream allows extra per-chain config keys on the config object itself. */
  [key: string]: any;
};

export type BaseAdapter = { [chain: string]: BaseAdapterChainConfig };

export type AdapterBase = {
  version?: number;
  pullHourly?: boolean;
  fetch?: FetchV2;
  prefetch?: FetchV2;
  chains?: (string | [string, BaseAdapterChainConfig])[];
  start?: string;
  deadFrom?: string;
  doublecounted?: boolean;
  allowNegativeValue?: boolean;
  isExpensiveAdapter?: boolean;
  skipBreakdownValidation?: boolean;
  methodology?: string | Record<string, string>;
  breakdownMethodology?: Record<string, string | Record<string, string>>;
};

export type SimpleAdapter = AdapterBase & { adapter?: BaseAdapter };
export type Adapter = SimpleAdapter;

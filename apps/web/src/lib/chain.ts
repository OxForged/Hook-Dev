import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  HttpRequestError,
  LimitExceededRpcError,
  RpcRequestError,
  TimeoutError,
  createPublicClient,
  http,
  fallback,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
} from 'viem'

import {
  LATCH_DEPLOYMENTS,
  isLatchChainId,
  readContractClock,
  resolveEndpoints,
  resolveLogEndpoints,
  type ContractClockReading,
  type LatchChainId,
} from '@latchprotocol/sdk'

/**
 * Live reader for the deployed Latch Protocol contracts.
 *
 * This is the real half of the dapp's mock/live seam. Everything here talks to
 * chain; nothing here invents a number. If a read fails it throws, and the caller
 * decides what to show — a screen must never render a fabricated figure as if it
 * came from chain.
 */

/* ============================================================================
   THE ADDRESS BOOK IS NOT DECLARED HERE ANY MORE.

   It lives in `@latchprotocol/sdk` (`packages/sdk/src/deployments/index.ts`)
   and this file RE-EXPORTS it. Forty-odd modules in this app import
   `DEPLOYMENTS`, `DeployedChainId` and `isDeployed` from here, and every one of
   them keeps working unchanged — the names, the fields and the values are
   identical. What changed is where the values come from.

   WHY IT MOVED. The table had already been copied: once into this file, once
   into `packages/create-latch-dex/template/src/config/deployments.ts`, and the
   two had quietly diverged (the template's copy knows nothing of the timelocks,
   the fee controller, the quoters or the descriptor). Meanwhile the published
   SDK — the package whose entire purpose is "install this and integrate" —
   shipped no addresses at all, so an integrator's first task was hand-typing
   twenty hex strings. One table serving all three consumers fixes both halves
   of that at once. The DefiLlama adapters in this repo show the alternative:
   two hand-maintained mirrors and a parity test to catch drift, which detects
   the problem instead of removing it.

   The SDK is MIT and carries only addresses and ABIs, which are facts about a
   public chain rather than derivative works — nothing GPL is pulled in by this
   import.

   WHAT DID NOT MOVE, AND WHY. `IS_TESTNET_BUILD` and `ACTIVE_CHAIN_ID` below
   stay here. They are not facts about a chain; they are this build's decision
   about which chain it serves, read from `import.meta.env` at build time. A
   library that answers "which network am I?" would be answering it for
   consumers who never asked, and every one of them has a different answer.

   REDEPLOYS ARE ONE EDIT, IN THE SDK. `LatchRegistry`, `RevShareHook` and the
   custody timelock are queued for replacement, and the launchpad contracts do
   not exist yet (they read `null`, never a zero address — a zero address is a
   value this app would happily call). Change them there; nothing here needs
   touching.
   ============================================================================ */

export const SEPOLIA_CHAIN_ID = 11155111
export const ROBINHOOD_CHAIN_ID = 4663

/**
 * Every deployed Latch contract, per chain. Re-exported from the SDK — see the
 * note above. The record carries more than this app reads (the pool-manager
 * owner wrappers, the two upstream fee controllers, the governance Safe, and a
 * token table with decimals), which is additive: nothing that used to be here
 * has changed name, type or value.
 */
export const DEPLOYMENTS = LATCH_DEPLOYMENTS

/* ============================================================================
   WHICH NETWORK THIS BUILD IS.

   One build serves one network. `VITE_NETWORK=testnet` produces the Sepolia
   site; anything else produces the mainnet site. Two deployments of the same
   codebase, not one site trying to be both.

   The alternative — shipping every chain everywhere and letting a switcher sort
   it out — is what we had, and it put Sepolia contracts on a page headed
   "mainnet". A testnet address rendered under a mainnet chrome is the same
   class of error as an invented number: it looks authoritative and is not.

   Everything downstream reads ACTIVE_CHAIN_ID. Nothing should import
   SEPOLIA_CHAIN_ID or ROBINHOOD_CHAIN_ID to decide what to READ — those two
   names are for identifying a chain, never for choosing one.
   ============================================================================ */

export const IS_TESTNET_BUILD = import.meta.env['VITE_NETWORK'] === 'testnet'

/** The one chain this build reads and writes. */
export const ACTIVE_CHAIN_ID = IS_TESTNET_BUILD ? SEPOLIA_CHAIN_ID : ROBINHOOD_CHAIN_ID

/** The chains Latch is deployed on. Same union as before, now named by the SDK. */
export type DeployedChainId = LatchChainId

export function isDeployed(chainId: number): chainId is DeployedChainId {
  return isLatchChainId(chainId)
}

/* ============================================================================
   TEST TOKENS AND THE POOLS THAT TRADE THEM ARE NOT SHOWCASED.

   Owner decision, 2026-09-14: the protocol's own test-token pool is retired and
   comes off the landing page and the dapp. Latch is infrastructure with no token
   of its own, so a showcase surface shows real pools only, and when there are
   none it says so rather than filling the space.

   The rule is read off the address book's own `isTestToken` flag, never off a
   pool id, a symbol or the chain: a pool is left out of every showcase reading
   (pool lists, swap history, vault holdings, protocol totals) when EITHER of its
   currencies is a token the book marks as a test token. A token the book does
   not carry is not assumed to be one. The book's `demoPool` record is no longer
   read by this app at all.

   What this does NOT hide: an address's own LP positions (Portfolio), and the
   revenue-share governance and claim screens that address a pool by id. Those
   are a holder's or an owner's business with a pool that still exists, not a
   showcase of it.
   ============================================================================ */

/** True only when the address book lists `address` on `chainId` as a test token. */
export function isTestToken(chainId: DeployedChainId, address: string): boolean {
  const wanted = address.toLowerCase()
  return DEPLOYMENTS[chainId].tokens.some((t) => t.isTestToken && t.address.toLowerCase() === wanted)
}

/** True when either currency of a pool is an address-book test token. */
export function tradesTestToken(
  chainId: DeployedChainId,
  pool: { readonly currency0: string; readonly currency1: string },
): boolean {
  return isTestToken(chainId, pool.currency0) || isTestToken(chainId, pool.currency1)
}

/** The address book's tokens that are NOT test tokens, in book order. */
export function showcaseTokens(chainId: DeployedChainId) {
  return DEPLOYMENTS[chainId].tokens.filter((t) => !t.isTestToken)
}

/* ============================================================================
   RPC ENDPOINTS ARE ALSO NO LONGER RESTATED HERE.

   `resolveEndpoints` is the same function the SDK's own transport uses. It puts
   any keyed provider from the environment first and the probed public list
   behind it as a safety net, so nothing here has to know which is which.

   THE ENVIRONMENT IS ACTUALLY PASSED NOW. This file used to call
   `resolveEndpoints(chainId)` with no env argument, so the "keyed provider
   first" half could never happen in the browser. Vite exposes only `VITE_`
   variables, so a keyed RPC for this build is `VITE_LATCH_RPC_<chainId>`
   (comma-separated for several), mapped here onto the SDK's `LATCH_RPC_<id>`.
   Anything in a `VITE_` variable is shipped in the bundle and readable by every
   visitor — use a key restricted to this site's origin, never a secret one.
   ============================================================================ */

/** `VITE_LATCH_RPC_<id>` from the build, renamed to the SDK's `LATCH_RPC_<id>`. */
const RPC_ENV: Record<string, string | undefined> = (() => {
  const env = import.meta.env as Record<string, string | undefined>
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(env)) {
    const m = /^VITE_(LATCH_RPC_\d+)$/.exec(k)
    if (m?.[1] && typeof v === 'string' && v.trim() !== '') out[m[1]] = v
  }
  return out
})()

/**
 * One client per chain, cached by chain id.
 *
 * This used to be a single `let cached` with `if (cached) return cached`, which
 * silently IGNORED the `chainId` argument after the first call: ask for Base
 * having already asked for Sepolia and you got Sepolia's client, reading Sepolia
 * addresses, and nothing anywhere said so. That was invisible while exactly one
 * chain was deployed and becomes a wrong-chain read the moment a second is.
 */
const clients = new Map<number, PublicClient>()

/**
 * The endpoints configured for a chain, in the order the fallback tries them
 * for READS (`eth_call`, `eth_blockNumber`, …).
 *
 * Exposed so the Settings screen can show what the app is ACTUALLY talking to,
 * rather than describing it in prose that drifts from the array.
 */
export function rpcsFor(chainId: DeployedChainId): readonly string[] {
  return resolveEndpoints(chainId, RPC_ENV)
}

/**
 * The same endpoints in the order `eth_getLogs` tries them: keyed providers,
 * then the public endpoints the SDK has verified to serve a whole-history range
 * in one request (`LOG_RANGE_ENDPOINTS`), then the rest.
 */
export function logRpcsFor(chainId: DeployedChainId): readonly string[] {
  return resolveLogEndpoints(chainId, RPC_ENV)
}

/**
 * Route `eth_getLogs` to one fallback and everything else to another.
 *
 * WHY. With `rank: false` a fallback restarts at endpoint 1 on every request.
 * On Robinhood endpoint 1 allows one request per ten seconds and endpoints 2-4
 * refuse any log range wider than 10,000 blocks, so every log request paid
 * three or four refusals before reaching the canonical endpoint — the one that
 * serves the protocol's entire 2.5M-block history in a single request. Reads
 * keep their probed latency order; only logs are reordered.
 */
function routedTransport(reads: Transport, logs: Transport): Transport {
  return (params) => {
    const r = reads(params)
    const l = logs(params)
    const request = ((args: { method: string; params?: unknown }) =>
      args.method === 'eth_getLogs' ? l.request(args as never) : r.request(args as never)) as typeof r.request
    return {
      config: { ...r.config, key: 'latch-routed', name: 'Latch (reads · logs)' },
      request,
      value: r.value,
    }
  }
}

/** Per-request timeout for a log call. A whole-history range on a healthy
    endpoint answers in well under a second; this is the ceiling, not the norm. */
const LOG_REQUEST_TIMEOUT_MS = 15_000

/**
 * The dapp's read client FOR ONE CHAIN.
 *
 * The retry shape is chosen for rate limits, not for flaky networks. `retryCount: 0`
 * per endpoint means a 429 falls straight through to the next provider instead of
 * being retried against the one that just refused; the retries sit on `fallback`, so
 * one pass asks all five before any is asked twice. `rank: false` keeps the measured
 * order and avoids viem's background re-ranking traffic, which would spend the same
 * per-minute budget we are trying to conserve.
 *
 * `eth_getLogs` goes through a second fallback in `logRpcsFor` order — see
 * `routedTransport`.
 */
export function client(chainId: DeployedChainId = ACTIVE_CHAIN_ID): PublicClient {
  const hit = clients.get(chainId)
  if (hit) return hit

  const urls = rpcsFor(chainId)
  if (urls.length === 0) {
    // Louder than returning some other chain's client, which is what the old
    // single-cache version effectively did.
    throw new Error(
      `No RPC endpoints for chain ${chainId}. Add it to CHAIN_RPCS in ` +
        `packages/sdk/src/chains/endpoints.ts — after probing it, which is the ` +
        `standard every URL in that file was held to.`,
    )
  }

  const made = createPublicClient({
    transport: routedTransport(
      fallback(
        urls.map((u) => http(u, { timeout: 12_000, retryCount: 0 })),
        { rank: false, retryCount: 2 },
      ),
      fallback(
        logRpcsFor(chainId).map((u) => http(u, { timeout: LOG_REQUEST_TIMEOUT_MS, retryCount: 0 })),
        { rank: false, retryCount: 1 },
      ),
    ),
  })
  clients.set(chainId, made)
  return made
}

/* ---------------------------------------------------------------------------
   HOW A LOG SCAN RUNS: ONE REQUEST FIRST, WINDOWS ONLY IF EVERY ENDPOINT REFUSES.

   Every log reader here used to ask for `fromBlock: deployedAtBlock, toBlock:
   'latest'` in one call against whichever endpoint the fallback reached first,
   and on Robinhood the first endpoints answer

     -32602  block range too large: span 1580086 blocks exceeds maximum 10000

   So scans were windowed into 9,000-block slices — ~280 of them today, each one
   restarting at endpoint 1 — and eight screens sat on "Reading contract logs…"
   until the 25 s deadline killed them.

   The pattern `lib/protocolActivity.ts` proved on the landing page is now the
   shared one: ask for the WHOLE range once. The request goes through the log
   ordering (`logRpcsFor`), so it reaches the endpoint verified to serve it
   first, and the fallback tries each other endpoint once if it refuses. Only
   when every endpoint refuses does the windowed scan run, under its own
   deadline.
   --------------------------------------------------------------------------- */

/**
 * A log scan that ran out of time. Distinct from a transport failure on
 * purpose: "the chain is unreachable" and "the chain answered but a scan of N
 * windows was too slow" are different statements, and the UI makes both.
 */
export class LogScanTimeoutError extends Error {
  override readonly name = 'LogScanTimeoutError'
  /** Windows (or single-range queries) that came back before the deadline. */
  readonly served: number
  /** Windows the scan needed. */
  readonly planned: number
  constructor(message: string, served: number, planned: number) {
    super(message)
    this.served = served
    this.planned = planned
  }
}

/** What kind of failure a read hit — for choosing the error card's words. */
export type ReadFailureKind = 'scan-timeout' | 'transport' | 'contract' | 'other'

export function classifyReadFailure(e: unknown): ReadFailureKind {
  if (e instanceof LogScanTimeoutError) return 'scan-timeout'
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError)) {
      return 'contract'
    }
    if (
      e.walk(
        (x) =>
          x instanceof HttpRequestError ||
          x instanceof TimeoutError ||
          x instanceof RpcRequestError ||
          x instanceof LimitExceededRpcError,
      )
    ) {
      return 'transport'
    }
  }
  if (e instanceof Error && /fetch|network|failed to fetch|timed? ?out/i.test(e.message)) return 'transport'
  return 'other'
}

/** Reject if `p` has not settled in `ms`. The work is not cancelled — nothing
    here can cancel an in-flight fetch — it is merely no longer waited on. */
function withDeadline<T>(p: Promise<T>, ms: number, fail: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(fail()), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** How long a whole-history log scan may take before it is treated as unread. */
const LOG_SCAN_DEADLINE_MS = 8_000

/** Hard cap the windowed fallback slices at. The window leaves headroom under
    the 10,000-block maximum the refusing endpoints enforce. */
const MAX_LOG_SPAN = 9_000n

/** Requests in flight during a windowed scan. DO NOT RAISE IT: the public
    endpoints meter by request count per minute, and exceeding the budget
    presents as a 429 that viem retries with backoff — a scan that is too eager
    does not go faster, it goes silent. */
const SCAN_CONCURRENCY = 3

/** The single-range attempt: every query over the whole range, once. */
const SINGLE_RANGE_DEADLINE_MS = 15_000

/**
 * The backstop the WINDOWED fallback runs under.
 *
 * Not a latency budget — a "this will never finish" detector. A rate-limited
 * endpoint leaves viem retrying with backoff, so an unbounded scan hangs rather
 * than throwing, and a screen sits on its loading state forever. Past this, the
 * scan REJECTS with `LogScanTimeoutError`, and the caller's error state says what
 * could not be read and that it was a timeout, not an outage.
 */
const SCAN_DEADLINE_MS = 25_000

/**
 * Windows one windowed scan may plan before it is refused outright.
 *
 * A guard against `fromBlock: 0n` or `'earliest'`: Robinhood is past 62,000,000
 * blocks, which is ~6,900 windows; the protocol's own history from
 * `deployedAtBlock` (60,111,836) is ~280 today and grows ~94 a day. The
 * single-range request does not need this guard — it is one request whatever
 * the span — but a windowed fallback that large is unfinishable.
 */
const MAX_SCAN_WINDOWS = 5_000

function windowCount(fromBlock: bigint, toBlock: bigint): bigint {
  if (toBlock < fromBlock) return 0n
  return (toBlock - fromBlock + 1n + MAX_LOG_SPAN) / (MAX_LOG_SPAN + 1n)
}

/** Slice `[fromBlock, toBlock]` into spans the endpoint will accept, or throw
    if the range is so large it can only be a missing `deployedAtBlock`. */
function planWindows(fromBlock: bigint, toBlock: bigint): Array<[bigint, bigint]> {
  if (fromBlock < 0n) throw new Error(`log scan: negative fromBlock ${fromBlock}`)
  if (toBlock < fromBlock) return []

  const span = toBlock - fromBlock + 1n
  const count = windowCount(fromBlock, toBlock)
  if (count > BigInt(MAX_SCAN_WINDOWS)) {
    throw new Error(
      `log scan refused: ${span} blocks is ${count} windows of ${MAX_LOG_SPAN}, past the ` +
        `${MAX_SCAN_WINDOWS}-window budget. Either fromBlock is genesis rather than the ` +
        `contract's deployment block (DEPLOYMENTS[chainId].deployedAtBlock), or this chain has ` +
        `outgrown whole-history scanning from a public endpoint and needs an indexer.`,
    )
  }

  const windows: Array<[bigint, bigint]> = []
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_SPAN + 1n) {
    const stop = start + MAX_LOG_SPAN > toBlock ? toBlock : start + MAX_LOG_SPAN
    windows.push([start, stop])
  }
  return windows
}

/* ---------------------------------------------------------------------------
   ONE SCAN PER QUESTION, PER RENDER.

   This dedupes only IN-FLIGHT work: the promise is dropped from the map as soon
   as it settles, so a later caller always starts a fresh read. Nothing is
   cached, so nothing goes stale — the only thing shared is a walk that has not
   finished yet.
   --------------------------------------------------------------------------- */
const inFlight = new Map<string, Promise<unknown>>()

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inFlight.get(key)
  if (hit) return hit as Promise<T>
  const p = run().finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key)
  })
  inFlight.set(key, p)
  return p
}

/** Run `count` indexed tasks, at most `SCAN_CONCURRENCY` at a time. */
async function pooled(count: number, run: (i: number) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= count) return
      await run(i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, count) }, worker))
}

const shortReason = (e: unknown): string => {
  const raw = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e)
  return raw.split('\n')[0]?.slice(0, 160) ?? 'refused'
}

type WindowFetch<T> = (from: bigint, to: bigint) => Promise<readonly T[]>

/**
 * Every query over `[fromBlock, toBlock]` in ONE request each. Returns the
 * per-query results in query order, or throws with the reason every endpoint
 * refused.
 */
async function singleRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetches: readonly WindowFetch<T>[],
  label: string,
): Promise<(readonly T[])[]> {
  const out: (readonly T[])[] = new Array<readonly T[]>(fetches.length).fill([])
  let served = 0
  await withDeadline(
    pooled(fetches.length, async (i) => {
      const f = fetches[i]
      if (!f) return
      out[i] = await f(fromBlock, toBlock)
      served += 1
    }),
    SINGLE_RANGE_DEADLINE_MS,
    () =>
      new LogScanTimeoutError(
        `${label}: the single-range request did not complete within ${SINGLE_RANGE_DEADLINE_MS / 1000}s`,
        served,
        fetches.length,
      ),
  )
  return out
}

/* ---------------------------------------------------------------------------
   THE FOUR SCAN PRIMITIVES.

   EVERY ONE TAKES A CALLBACK RATHER THAN A QUERY OBJECT, and that is the whole
   design: the call site keeps viem's full event inference, and these helpers
   only decide the RANGE each callback is asked for — first the whole range,
   then, if refused, 9,000-block windows.

     scanWindows              one query, every match — a count, a sum, a list
     scanWindowsMulti         several queries over the same range, sharing one
                              concurrency budget
     scanWindowsBackward      one query, the newest `limit` matches
     scanWindowsBackwardMulti several queries, ONE backward walk between them
   --------------------------------------------------------------------------- */

/**
 * Every match of `fetchWindow` over a block range.
 *
 * Exhaustive, so use it wherever a partial answer would be a WRONG answer — a
 * pool count, a fee total, an ownership candidate list. `fromBlock` must be a
 * real starting height (`DEPLOYMENTS[chainId].deployedAtBlock` for a protocol
 * contract, a pool's `createdAtBlock` for a pool).
 *
 * Rejects rather than truncating: if every endpoint refuses and the windowed
 * fallback stalls past `SCAN_DEADLINE_MS`, the caller gets a
 * `LogScanTimeoutError`, never a short list that reads as a complete one.
 */
export async function scanWindows<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchWindow: WindowFetch<T>,
  label = 'log scan',
): Promise<T[]> {
  return scanWindowsMulti(fromBlock, toBlock, [fetchWindow], label)
}

/**
 * `scanWindows` for several queries over the SAME range.
 *
 * Results come back grouped by query (single-range) or window-ascending
 * (windowed), flattened either way — so give every callback the same result
 * type, and sort by block where order matters.
 *
 * `label` names the scan in its failure message. It is what a screen's error
 * state ends up printing, so make it say which reading is missing.
 */
export async function scanWindowsMulti<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchWindows: readonly WindowFetch<T>[],
  label = 'log scan',
): Promise<T[]> {
  if (fromBlock < 0n) throw new Error(`log scan: negative fromBlock ${fromBlock}`)
  if (toBlock < fromBlock || fetchWindows.length === 0) return []

  let refusal: string
  try {
    return (await singleRange(fromBlock, toBlock, fetchWindows, label)).flat()
  } catch (e) {
    refusal = shortReason(e)
  }

  const windows = planWindows(fromBlock, toBlock)
  const tasks: Array<{ window: [bigint, bigint]; fetch: WindowFetch<T> }> = []
  for (const window of windows) {
    for (const fetch of fetchWindows) tasks.push({ window, fetch })
  }

  const results: (readonly T[])[] = new Array<readonly T[]>(tasks.length).fill([])
  let served = 0
  const expiresAt = Date.now() + SCAN_DEADLINE_MS
  const timeout = () =>
    new LogScanTimeoutError(
      `${label}: no endpoint served the range in one request (${refusal}), and the windowed ` +
        `fallback did not finish within ${SCAN_DEADLINE_MS / 1000}s — ${served} of ${tasks.length} ` +
        `window request${tasks.length === 1 ? '' : 's'} (${MAX_LOG_SPAN}-block windows × ` +
        `${fetchWindows.length} quer${fetchWindows.length === 1 ? 'y' : 'ies'}) came back`,
      served,
      tasks.length,
    )

  await withDeadline(
    pooled(tasks.length, async (i) => {
      const t = tasks[i]
      if (!t) return
      /* Checked between windows as well as raced: once the deadline has passed
         there is no point spending more of a metered budget. */
      if (Date.now() > expiresAt) throw timeout()
      results[i] = await t.fetch(t.window[0], t.window[1])
      served += 1
    }),
    SCAN_DEADLINE_MS,
    timeout,
  )

  return results.flat()
}

/**
 * The most recent `limit` results. Single-range first (which returns every
 * match; callers slice to `limit`), then a BACKWARD windowed walk from the head
 * that stops as soon as there are enough.
 *
 * `fromBlock` still matters — it is where the walk gives up — so pass the
 * deployment block, not genesis.
 */
export async function scanWindowsBackward<T>(
  fromBlock: bigint,
  toBlock: bigint,
  limit: number,
  fetchWindow: WindowFetch<T>,
  label = 'log scan',
): Promise<T[]> {
  return scanWindowsBackwardMulti(fromBlock, toBlock, limit, [fetchWindow], label)
}

/**
 * `scanWindowsBackward` for several queries that share ONE backward walk, so
 * `limit` counts across all of them and an event type that never fired does
 * not walk the whole history alone. Every callback must return the same result
 * type; callers sort by block.
 */
export async function scanWindowsBackwardMulti<T>(
  fromBlock: bigint,
  toBlock: bigint,
  limit: number,
  fetchWindows: readonly WindowFetch<T>[],
  label = 'log scan',
): Promise<T[]> {
  if (fromBlock < 0n) throw new Error(`log scan: negative fromBlock ${fromBlock}`)
  if (fetchWindows.length === 0 || toBlock < fromBlock) return []

  let refusal: string
  try {
    return (await singleRange(fromBlock, toBlock, fetchWindows, label)).flat()
  } catch (e) {
    refusal = shortReason(e)
  }

  /* Same budget precondition as the forward scan. */
  const planned = Number(windowCount(fromBlock, toBlock))
  planWindows(fromBlock, toBlock)

  let served = 0
  const expiresAt = Date.now() + SCAN_DEADLINE_MS
  const timeout = () =>
    new LogScanTimeoutError(
      `${label}: no endpoint served the range in one request (${refusal}), and the backward ` +
        `windowed walk from block ${toBlock} for the newest ${limit} did not finish within ` +
        `${SCAN_DEADLINE_MS / 1000}s — ${served} window${served === 1 ? '' : 's'} came back`,
      served,
      planned,
    )

  const walk = async (): Promise<T[]> => {
    const out: (readonly T[])[] = []
    let count = 0
    let stop = toBlock
    while (stop >= fromBlock && count < limit) {
      if (Date.now() > expiresAt) throw timeout()
      const start = stop - MAX_LOG_SPAN < fromBlock ? fromBlock : stop - MAX_LOG_SPAN

      const batches: (readonly T[])[] = new Array<readonly T[]>(fetchWindows.length).fill([])
      await pooled(fetchWindows.length, async (i) => {
        const fetch = fetchWindows[i]
        if (!fetch) return
        batches[i] = await fetch(start, stop)
      })
      served += 1

      const inWindow = batches.flat()
      if (inWindow.length > 0) {
        out.unshift(inWindow)
        count += inWindow.length
      }

      if (start === fromBlock) break
      stop = start - 1n
    }
    return out.flat()
  }

  return withDeadline(walk(), SCAN_DEADLINE_MS, timeout)
}

/* ---------------------------------------------------------------------------
   ABIs — only what is read. Human-readable so they stay auditable inline.
   --------------------------------------------------------------------------- */

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const VAULT = parseAbi([
  'function isAppRegistered(address) view returns (bool)',
  'function reservesOfApp(address, address) view returns (uint256)',
  'function owner() view returns (address)',
])

/* LatchProtocolFeeControllerV2, live on Robinhood since 2026-09-13.

   THIS ABI IS V2'S AND V1'S ARE GONE. V2 replaced the flat per-direction
   default with a SHARE of the total swap fee, so `defaultFee()` and
   `DEFAULT_FEE_PIPS` no longer exist on the contract at this address — asking
   for them reverts. The address book was repointed at V2 while this ABI still
   described V1, which is the same shape of bug as reading one distributor's
   `getEpoch` through the other's ABI: the address resolves, the call does not.

   `feeForLpFee(lpFee)` is the tier-aware replacement. It returns the pips a
   pool at that LP fee is stamped with, derived on chain from the live split
   ratio — so the UI never has to reproduce the arithmetic. */
const FEE_CONTROLLER = parseAbi([
  'function MAX_PROTOCOL_FEE() view returns (uint16)',
  'function protocolFeeSplitRatio() view returns (uint256)',
  'function feeForLpFee(uint24 lpFee) view returns (uint16)',
  'function DYNAMIC_FEE_PIPS() view returns (uint16)',
  'function feesDisabled() view returns (bool)',
  'function guardian() view returns (address)',
  'function treasury() view returns (address)',
  'function owner() view returns (address)',
])

/* The pool manager, not the controller, decides whether the controller is in
   force at all. `protocolFeeController()` is the single slot that settles it,
   and it reads address(0) on Robinhood today. */
const POOL_MANAGER = parseAbi([
  'function protocolFeeController() view returns (address)',
])

/**
 * CL Swap. NOTE: several Latch events collide on topic0 because ProtocolFees is a
 * shared base — 34 declarations, 22 unique signatures. Always scope a log query by
 * the emitting contract address, never by topic0 alone, or CL and Bin activity merge.
 */
const CL_SWAP_EVENT = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee, uint16 protocolFee)',
])

const REGISTRY = parseAbi([
  'function latchCount() view returns (uint256)',
  'function classify(uint16) pure returns (uint8)',
  'function takesSwapCut(uint16) pure returns (bool)',
  'function canBlockSwaps(uint16) pure returns (bool)',
  'function canTrapLiquidity(uint16) pure returns (bool)',
])

const TIMELOCK = parseAbi(['function getMinDelay() view returns (uint256)'])

/* ---------------------------------------------------------------------------
   Reads
   --------------------------------------------------------------------------- */

export interface ProtocolStatus {
  chainId: number
  chainName: string
  vault: Address
  vaultOwner: Address
  clRegistered: boolean
  binRegistered: boolean
  /**
   * The controller's live `protocolFeeSplitRatio`, in hundredths of a bip.
   * 250000 == 25% of the TOTAL swap fee.
   *
   * Replaces `defaultFeePips`, which described V1's flat per-direction default.
   * V2 takes a share of the total instead, so there is no single "default pips"
   * to report — the number depends on the pool's LP fee, which is why
   * `configuredFeePips` below is now tier-specific rather than global.
   */
  splitRatio: number
  /**
   * What a pool at the STANDARD 0.30% tier is stamped with, read from
   * `feeForLpFee(3000)` on chain rather than recomputed here.
   *
   * Tier-specific on purpose: under a share model a single protocol-fee figure
   * is meaningless without saying which pool it applies to.
   */
  configuredFeePips: number
  maxFeePips: number
  feesDisabled: boolean
  /**
   * Whether `CLPoolManager.protocolFeeController()` actually points at our
   * controller. False means the controller is deployed and inert.
   */
  controllerWired: boolean
  /**
   * What a pool initialized right now would actually charge: zero unless the
   * controller is BOTH wired and not disabled.
   *
   * This field exists because the dashboard used to render the controller's
   * compiled default as "the protocol fee" while the activity feed beside it read
   * "0 to protocol" on every swap — both true, flatly contradicting each
   * other, and only one of them answering the question a reader was asking.
   */
  effectiveFeePips: number
  guardian: Address
  blockNumber: bigint
}

/** Live protocol state. Every field is read from chain. */
/** One pool tier and what the controller stamps a pool at that tier with. */
export interface FeeTier {
  /** The pool's LP fee, in pips. 3000 == 0.30%. */
  lpFee: number
  /** Protocol fee per direction, from `feeForLpFee(lpFee)` on the controller. */
  protocolFeePips: number
}

/**
 * The tiers the marketplace actually uses, and nothing invented around them.
 *
 * These five are core's conventional CL tiers; a pool may be created at any
 * spacing, so this is a representative set rather than an exhaustive one — the
 * chart says "by pool tier", not "every pool".
 */
const FEE_TIERS: readonly number[] = [100, 500, 2500, 3000, 10_000]

/**
 * Every tier's protocol fee, READ FROM THE CONTROLLER rather than derived here.
 *
 * `feeForLpFee` applies the live split ratio, the per-tier overrides and the
 * MAX_PROTOCOL_FEE clamp, in that order. Reimplementing that in TypeScript
 * would mean two implementations of the protocol's pricing and one of them
 * would eventually be wrong — and it would be the one on the marketing page.
 *
 * Five `eth_call`s plus one. Cheap: these endpoints meter by compute unit and
 * a view call is a rounding error next to the log scans that actually strain
 * them.
 */
export async function readFeeTiers(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<{ tiers: FeeTier[]; splitRatio: number }> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const [splitRatio, ...fees] = await Promise.all([
    c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'protocolFeeSplitRatio' }),
    ...FEE_TIERS.map((lpFee) =>
      c.readContract({
        address: d.feeController,
        abi: FEE_CONTROLLER,
        functionName: 'feeForLpFee',
        args: [lpFee],
      }),
    ),
  ])

  return {
    splitRatio: Number(splitRatio),
    tiers: FEE_TIERS.map((lpFee, i) => ({ lpFee, protocolFeePips: Number(fees[i] ?? 0) })),
  }
}

export async function readProtocolStatus(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ProtocolStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  const [clReg, binReg, vaultOwner, splitRatio, standardTierFee, maxFee, disabled, wiredTo, guardian, blockNumber] =
    await Promise.all([
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.clPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'isAppRegistered', args: [d.binPoolManager] }),
      c.readContract({ address: d.vault, abi: VAULT, functionName: 'owner' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'protocolFeeSplitRatio' }),
      /* The 0.30% tier: the common case, and the number the UI quotes when it
         has to quote one. Derived on chain so the split arithmetic lives in
         exactly one place — the contract. */
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'feeForLpFee', args: [3000] }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'MAX_PROTOCOL_FEE' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'feesDisabled' }),
      c.readContract({ address: d.clPoolManager, abi: POOL_MANAGER, functionName: 'protocolFeeController' }),
      c.readContract({ address: d.feeController, abi: FEE_CONTROLLER, functionName: 'guardian' }),
      c.getBlockNumber(),
    ])

  const configuredFeePips = Number(standardTierFee)

  const controllerWired = wiredTo.toLowerCase() === d.feeController.toLowerCase()
  const effectiveFeePips = controllerWired && !disabled ? configuredFeePips : 0

  return {
    chainId,
    chainName: d.name,
    vault: d.vault,
    vaultOwner,
    clRegistered: clReg,
    binRegistered: binReg,
    splitRatio: Number(splitRatio),
    configuredFeePips,
    maxFeePips: maxFee,
    feesDisabled: disabled,
    controllerWired,
    effectiveFeePips,
    guardian,
    blockNumber,
  }
}

export interface VaultHolding {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  token: Address
  symbol: string
  decimals: number
  /** Raw balance held by the Vault. */
  balance: bigint
  /** Portion attributed to the CL pool manager via reservesOfApp. */
  clReserve: bigint
}

/**
 * TVL. The Vault custodies every token for the whole protocol and the pool managers
 * hold nothing — verified on chain — so Vault balances ARE the protocol's TVL.
 * There is no per-pool contract to enumerate.
 */
export async function readVaultHoldings(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<VaultHolding[]> {
  /* There is no on-chain enumeration of "tokens the vault holds", so WHICH
     tokens to ask about comes from the address book: every token it carries
     that is not a test token (see `showcaseTokens`). A zero balance here is a
     real `balanceOf` read, not a default. A chain whose book lists no such token
     returns an empty list, which the caller renders as "no tracked tokens". */
  return readVaultBalancesOf(
    chainId,
    showcaseTokens(chainId).map((t) => t.address as Address),
  )
}

/**
 * The Vault's balance of each named token, with its symbol, decimals and the CL
 * pool manager's reserve. `address(0)` is the chain's native currency: its
 * balance is the Vault's own, and the book's native symbol labels it.
 */
export async function readVaultBalancesOf(
  chainId: DeployedChainId,
  tokens: readonly Address[],
): Promise<VaultHolding[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  if (tokens.length === 0) return []

  return Promise.all(
    tokens.map(async (token) => {
      if (token.toLowerCase() === '0x0000000000000000000000000000000000000000') {
        const [balance, clReserve] = await Promise.all([
          c.getBalance({ address: d.vault }),
          c.readContract({ address: d.vault, abi: VAULT, functionName: 'reservesOfApp', args: [d.clPoolManager, token] }),
        ])
        return {
          chainId,
          token,
          symbol: d.nativeCurrency.symbol,
          decimals: d.nativeCurrency.decimals,
          balance,
          clReserve,
        }
      }
      // chainId is captured from the enclosing read, so a holding always knows
      // which chain's vault it came from.
      const [balance, symbol, decimals, clReserve] = await Promise.all([
        c.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [d.vault] }),
        c.readContract({ address: token, abi: ERC20, functionName: 'symbol' }),
        c.readContract({ address: token, abi: ERC20, functionName: 'decimals' }),
        c.readContract({ address: d.vault, abi: VAULT, functionName: 'reservesOfApp', args: [d.clPoolManager, token] }),
      ])
      return { chainId, token, symbol, decimals, balance, clReserve }
    }),
  )
}

export interface SwapRecord {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  txHash: Hex
  blockNumber: bigint
  poolId: Hex
  sender: Address
  amount0: bigint
  amount1: bigint
  /** Combined swap fee in pips (protocol + LP, composed). */
  feePips: number
  /** Protocol slice in pips. */
  protocolFeePips: number
}

/**
 * Real swaps from the CL pool manager.
 *
 * Scoped by emitting address deliberately — see the topic0 note above.
 */
export async function readRecentSwaps(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
  limit = 25,
): Promise<SwapRecord[]> {
  /* Keyed by limit as well as chain: "the newest 25" and "the newest 5000" are
     different walks, and pretending otherwise would hand a caller a list
     shorter than it asked for with no way to tell. */
  return coalesce(`swaps:${chainId}:${limit}`, () => readRecentSwapsUncached(chainId, limit))
}

async function readRecentSwapsUncached(
  chainId: DeployedChainId,
  limit: number,
): Promise<SwapRecord[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  /* Swaps on a test-token pool are dropped INSIDE the window fetch, so the
     backward walk's `limit` counts only swaps that are shown and keeps walking
     past hidden ones. A Swap log carries the pool id and not the currencies, so
     the hidden ids come from the pool list. */
  const [hidden, head] = await Promise.all([readTestTokenPoolIds(chainId), c.getBlockNumber()])

  const logs = await scanWindowsBackward(
    d.deployedAtBlock,
    head,
    limit,
    async (from, to) =>
      (await c.getLogs({ address: d.clPoolManager, event: CL_SWAP_EVENT[0], fromBlock: from, toBlock: to })).filter(
        (l) => !hidden.has(String(l.args.id).toLowerCase()),
      ),
    'recent swaps (CLPoolManager Swap)',
  )

  return logs
    .slice(-limit)
    .reverse()
    .map((l) => ({
      txHash: l.transactionHash,
      chainId,
      blockNumber: l.blockNumber,
      poolId: l.args.id as Hex,
      sender: l.args.sender as Address,
      amount0: l.args.amount0 as bigint,
      amount1: l.args.amount1 as bigint,
      feePips: Number(l.args.fee),
      protocolFeePips: Number(l.args.protocolFee),
    }))
}

/**
 * Split a swap's fee into protocol and LP slices.
 *
 * Protocol fee comes off the INPUT first, LP fee applies to the remainder:
 *   total = protocolFee + lpFee - (protocolFee * lpFee / 1e6)
 * Confirmed against real Sepolia swaps: fee=3997, protocolFee=1000 => lpFee=3000.
 */
export function splitFee(feePips: number, protocolFeePips: number): { lpPips: number } {
  if (protocolFeePips === 0) return { lpPips: feePips }
  const lp = Math.round(((feePips - protocolFeePips) * 1_000_000) / (1_000_000 - protocolFeePips))
  return { lpPips: lp }
}

export function explorerTx(chainId: DeployedChainId, hash: Hex): string {
  return `${DEPLOYMENTS[chainId].explorer}/tx/${hash}`
}

export function explorerAddress(chainId: DeployedChainId, addr: Address | string): string {
  return `${DEPLOYMENTS[chainId].explorer}/address/${addr}`
}

export function formatUnits(v: bigint, decimals: number, places = 4): string {
  const neg = v < 0n
  const abs = neg ? -v : v
  const base = 10n ** BigInt(decimals)
  const whole = abs / base
  const frac = ((abs % base) * 10n ** BigInt(places)) / base
  const s = `${whole}.${frac.toString().padStart(places, '0')}`
  return neg ? `-${s}` : s
}

export interface GovernanceStatus {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  registry: Address
  hookCount: bigint
  custodyDelaySec: bigint
  policyDelaySec: bigint
}

/**
 * Registry and governance state, read live.
 *
 * hookCount is genuinely 0 today - the registry is deployed but nothing has been
 * listed. That is shown as zero, not padded with examples.
 */
export async function readGovernanceStatus(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<GovernanceStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const [hookCount, custodyDelaySec, policyDelaySec] = await Promise.all([
    c.readContract({ address: d.registry, abi: REGISTRY, functionName: 'latchCount' }),
    c.readContract({ address: d.timelockCustody, abi: TIMELOCK, functionName: 'getMinDelay' }),
    c.readContract({ address: d.timelockPolicy, abi: TIMELOCK, functionName: 'getMinDelay' }),
  ])
  return { chainId, registry: d.registry, hookCount, custodyDelaySec, policyDelaySec }
}

/* ---------------------------------------------------------------------------
   Who actually holds the custody powers — read, not assumed from the table.

   The dashboard used to print "CUSTODY DELAY 48h · Vault + managers" beside the
   custody timelock's `getMinDelay()`. The delay was real; the claim that it
   governs the Vault and the managers was not. `owner()` on the Vault and on
   both `*PoolManagerOwner` wrappers read the Safe DIRECTLY on 2026-09-13, with
   the custody timelock only NOMINATED (`pendingOwner`) — so `registerApp` needed
   2-of-3 signatures and no delay at all. A delay is only a property of a
   contract if the timelock is its owner, so this reads the owner.
   --------------------------------------------------------------------------- */

const OWNABLE_2STEP = parseAbi([
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
])

export type HolderKind = 'custody-timelock' | 'policy-timelock' | 'safe' | 'other'

export interface HeldContract {
  name: string
  address: Address
  owner: Address
  ownerKind: HolderKind
  /** `pendingOwner()`; null when zero or when the contract has no such getter. */
  pendingOwner: Address | null
  pendingKind: HolderKind | null
}

export interface CustodyStatus {
  chainId: DeployedChainId
  custodyDelaySec: bigint
  policyDelaySec: bigint
  contracts: HeldContract[]
}

function holderKind(d: (typeof DEPLOYMENTS)[DeployedChainId], a: Address): HolderKind {
  const l = a.toLowerCase()
  if (l === d.timelockCustody.toLowerCase()) return 'custody-timelock'
  if (l === d.timelockPolicy.toLowerCase()) return 'policy-timelock'
  if (l === d.governanceSafe.toLowerCase()) return 'safe'
  return 'other'
}

export async function readCustodyStatus(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<CustodyStatus> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const tracked: { name: string; address: Address | null }[] = [
    { name: 'Vault', address: d.vault },
    { name: 'CLPoolManagerOwner', address: d.clPoolManagerOwner },
    { name: 'BinPoolManagerOwner', address: d.binPoolManagerOwner },
    { name: 'LatchProtocolFeeController', address: d.feeController },
    { name: 'CLPositionDescriptor', address: d.clPositionDescriptor },
  ]

  const [custodyDelaySec, policyDelaySec, contracts] = await Promise.all([
    c.readContract({ address: d.timelockCustody, abi: TIMELOCK, functionName: 'getMinDelay' }),
    c.readContract({ address: d.timelockPolicy, abi: TIMELOCK, functionName: 'getMinDelay' }),
    Promise.all(
      tracked
        .filter((t): t is { name: string; address: Address } => t.address !== null)
        .map(async (t): Promise<HeldContract> => {
          const owner = await c.readContract({ address: t.address, abi: OWNABLE_2STEP, functionName: 'owner' })
          /* A plain Ownable has no `pendingOwner` and reverts; that is "no
             nomination", not an error. A transport failure on the owner read
             above still throws. */
          const pending = await c
            .readContract({ address: t.address, abi: OWNABLE_2STEP, functionName: 'pendingOwner' })
            .catch((e: unknown) => {
              if (classifyReadFailure(e) === 'transport') throw e
              return null
            })
          const pendingOwner = pending === null || pending === '0x0000000000000000000000000000000000000000' ? null : pending
          return {
            name: t.name,
            address: t.address,
            owner,
            ownerKind: holderKind(d, owner),
            pendingOwner,
            pendingKind: pendingOwner === null ? null : holderKind(d, pendingOwner),
          }
        }),
    ),
  ])
  return { chainId, custodyDelaySec, policyDelaySec, contracts }
}

/* ---------------------------------------------------------------------------
   The protocol fee each pool ACTUALLY charges — `slot0.protocolFee`.

   The dashboard gauge used to show `feeForLpFee(3000)` from the controller as
   "Protocol fee actually charged". That is what the controller would stamp a
   NEW 0.30% pool with; an existing pool's fee is fixed in its own slot0 until
   somebody sets it, and the only live pool's reads 0. The per-direction values
   are packed as in core's ProtocolFeeLibrary: low 12 bits zeroForOne, high 12
   bits oneForZero.
   --------------------------------------------------------------------------- */

const CL_SLOT0 = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])

export interface PoolProtocolFee {
  pool: PoolRecord
  zeroForOnePips: number
  oneForZeroPips: number
  lpFeePips: number
}

export async function readPoolProtocolFees(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<{ pools: PoolProtocolFee[] }> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const pools = await readPools(chainId)
  const fees = await Promise.all(
    pools.map(async (pool): Promise<PoolProtocolFee> => {
      const [, , protocolFee, lpFee] = await c.readContract({
        address: d.clPoolManager,
        abi: CL_SLOT0,
        functionName: 'getSlot0',
        args: [pool.id],
      })
      return {
        pool,
        zeroForOnePips: protocolFee & 0xfff,
        oneForZeroPips: protocolFee >> 12,
        lpFeePips: lpFee,
      }
    }),
  )
  return { pools: fees }
}

/* ---------------------------------------------------------------------------
   Aggregations for the dapp screens.

   These replace the mock `data/*.ts` modules. Every figure is derived from chain.
   The numbers are SMALL because this is a testnet with one pool and a handful of
   swaps — that is the honest picture, and showing it beats showing invented
   millions. A dashboard is only useful if its numbers mean something.
   --------------------------------------------------------------------------- */

const CL_INITIALIZE_EVENT = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)',
])

export interface PoolRecord {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  id: Hex
  currency0: Address
  currency1: Address
  hooks: Address
  /** true when the pool has a hook attached. */
  hasHook: boolean
  lpFeePips: number
  createdAtBlock: bigint
}

/**
 * Every pool initialized on the CL manager, from logs, LESS the pools that trade
 * an address-book test token (see `tradesTestToken`). This is the list every
 * showcase surface reads; an empty array is a real answer and is rendered as
 * "no live pools", never padded.
 */
export async function readPools(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<PoolRecord[]> {
  return (await readAllPools(chainId)).filter((p) => !tradesTestToken(chainId, p))
}

/** The ids (lowercase) of initialized pools that trade an address-book test token. */
export async function readTestTokenPoolIds(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<Set<string>> {
  return new Set(
    (await readAllPools(chainId)).filter((p) => tradesTestToken(chainId, p)).map((p) => p.id.toLowerCase()),
  )
}

/** Every pool ever initialized on the CL manager, test-token pools included. */
function readAllPools(chainId: DeployedChainId): Promise<PoolRecord[]> {
  return coalesce(`pools:${chainId}`, () => readPoolsUncached(chainId))
}

async function readPoolsUncached(chainId: DeployedChainId): Promise<PoolRecord[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  /* Exhaustive: this feeds the pool COUNT, so a truncated scan is a wrong
     number rather than a slow one. */
  const logs = await scanWindows(
    d.deployedAtBlock,
    await c.getBlockNumber(),
    (from, to) => c.getLogs({ address: d.clPoolManager, event: CL_INITIALIZE_EVENT[0], fromBlock: from, toBlock: to }),
    'pool list (CLPoolManager Initialize)',
  )
  return logs.map((l) => {
    const hooks = l.args.hooks as Address
    return {
      id: l.args.id as Hex,
      chainId,
      currency0: l.args.currency0 as Address,
      currency1: l.args.currency1 as Address,
      hooks,
      hasHook: hooks !== '0x0000000000000000000000000000000000000000',
      lpFeePips: Number(l.args.fee),
      createdAtBlock: l.blockNumber,
    }
  })
}

export interface ProtocolMetrics {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId

  /* ---- LOG-DERIVED, AND THEREFORE NULLABLE ----------------------------------
     `null` means "the chain would not tell us", NOT zero.

     Every figure below needs `eth_getLogs` over the protocol's whole history.
     On Robinhood that is ~1.58M blocks, and as of 2026-09-13 none of the three
     configured public endpoints will serve it:

       rpc-robinhood.blockmachine.io   rate limit exceeded, at any concurrency
       robinhood.rpc.blxrbdn.com       non-JSON response
       rpc.nodeflare.app/robinhood     non-JSON response

     The reads are correct and chunked (see `scanWindows`); the endpoints
     refuse them. Until an archive or indexer endpoint exists these stay null.

     THE BUG THIS TYPE CHANGE FIXES. They were plain `number`, so a refused scan
     surfaced as `0` and the landing page announced "0 POOLS INITIALIZED" and
     "0 SWAPS EXECUTED" over a chain holding one pool and two swaps. A zero that
     means "we could not look" is indistinguishable from a zero that means
     "none", which is precisely what CLAUDE.md's no-invented-data rule exists to
     prevent — it just happens to under-report rather than over-report.
     -------------------------------------------------------------------------- */
  poolCount: number | null
  hookedPoolCount: number | null
  swapCount: number | null
  /**
   * Volume and fees PER TOKEN, one entry per token that was the input side of a
   * swap on a shown pool, ordered by swap count (then address-book order). Keyed
   * by the swap's own pool currencies, never by position — a list indexed
   * [0]/[1] only described the chain while it had exactly one pool. Empty when
   * no shown pool has swapped. Token units; nothing here is priced.
   */
  tokenFees: TokenFees[] | null
  /** The shown pools the figures above were computed over (test-token pools excluded). */
  pools: PoolRecord[] | null
  /** Why the figures above are null, for the UI to show verbatim. */
  logScanError: string | null

  /* ---- CHEAP READS. One `eth_call` each, and they always work. ------------- */
  tvl: VaultHolding[]
  latestBlock: bigint
}

/** One token's side of the protocol's swaps. All amounts in that token's base units. */
export interface TokenFees {
  token: Address
  symbol: string
  decimals: number
  /** Swaps on a shown pool in which this token was paid in. */
  swaps: number
  volume: bigint
  protocolFees: bigint
  lpFees: bigint
}

const abs = (v: bigint) => (v < 0n ? -v : v)

/**
 * Protocol-wide metrics, computed from real logs and balances.
 *
 * Fees are apportioned per swap from that swap's OWN fee/protocolFee fields rather
 * than the controller's current default — a fee change would otherwise silently
 * rewrite history.
 *
 * NOTE: no USD anywhere. Nothing here prices these tokens, and inventing a price to
 * make a dashboard look busy would be the exact failure this avoids.
 *
 * Pools and swaps are the SHOWCASE set: `readPools` and `readRecentSwaps` both
 * leave out pools that trade an address-book test token.
 */
export async function readProtocolMetrics(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ProtocolMetrics> {
  /* THE CHEAP READS MUST NOT BE HOSTAGE TO THE EXPENSIVE ONES.

     This was one `Promise.all` over all four. `readPools` needs a full-history
     log scan, the public endpoints refuse it, and the rejection took the vault
     holdings and the block height down with it — so a screen that could have
     shown three real figures showed none, or worse, zeros.

     The two O(1) reads are awaited on their own and always resolve. The
     log-derived pair is allowed to fail, and its failure is DATA (`logScanError`)
     rather than an exception. */
  const [tvl, latestBlock] = await Promise.all([
    readVaultHoldings(chainId),
    client(chainId).getBlockNumber(),
  ])

  let pools: PoolRecord[] | null = null
  let swaps: SwapRecord[] | null = null
  let logScanError: string | null = null
  try {
    /* BOUNDED, because a refusal does not always arrive as a rejection.

       viem retries across the fallback transport with backoff, so a
       rate-limited endpoint leaves the promise pending rather than throwing.
       Unbounded, the strip sat on "READING CHAIN…" forever — which is a
       different lie from "0" and no better: an indefinite spinner reads as
       "almost there" when the answer is "never".

       Whatever has not arrived by the deadline is treated as unread and the UI
       says so. The scan is not cancelled; if it ever lands it simply lands too
       late to be believed. */
    ;[pools, swaps] = await withDeadline(
      Promise.all([readPools(chainId), readRecentSwaps(chainId, 1000)]),
      LOG_SCAN_DEADLINE_MS,
      () =>
        new LogScanTimeoutError(`pool list and swaps: no answer within ${LOG_SCAN_DEADLINE_MS / 1000}s`, 0, 2),
    )
  } catch (e) {
    logScanError = e instanceof Error ? e.message : 'the endpoint refused the log scan'
  }

  let tokenFees: TokenFees[] | null = null
  if (pools !== null && swaps !== null) {
    const byId = new Map(pools.map((p) => [p.id.toLowerCase(), p]))
    const acc = new Map<string, Omit<TokenFees, 'symbol' | 'decimals'>>()
    for (const s of swaps) {
      const pool = byId.get(s.poolId.toLowerCase())
      if (!pool) continue
      // The INPUT side is the NEGATIVE delta. `Swap` emits the swap's BalanceDelta from the
      // CALLER's side (negative = owed by the caller = paid in), whatever the inherited
      // `ICLPoolManager` docstring says about "the pool". Verified 2026-09-13 on 4663: tx
      // 0x68286e9b…629a emitted amount0 = -1e18 while exactly 1e18 of currency0 moved INTO the
      // Vault. This line used to read `> 0n` and counted every swap's OUTPUT as its volume.
      const inIs0 = s.amount0 < 0n
      const gross = inIs0 ? abs(s.amount0) : abs(s.amount1)
      const token = inIs0 ? pool.currency0 : pool.currency1

      const total = (gross * BigInt(s.feePips)) / 1_000_000n
      const proto = (gross * BigInt(s.protocolFeePips)) / 1_000_000n
      const lp = total > proto ? total - proto : 0n

      const k = token.toLowerCase()
      const row = acc.get(k) ?? { token, swaps: 0, volume: 0n, protocolFees: 0n, lpFees: 0n }
      row.swaps += 1
      row.volume += gross
      row.protocolFees += proto
      row.lpFees += lp
      acc.set(k, row)
    }
    const book = DEPLOYMENTS[chainId].tokens
    const bookIndex = (a: string) => {
      const i = book.findIndex((t) => t.address.toLowerCase() === a.toLowerCase())
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    tokenFees = (await Promise.all([...acc.values()].map(async (r) => ({ ...r, ...(await readTokenLabel(chainId, r.token)) }))))
      .sort((x, y) => y.swaps - x.swaps || bookIndex(x.token) - bookIndex(y.token))
  }

  return {
    chainId,
    poolCount: pools?.length ?? null,
    hookedPoolCount: pools?.filter((p) => p.hasHook).length ?? null,
    swapCount: swaps?.length ?? null,
    tokenFees,
    pools,
    logScanError,
    tvl,
    latestBlock,
  }
}

/** Symbol and decimals: the address book first, then the token itself. */
async function readTokenLabel(chainId: DeployedChainId, token: Address): Promise<{ symbol: string; decimals: number }> {
  const d = DEPLOYMENTS[chainId]
  if (token.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { symbol: d.nativeCurrency.symbol, decimals: d.nativeCurrency.decimals }
  }
  const known = d.tokens.find((t) => t.address.toLowerCase() === token.toLowerCase())
  if (known) return { symbol: known.symbol, decimals: known.decimals }
  const c = client(chainId)
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: 'symbol' }),
    c.readContract({ address: token, abi: ERC20, functionName: 'decimals' }),
  ])
  return { symbol, decimals }
}

/* ---------------------------------------------------------------------------
   Hook registry — the marketplace's backing contract.
   --------------------------------------------------------------------------- */

import { registryAbi } from './abi/registry'

/** 0 Passive · 1 Restrictive · 2 ValueExtracting — computed on chain, uncheatable. */
export type RiskClass = 0 | 1 | 2
/** 0 Unverified · 1 SourceVerified · 2 Audited */
export type VerificationLevel = 0 | 1 | 2
/** 0 Active · 1 Deprecated · 2 Malicious */
export type ListingState = 0 | 1 | 2

export interface RegisteredLatch {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  address: Address
  name: string
  description: string
  sourceURI: string
  auditURI: string
  submitter: Address
  /** Read off the hook itself at registration — never supplied by the submitter. */
  permissions: number
  /** False when the hook's bitmap could not be read, or is malformed. Show it. */
  permissionsReadable: boolean
  permissionsValid: boolean
  risk: RiskClass
  takesSwapCut: boolean
  canBlockSwaps: boolean
  canTrapLiquidity: boolean
  verification: VerificationLevel
  listing: ListingState
  /**
   * The callbacks this hook holds, named. Expanded by the registry's own
   * `decodePermissions`, not by shifting the bitmap here — see the note on
   * readRegisteredLatches about why the UI must not re-derive capability.
   */
  callbacks: string[]
}

/**
 * The field order of ILatchHookRegistry.DecodedPermissions. Used only to turn the
 * struct the chain returns into a list; the truth values are the chain's.
 */
const CALLBACK_FIELDS = [
  'beforeInitialize',
  'afterInitialize',
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
  'beforeSwap',
  'afterSwap',
  'beforeDonate',
  'afterDonate',
  'beforeSwapReturnsDelta',
  'afterSwapReturnsDelta',
  'afterAddLiquidityReturnsDelta',
  'afterRemoveLiquidityReturnsDelta',
] as const

/* One vocabulary for the on-chain enums, shared by every surface that renders them.
   Two screens holding two copies of these strings is how a hook ends up described as
   "Restrictive" on one page and "Passive" on the next. */
export const RISK_LABEL = ['Passive', 'Restrictive', 'Value-extracting'] as const
export const VERIFICATION_LABEL = ['Unverified', 'Source verified', 'Audited'] as const
export const LISTING_LABEL = ['Active', 'Deprecated', 'Flagged malicious'] as const

/**
 * Capability in plain language, straight off the registry's classifiers.
 *
 * Callers must render this whether or not it is comfortable — it is the sentence a
 * user needs before they route funds through a pool.
 */
export function capabilityClaims(hook: RegisteredLatch): string[] {
  const claims: string[] = []
  if (hook.takesSwapCut) claims.push('can take a share of every swap')
  if (hook.canBlockSwaps) claims.push('can block or price swaps')
  if (hook.canTrapLiquidity) claims.push('can refuse liquidity withdrawal')
  if (claims.length === 0) claims.push('observes only — cannot move funds or block trading')
  return claims
}

/**
 * Every hook listed in the registry.
 *
 * Capability flags come from the registry's own pure classifiers rather than being
 * re-derived here. Three components describing one bitmap three different ways is
 * how a user ends up trusting a hook the chain would have warned them about.
 */
export async function readRegisteredLatches(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<RegisteredLatch[]> {
  /* Not a log scan, but 6 `eth_call`s per listing against the same metered
     budget — and Analytics, Portfolio and the marketplace all ask for it at
     once. */
  return coalesce(`latches:${chainId}`, () => readRegisteredLatchesUncached(chainId))
}

async function readRegisteredLatchesUncached(
  chainId: DeployedChainId,
): Promise<RegisteredLatch[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const abi = registryAbi

  const count = await c.readContract({ address: d.registry, abi, functionName: 'latchCount' }) as bigint
  if (count === 0n) return []

  const addrs = (await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      c.readContract({ address: d.registry, abi, functionName: 'latchAt', args: [BigInt(i)] }),
    ),
  )) as Address[]

  return Promise.all(addrs.map((a) => hydrateHook(chainId, c, d.registry, a)))
}

/**
 * Turn one registry address into a RegisteredLatch.
 *
 * Extracted so the list read and the single-address read below cannot drift: two
 * code paths hydrating the same record is how one screen ends up calling a hook
 * "Passive" while another calls it "Value-extracting".
 *
 * Throws if the hook is not registered — `getHook` reverts rather than returning a
 * zeroed struct, deliberately. Call `readRegisteredLatch` if you do not already know
 * the address is listed.
 */
async function hydrateHook(
  chainId: DeployedChainId,
  c: PublicClient,
  registry: Address,
  a: Address,
): Promise<RegisteredLatch> {
  const abi = registryAbi
  const r = (await c.readContract({
    address: registry, abi, functionName: 'getLatch', args: [a],
  })) as any
  const p = Number(r.permissions)
  const [risk, cut, block, trap, decoded] = (await Promise.all([
    c.readContract({ address: registry, abi, functionName: 'classify', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'takesSwapCut', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'canBlockSwaps', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'canTrapLiquidity', args: [p] }),
    c.readContract({ address: registry, abi, functionName: 'decodePermissions', args: [p] }),
  ])) as [number, boolean, boolean, boolean, Record<string, boolean>]

  return {
    chainId,
    address: a,
    name: r.metadata?.name ?? '',
    description: r.metadata?.description ?? '',
    sourceURI: r.metadata?.sourceURI ?? '',
    auditURI: r.metadata?.auditURI ?? '',
    submitter: r.submitter as Address,
    permissions: p,
    permissionsReadable: Boolean(r.permissionsReadable),
    permissionsValid: Boolean(r.permissionsValid),
    risk: Number(risk) as RiskClass,
    takesSwapCut: cut,
    canBlockSwaps: block,
    canTrapLiquidity: trap,
    verification: Number(r.verification) as VerificationLevel,
    listing: Number(r.listing) as ListingState,
    callbacks: CALLBACK_FIELDS.filter((f) => decoded?.[f]),
  }
}

/**
 * One hook, looked up by address.
 *
 * `found: false` is a RESULT, not an absence of one. The caller must render it as an
 * explicit "not in the registry" answer — never as a hook record with empty fields.
 * The registry itself takes this seriously enough that `getHook` reverts instead of
 * returning a zeroed struct, because a zeroed struct reads as "Unverified, Active,
 * no permissions", which is the most reassuring thing you could possibly say about a
 * contract nobody has ever looked at.
 *
 * `hasCode` separates the two ways an address can be absent — a contract that exists
 * but was never listed, versus an address with no code at all (a typo, an EOA, or a
 * contract on some other chain). Neither is a hook; saying which one it is saves the
 * reader from guessing.
 *
 * A chain that cannot be reached THROWS. It must never be reported as "not found":
 * an unreachable RPC and an unregistered hook are opposite answers.
 */
export type LatchLookup =
  | { found: true; latch: RegisteredLatch; checkedAtBlock: bigint }
  | { found: false; address: Address; hasCode: boolean; checkedAtBlock: bigint }

export async function readRegisteredLatch(
  address: Address,
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<LatchLookup> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)

  // Asked first, and on its own. `isRegistered` is the registry's own answer to
  // exactly this question, and it is the gate the rest of the read sits behind.
  const [registered, checkedAtBlock] = await Promise.all([
    c.readContract({
      address: d.registry, abi: registryAbi, functionName: 'isRegistered', args: [address],
    }) as Promise<boolean>,
    c.getBlockNumber(),
  ])

  if (!registered) {
    const code = await c.getCode({ address })
    return {
      found: false,
      address,
      hasCode: Boolean(code && code !== '0x'),
      checkedAtBlock,
    }
  }

  return { found: true, latch: await hydrateHook(chainId, c, d.registry, address), checkedAtBlock }
}

/* ---------------------------------------------------------------------------
   Activity feed — real protocol events.
   --------------------------------------------------------------------------- */

const CL_MODIFY_EVENT = parseAbi([
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
])
const CL_DONATE_EVENT = parseAbi([
  'event Donate(bytes32 indexed id, address indexed sender, uint256 amount0, uint256 amount1, int24 tick)',
])

export interface ActivityEvent {
  /**
   * The chain this record was read from.
   *
   * Part of the RECORD, not of the call that produced it. Without it a record is
   * only meaningful next to the client that fetched it, which is why nothing in
   * the UI could label a row by chain.
   */
  chainId: DeployedChainId
  kind: 'Initialize' | 'Swap' | 'Add liquidity' | 'Remove liquidity' | 'Donate'
  blockNumber: bigint
  txHash: Hex
  detail: string
}

/**
 * Recent protocol activity, newest first.
 *
 * The design spec's feed listed hook callbacks (beforeSwap, afterDonate…). None have
 * ever fired: the only live pool has no hook attached, so a callback feed would be
 * entirely fabricated. These are the events that genuinely occurred instead.
 *
 * Every query is scoped by emitting address — Latch has 34 event declarations but
 * only 22 unique signatures, so a topic0-only filter merges CL and Bin activity.
 */
export async function readActivity(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
  limit = 12,
): Promise<ActivityEvent[]> {
  return coalesce(`activity:${chainId}:${limit}`, () => readActivityUncached(chainId, limit))
}

async function readActivityUncached(
  chainId: DeployedChainId,
  limit: number,
): Promise<ActivityEvent[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  /* Events on a test-token pool are dropped inside each window fetch, so the
     shared `limit` counts only events that are shown. Every one of these four
     events carries the pool id. */
  const [head, hidden] = await Promise.all([c.getBlockNumber(), readTestTokenPoolIds(chainId)])
  const shown = <L extends { args: { id?: unknown } }>(logs: readonly L[]): L[] =>
    logs.filter((l) => !hidden.has(String(l.args.id).toLowerCase()))

  /* ONE backward walk shared by all four queries, not four walks in parallel.
     Independently, each query stops only when it has found `limit` of its OWN
     kind — so `Donate`, which has never fired here, walked the protocol's
     entire history alone every time this feed rendered, and the four scans
     between them put twelve requests in flight against an endpoint sized for
     three. Sharing the walk, `limit` counts across all four kinds at once.

     Each callback maps to `ActivityEvent` INSIDE the callback, where viem still
     knows the event's ABI — that is what keeps `l.args.fee` and a non-nullable
     `l.blockNumber` typed. */
  const out = await scanWindowsBackwardMulti<ActivityEvent>(d.deployedAtBlock, head, limit, [
    async (f, t) =>
      shown(await c.getLogs({ address: d.clPoolManager, event: CL_INITIALIZE_EVENT[0], fromBlock: f, toBlock: t })).map(
        (l): ActivityEvent => {
          const hooks = l.args.hooks as Address
          const hooked = hooks !== '0x0000000000000000000000000000000000000000'
          return {
            chainId,
            kind: 'Initialize',
            blockNumber: l.blockNumber,
            txHash: l.transactionHash,
            detail: `pool created · fee ${Number(l.args.fee)} pips · ${hooked ? 'hook attached' : 'no hook'}`,
          }
        },
      ),
    async (f, t) =>
      shown(await c.getLogs({ address: d.clPoolManager, event: CL_SWAP_EVENT[0], fromBlock: f, toBlock: t })).map(
        (l): ActivityEvent => ({
          chainId,
          kind: 'Swap',
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          detail: `${Number(l.args.fee)} pips total · ${Number(l.args.protocolFee)} to protocol`,
        }),
      ),
    async (f, t) =>
      shown(await c.getLogs({ address: d.clPoolManager, event: CL_MODIFY_EVENT[0], fromBlock: f, toBlock: t })).map(
        (l): ActivityEvent => ({
          chainId,
          kind: (l.args.liquidityDelta as bigint) >= 0n ? 'Add liquidity' : 'Remove liquidity',
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          detail: `ticks ${Number(l.args.tickLower)} to ${Number(l.args.tickUpper)}`,
        }),
      ),
    async (f, t) =>
      shown(await c.getLogs({ address: d.clPoolManager, event: CL_DONATE_EVENT[0], fromBlock: f, toBlock: t })).map(
        (l): ActivityEvent => ({
          chainId,
          kind: 'Donate',
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
          detail: 'donated to in-range liquidity',
        }),
      ),
  ], 'activity feed (CLPoolManager Initialize/Swap/ModifyLiquidity/Donate)')

  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, limit)
}

/**
 * Current head of the chain — the LOG clock. Used by the dapp shell's block
 * chip and for `getLogs` ranges. Never compare a contract-stored block number
 * (a block-numbered hook's `effective` / `expiry`, the block kit's `startBlock`) against this; use
 * `readContractClockReading`.
 */
export async function readBlockNumber(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<bigint> {
  return client(chainId).getBlockNumber()
}

/**
 * `block.number` as a CONTRACT sees it, with the RPC head beside it.
 *
 * On Robinhood (Arbitrum Nitro) these are different clocks: a contract sees
 * Ethereum's block number (~26M, ~12 s each) while `eth_blockNumber` is the L2
 * block (~62M, ~0.1 s). Every block number a Latch contract stores is on the
 * first. Comparing one against the second made queued proposals render as
 * expired or armed. Throws rather than substitute the RPC head — see
 * `packages/sdk/src/chains/clock.ts`.
 */
export async function readContractClockReading(
  chainId: DeployedChainId = ACTIVE_CHAIN_ID,
): Promise<ContractClockReading> {
  return readContractClock(client(chainId), chainId)
}

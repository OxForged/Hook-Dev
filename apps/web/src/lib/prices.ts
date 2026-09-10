/**
 * Price feeds for the two ticker strips.
 *
 * ============================================================================
 * ENVIRONMENT
 *   VITE_FINNHUB_API_KEY   optional. A free-tier key from https://finnhub.io.
 *
 *   Without it `finnhubStocks.load()` returns `{ k: 'unconfigured' }` and the
 *   equity half of the landing strip says so in plain words. The crypto half
 *   needs no key and is unaffected. A key is NEVER hardcoded here, never
 *   committed, and never logged — see CLAUDE.md § Secrets.
 * ============================================================================
 *
 * THE RULE THIS FILE EXISTS TO KEEP
 *
 * Nothing in this module may invent, simulate, randomise, extrapolate or
 * smooth a number. Every value returned came off a provider response or out of
 * a contract read. When a source is unreachable, unconfigured or empty, the
 * result says so and the caller renders that state — it does not substitute a
 * plausible figure. `chain.ts` states the same rule at its head, and the
 * reason is the same one: a number that silently degrades from real to
 * invented is indistinguishable to the reader, which is exactly when it
 * matters most.
 *
 * TWO KINDS OF PRICE LIVE HERE, AND THEY MUST NOT BE CONFLATED
 *
 *   1. Reference market data (CoinGecko, Finnhub). External quotes for the
 *      markets Latch targets. These are NOT Latch pool prices and every
 *      surface rendering them must say so.
 *
 *   2. Latch pool prices, derived from `sqrtPriceX96` on chain. Expressed as a
 *      token1-per-token0 RATIO, never as USD: the pool tokens are testnet
 *      tokens that nothing prices, and attaching a dollar figure to them would
 *      be the fabrication this codebase keeps refusing to make.
 */

import { useEffect, useState } from 'react'
import { parseAbi, type Address, type Hex } from 'viem'
import {
  client,
  DEPLOYMENTS,
  readPools,
  SEPOLIA_CHAIN_ID,
  type DeployedChainId,
} from './chain'

/* ===========================================================================
   Shared shapes
   =========================================================================== */

/** One reference quote. `price` is in USD; these are real, externally traded assets. */
export interface MarketQuote {
  /** Stable react key. */
  key: string
  /** Ticker as a trader would write it. */
  symbol: string
  /** What it is, for the tooltip / screen reader. */
  name: string
  price: number
  /** Percent change over the provider's own window. `null` when unknown — never zero-filled. */
  changePct: number | null
  /** When the provider says the quote was taken, epoch ms. `null` when unstated. */
  asOf: number | null
  /**
   * Set when the quote is not a currently-trading price — a US equity last
   * close outside market hours, for example. Rendered verbatim.
   */
  note?: string
}

/**
 * What a provider returns. The three failure shapes are distinct on purpose:
 * "you never set a key" and "the API is down" are different facts, and a
 * visitor is owed the difference.
 */
export type FeedResult =
  | { k: 'ok'; rows: MarketQuote[]; note?: string }
  | { k: 'unconfigured'; reason: string }
  | { k: 'error'; reason: string }

/**
 * The seam a different data vendor drops into.
 *
 * Swapping Finnhub for another equity vendor means writing one more object of
 * this shape and changing the constant the component imports. No component
 * knows a vendor's URL shape, and no vendor knows how a ticker renders.
 */
export interface MarketFeedProvider {
  readonly id: string
  /** What this feed covers, for the strip's own labelling. */
  readonly label: string
  /** Vendor name, shown as attribution. */
  readonly source: string
  readonly sourceUrl: string
  load(signal: AbortSignal): Promise<FeedResult>
}

/* Shared fetch guard. Providers get a hard deadline so one hung request cannot
   leave a strip in "loading" forever. */
async function getJson(url: string, signal: AbortSignal, timeoutMs = 10_000): Promise<unknown> {
  const local = new AbortController()
  const onAbort = () => local.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => local.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: local.signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

function reasonOf(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'request timed out'
  return e instanceof Error ? e.message : 'unreachable'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/* ===========================================================================
   Provider 1 — CoinGecko. Crypto, keyless, public.

   The asset list is the chains Latch targets plus the two majors any reader
   uses to sanity-check that a ticker is live. CoinGecko silently omits ids it
   does not know, and this reader renders exactly what came back rather than
   filling a gap — an unlisted asset simply does not appear.
   =========================================================================== */

const COINGECKO_ASSETS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB Chain' },
  { id: 'hyperliquid', symbol: 'HYPE', name: 'Hyperliquid — HyperEVM' },
  { id: 'monad', symbol: 'MON', name: 'Monad' },
  { id: 'plasma', symbol: 'XPL', name: 'Plasma' },
] as const

export const coinGeckoCrypto: MarketFeedProvider = {
  id: 'coingecko',
  label: 'Crypto',
  source: 'CoinGecko',
  sourceUrl: 'https://www.coingecko.com',

  async load(signal) {
    const ids = COINGECKO_ASSETS.map((a) => a.id).join(',')
    const url =
      'https://api.coingecko.com/api/v3/simple/price' +
      `?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`

    try {
      const body = (await getJson(url, signal)) as Record<string, Record<string, unknown>> | null
      if (!body || typeof body !== 'object') return { k: 'error', reason: 'malformed response' }

      const rows: MarketQuote[] = []
      for (const asset of COINGECKO_ASSETS) {
        const entry = body[asset.id]
        if (!entry) continue // not listed / not returned — omitted, not guessed
        const price = num(entry['usd'])
        if (price === null) continue
        const updated = num(entry['last_updated_at'])
        rows.push({
          key: `cg:${asset.id}`,
          symbol: asset.symbol,
          name: asset.name,
          price,
          changePct: num(entry['usd_24h_change']),
          asOf: updated === null ? null : updated * 1000,
        })
      }
      if (rows.length === 0) return { k: 'error', reason: 'no quotes returned' }
      return { k: 'ok', rows }
    } catch (e) {
      return { k: 'error', reason: reasonOf(e) }
    }
  },
}

/* ===========================================================================
   Provider 2 — Finnhub. US equities, free tier, key required.

   These are the markets `StockPairHook` targets, so they belong on the
   marketing surface. Two honesty problems come with equity data and both are
   handled here rather than in the view:

     · No key. Reported as `unconfigured`, never as a failure and never as
       zeroes. The crypto half keeps working.

     · The market is shut most of the day. Finnhub keeps serving the last
       print, so a naive ticker shows a Sunday price as if it were live. The
       quote's own timestamp `t` decides: older than QUOTE_FRESH_MS and the row
       is labelled "last close" rather than presented as a live quote. Market
       hours are NOT computed locally — a hand-rolled holiday and DST calendar
       is exactly the kind of invention this file refuses.
   =========================================================================== */

const FINNHUB_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'SPY', name: 'S&P 500 ETF' },
] as const

/** A quote older than this is presented as a close, not as a live price. */
const QUOTE_FRESH_MS = 15 * 60 * 1000

function finnhubKey(): string | null {
  const raw: unknown = import.meta.env['VITE_FINNHUB_API_KEY']
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/** True when a Finnhub key is present. Never returns or logs the key itself. */
export function stocksConfigured(): boolean {
  return finnhubKey() !== null
}

export const finnhubStocks: MarketFeedProvider = {
  id: 'finnhub',
  label: 'US equities',
  source: 'Finnhub',
  sourceUrl: 'https://finnhub.io',

  async load(signal) {
    const key = finnhubKey()
    if (key === null) {
      return {
        k: 'unconfigured',
        reason: 'US equity quotes need a Finnhub API key (VITE_FINNHUB_API_KEY).',
      }
    }

    try {
      const settled = await Promise.all(
        FINNHUB_SYMBOLS.map(async (s) => {
          const url =
            'https://finnhub.io/api/v1/quote' +
            `?symbol=${encodeURIComponent(s.symbol)}&token=${encodeURIComponent(key)}`
          const body = (await getJson(url, signal)) as Record<string, unknown> | null
          return { s, body }
        }),
      )

      const now = Date.now()
      const rows: MarketQuote[] = []
      for (const { s, body } of settled) {
        if (!body || typeof body !== 'object') continue
        const price = num(body['c'])
        const ts = num(body['t'])
        // Finnhub answers an unknown or unentitled symbol with zeroes. A zero
        // price is absence of data, not a price — drop the row.
        if (price === null || price === 0) continue
        const asOf = ts === null || ts === 0 ? null : ts * 1000
        const closed = asOf === null || now - asOf > QUOTE_FRESH_MS
        rows.push({
          key: `fh:${s.symbol}`,
          symbol: s.symbol,
          name: s.name,
          price,
          changePct: num(body['dp']),
          asOf,
          ...(closed ? { note: 'last close' } : {}),
        })
      }

      if (rows.length === 0) return { k: 'error', reason: 'no quotes returned' }
      const allClosed = rows.every((r) => r.note !== undefined)
      return {
        k: 'ok',
        rows,
        ...(allClosed ? { note: 'US market closed — last close shown, change is vs. prior close' } : {}),
      }
    } catch (e) {
      return { k: 'error', reason: reasonOf(e) }
    }
  },
}

/* ===========================================================================
   Latch pool prices — the dapp strip.

   Derived from `sqrtPriceX96` read off the CL pool manager. No external price
   is consulted here and none may be: falling back to a reference quote would
   put an invented dollar value on a testnet token.
   =========================================================================== */

const CL_SLOT0 = parseAbi([
  'function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
])

const ERC20_META = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

export interface PoolPrice {
  id: Hex
  token0: Address
  token1: Address
  symbol0: string
  symbol1: string
  /**
   * Units of token1 per 1 token0, from sqrtPriceX96 and the two decimals.
   * A RATIO between two unpriced testnet tokens. Not USD. Never label it as money.
   */
  price1Per0: number
  tick: number
  /** LP fee in pips, off the pool's Initialize log. */
  lpFeePips: number
  hasHook: boolean
}

const Q192 = 2n ** 192n
/** Fixed-point headroom for the bigint -> number step. */
const SCALE = 10n ** 18n

/**
 * (sqrtPriceX96 / 2^96)^2, decimal-adjusted, as a JS number.
 *
 * Done in bigint up to the last step so no precision is lost squaring a 160-bit
 * value. Returns null for an uninitialized slot rather than 0 — zero is a
 * price, absence is not.
 */
export function priceFromSqrtX96(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number | null {
  if (sqrtPriceX96 <= 0n) return null
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(decimals0) * SCALE
  const denominator = Q192 * 10n ** BigInt(decimals1)
  const scaled = numerator / denominator
  const value = Number(scaled) / Number(SCALE)
  return Number.isFinite(value) ? value : null
}

/** Token metadata never changes; read it once per address per session. */
const tokenMetaCache = new Map<string, Promise<{ symbol: string; decimals: number }>>()

function tokenMeta(
  chainId: DeployedChainId,
  token: Address,
): Promise<{ symbol: string; decimals: number }> {
  const cacheKey = `${chainId}:${token.toLowerCase()}`
  const hit = tokenMetaCache.get(cacheKey)
  if (hit) return hit
  const c = client(chainId)
  const pending = Promise.all([
    c.readContract({ address: token, abi: ERC20_META, functionName: 'symbol' }),
    c.readContract({ address: token, abi: ERC20_META, functionName: 'decimals' }),
  ])
    .then(([symbol, decimals]) => ({ symbol, decimals: Number(decimals) }))
    .catch((e: unknown) => {
      // Do not cache a failure — a flaky RPC would poison the session.
      tokenMetaCache.delete(cacheKey)
      throw e
    })
  tokenMetaCache.set(cacheKey, pending)
  return pending
}

/**
 * Every initialized CL pool, priced from its own slot0.
 *
 * An empty array is a real and expected answer on a fresh deployment. The
 * caller must render that as "no pools yet", never pad it.
 */
export async function readLatchPoolPrices(
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
): Promise<PoolPrice[]> {
  const d = DEPLOYMENTS[chainId]
  const c = client(chainId)
  const pools = await readPools(chainId)
  if (pools.length === 0) return []

  const priced = await Promise.all(
    pools.map(async (p): Promise<PoolPrice | null> => {
      try {
        const [slot0, meta0, meta1] = await Promise.all([
          c.readContract({
            address: d.clPoolManager,
            abi: CL_SLOT0,
            functionName: 'getSlot0',
            args: [p.id],
          }),
          tokenMeta(chainId, p.currency0),
          tokenMeta(chainId, p.currency1),
        ])
        const [sqrtPriceX96, tick] = slot0
        const price = priceFromSqrtX96(sqrtPriceX96, meta0.decimals, meta1.decimals)
        if (price === null) return null // uninitialized — dropped, not defaulted
        return {
          id: p.id,
          token0: p.currency0,
          token1: p.currency1,
          symbol0: meta0.symbol,
          symbol1: meta1.symbol,
          price1Per0: price,
          tick: Number(tick),
          lpFeePips: p.lpFeePips,
          hasHook: p.hasHook,
        }
      } catch {
        // One unreadable pool must not blank the strip; it is left out.
        return null
      }
    }),
  )

  return priced.filter((p): p is PoolPrice => p !== null)
}

/* ===========================================================================
   Formatting. Presentation only — never rounds a value into existence.
   =========================================================================== */

/** USD, with precision that follows magnitude so a sub-cent asset stays readable. */
export function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  const places = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return v.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/** A token1-per-token0 ratio. No currency symbol — there is no currency here. */
export function fmtRatio(v: number): string {
  const abs = Math.abs(v)
  if (abs !== 0 && abs < 0.000001) return v.toExponential(4)
  const places = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8
  return v.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

export function fmtPct(v: number): string {
  return `${Math.abs(v).toFixed(2)}%`
}

/** Local wall-clock time of a quote, so "as of" means something to the reader. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Newest timestamp in a set of quotes, or null when no provider stamped one. */
export function latestAsOf(rows: readonly MarketQuote[]): number | null {
  let best: number | null = null
  for (const r of rows) {
    if (r.asOf !== null && (best === null || r.asOf > best)) best = r.asOf
  }
  return best
}

/* ===========================================================================
   Polling.

   One shared scheduler for both strips. Rules it enforces so a ticker can
   never become a load generator:

     · Never a tight loop — the next request is scheduled only after the
       previous one settles, so a slow provider stretches the interval instead
       of stacking requests.
     · Nothing runs while the tab is hidden. CoinGecko's keyless tier and
       Finnhub's 60-calls-per-minute free tier are both easy to exhaust with a
       forgotten background tab.
     · Every timer and in-flight request is torn down on unmount.
     · An `unconfigured` provider stops polling outright. A missing env var
       will not appear mid-session, so retrying it forever is pure noise.
   =========================================================================== */

/** Default cadence. Slow on purpose: these are reference prices, not a trading screen. */
export const DEFAULT_POLL_MS = 60_000

export type MarketFeedState =
  | { k: 'loading' }
  | { k: 'unconfigured'; reason: string }
  | { k: 'error'; reason: string }
  | { k: 'ready'; rows: MarketQuote[]; note?: string; fetchedAt: number }

/**
 * @param run    performs one fetch; must resolve rather than throw.
 * @param apply  commits the result to state and returns `true` to stop polling.
 */
function usePoll<T>(
  run: (signal: AbortSignal) => Promise<T>,
  apply: (value: T) => boolean,
  intervalMs: number,
  deps: readonly unknown[],
): void {
  useEffect(() => {
    let disposed = false
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    /**
     * Set when a tick was skipped because the tab was hidden. Without it a
     * tab opened in the background never loads until a full interval after
     * it is focused — the first tick is skipped at mount and nothing brings
     * it forward. On becoming visible the skipped tick runs immediately; the
     * flag guarantees this only ever REPLACES a tick that would have happened
     * anyway, so flipping between tabs cannot add requests.
     */
    let skippedWhileHidden = false

    const schedule = () => {
      timer = setTimeout(() => void tick(), intervalMs)
    }

    const tick = async () => {
      if (disposed) return
      // Asleep in a background tab: skip the call, keep the schedule alive.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        skippedWhileHidden = true
        schedule()
        return
      }
      skippedWhileHidden = false
      controller = new AbortController()
      const value = await run(controller.signal)
      if (disposed) return
      if (!apply(value)) schedule()
    }

    const onVisibilityChange = () => {
      if (disposed || !skippedWhileHidden || document.visibilityState !== 'visible') return
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      void tick()
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    void tick()
    return () => {
      disposed = true
      controller?.abort()
      if (timer !== undefined) clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * A reference market feed, polled.
 *
 * There is no cached-last-good fallback: if a refresh fails the strip says the
 * feed is unreachable rather than leaving an aging price on screen with no
 * indication of its age.
 */
export function useMarketFeed(
  provider: MarketFeedProvider,
  intervalMs: number = DEFAULT_POLL_MS,
): MarketFeedState {
  const [state, setState] = useState<MarketFeedState>({ k: 'loading' })

  usePoll(
    (signal) => provider.load(signal),
    (r: FeedResult) => {
      if (r.k === 'ok') {
        setState({ k: 'ready', rows: r.rows, note: r.note, fetchedAt: Date.now() })
        return false
      }
      if (r.k === 'unconfigured') {
        setState({ k: 'unconfigured', reason: r.reason })
        return true // will never change mid-session
      }
      setState({ k: 'error', reason: r.reason })
      return false
    },
    intervalMs,
    [provider, intervalMs],
  )

  return state
}

export type PoolPriceState =
  | { k: 'loading' }
  | { k: 'error'; reason: string }
  /** `pools` empty is the honest answer on a chain with nothing initialized. */
  | { k: 'ready'; pools: PoolPrice[]; fetchedAt: number }

/** Latch pool prices, polled off the RPC. */
export function useLatchPoolPrices(
  chainId: DeployedChainId = SEPOLIA_CHAIN_ID,
  intervalMs: number = DEFAULT_POLL_MS,
): PoolPriceState {
  const [state, setState] = useState<PoolPriceState>({ k: 'loading' })

  usePoll(
    async () => {
      try {
        return { ok: true as const, pools: await readLatchPoolPrices(chainId) }
      } catch (e) {
        return { ok: false as const, reason: reasonOf(e) }
      }
    },
    (r: { ok: true; pools: PoolPrice[] } | { ok: false; reason: string }) => {
      setState(
        r.ok
          ? { k: 'ready', pools: r.pools, fetchedAt: Date.now() }
          : { k: 'error', reason: r.reason },
      )
      return false
    },
    intervalMs,
    [chainId, intervalMs],
  )

  return state
}

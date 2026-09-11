/* ============================================================================
   Pool price — the surface that puts `src/lib/prices.ts` in front of a user.

   Two cards, two kinds of number, kept visibly apart:

     · LEFT  — the Latch pool price, derived from `sqrtPriceX96` on chain. A
       RATIO between two testnet tokens; never labelled as money.
     · RIGHT — reference market quotes (CoinGecko, Finnhub). Real, externally
       traded assets in USD, and NOT Latch prices. The card says so in its title.

   When a pool's token symbols map onto a reference asset (ltETH -> ETH against
   a dollar leg such as ltUSD) the two figures are placed side by side in the
   same orientation — dollars per unit — so a reader can compare them by eye.
   No spread or deviation is computed: a percentage would assert that the
   testnet ratio IS a dollar price, and it is not.

   Every state the feeds can be in has its own rendering and its own words:
   loading, unreachable, not configured, empty, ready. A price is never shown
   without the time it was taken, and a failed refresh replaces the number with
   the failure rather than leaving an aging figure on screen.

   Polling, aborts and unmount cleanup are owned by the hooks in prices.ts;
   this component holds no timers of its own.
   ============================================================================ */

import { DEPLOYMENTS, ACTIVE_CHAIN_ID, explorerAddress } from '../../../lib/chain'
import {
  DEFAULT_POLL_MS,
  coinGeckoCrypto,
  finnhubStocks,
  fmtPct,
  fmtRatio,
  fmtTime,
  fmtUsd,
  latestAsOf,
  stocksConfigured,
  useLatchPoolPrices,
  useMarketFeed,
  type MarketFeedProvider,
  type MarketFeedState,
  type MarketQuote,
  type PoolPrice,
  type PoolPriceState,
} from '../../../lib/prices'

const POLL_SECONDS = Math.round(DEFAULT_POLL_MS / 1000)

/* ---------------------------------------------------------------------------
   Reference matching.

   A pool token is matched to a reference asset only through this explicit
   table — never by fuzzy string similarity. `lt` is the prefix Latch's own
   testnet tokens carry (ltUSD, ltETH); it is stripped case-sensitively so a
   real ticker starting with the letters LT is left alone.
   --------------------------------------------------------------------------- */

const CRYPTO_ALIAS: Record<string, string> = {
  ETH: 'ETH',
  WETH: 'ETH',
  BTC: 'BTC',
  WBTC: 'BTC',
  BNB: 'BNB',
  WBNB: 'BNB',
  HYPE: 'HYPE',
  MON: 'MON',
  XPL: 'XPL',
}

const DOLLAR_LEGS = new Set(['USD', 'USDC', 'USDT', 'DAI'])

function canonical(symbol: string): string {
  const stripped = symbol.startsWith('lt') ? symbol.slice(2) : symbol
  return stripped.toUpperCase()
}

interface Reference {
  quote: MarketQuote
  /** The pool's own ratio, re-oriented as dollar-leg units per 1 crypto-leg unit. */
  poolPerUnit: number
  cryptoSymbol: string
  dollarSymbol: string
}

/**
 * Finds the reference quote a pool can be read against, or null when neither
 * orientation of the pair maps onto one. `price1Per0` is token1 per token0.
 */
function matchReference(pool: PoolPrice, rows: readonly MarketQuote[]): Reference | null {
  const c0 = canonical(pool.symbol0)
  const c1 = canonical(pool.symbol1)

  if (DOLLAR_LEGS.has(c1) && CRYPTO_ALIAS[c0] !== undefined) {
    const quote = rows.find((r) => r.symbol === CRYPTO_ALIAS[c0])
    if (!quote) return null
    return {
      quote,
      poolPerUnit: pool.price1Per0,
      cryptoSymbol: pool.symbol0,
      dollarSymbol: pool.symbol1,
    }
  }

  if (DOLLAR_LEGS.has(c0) && CRYPTO_ALIAS[c1] !== undefined && pool.price1Per0 > 0) {
    const quote = rows.find((r) => r.symbol === CRYPTO_ALIAS[c1])
    if (!quote) return null
    return {
      quote,
      poolPerUnit: 1 / pool.price1Per0,
      cryptoSymbol: pool.symbol1,
      dollarSymbol: pool.symbol0,
    }
  }

  return null
}

/** `0x1373…2b38`. */
function short(hex: string): string {
  return hex.length > 12 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex
}

function signedPct(v: number): string {
  return `${v < 0 ? '−' : '+'}${fmtPct(v)}`
}

/**
 * viem error messages run to several lines and include the raw JSON-RPC
 * request body. The first line ("HTTP request failed.") is the part a reader
 * needs; the rest stays in the console, not in the card.
 */
function headline(reason: string): string {
  const first = reason.split('\n')[0]?.trim() ?? ''
  return first === '' ? 'unreachable' : first
}

/* ---------------------------------------------------------------------------
   Left card — the pool, priced off chain state.
   --------------------------------------------------------------------------- */

function PoolCard({ pools, crypto }: { pools: PoolPriceState; crypto: MarketFeedState }) {
  const d = DEPLOYMENTS[ACTIVE_CHAIN_ID]

  return (
    <section className="dapp-card" aria-labelledby="pool-price-h">
      <div className="dapp-card__bar">
        <h2 id="pool-price-h" className="dapp-microlabel">
          POOL PRICE · FROM sqrtPriceX96
        </h2>
        <span className="live-badge">
          <span className="live-dot" aria-hidden="true" />
          ON CHAIN
        </span>
        {pools.k === 'ready' && (
          <span className="dapp-dot--end dapp-stat__label">READ {fmtTime(pools.fetchedAt)}</span>
        )}
      </div>

      {pools.k === 'loading' && (
        <>
          <p className="dapp-kpi__value" aria-hidden="true">
            ·
          </p>
          <p className="live-note" role="status">
            Reading slot0 on {d.name}&hellip;
          </p>
        </>
      )}

      {pools.k === 'error' && (
        <>
          <p className="dapp-kpi__value" aria-hidden="true">
            &mdash;
          </p>
          <p className="live-note live-note--err" role="status">
            Chain unreachable: {headline(pools.reason)} No price shown rather than a stale one.
          </p>
        </>
      )}

      {pools.k === 'ready' && pools.pools.length === 0 && (
        <p className="live-note" role="status">
          No initialized CL pools on this deployment. Shown empty rather than with an example.
        </p>
      )}

      {pools.k === 'ready' &&
        pools.pools.map((p, i) => (
          <PoolBlock key={p.id} pool={p} crypto={crypto} showHeading={pools.pools.length > 1 || i > 0} />
        ))}

      <p className="dapp-note">
        A ratio between two testnet tokens that nothing prices &mdash; not a USD value. Read from{' '}
        <code>getSlot0</code> on the{' '}
        <a href={explorerAddress(ACTIVE_CHAIN_ID, d.clPoolManager)} target="_blank" rel="noopener noreferrer" data-hit>
          CL pool manager
        </a>{' '}
        every {POLL_SECONDS}s while this tab is visible.
      </p>
    </section>
  )
}

function PoolBlock({
  pool,
  crypto,
  showHeading,
}: {
  pool: PoolPrice
  crypto: MarketFeedState
  showHeading: boolean
}) {
  const inverse = pool.price1Per0 > 0 ? 1 / pool.price1Per0 : null

  return (
    <article aria-label={`${pool.symbol0} / ${pool.symbol1} pool`}>
      {showHeading && (
        <h3 className="live-sub-h">
          {pool.symbol0} / {pool.symbol1}
        </h3>
      )}

      <p className="dapp-kpi__value">
        {fmtRatio(pool.price1Per0)}{' '}
        <span className="live-sub">
          {pool.symbol1} per {pool.symbol0}
        </span>
      </p>
      {inverse !== null && (
        <p className="live-note tabular">
          = {fmtRatio(inverse)} {pool.symbol0} per {pool.symbol1}
        </p>
      )}

      <dl className="live-grid">
        <div>
          <dt>Pair</dt>
          <dd>
            <a href={explorerAddress(ACTIVE_CHAIN_ID, pool.token0)} target="_blank" rel="noopener noreferrer" data-hit>
              {pool.symbol0}
            </a>
            {' / '}
            <a href={explorerAddress(ACTIVE_CHAIN_ID, pool.token1)} target="_blank" rel="noopener noreferrer" data-hit>
              {pool.symbol1}
            </a>
          </dd>
        </div>
        <div>
          <dt>Tick</dt>
          <dd className="tabular">{pool.tick}</dd>
        </div>
        <div>
          <dt>LP fee</dt>
          <dd className="tabular">{(pool.lpFeePips / 10_000).toFixed(2)}%</dd>
        </div>
        <div>
          <dt>Latch</dt>
          <dd>{pool.hasHook ? 'attached' : 'none'}</dd>
        </div>
        <div>
          <dt>Pool id</dt>
          <dd className="tabular" title={pool.id}>
            {short(pool.id)}
          </dd>
        </div>
      </dl>

      <ReferenceBlock pool={pool} crypto={crypto} />
    </article>
  )
}

/**
 * The comparison. Both figures are shown in the same orientation (dollar leg
 * per 1 unit) with their own timestamps; the reader draws the conclusion.
 */
function ReferenceBlock({ pool, crypto }: { pool: PoolPrice; crypto: MarketFeedState }) {
  const heading = <h3 className="live-sub-h">Against the reference market</h3>

  if (crypto.k === 'loading') {
    return (
      <>
        {heading}
        <p className="live-note" role="status">
          Reference quote loading&hellip;
        </p>
      </>
    )
  }

  if (crypto.k === 'error') {
    return (
      <>
        {heading}
        <p className="live-note live-note--err" role="status">
          Reference feed unreachable: {crypto.reason}. No comparison shown.
        </p>
      </>
    )
  }

  if (crypto.k === 'unconfigured') {
    return (
      <>
        {heading}
        <p className="live-note" role="status">
          Reference feed not configured &mdash; {crypto.reason}
        </p>
      </>
    )
  }

  const ref = matchReference(pool, crypto.rows)
  if (ref === null) {
    return (
      <>
        {heading}
        <p className="live-note">
          No reference market maps onto {pool.symbol0} / {pool.symbol1}, so nothing is compared.
        </p>
      </>
    )
  }

  const quotedAt = ref.quote.asOf

  return (
    <>
      {heading}
      <dl className="live-grid">
        <div>
          <dt>
            Pool &middot; {ref.dollarSymbol} per {ref.cryptoSymbol}
          </dt>
          <dd className="tabular">{fmtRatio(ref.poolPerUnit)}</dd>
        </div>
        <div>
          <dt>
            Market &middot; USD per {ref.quote.symbol}
          </dt>
          <dd className="tabular">
            ${fmtUsd(ref.quote.price)}
            <span className="live-sub">
              {' '}
              {coinGeckoCrypto.source}
              {quotedAt !== null ? ` · quoted ${fmtTime(quotedAt)}` : ` · fetched ${fmtTime(crypto.fetchedAt)}`}
            </span>
          </dd>
        </div>
      </dl>
      <p className="live-note">
        {ref.cryptoSymbol} and {ref.dollarSymbol} are testnet tokens. The market quote is context
        for reading the ratio, not a valuation of the pool.
      </p>
    </>
  )
}

/* ---------------------------------------------------------------------------
   Right card — reference markets, off chain.
   --------------------------------------------------------------------------- */

function FeedBadge({ state }: { state: MarketFeedState }) {
  if (state.k === 'unconfigured') {
    return <span className="dapp-badge dapp-badge--mute">NOT CONFIGURED</span>
  }
  if (state.k === 'loading') return <span className="dapp-badge dapp-badge--mute">LOADING</span>
  if (state.k === 'error') return <span className="dapp-badge dapp-badge--warn">UNREACHABLE</span>
  if (state.note !== undefined) return <span className="dapp-badge dapp-badge--info">LAST CLOSE</span>
  return <span className="dapp-badge dapp-badge--ok">LIVE</span>
}

function FeedBlock({
  provider,
  state,
  configured,
}: {
  provider: MarketFeedProvider
  state: MarketFeedState
  configured: boolean
}) {
  // The badge and the body must never disagree. `configured` is known
  // synchronously from the environment, while the hook needs a tick to resolve
  // to `unconfigured` — reading them independently is what produced a
  // NOT CONFIGURED badge sitting above "Fetching Finnhub…". Normalise once,
  // here, and let everything below read this one value.
  const shown: MarketFeedState =
    !configured && state.k !== 'unconfigured'
      ? { k: 'unconfigured', reason: `${provider.label} quotes from ${provider.source} need an API key that is not set.` }
      : state

  const asOf = shown.k === 'ready' ? latestAsOf(shown.rows) : null

  return (
    <div>
      <h3 className="live-sub-h">
        {provider.label} <span className="live-sub">&middot; {provider.source}</span>{' '}
        <FeedBadge state={shown} />
      </h3>

      {shown.k === 'loading' && (
        <p className="live-note" role="status">
          Fetching {provider.source}&hellip;
        </p>
      )}

      {shown.k === 'unconfigured' && (
        <p className="live-note" role="status">
          Not configured &mdash; {shown.reason} No quotes are shown for this market.
        </p>
      )}

      {shown.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          {provider.source} unreachable: {shown.reason}. No quotes shown rather than stale ones.
        </p>
      )}

      {shown.k === 'ready' && (
        <>
          {shown.note !== undefined && <p className="live-note">{shown.note}</p>}
          <ul className="live-list">
            {shown.rows.map((r) => (
              <li key={r.key}>
                <span title={r.name}>
                  {r.symbol}
                  {r.note !== undefined && <span className="live-sub"> &middot; {r.note}</span>}
                </span>
                <span className="tabular">
                  ${fmtUsd(r.price)}{' '}
                  {r.changePct === null ? (
                    <span className="live-sub">&middot; change n/a</span>
                  ) : r.changePct < 0 ? (
                    <span className="dapp-checks__value is-error">{signedPct(r.changePct)}</span>
                  ) : (
                    <span className="dapp-trend is-up">{signedPct(r.changePct)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="live-note">
            {asOf !== null
              ? `Quoted ${fmtTime(asOf)}`
              : `Fetched ${fmtTime(shown.fetchedAt)} — ${provider.source} gave no quote timestamp`}
            {' · '}
            <a href={provider.sourceUrl} target="_blank" rel="noopener noreferrer" data-hit>
              {provider.source}
            </a>
          </p>
        </>
      )}
    </div>
  )
}

function ReferenceCard({ crypto, stocks }: { crypto: MarketFeedState; stocks: MarketFeedState }) {
  return (
    <section className="dapp-card" aria-labelledby="ref-markets-h">
      <div className="dapp-card__bar">
        <h2 id="ref-markets-h" className="dapp-microlabel">
          REFERENCE MARKETS · NOT LATCH PRICES
        </h2>
        <span className="dapp-badge dapp-badge--info">OFF CHAIN</span>
      </div>

      <FeedBlock provider={coinGeckoCrypto} state={crypto} configured />
      <FeedBlock provider={finnhubStocks} state={stocks} configured={stocksConfigured()} />

      <p className="dapp-note">
        External quotes for the markets Latch targets, in USD. Refreshed every {POLL_SECONDS}s
        while this tab is visible; a refresh that fails is shown as unreachable, never as the
        previous number.
      </p>
    </section>
  )
}

/* ---------------------------------------------------------------------------
   Composition. All three feeds are subscribed here, once, and handed down as
   plain state so no child owns a poller.
   --------------------------------------------------------------------------- */

export function PoolPriceCard() {
  const pools = useLatchPoolPrices(ACTIVE_CHAIN_ID)
  const crypto = useMarketFeed(coinGeckoCrypto)
  const stocks = useMarketFeed(finnhubStocks)

  return (
    <div className="dapp-row dapp-row--pool">
      <PoolCard pools={pools} crypto={crypto} />
      <ReferenceCard crypto={crypto} stocks={stocks} />
    </div>
  )
}

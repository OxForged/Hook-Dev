/* ============================================================================
   TickerStrip — the scrolling reference-price rail that sits under a header.

   It is the view half of `src/lib/prices.ts`, which was written for exactly
   this and states the rule both halves keep: nothing here may invent, hold or
   smooth a number. Every state a feed can be in gets its own words —

     loading       "Loading CoinGecko…"           no numbers
     unconfigured  says which key is missing      no numbers, no fake tickers
     error         says the feed is unreachable   no numbers, NOT the last ones
     ready         the marquee, with a timestamp

   The error case is the one that matters. `useMarketFeed` deliberately keeps no
   last-good cache, so a failed refresh replaces the prices with the failure. A
   strip that kept scrolling yesterday's numbers would be indistinguishable from
   a live one, which is the single worst thing a price ticker can do.

   THESE ARE NOT LATCH POOL PRICES. They are external reference quotes for the
   markets Latch targets, and the strip labels its source on screen and in its
   accessible name so that can never be misread.

   ── Motion ────────────────────────────────────────────────────────────────
   The scroll is a CSS animation on a duplicated track, never a JS scroll loop.
   That is a repo rule: `prefers-reduced-motion` is enforced in CSS (tokens.css
   collapses every duration globally), and JS-driven motion escapes it — which
   is the entire reason `dapp/lib/motion.ts` has to exist. This adds nothing to
   that problem.

   tokens.css alone is NOT sufficient here, though. Its global block zeroes
   `animation-duration` and pins `animation-iteration-count: 1`, which for a
   marquee means the track SNAPS to its final keyframe — translated fully off to
   the left, i.e. a blank strip. So the reduced-motion block in TickerStrip.css
   cancels the animation outright and turns the viewport into a plain
   `overflow-x: auto` row, with the duplicate track removed so nothing is read
   twice. Verified by toggling emulated reduced motion, not assumed.

   The viewport is one focusable region: focusing or hovering it pauses the
   marquee (WCAG 2.2.2 — moving content must be pausable), and under reduced
   motion the same focus is what lets a keyboard user scroll the row. One tab
   stop, no interactive descendants, so there is nothing to be trapped in.
   ============================================================================ */

import { useState } from 'react'
import {
  fmtPct,
  fmtTime,
  fmtUsd,
  latestAsOf,
  type MarketFeedProvider,
  type MarketFeedState,
  type MarketQuote,
} from '../lib/prices'
import './TickerStrip.css'

/** Seconds of travel per row, so a six-row strip is not six times faster than a four-row one. */
const SECONDS_PER_ROW = 7

/** Below this many rows the track is padded out so a short feed still fills the viewport. */
const MIN_TRACK_ROWS = 6

interface TickerStripProps {
  readonly provider: MarketFeedProvider
  readonly state: MarketFeedState
  /**
   * Known synchronously from the environment. The hook needs a tick to resolve
   * to `unconfigured`, and reading the two independently is what lets a strip
   * say "loading Finnhub…" for a key that is not set — see the same
   * normalisation in PoolPriceCard.
   */
  readonly configured?: boolean
  /** Extra class for the surface mounting it (landing vs. dapp chrome). */
  readonly className?: string | undefined
}

/* ---------------------------------------------------------------------------
   Logo, and the fallback that must never look like a failure.
   --------------------------------------------------------------------------- */

/** First two characters of the ticker. `BTC` -> `BT`, `SPY` -> `SP`. */
function monogram(symbol: string): string {
  return symbol.slice(0, 2).toUpperCase()
}

/**
 * The asset's mark, or a monogram disc.
 *
 * Three ways a logo can be absent and all three land on the same designed
 * state: the provider supplied none (every Finnhub row), the URL failed the
 * https check in prices.ts, or the image 404s / is blocked at load time. The
 * last is what `failedSrc` covers — without it a dead CDN entry renders the
 * browser's broken-image glyph, which is the one outcome that reads as a bug.
 *
 * `failedSrc` stores the URL that failed rather than a boolean, so a later poll
 * returning a different URL is given its own chance to load.
 */
function QuoteLogo({ quote }: { quote: MarketQuote }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = quote.logo

  if (src !== undefined && src !== failedSrc) {
    return (
      <img
        className="ltk-logo"
        src={src}
        /* Decorative: the symbol and name are already in the row's text. */
        alt=""
        width={18}
        height={18}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
      />
    )
  }

  return (
    <span className="ltk-logo ltk-logo--mono" aria-hidden="true">
      {monogram(quote.symbol)}
    </span>
  )
}

/* ---------------------------------------------------------------------------
   One row.
   --------------------------------------------------------------------------- */

function signedPct(v: number): string {
  return `${v < 0 ? '−' : '+'}${fmtPct(v)}`
}

/**
 * @param showNote per-row "last close" markers are suppressed when the FEED
 *   already carries one — repeating it on every row of a closed market is
 *   noise, and the strip's own badge says it once.
 */
function QuoteRow({ quote, showNote }: { quote: MarketQuote; showNote: boolean }) {
  const change = quote.changePct

  return (
    <li className="ltk-row">
      <QuoteLogo quote={quote} />
      <span className="ltk-sym" title={quote.name}>
        {quote.symbol}
      </span>
      <span className="ltk-price tabular">${fmtUsd(quote.price)}</span>
      {change === null ? (
        <span className="ltk-flat">change n/a</span>
      ) : (
        <span
          className={change < 0 ? 'ltk-chg ltk-chg--down' : 'ltk-chg ltk-chg--up'}
          /* The arrow is decoration; the sign in signedPct() carries the fact. */
        >
          <span aria-hidden="true">{change < 0 ? '▼' : '▲'}</span>
          <span className="tabular">{signedPct(change)}</span>
        </span>
      )}
      {showNote && quote.note !== undefined && <span className="ltk-note">{quote.note}</span>}
    </li>
  )
}

/* ---------------------------------------------------------------------------
   The marquee.

   Two identical runs sit side by side inside a track that translates by exactly
   -50%. At the moment the animation restarts, run two is pixel-for-pixel where
   run one began, so the seam is invisible. Run two is `aria-hidden` and holds
   nothing focusable, so it costs a screen reader and the tab order nothing.
   --------------------------------------------------------------------------- */

function Marquee({ rows, showRowNotes }: { rows: readonly MarketQuote[]; showRowNotes: boolean }) {
  // A four-row feed is narrower than a wide viewport, which would leave a gap
  // mid-cycle. Repeating the run until it is long enough closes it without
  // inventing a row: every entry is the same real quote, shown twice.
  const repeats = Math.max(1, Math.ceil(MIN_TRACK_ROWS / Math.max(rows.length, 1)))
  const run = Array.from({ length: repeats }, (_, r) => r).flatMap((r) =>
    rows.map((quote) => ({ quote, id: `${quote.key}#${r}` })),
  )
  const seconds = run.length * SECONDS_PER_ROW

  // The two runs must be pixel-identical for -50% to land seamlessly, so they
  // are rendered from one function and differ only in the key prefix.
  const renderRun = (pass: 'a' | 'b') => (
    <ul className={pass === 'a' ? 'ltk-run' : 'ltk-run ltk-run--dup'} aria-hidden={pass === 'b'}>
      {run.map((entry) => (
        <QuoteRow key={`${pass}${entry.id}`} quote={entry.quote} showNote={showRowNotes} />
      ))}
    </ul>
  )

  return (
    <div
      className="ltk-viewport"
      role="group"
      aria-label="Price ticker. Hover or focus to pause."
      tabIndex={0}
    >
      <div className="ltk-track" style={{ animationDuration: `${seconds}s` }}>
        {renderRun('a')}
        {/* The seam copy. Hidden from assistive tech, and removed outright
            under reduced motion so a static row never reads twice. */}
        {renderRun('b')}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   The strip.
   --------------------------------------------------------------------------- */

export function TickerStrip({ provider, state, configured = true, className }: TickerStripProps) {
  // Badge, body and accessible name are all derived from this one value so they
  // can never disagree about whether the feed is configured.
  const shown: MarketFeedState =
    !configured && state.k !== 'unconfigured'
      ? {
          k: 'unconfigured',
          reason: `${provider.label} quotes from ${provider.source} need an API key that is not set.`,
        }
      : state

  const asOf = shown.k === 'ready' ? latestAsOf(shown.rows) : null
  const feedNote = shown.k === 'ready' ? shown.note : undefined

  const label = `${provider.label} reference prices from ${provider.source}. Not Latch pool prices.`

  return (
    <section className={className === undefined ? 'ltk' : `ltk ${className}`} aria-label={label}>
      <p className="ltk-label">
        <span className="ltk-label__text">{provider.label}</span>
        {feedNote !== undefined && (
          <span className="ltk-badge" title={feedNote}>
            LAST CLOSE
          </span>
        )}
      </p>

      {shown.k === 'loading' && (
        <p className="ltk-msg" role="status">
          Loading {provider.source}&hellip;
        </p>
      )}

      {shown.k === 'unconfigured' && (
        <p className="ltk-msg" role="status">
          Not configured &mdash; {shown.reason} No quotes shown.
        </p>
      )}

      {shown.k === 'error' && (
        <p className="ltk-msg ltk-msg--err" role="status">
          {provider.source} unreachable: {shown.reason}. No prices shown rather than stale ones.
        </p>
      )}

      {shown.k === 'ready' && (
        <>
          <Marquee rows={shown.rows} showRowNotes={feedNote === undefined} />
          <p className="ltk-meta">
            {/* A price with no time on it is a claim about "now" that nothing
                backs. When the vendor stamps no quote time, the strip says it
                is showing a fetch time instead of implying one. */}
            <span className="tabular">
              {asOf !== null ? `QUOTED ${fmtTime(asOf)}` : `FETCHED ${fmtTime(shown.fetchedAt)}`}
            </span>
            <a
              className="ltk-src"
              href={provider.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {provider.source}
            </a>
            {feedNote !== undefined && <span className="ltk-sr">{feedNote}</span>}
            {asOf === null && (
              <span className="ltk-sr">{provider.source} gave no quote timestamp.</span>
            )}
          </p>
        </>
      )}
    </section>
  )
}

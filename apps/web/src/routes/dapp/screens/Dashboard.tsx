/* Dashboard — SCREENS.md § C1. */

import { CountUp } from '../components/CountUp.tsx'
import { LiveChainPanel } from '../components/LiveChainPanel'
import { useProtocolMetrics, fmtToken } from '../../../lib/useMetrics'
import { LiveActivityFeed } from '../components/LiveActivityFeed'
import { SwapVolumeCard, ActivityMixCard } from '../components/ProtocolCharts'

/**
 * Real KPI tiles, read from whichever deployment this build targets.
 *
 * The design spec put $48.2M TVL / 412,905 hook calls / $186.4K fees here. Those
 * were placeholders and are gone. What replaces them is a young deployment: one
 * pool, a handful of swaps, a few thousandths of a token in fees.
 *
 * No USD. The pool tokens are unpriced; a fabricated price to make a dollar
 * headline is the exact failure this replaces. Sparklines are gone too — a rising
 * sparkline is a visual claim, and there is no history behind one here.
 *
 * THE SECOND LINE OF A TILE NAMES ITS SOURCE, NEVER A RATE. Two of these read
 * "0.1%" and "0.3%", hardcoded: static copy asserting a fee that lives on chain
 * and can be changed by the fee controller. Whether that claim was true depended
 * on the chain nobody had checked. It now says where the figure came from, which
 * cannot go stale.
 */
function liveKpis(m: import('../../../lib/chain').ProtocolMetrics): { label: string; value: string; trend: string }[] {
  const t0 = m.tvl[0]
  /* The fee tiles name the token most swaps paid in, read off the swap's own
     pool currencies. They used to take tvl[0]/tvl[1] positionally, which only
     described the chain while it had exactly one pool. */
  const top = m.tokenFees?.[0]
  /* Em dash when the log scan was refused (null); a zero would claim the
     protocol earned nothing, which is a different statement. A real zero —
     no swap on any live pool — is shown as 0 and the tile says why. */
  const noSwaps = m.tokenFees !== null && top === undefined
  return [
    {
      label: `VAULT TVL · ${t0?.symbol ?? 'TOKEN'}`,
      value: t0 ? fmtToken(t0.balance, t0.decimals, 2) : '—',
      trend: t0 ? 'balanceOf(vault)' : 'no tracked token',
    },
    {
      label: 'SWAPS EXECUTED',
      value: m.swapCount === null ? '—' : String(m.swapCount),
      trend: m.swapCount === 0 ? 'none yet' : 'live pools',
    },
    {
      label: `PROTOCOL FEES${top ? ` · ${top.symbol}` : ''}`,
      value: top ? fmtToken(top.protocolFees, top.decimals, 6) : noSwaps ? '0' : '—',
      trend: noSwaps ? 'no swaps yet' : 'summed per swap',
    },
    {
      label: `LP FEES${top ? ` · ${top.symbol}` : ''}`,
      value: top ? fmtToken(top.lpFees, top.decimals, 6) : noSwaps ? '0' : '—',
      trend: noSwaps ? 'no swaps yet' : 'summed per swap',
    },
  ]
}
export default function Dashboard() {
  const metrics = useProtocolMetrics()

  /* ORDER. Tiles, then charts, then the raw chain reads.
     It used to open on `LiveChainPanel` — four unrelated readings in one flat
     card, so the first thing on the dashboard was a debug dump and the actual
     summary sat below the fold. A dashboard should answer "how is it going" in
     the first screen and "show me the rows" in the second. */
  return (
    <>
      <div className="dapp-kpis">
        {metrics.k === 'ready' ? (
          liveKpis(metrics.m).map((k, i) => (
            <article
              key={k.label}
              className="dapp-card dapp-card--kpi"
              style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}
            >
              <div className="dapp-card__head">
                <h2 className="dapp-microlabel">{k.label}</h2>
                <p className="dapp-trend is-flat">{k.trend}</p>
              </div>
              <p className="dapp-kpi__value">
                <CountUp value={k.value} />
              </p>
            </article>
          ))
        ) : (
          <article
            className={
              metrics.k === 'error' ? 'dapp-card dapp-card--kpi hx-state--err' : 'dapp-card dapp-card--kpi'
            }
          >
            <div className="dapp-card__head">
              <h2
                className={
                  metrics.k === 'error' ? 'dapp-microlabel' : 'dapp-microlabel dapp-state--loading'
                }
              >
                {metrics.k === 'error' ? 'CHAIN UNREACHABLE' : 'READING CHAIN…'}
              </h2>
            </div>
            <p className="dapp-kpi__value">{metrics.k === 'error' ? '—' : '·'}</p>
          </article>
        )}
      </div>

      <div className="dapp-row dapp-row--dashboard">
        <SwapVolumeCard />

        <div className="dapp-stack">
          <ActivityMixCard />
          <LiveActivityFeed />
        </div>
      </div>

      <LiveChainPanel />
    </>
  )
}

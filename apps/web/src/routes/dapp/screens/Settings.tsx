/* Settings — SCREENS.md § C7.

   MINIMAL ON PURPOSE. This screen used to print the full RPC URL list, the build's
   environment switches, every contract address and a network picker that changed
   nothing any other screen read. None of that helps a user, and one part of it was
   a leak: `rpcsFor` puts a keyed `VITE_LATCH_RPC_<id>` endpoint first, and that URL
   (key included) was rendered verbatim. Contracts live in the docs.

   What remains is the one preference the app keeps, the network this build reads,
   and live measurements taken from the reader's own browser:

   - RESPONSE TIME is a real `eth_blockNumber` round trip per endpoint, timed here.
     Only HOSTNAMES are shown; an endpoint that is not in the SDK's public list is
     a private one and is labelled as such, never printed.
   - THE TREND is the median of each probe round since the page opened. Fewer than
     two rounds is an honest empty state, not a flat line.
   - COVERAGE counts the SDK's target chains and the ones with Latch contracts.

   Probing is gentle: one round on open, then every 30 s while the tab is visible,
   one request per endpoint, sequential, 4 s timeout. Some public endpoints allow
   one request per ten seconds, and a Settings page must never be the reason the
   rest of the app gets rate-limited. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { chainById } from '@latchprotocol/sdk'
import { ChainMark } from '../../../components/ChainMark.tsx'
import { ThemeToggle } from '../../../components/ThemeToggle.tsx'
import { ACTIVE_CHAIN_ROW } from '../../../data/chains.ts'
import { rpcsFor } from '../../../lib/chain'
import { BarList, Donut, DonutLegend } from '../components/charts.tsx'
import { SeriesChart } from '../components/series-charts.tsx'
import type { SeriesPoint } from '../components/series-charts.tsx'
import { loadSettings } from '../data/settings.ts'
import type { DonutSegment, LabelledBar, SeriesColor } from '../data/types.ts'
import { useDapp } from '../state.tsx'

const PROBE_INTERVAL_MS = 30_000
const PROBE_TIMEOUT_MS = 4_000
const MAX_ROUNDS = 20

type ProbeResult =
  | { readonly k: 'ok'; readonly ms: number; readonly block: bigint }
  | { readonly k: 'limited' }
  | { readonly k: 'failed' }

interface Endpoint {
  readonly url: string
  /** Hostname for public endpoints; a neutral label for private ones. */
  readonly label: string
  readonly isPrivate: boolean
}

interface Round {
  readonly at: number
  readonly results: readonly ProbeResult[]
}

async function probe(url: string): Promise<ProbeResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: ctrl.signal,
    })
    const ms = performance.now() - t0
    if (res.status === 429) return { k: 'limited' }
    if (!res.ok) return { k: 'failed' }
    const body = (await res.json()) as { result?: unknown; error?: { code?: number } }
    if (typeof body.result === 'string') return { k: 'ok', ms, block: BigInt(body.result) }
    return body.error?.code === 429 || body.error?.code === -32005 ? { k: 'limited' } : { k: 'failed' }
  } catch {
    return { k: 'failed' }
  } finally {
    clearTimeout(timer)
  }
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

function latencyColor(ms: number): SeriesColor {
  return ms < 300 ? 'success' : ms < 800 ? 'signal' : 'amber'
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function useEndpointProbe(endpoints: readonly Endpoint[], live: boolean) {
  const [rounds, setRounds] = useState<readonly Round[]>([])
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  const run = useCallback(async () => {
    if (running.current || endpoints.length === 0) return
    running.current = true
    setBusy(true)
    const results: ProbeResult[] = []
    for (const e of endpoints) results.push(await probe(e.url))
    setRounds((prev) => [...prev, { at: Date.now(), results }].slice(-MAX_ROUNDS))
    running.current = false
    setBusy(false)
  }, [endpoints])

  useEffect(() => {
    void run()
  }, [run])

  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void run()
    }, PROBE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [live, run])

  return { rounds, busy, run }
}

export default function Settings() {
  const { browsingChain } = useDapp()
  const data = useMemo(loadSettings, [])
  const [live, setLive] = useState(true)
  const [slice, setSlice] = useState<string | null>(null)

  const endpoints: readonly Endpoint[] = useMemo(() => {
    const pub = new Set(chainById(browsingChain)?.endpoints.map((e) => e.url) ?? [])
    let n = 0
    return rpcsFor(browsingChain).map((url) => {
      if (pub.has(url)) return { url, label: new URL(url).hostname, isPrivate: false }
      n += 1
      return { url, label: `Private endpoint ${n}`, isPrivate: true }
    })
  }, [browsingChain])

  const { rounds, busy, run } = useEndpointProbe(endpoints, live)
  const latest = rounds.at(-1)

  const okLatest = latest?.results.filter((r) => r.k === 'ok') ?? []
  const head = okLatest.reduce<bigint | null>((m, r) => (m === null || r.block > m ? r.block : m), null)
  const fastest = latest
    ? latest.results.reduce<{ i: number; ms: number } | null>(
        (best, r, i) => (r.k === 'ok' && (!best || r.ms < best.ms) ? { i, ms: r.ms } : best),
        null,
      )
    : null

  const slowest = Math.max(1, ...okLatest.map((r) => r.ms))
  const bars: LabelledBar[] = endpoints.map((e, i) => {
    const r = latest?.results[i]
    if (!r) return { name: e.label, value: '…', pct: 0, color: 'primary' }
    if (r.k === 'limited') return { name: e.label, value: 'rate limited', pct: 0, color: 'amber' }
    if (r.k === 'failed') return { name: e.label, value: 'no answer', pct: 0, color: 'amber' }
    return {
      name: e.label,
      value: `${Math.round(r.ms)} ms`,
      pct: Math.max(4, (r.ms / slowest) * 100),
      color: latencyColor(r.ms),
    }
  })

  const trend: SeriesPoint[] = rounds.flatMap((round) => {
    const ms = round.results.flatMap((r) => (r.k === 'ok' ? [r.ms] : []))
    if (ms.length === 0) return []
    const m = Math.round(median(ms))
    return [{ x: round.at, y: m, label: clock(round.at), value: `${m} ms` }]
  })

  const liveChains = data.networks.filter((c) => c.deployed).length
  const coverage: DonutSegment[] = [
    { name: 'Latch deployed', pct: (liveChains / data.networks.length) * 100, color: 'primary' },
    {
      name: 'Supported, not deployed',
      pct: ((data.networks.length - liveChains) / data.networks.length) * 100,
      color: 'violet',
    },
  ]

  return (
    <div className="dapp-stack">
      <div className="dapp-grid dapp-grid--settings">
        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel">APPEARANCE</h2>
          <div className="dapp-pref set-row">
            <span className="dapp-pref__copy">
              <span className="dapp-pref__name">Theme</span>
              <span className="dapp-pref__hint">Light, dark, or match your system.</span>
            </span>
            <ThemeToggle showLabels />
          </div>
        </section>

        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel">NETWORK</h2>
          <div className="dapp-pref set-row set-net">
            <ChainMark brand={ACTIVE_CHAIN_ROW.brand} size={28} className="dapp-netchip__mark" />
            <span className="dapp-pref__copy">
              <span className="dapp-pref__name">{ACTIVE_CHAIN_ROW.name}</span>
              <span className="dapp-pref__hint tabular">Chain ID {ACTIVE_CHAIN_ROW.chainId}</span>
            </span>
            <span className="dapp-badge dapp-badge--ok set-push">LIVE</span>
          </div>
          <p className="dapp-pref__hint set-gap">
            Contract addresses are listed in the <Link to="/docs#contracts">docs</Link>.
          </p>
        </section>
        <section className="dapp-card dapp-card--donut set-coverage">
          <Donut
            segments={coverage}
            label="Supported chains with and without a Latch deployment"
            unit="of supported chains"
            selected={slice}
            onSelect={setSlice}
          />
          <div className="dapp-card__donut-body">
            <h2 className="dapp-microlabel">CHAIN COVERAGE</h2>
            <p className="dapp-kpi__value tabular">
              {liveChains} <span className="set-of">of {data.networks.length} chains</span>
            </p>
            <DonutLegend segments={coverage} unit="of supported chains" selected={slice} onSelect={setSlice} />
          </div>
        </section>
      </div>

      <section className="dapp-card" aria-live="polite">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">CONNECTION</h2>
          <div className="set-actions">
            <button
              type="button"
              className="dapp-btn dapp-btn--sm"
              aria-pressed={live}
              onClick={() => setLive((v) => !v)}
            >
              <span className={live ? 'dapp-dot set-dot is-live' : 'dapp-dot set-dot'} aria-hidden="true" />
              {live ? 'Live' : 'Paused'}
            </button>
            <button
              type="button"
              className="dapp-btn dapp-btn--sm"
              onClick={() => void run()}
              disabled={busy}
              data-busy={busy ? 'true' : undefined}
            >
              {busy ? 'Measuring…' : 'Measure now'}
            </button>
          </div>
        </div>

        <div className="dapp-kpis set-kpis">
          <div>
            <p className="dapp-microlabel">HEAD BLOCK</p>
            <p className="dapp-kpi__value" key={head?.toString() ?? 'none'}>
              <span className="set-tick">{head === null ? '—' : head.toLocaleString()}</span>
            </p>
          </div>
          <div>
            <p className="dapp-microlabel">FASTEST</p>
            <p className="dapp-kpi__value">{fastest ? `${Math.round(fastest.ms)} ms` : '—'}</p>
            <p className="dapp-kpi__sub">{fastest ? endpoints[fastest.i]?.label : 'waiting for a reading'}</p>
          </div>
          <div>
            <p className="dapp-microlabel">ANSWERING</p>
            <p className="dapp-kpi__value tabular">
              {latest ? `${okLatest.length} / ${endpoints.length}` : '—'}
            </p>
            <p className="dapp-kpi__sub">{latest ? `measured ${clock(latest.at)}` : 'measuring…'}</p>
          </div>
        </div>

        <div className="set-charts">
          <div>
            <p className="dapp-microlabel dapp-microlabel--tight">RESPONSE TIME</p>
            <BarList items={bars} valueLabel="Round trip" shareLabel="of the slowest answer" />
          </div>
          <div>
            <p className="dapp-microlabel dapp-microlabel--tight">MEDIAN OVER TIME</p>
            <SeriesChart
              points={trend}
              label="Median endpoint response time per measurement"
              valueLabel="Median round trip"
              color="primary"
              area
              empty={live ? 'The trend appears after the second measurement, 30 seconds from the first.' : 'Paused. Press Measure now to add a reading.'}
            />
          </div>
        </div>
        <p className="dapp-note">
          Measured from your browser with one <code>eth_blockNumber</code> call per endpoint. Your
          connection is part of every number.
        </p>
      </section>


    </div>
  )
}

/* ============================================================================
   Pool Detail.

   The header used to read `$0.6M TVL · $0.4M volume 24h · 8K hook calls ·
   DynamicFeeLatch attached · Base`. Every one of those was invented, and Base
   is not a chain this protocol is deployed on. The fee chart below it plotted a
   fabricated 24-hour series against a fabricated volatility index.

   All of it is gone. What replaces it is what the chain actually says: the pool
   record from the CL pool manager's own Initialize log, the vault's real token
   balances, and the real swap count. The numbers are small because this is a
   testnet with one pool and a handful of swaps — that is the honest picture, and
   Analytics already established that showing it beats showing invented millions.

   THE 24-HOUR FEE SERIES IS NOT REPLACED BY A PRETTIER 24-HOUR FEE SERIES. A
   fee-over-time chart needs time, and time here would have to be inferred from
   block height. What replaces it is indexed by the thing that was actually
   measured: swaps through THIS pool, counted against the block each landed in.
   Every point is a reading; the line never passes between two of them, and it
   refuses to draw at all below two points rather than implying a shape from
   one. That is the pattern Analytics settled on for exactly this case.
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  DEPLOYMENTS,
  explorerAddress,
  formatUnits,
  readPools,
  readRecentSwaps,
  readVaultHoldings,
  type PoolRecord,
  type SwapRecord,
  type VaultHolding,
} from '../../../lib/chain'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { PoolPriceCard } from '../components/PoolPriceCard.tsx'
import { Methodology } from '../components/ProtocolCharts.tsx'
import { SeriesChart, StackedBar, type SeriesPoint } from '../components/series-charts.tsx'
import { useDapp } from '../state.tsx'
import { dappPath } from '../paths.ts'

/**
 * `readProtocolMetrics` is deliberately NOT one of these reads any more.
 *
 * Its `swapCount` is protocol-wide, and this screen was printing it under a
 * heading naming one pool. On a one-pool deployment the two agree, which is
 * exactly why it went unnoticed — the second pool would have made every figure
 * on this page quietly wrong. Swap logs carry the pool id, so the count, the
 * series and the fee split below are all filtered to THIS pool.
 */
interface Loaded {
  readonly pool: PoolRecord | undefined
  readonly holdings: readonly VaultHolding[]
  /** Every Swap log on the CL manager. Filtered to this pool by the screen. */
  readonly swaps: readonly SwapRecord[]
}

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; d: Loaded }

const ZERO = '0x0000000000000000000000000000000000000000'

function pctFromPips(pips: number): string {
  return `${(pips / 10_000).toFixed(2)}%`
}

export default function PoolDetail() {
  const { browsingChain } = useDapp()
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    setState({ k: 'loading' })
    Promise.all([
      readPools(browsingChain),
      readVaultHoldings(browsingChain),
      readRecentSwaps(browsingChain, 5000),
    ])
      .then(([pools, holdings, swaps]) => {
        if (off) return
        // Prefer the deployment's named pool; fall back to the first one that
        // exists, so this screen is not empty on a chain configured differently.
        // A chain with no named pool (mainnet, until one is initialised) just
        // takes whatever the chain actually has — which may be nothing.
        const named = DEPLOYMENTS[browsingChain].demoPool
        const target = named === null ? null : named.id.toLowerCase()
        const pool =
          (target === null ? undefined : pools.find((p) => p.id.toLowerCase() === target)) ??
          pools[0]
        setState({ k: 'ready', d: { pool, holdings, swaps } })
      })
      .catch((e) =>
        !off &&
        setState({
          k: 'error',
          message: e instanceof Error ? e.message : 'chain unreachable',
        }),
      )
    return () => {
      off = true
    }
  }, [browsingChain])

  const d = DEPLOYMENTS[browsingChain]

  if (state.k !== 'ready') {
    return (
      <section className="dapp-card" role="status">
        <h2 className="dapp-card__title">
          {state.k === 'loading' ? 'Reading the pool…' : 'Could not reach the chain'}
        </h2>
        <p className={`live-note${state.k === 'error' ? ' live-note--err' : ''}`}>
          {state.k === 'loading'
            ? `Reading pool state, vault balances and swap history from ${d.name}.`
            : `${state.message}. Nothing shown rather than placeholder figures.`}
        </p>
      </section>
    )
  }

  const { pool, holdings, swaps } = state.d

  if (!pool) {
    return (
      <section className="dapp-card">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">POOL DETAIL</h2>
          <ChainTag chainId={browsingChain} />
        </div>
        <div className="an-empty">
          <p className="an-empty__title">No pools initialized</p>
          <p className="live-note">
            The CL pool manager on {d.name} has emitted no Initialize event since deployment at
            block {d.deployedAtBlock.toString()}. Shown empty rather than filled with an example
            pair.
          </p>
        </div>
      </section>
    )
  }

  const hooked = pool.hooks !== ZERO
  /* Scoped to THIS pool. Swap logs carry the pool id, so there is no reason to
     show a protocol-wide count under a heading that names one pair. */
  const poolSwaps = swaps.filter((s) => s.poolId.toLowerCase() === pool.id.toLowerCase())
  /* Symbols come from the deployment record, which only has them for a named
     pool. Falling back to the chain's own pool id is honest: it says "this is
     the pool" without inventing a ticker for tokens nobody has named here. */
  const pair =
    d.demoPool === null
      ? `Pool ${pool.id.slice(0, 10)}…`
      : `${d.demoPool.symbol0} / ${d.demoPool.symbol1}`

  return (
    <>
      <section className="dapp-pool-head">
        <span className="dapp-pair" aria-hidden="true">
          <span className="dapp-pair__token" />
          <span className="dapp-pair__token dapp-pair__token--alt" />
        </span>
        <div>
          <h2 className="dapp-pool-head__pair">
            {pair} · {pctFromPips(pool.lpFeePips)}
          </h2>
          <p className="dapp-pool-head__attach">
            {hooked ? (
              <>
                Latch{' '}
                <a
                  href={explorerAddress(pool.chainId, pool.hooks)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {pool.hooks.slice(0, 10)}…
                </a>{' '}
                attached
              </>
            ) : (
              'No Latch attached — a plain pool'
            )}
            {' · '}
            <ChainTag chainId={pool.chainId} size={13} />
          </p>
        </div>

        {/* Token units, never dollars: ltUSD and ltETH are unpriced testnet
            tokens, and inventing a price to produce a dollar headline is the
            failure this screen replaced. */}
        <dl className="dapp-pool-stats">
          <div className="dapp-pool-stat">
            <dt className="dapp-stat__label">LP FEE</dt>
            <dd className="dapp-pool-stat__value">{pctFromPips(pool.lpFeePips)}</dd>
          </div>
          <div className="dapp-pool-stat">
            <dt className="dapp-stat__label">SWAPS · THIS POOL</dt>
            <dd className="dapp-pool-stat__value">{poolSwaps.length.toLocaleString('en-US')}</dd>
          </div>
          {holdings.map((h) => (
            <div key={h.token} className="dapp-pool-stat">
              <dt className="dapp-stat__label">VAULT · {h.symbol}</dt>
              <dd className="dapp-pool-stat__value">{formatUnits(h.balance, h.decimals, 2)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <PoolPriceCard />

      <div className="dapp-row dapp-row--pool">
        <PoolActivityCard pool={pool} swaps={poolSwaps} holdings={holdings} hooked={hooked} />

        <section className="dapp-card">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">POOL FACTS</h2>
            <ChainTag chainId={pool.chainId} size={13} />
          </div>
          <dl className="live-grid">
            <div>
              <dt>Pool id</dt>
              <dd className="tabular">{pool.id.slice(0, 14)}…</dd>
            </div>
            <div>
              <dt>Created at block</dt>
              <dd className="tabular">{pool.createdAtBlock.toString()}</dd>
            </div>
            <div>
              <dt>currency0</dt>
              <dd>
                <a
                  href={explorerAddress(pool.chainId, pool.currency0)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {d.demoPool === null
                    ? `${pool.currency0.slice(0, 10)}…`
                    : d.demoPool.symbol0}{' '}
                  ↗
                </a>
              </dd>
            </div>
            <div>
              <dt>currency1</dt>
              <dd>
                <a
                  href={explorerAddress(pool.chainId, pool.currency1)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {d.demoPool === null
                    ? `${pool.currency1.slice(0, 10)}…`
                    : d.demoPool.symbol1}{' '}
                  ↗
                </a>
              </dd>
            </div>
          </dl>
          <p className="live-note">
            Read from the CL pool manager&rsquo;s own Initialize log — what the pool was created
            with.
          </p>
          <p className="dapp-note">
            <Link to={dappPath('analytics')}>Protocol-wide activity →</Link>
          </p>
        </section>
      </div>
    </>
  )
}

/* ============================================================================
   Swaps through this pool, and where their fees went.

   TWO CHARTS, TWO DIFFERENT QUESTIONS, BOTH FROM THE SAME LOGS.

   The series answers "has anybody used this pool", indexed by block because
   that is what a log carries. The stacked bars answer "who got the fee", one
   bar per token, because the protocol's slice and the LP's slice of a swap are
   amounts of the SAME token and add to exactly what was charged. A bar putting
   one token against another would need a price neither has.

   Both are filtered to this pool by `poolId`, which every Swap log carries.
   ============================================================================ */

interface FeeSide {
  readonly holding: VaultHolding
  readonly protocol: bigint
  readonly lp: bigint
}

const absBig = (v: bigint) => (v < 0n ? -v : v)

/**
 * Apportion each swap's fee from that swap's OWN pips.
 *
 * Reading the controller's current default instead would rewrite history the
 * moment a fee changed — the same rule `readProtocolMetrics` follows, kept
 * identical here so the two can never disagree about one pool.
 */
function feeSides(pool: PoolRecord, swaps: readonly SwapRecord[], holdings: readonly VaultHolding[]): FeeSide[] {
  const currencies = [pool.currency0, pool.currency1]
  const totals = [
    { protocol: 0n, lp: 0n },
    { protocol: 0n, lp: 0n },
  ]

  for (const s of swaps) {
    // The INPUT side is the positive delta: tokens flowing into the pool.
    const i = s.amount0 > 0n ? 0 : 1
    const gross = absBig(i === 0 ? s.amount0 : s.amount1)
    const total = (gross * BigInt(s.feePips)) / 1_000_000n
    const protocol = (gross * BigInt(s.protocolFeePips)) / 1_000_000n
    const side = totals[i]
    if (!side) continue
    side.protocol += protocol
    side.lp += total > protocol ? total - protocol : 0n
  }

  const out: FeeSide[] = []
  for (const [i, currency] of currencies.entries()) {
    const side = totals[i]
    if (!side || side.protocol + side.lp === 0n) continue
    /* Matched by ADDRESS, not by position. The holdings list is ordered by the
       deployment record's demo pool; a different pool's currency0 need not be
       the same token, and a symbol attached to the wrong balance is worse than
       no symbol. */
    const holding = holdings.find((h) => h.token.toLowerCase() === currency.toLowerCase())
    if (!holding) continue
    out.push({ holding, protocol: side.protocol, lp: side.lp })
  }
  return out
}

function PoolActivityCard({
  pool,
  swaps,
  holdings,
  hooked,
}: {
  pool: PoolRecord
  swaps: readonly SwapRecord[]
  holdings: readonly VaultHolding[]
  hooked: boolean
}) {
  /* Deduplicated by block: two swaps in one block are one reading of "4 swaps
     by block N", not two points sharing an x. */
  const points = useMemo<SeriesPoint[]>(() => {
    const blocks = swaps.map((s) => s.blockNumber).sort((a, b) => Number(a - b))
    const out: SeriesPoint[] = []
    let total = 0
    for (const [i, b] of blocks.entries()) {
      total += 1
      if (blocks[i + 1] === b) continue
      out.push({
        x: Number(b),
        y: total,
        label: `Block #${b.toLocaleString('en-US')}`,
        value: total.toLocaleString('en-US'),
      })
    }
    return out
  }, [swaps])

  const sides = useMemo(() => feeSides(pool, swaps, holdings), [pool, swaps, holdings])

  return (
    <section className="dapp-card">
      <div className="dapp-card__bar">
        <h2 className="dapp-microlabel">SWAPS THROUGH THIS POOL · BY BLOCK</h2>
        <span className="lr-badge">
          <span className="lr-dot" aria-hidden="true" />
          LIVE
        </span>
      </div>

      <SeriesChart
        points={points}
        area
        label={`Running total of swaps through pool ${pool.id.slice(0, 10)}, against the block each landed in`}
        valueLabel="swaps so far"
        empty={
          swaps.length === 0
            ? 'No swap has gone through this pool.'
            : `${swaps.length} swap${swaps.length === 1 ? '' : 's'}, in a single block. A line needs two readings, so none is drawn.`
        }
      />
      {points.length >= 2 && (
        <div className="dapp-axis">
          <span>#{(points[0]?.x ?? 0).toLocaleString('en-US')}</span>
          <span>running total · block height</span>
          <span>#{(points[points.length - 1]?.x ?? 0).toLocaleString('en-US')}</span>
        </div>
      )}

      <p className="live-note">
        {swaps.length.toLocaleString('en-US')} swap{swaps.length === 1 ? '' : 's'} at a flat{' '}
        {pctFromPips(pool.lpFeePips)} LP fee, fixed at initialization.
      </p>

      {sides.length > 0 && (
        <>
          <h3 className="dapp-microlabel" style={{ marginTop: 14 }}>
            WHERE THE FEES WENT
          </h3>
          {sides.map((s) => {
            const total = s.protocol + s.lp
            /* One floor, one remainder. Flooring both shares would leave the
               bar a basis point short, and a short bar is how StackedBar
               reports a split that genuinely does not add up. */
            const protocolBps = Number((s.protocol * 10_000n) / total)
            return (
              <StackedBar
                key={s.holding.token}
                total={10_000}
                unit={`of the ${s.holding.symbol} fees this pool charged`}
                label={`${s.holding.symbol} fees charged by this pool, split between the protocol and liquidity providers`}
                segments={[
                  {
                    name: `${s.holding.symbol} · protocol`,
                    amount: protocolBps,
                    value: formatUnits(s.protocol, s.holding.decimals, 6),
                    color: 'primary',
                  },
                  {
                    name: `${s.holding.symbol} · liquidity providers`,
                    amount: 10_000 - protocolBps,
                    value: formatUnits(s.lp, s.holding.decimals, 6),
                    color: 'violet',
                  },
                ]}
              />
            )
          })}
        </>
      )}

      <Methodology label="What these are read from, and what would change them">
        <p className="live-note">
          Every figure is a <code>Swap</code> log on the CL pool manager, filtered by this
          pool&rsquo;s id, with each swap&rsquo;s fee apportioned from its own <code>fee</code> and{' '}
          <code>protocolFee</code> fields rather than the controller&rsquo;s current default. Token
          units only — these tokens are unpriced. A Latch with a dynamic fee would move the LP rate
          per swap; this pool {hooked ? 'has one attached, shown above.' : 'has none attached.'}
        </p>
      </Methodology>
    </section>
  )
}

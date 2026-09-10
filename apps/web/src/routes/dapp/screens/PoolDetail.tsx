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

   THE FEE CHART IS NOT REPLACED WITH A DIFFERENT CHART. A 24-hour fee series
   needs 24 hours of fees; this deployment has a handful of swaps across a few
   blocks. Drawing any line through that would be the same lie in a new shape, so
   the section states the count and says why there is no series — the pattern
   Analytics settled on for exactly this case.
   ============================================================================ */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  DEPLOYMENTS,
  explorerAddress,
  formatUnits,
  readPools,
  readProtocolMetrics,
  readVaultHoldings,
  type PoolRecord,
  type ProtocolMetrics,
  type VaultHolding,
} from '../../../lib/chain'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { PoolPriceCard } from '../components/PoolPriceCard.tsx'
import { useDapp } from '../state.tsx'
import { dappPath } from '../paths.ts'

interface Loaded {
  readonly pool: PoolRecord | undefined
  readonly holdings: readonly VaultHolding[]
  readonly metrics: ProtocolMetrics
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
      readProtocolMetrics(browsingChain),
    ])
      .then(([pools, holdings, metrics]) => {
        if (off) return
        const target = DEPLOYMENTS[browsingChain].demoPool.id.toLowerCase()
        // Prefer the deployment's named pool; fall back to the first one that
        // exists, so this screen is not empty on a chain configured differently.
        const pool = pools.find((p) => p.id.toLowerCase() === target) ?? pools[0]
        setState({ k: 'ready', d: { pool, holdings, metrics } })
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

  const { pool, holdings, metrics } = state.d

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
  const pair = `${d.demoPool.symbol0} / ${d.demoPool.symbol1}`

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
            <dt className="dapp-stat__label">SWAPS · ALL TIME</dt>
            <dd className="dapp-pool-stat__value">{metrics.swapCount.toLocaleString('en-US')}</dd>
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
        <section className="dapp-card">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">FEE OVER TIME</h2>
            <span className="lr-badge">
              <span className="lr-dot" aria-hidden="true" />
              LIVE
            </span>
          </div>
          <div className="an-empty">
            <p className="an-empty__title">
              {metrics.swapCount === 0
                ? 'No swaps yet'
                : `Not enough history to plot — ${metrics.swapCount} swap${metrics.swapCount === 1 ? '' : 's'}`}
            </p>
            <p className="live-note">
              A fee-over-time series needs time. This pool charges a flat{' '}
              {pctFromPips(pool.lpFeePips)} LP fee, set at initialization and unchanged since; a
              line through {metrics.swapCount} swap
              {metrics.swapCount === 1 ? '' : 's'} would be a drawing, not a reading. The chart
              appears once there is a history to draw.
            </p>
            <p className="live-note">
              A Latch with a dynamic fee would move this number per swap. This pool
              {hooked ? ' has one attached — see the Latch above.' : ' has none attached.'}
            </p>
          </div>
        </section>

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
                  {d.demoPool.symbol0} ↗
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
                  {d.demoPool.symbol1} ↗
                </a>
              </dd>
            </div>
          </dl>
          <p className="live-note">
            Read from the CL pool manager&rsquo;s own Initialize log, so every field here is what
            the pool was actually created with.
          </p>
          <p className="dapp-note">
            <Link to={dappPath('analytics')}>Protocol-wide activity →</Link>
          </p>
        </section>
      </div>
    </>
  )
}

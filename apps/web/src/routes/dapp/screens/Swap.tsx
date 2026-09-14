/* ============================================================================
   Swap — the first screen in this dapp that can trade.

   Until now the dapp could read pools, read the registry and read revenue
   share, and could not buy or sell anything. Every contract needed was already
   live; what was missing was the calldata. It lives in `src/lib/swap.ts`, which
   carries the full derivation and the proof it was checked against chain.

   WHAT THIS SCREEN OWNS, AND WHAT IT DOES NOT. It owns the READS — one pass
   over `readSwapContext()` plus one `readHookTake()` per hooked pool — and the
   choice of which pool to trade. `<SwapPanel>` owns the trade itself, so the
   same panel can sit on a pool page later without this screen's chrome.

   THE POOL LIST IS DISCOVERED, NOT CONFIGURED. It comes from the CL pool
   manager's own `Initialize` logs, so a pool created after this build shipped
   appears without a code change, and a pool that does not exist cannot appear
   at all. Pools with no liquidity are LISTED and marked, not hidden — a reader
   looking for their pool deserves to be told why it cannot be traded rather
   than left to wonder where it went.

   FOUR STATES, VISUALLY DISTINCT. Reading, unreachable, empty and
   not-configured each have their own card and their own words, reusing the
   revenue-share surface's vocabulary so the dapp says these four things the
   same way everywhere. None of them shows a number.

   NO DOLLAR FIGURES ANYWHERE. The pools on this chain are unpriced test
   tokens. Amounts are token units with a symbol.
   ============================================================================ */

import { useCallback, useMemo, useState } from 'react'

import { DEPLOYMENTS } from '../../../lib/chain'
import {
  ROUTER,
  SWAP_CHAIN_ID,
  explorerAddressUrl,
  pipsPct,
  readHookTake,
  readSwapContext,
  shortHex,
  type HookTake,
  type SwapContext,
  type SwapPool,
} from '../../../lib/swap'
import { SwapPanel } from '../components/SwapPanel'
import { Empty, Reading, Unreachable } from '../lib/revshareParts'
import { useChainRead } from '../lib/useChainRead'

const CHAIN = DEPLOYMENTS[SWAP_CHAIN_ID]

interface SwapScreenData {
  context: SwapContext
  /** Keyed by pool id. Absent means the pool has no hook at all. */
  hooks: Record<string, HookTake>
}

async function loadSwapScreen(): Promise<SwapScreenData> {
  const context = await readSwapContext()

  /* One hook read per HOOKED pool, and none for the rest. A pool with no hook
     is not a pool whose hook takes nothing — it is a pool with no hook, and the
     panel says those two things differently. */
  const hooked = context.pools.filter((p) => p.hasHook)
  const takes = await Promise.all(
    /* The hook's own clock, not the RPC head: on Robinhood the hook stores
       Ethereum block numbers, and against the L2 head every queued proposal
       read as armed or expired. */
    hooked.map((p) =>
      readHookTake(p.hooks, p.poolId, { timestamp: context.timestamp, contractBlockNumber: context.contractBlockNumber }),
    ),
  )

  const hooks: Record<string, HookTake> = {}
  hooked.forEach((p, i) => {
    const take = takes[i]
    if (take) hooks[p.poolId] = take
  })

  return { context, hooks }
}

export default function Swap() {
  const { state, reload } = useChainRead<SwapScreenData>('swap', loadSwapScreen)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const data = state.k === 'ready' ? state.data : null

  /* Default to the first pool that can actually be traded, not simply the
     first pool. Landing on a dead pool and having to work out why is a worse
     first impression than landing on the one live one. */
  const selected: SwapPool | null = useMemo(() => {
    if (!data) return null
    const { pools } = data.context
    if (selectedId !== null) return pools.find((p) => p.poolId === selectedId) ?? null
    return pools.find((p) => p.liquidity > 0n) ?? pools[0] ?? null
  }, [data, selectedId])

  const onSelect = useCallback((id: string) => setSelectedId(id), [])

  if (state.k === 'idle' || state.k === 'loading') {
    return <Reading what="pools, fees and router state" />
  }

  if (state.k === 'error') {
    return <Unreachable message={state.message} kind={state.kind} onRetry={reload} />
  }

  if (!data) return <Reading what="pools, fees and router state" />

  const { context, hooks } = data

  if (context.pools.length === 0) {
    return (
      <Empty title={`No pools have been initialized on ${context.chainName}`}>
        <p>
          The CL pool manager has emitted no <code>Initialize</code> events since block{' '}
          {CHAIN.deployedAtBlock.toString()}. There is nothing to trade — not a zero-volume pool, no
          pool at all. The router at{' '}
          <a className="hx-addr" href={explorerAddressUrl(ROUTER)} target="_blank" rel="noopener noreferrer">
            {shortHex(ROUTER)}
          </a>{' '}
          is deployed and waiting.
        </p>
      </Empty>
    )
  }

  return (
    /* THE SWAP CARD COMES FIRST, in DOM order and in the layout.
       It used to sit under a full-width pool panel whose explanatory note ran
       to five lines, which put the only action on this screen below the fold.
       On a wide viewport the two sit side by side; narrow stacks them, and the
       trade is still first. */
    <div className="swap-screen">
      {selected ? (
        <SwapPanel
          context={context}
          pool={selected}
          hook={hooks[selected.poolId] ?? null}
          /* A confirmed trade invalidates liquidity, slot0 and the hook's
             pending config. Re-read them rather than leaving pre-trade state
             on screen under a confirmed transaction. */
          onTraded={reload}
        />
      ) : (
        <Empty title="No pool selected">
          <p>Pick a pool to quote a trade against it.</p>
        </Empty>
      )}

      <section className="dapp-card swap-screen__pools">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">POOLS ON {context.chainName.toUpperCase()}</h2>
          <span className="live-fee">
            head {context.blockNumber.toString()} · {context.pools.length}{' '}
            {context.pools.length === 1 ? 'pool' : 'pools'}
          </span>
        </div>
        <ul className="swap-pools">
          {context.pools.map((pool) => {
            const dead = pool.liquidity === 0n
            const isActive = selected?.poolId === pool.poolId
            return (
              <li key={pool.poolId}>
                <button
                  type="button"
                  className={isActive ? 'swap-pool is-active' : 'swap-pool'}
                  onClick={() => onSelect(pool.poolId)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className="swap-pool__pair">
                    {pool.token0.symbol} / {pool.token1.symbol}
                  </span>
                  <span className="swap-pool__meta">
                    {pipsPct(pool.lpFeePips)} · spacing {pool.tickSpacing} ·{' '}
                    {pool.hasHook ? 'Latch attached' : 'no hook'}
                  </span>
                  {/* The raw `uint128`, ungrouped except by locale separators.
                      It is NOT a token balance and has no decimals of its own —
                      dividing it by 1e18 to make it read like an amount would
                      be inventing a unit the contract does not have. */}
                  <span className={dead ? 'swap-pool__state is-dead' : 'swap-pool__state'}>
                    {dead ? 'no liquidity' : `L ${pool.liquidity.toLocaleString('en-US')}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {/* PROVENANCE STAYS VISIBLE. CLAUDE.md is explicit that "summed from
            logs since block N" is not a caveat to be tidied away — it is the
            difference between a total and an estimate. So the source line is
            always on screen; only the explanation of what `L` is and is not
            moves behind the disclosure, because that part is a definition
            rather than a provenance claim. */}
        <p className="dapp-note">
          Read from <code>CLPoolManager.Initialize</code> logs since block{' '}
          {CHAIN.deployedAtBlock.toString()}, then <code>getSlot0</code> and{' '}
          <code>getLiquidity</code> per pool.
        </p>
        <details className="swap-screen__what-is-l">
          <summary>What L is, and what it is not</summary>
          <p className="dapp-note">
            <code>L</code> is the in-range liquidity the manager reports, printed as the raw{' '}
            <code>uint128</code> it is: a curve parameter, not a token balance, with no decimals
            of its own. It is not a TVL and it is not money. Nothing on this chain prices these
            tokens, so no figure here is in dollars.
          </p>
        </details>
      </section>
    </div>
  )
}

/* ============================================================================
   Live chain state, as four cards rather than one wall.

   WHAT CHANGED AND WHY. This was a single `dk-card` stacking chain status,
   registry governance, vault holdings and recent swaps under `<h3>` rules —
   four unrelated readings sharing one container, above the KPI tiles, so the
   dashboard opened on a debug dump. Three specific failures:

     · No containment. Sections were text runs separated by headings, so
       nothing on the page had visual weight except by accident.
     · Label left, value hard right, across the full 1250px content column. A
       token symbol and its balance ended up 1,200px apart — technically a
       definition list, practically unreadable.
     · Wrong order. Raw rows came first and the actual dashboard — tiles and
       charts — came after.

   Now each reading is a `dapp-card`, the same primitive the marketplace and
   the pool-owner panel use, so the dapp has one card language instead of two.

   ONE FETCH, NOT FOUR. The cards are separate components but share a single
   `useLiveChain()` call made once by the parent and passed down. Four cards
   each running their own `useEffect` would be four parallel RPC storms on
   mount and four independent failure states for one underlying question.

   On failure it says so and shows nothing. A dashboard that silently falls
   back to placeholders when the chain is unreachable is worse than one that
   admits it — the reader cannot tell the difference, and that is exactly when
   they would most want to.
   ============================================================================ */

import { useEffect, useState } from 'react'

import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  explorerAddress,
  explorerTx,
  formatUnits,
  readGovernanceStatus,
  readProtocolStatus,
  readRecentSwaps,
  readVaultHoldings,
  splitFee,
  type GovernanceStatus,
  type ProtocolStatus,
  type SwapRecord,
  type VaultHolding,
} from '../../../lib/chain'

interface LiveData {
  status: ProtocolStatus
  holdings: VaultHolding[]
  swaps: SwapRecord[]
  gov: GovernanceStatus
}

type State = { k: 'loading' } | { k: 'error'; message: string } | { k: 'ready'; d: LiveData }

const D = DEPLOYMENTS[SEPOLIA_CHAIN_ID]

function useLiveChain(): State {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [status, holdings, swaps, gov] = await Promise.all([
          readProtocolStatus(),
          readVaultHoldings(),
          readRecentSwaps(SEPOLIA_CHAIN_ID, 5),
          readGovernanceStatus(),
        ])
        if (!cancelled) setState({ k: 'ready', d: { status, holdings, swaps, gov } })
      } catch (e) {
        if (!cancelled) {
          setState({
            k: 'error',
            message: e instanceof Error ? e.message : 'Could not reach the chain.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/* --------------------------------------------------------------------------
   Shared pieces
   -------------------------------------------------------------------------- */

/** A card that owns its loading and error states so no caller repeats them. */
function LiveCard({
  title,
  state,
  badge,
  note,
  children,
}: {
  title: string
  state: State
  badge?: string
  note?: React.ReactNode
  children: (d: LiveData) => React.ReactNode
}) {
  return (
    <section className="dapp-card lc-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">{title}</h2>
        {badge !== undefined && (
          <span className="lc-live">
            <span className="dapp-dot dapp-dot--success" aria-hidden="true" />
            {badge}
          </span>
        )}
      </div>

      {state.k === 'loading' && (
        <p className="live-note" role="status">
          Reading contracts&hellip;
        </p>
      )}
      {state.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          Could not read the chain: {state.message}. No figures shown rather than stale ones.
        </p>
      )}
      {state.k === 'ready' && (
        <>
          {children(state.d)}
          {note}
        </>
      )}
    </section>
  )
}

/**
 * A label over its value, not beside it.
 *
 * The old layout put them at opposite ends of the content column. Stacking
 * inside a narrow card keeps the pair within a few characters of each other,
 * which is the only reason a scan works.
 */
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="lc-stat">
      <dt className="dapp-microlabel">{label}</dt>
      <dd className="lc-stat__v">
        {value}
        {sub !== undefined && <span className="lc-stat__sub">{sub}</span>}
      </dd>
    </div>
  )
}

/** A row inside a card: name on the left, figure on the right, one card wide. */
function Row({
  href,
  name,
  value,
  mono = true,
}: {
  href: string
  name: string
  value: string
  mono?: boolean
}) {
  return (
    <li className="lc-row">
      <a href={href} target="_blank" rel="noopener noreferrer" className="lc-row__name" data-hit>
        {name}
      </a>
      <span className={mono ? 'lc-row__v tabular' : 'lc-row__v'}>{value}</span>
    </li>
  )
}

/* --------------------------------------------------------------------------
   The four cards
   -------------------------------------------------------------------------- */

export function ChainStatusCard({ state }: { state: State }) {
  return (
    <LiveCard title={`Live on ${D.name}`} state={state} badge="ON CHAIN">
      {(d) => (
        <dl className="lc-stats">
          <Stat label="BLOCK" value={<span className="tabular">{d.status.blockNumber.toString()}</span>} />
          <Stat
            label="PROTOCOL FEE"
            value={<span className="tabular">{(d.status.defaultFeePips / 10_000).toFixed(2)}%</span>}
            sub={`of ${(d.status.maxFeePips / 10_000).toFixed(1)}% cap`}
          />
          <Stat
            label="POOL MANAGERS"
            value={d.status.clRegistered && d.status.binRegistered ? 'CL + Bin' : 'not registered'}
          />
          <Stat label="FEES" value={d.status.feesDisabled ? 'DISABLED' : 'Active'} />
        </dl>
      )}
    </LiveCard>
  )
}

export function GovernanceCard({ state }: { state: State }) {
  return (
    <LiveCard
      title="Registry &amp; governance"
      state={state}
      note={
        <p className="live-note lc-note">
          Timelocks are deployed and enforce their floors. On Sepolia the Vault is still owned by an
          EOA, so it stays iterable — that transfer is the last thing standing between here and
          mainnet.
        </p>
      }
    >
      {(d) => (
        <dl className="lc-stats">
          <Stat
            label="LATCHES LISTED"
            value={<span className="tabular">{d.gov.hookCount.toString()}</span>}
            sub={d.gov.hookCount === 0n ? 'none listed yet' : 'read from the registry'}
          />
          <Stat
            label="CUSTODY DELAY"
            value={<span className="tabular">{Number(d.gov.custodyDelaySec) / 3600}h</span>}
            sub="Vault + managers"
          />
          <Stat
            label="POLICY DELAY"
            value={<span className="tabular">{Number(d.gov.policyDelaySec) / 3600}h</span>}
            sub="fee policy"
          />
          <Stat
            label="REGISTRY"
            value={
              <a
                href={explorerAddress(SEPOLIA_CHAIN_ID, d.gov.registry)}
                target="_blank"
                rel="noopener noreferrer"
                className="lc-link"
                data-hit
              >
                View contract
              </a>
            }
          />
        </dl>
      )}
    </LiveCard>
  )
}

export function VaultHoldingsCard({ state }: { state: State }) {
  return (
    <LiveCard
      title="Vault holdings"
      state={state}
      note={
        <p className="live-note lc-note">
          The Vault custodies every token; pool managers hold nothing. These balances are the
          protocol&rsquo;s TVL. No dollar figure — ltUSD and ltETH are testnet tokens nothing prices.
        </p>
      }
    >
      {(d) =>
        d.holdings.length === 0 ? (
          <p className="live-note">The Vault holds no tracked tokens on this deployment.</p>
        ) : (
          <ul className="lc-rows">
            {d.holdings.map((h) => (
              <Row
                key={h.token}
                href={explorerAddress(SEPOLIA_CHAIN_ID, h.token)}
                name={h.symbol}
                value={formatUnits(h.balance, h.decimals, 4)}
              />
            ))}
          </ul>
        )
      }
    </LiveCard>
  )
}

export function RecentSwapsCard({ state }: { state: State }) {
  return (
    <LiveCard title="Recent swaps" state={state}>
      {(d) =>
        d.swaps.length === 0 ? (
          <p className="live-note">No swaps recorded on this deployment yet.</p>
        ) : (
          <ul className="lc-rows">
            {d.swaps.map((s) => {
              const { lpPips } = splitFee(s.feePips, s.protocolFeePips)
              return (
                <Row
                  key={s.txHash}
                  href={explorerTx(SEPOLIA_CHAIN_ID, s.txHash)}
                  name={`Block ${s.blockNumber.toString()}`}
                  value={`${s.feePips} pips · ${s.protocolFeePips} protocol + ${lpPips} LP`}
                />
              )
            })}
          </ul>
        )
      }
    </LiveCard>
  )
}

/**
 * The four cards in a grid, sharing one read.
 *
 * Kept as a single export so the dashboard mounts one thing and the fetch
 * stays singular. The cards are exported individually as well, for any screen
 * that wants one without the rest.
 */
export function LiveChainPanel() {
  const state = useLiveChain()

  return (
    <div className="lc-grid">
      <ChainStatusCard state={state} />
      <GovernanceCard state={state} />
      <VaultHoldingsCard state={state} />
      <RecentSwapsCard state={state} />
    </div>
  )
}

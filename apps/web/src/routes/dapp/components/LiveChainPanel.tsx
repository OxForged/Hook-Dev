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

   THREE OF THE FOUR CARDS NOW DRAW WHAT THEY USED TO STATE. Each chart is fed
   by a reading the card was already making, and each one says something a bare
   figure cannot:

     · The protocol fee against `MAX_PROTOCOL_FEE`. "0.30%" does not tell you
       how much room is left; a gauge against a ceiling that is a constant in
       deployed code does.
     · A token's Vault balance against the CL pool manager's reserve in it.
       Both sides are the SAME token, which is the only reason the comparison
       is legitimate — nothing prices these tokens, so a chart comparing one
       token's balance to another's would need a rate that does not exist.
     · A swap's fee, split. `protocolFee` and the remainder are both shares of
       the same input amount and add to exactly `fee`, so the bar cannot be
       short or renormalised.
   ============================================================================ */

import { useEffect, useState } from 'react'

import { Gauge, StackedBar } from './series-charts.tsx'
import { Methodology } from './ProtocolCharts.tsx'
import {
  DEPLOYMENTS,
  ACTIVE_CHAIN_ID,
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

const D = DEPLOYMENTS[ACTIVE_CHAIN_ID]

function useLiveChain(): State {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [status, holdings, swaps, gov] = await Promise.all([
          readProtocolStatus(),
          readVaultHoldings(),
          readRecentSwaps(ACTIVE_CHAIN_ID, 5),
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

/** pips of PIPS_DENOMINATOR (1e6) as a percentage. 4000 pips → "0.4%". */
const pipsPct = (pips: number, places = 2) => `${(pips / 10_000).toFixed(places)}%`

export function ChainStatusCard({ state }: { state: State }) {
  return (
    <LiveCard title={`Live on ${D.name}`} state={state} badge="ON CHAIN">
      {(d) => (
        <>
          {/* WHAT THIS GAUGE MUST NOT DO IS READ `DEFAULT_FEE_PIPS`.

              It used to, and the result was two true statements contradicting
              each other on one screen: this card said the protocol fee was
              0.10%, while the activity feed a few hundred pixels away read
              "3000 pips total · 0 to protocol" on every swap. The feed was
              right. `DEFAULT_FEE_PIPS` is a constant compiled into the
              controller, and the controller is only in force if a pool manager
              points at it — `CLPoolManager.protocolFeeController()` reads
              address(0) on Robinhood today, so nothing charges anything.

              `effectiveFeePips` is what a pool initialized right now would
              actually pay: zero unless the controller is BOTH wired and not
              disabled. The unwired case is called out rather than shown as a
              tidy zero, because "no fee" and "no fee YET" are different
              readings and only one of them is a decision. */}
          <Gauge
            value={d.status.effectiveFeePips}
            max={d.status.maxFeePips}
            label="Protocol fee actually charged, against the protocol fee cap"
            valueText={pipsPct(d.status.effectiveFeePips)}
            maxText={pipsPct(d.status.maxFeePips, 1)}
            color={d.status.effectiveFeePips === 0 ? 'success' : 'primary'}
            caption={
              !d.status.controllerWired ? (
                <>
                  Nothing is taken: no pool manager points at the fee
                  controller, so its {pipsPct(d.status.configuredFeePips)} default is not in
                  force.
                </>
              ) : d.status.feesDisabled ? (
                <>
                  Nothing is taken: the guardian has fees <strong>disabled</strong>. The
                  configured default is {pipsPct(d.status.configuredFeePips)}.
                </>
              ) : (
                <>
                  of <code>MAX_PROTOCOL_FEE</code>, the cap compiled into core.
                </>
              )
            }
          />
          <dl className="lc-stats" style={{ marginTop: 12 }}>
            <Stat label="BLOCK" value={<span className="tabular">{d.status.blockNumber.toString()}</span>} />
            <Stat
              label="POOL MANAGERS"
              value={d.status.clRegistered && d.status.binRegistered ? 'CL + Bin' : 'not registered'}
            />
            <Stat label="FEES" value={d.status.feesDisabled ? 'DISABLED' : 'Active'} />
          </dl>
        </>
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
          Delays are read from the timelocks. Owning something is a separate question — the
          Governance screen reads every <code>owner()</code> live.
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
                href={explorerAddress(ACTIVE_CHAIN_ID, d.gov.registry)}
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

/**
 * One token's Vault balance, split by what the CL pool manager has reserved.
 *
 * Shares are computed in basis points with bigint arithmetic and the bar is
 * given a total of 10,000 — converting two 18-decimal balances to doubles first
 * would round the split before drawing it.
 *
 * A reserve LARGER than the balance is not clamped into a full bar. It would
 * mean the Vault owes an app more of a token than it holds, which is the single
 * most important thing this card could report, so it is reported in words.
 */
function HoldingSplit({ h }: { h: VaultHolding }) {
  const amount = formatUnits(h.balance, h.decimals, 4)

  if (h.balance === 0n) {
    return (
      <p className="live-note">
        {h.symbol}: the Vault holds none, so there is no balance to split.
      </p>
    )
  }
  if (h.clReserve > h.balance) {
    return (
      <p className="live-note live-note--err">
        {h.symbol}: <code>reservesOfApp</code> ({formatUnits(h.clReserve, h.decimals, 4)}) exceeds
        the Vault&rsquo;s balance ({amount}). Not drawn — a bar past its own total would hide the
        discrepancy rather than show it.
      </p>
    )
  }

  /* The reserve's share is floored; the remainder takes whatever is left of
     10,000 rather than being floored too. Two floors would leave the bar a
     basis point short, and `StackedBar` draws a shortfall as an unallocated
     sliver — which is the right behaviour for a split that genuinely does not
     add up, and a lie about one that does. Both `value` strings stay exact. */
  const bps = (v: bigint) => Number((v * 10_000n) / h.balance)
  const reserveBps = bps(h.clReserve)
  const rest = h.balance - h.clReserve

  return (
    <StackedBar
      total={10_000}
      unit={`of the Vault's ${h.symbol}`}
      label={`${h.symbol}: ${amount} held by the Vault, of which the CL pool manager has reserved ${formatUnits(h.clReserve, h.decimals, 4)}`}
      segments={[
        {
          name: `${h.symbol} · CL pool manager`,
          amount: reserveBps,
          value: formatUnits(h.clReserve, h.decimals, 4),
          color: 'primary',
        },
        {
          name: `${h.symbol} · unreserved`,
          amount: 10_000 - reserveBps,
          value: formatUnits(rest, h.decimals, 4),
          color: 'violet',
        },
      ]}
    />
  )
}

export function VaultHoldingsCard({ state }: { state: State }) {
  return (
    <LiveCard
      title="Vault holdings"
      state={state}
      note={
        <Methodology label="Why token units and why this split">
          <p className="live-note">
            The Vault custodies every token and the pool managers hold nothing, so these balances
            are the protocol&rsquo;s TVL. No dollar figure: the pool tokens are unpriced, which is
            also why each bar splits a token against ITSELF —{' '}
            <code>reservesOfApp(clPoolManager, token)</code> against{' '}
            <code>balanceOf(vault)</code> — rather than one token against another.
          </p>
        </Methodology>
      }
    >
      {(d) =>
        d.holdings.length === 0 ? (
          <p className="live-note">The Vault holds no tracked tokens on this deployment.</p>
        ) : (
          <>
            <ul className="lc-rows">
              {d.holdings.map((h) => (
                <Row
                  key={h.token}
                  href={explorerAddress(ACTIVE_CHAIN_ID, h.token)}
                  name={h.symbol}
                  value={formatUnits(h.balance, h.decimals, 4)}
                />
              ))}
            </ul>
            {d.holdings.map((h) => (
              <HoldingSplit key={`split-${h.token}`} h={h} />
            ))}
          </>
        )
      }
    </LiveCard>
  )
}

/**
 * The newest swap's fee, decomposed.
 *
 * The two segments are shares of the SAME input amount and add to exactly
 * `fee`, because `fee - protocolFee` is precisely the LP's share of the gross:
 * the protocol takes its cut first and the LP rate applies to the remainder, so
 * total = p + l − p·l/1e6 and total − p = l·(1 − p/1e6). Charting `protocolFee`
 * and `lpPips` side by side instead would sum past 100% of the fee and draw a
 * bar wider than its own total.
 */
function SwapFeeSplit({ s }: { s: SwapRecord }) {
  const { lpPips } = splitFee(s.feePips, s.protocolFeePips)
  const lpOfGross = s.feePips - s.protocolFeePips

  if (s.feePips === 0) {
    return <p className="live-note">The newest swap charged no fee, so there is nothing to split.</p>
  }

  return (
    <>
      <StackedBar
        total={s.feePips}
        unit="of the fee charged"
        label={`Newest swap, block ${s.blockNumber.toString()}: ${s.feePips} pips of the input, split between the protocol and liquidity providers`}
        segments={[
          {
            name: 'Protocol',
            amount: s.protocolFeePips,
            value: `${s.protocolFeePips} pips`,
            color: 'primary',
          },
          {
            name: 'Liquidity providers',
            amount: lpOfGross,
            value: `${lpOfGross} pips`,
            color: 'violet',
          },
        ]}
      />
      <p className="live-note" style={{ marginTop: 8 }}>
        Newest swap, block {s.blockNumber.toString()}: {s.feePips} pips of the input amount.
      </p>
      <Methodology label="Why the LP bar is not the LP rate">
        <p className="live-note">
          The pool&rsquo;s LP fee is {lpPips} pips, but it applies to what is left AFTER the
          protocol&rsquo;s {s.protocolFeePips}, so the LP&rsquo;s share of the gross input is{' '}
          {lpOfGross} pips. Both segments are shares of the same amount and add to exactly the{' '}
          {s.feePips} the <code>Swap</code> event reports.
        </p>
      </Methodology>
    </>
  )
}

export function RecentSwapsCard({ state }: { state: State }) {
  return (
    <LiveCard title="Recent swaps" state={state}>
      {(d) =>
        d.swaps.length === 0 || !d.swaps[0] ? (
          <p className="live-note">No swaps recorded on this deployment yet.</p>
        ) : (
          <>
            <ul className="lc-rows">
              {d.swaps.map((s) => {
                const { lpPips } = splitFee(s.feePips, s.protocolFeePips)
                return (
                  <Row
                    key={s.txHash}
                    href={explorerTx(ACTIVE_CHAIN_ID, s.txHash)}
                    name={`Block ${s.blockNumber.toString()}`}
                    value={`${s.feePips} pips · ${s.protocolFeePips} protocol + ${lpPips} LP`}
                  />
                )
              })}
            </ul>
            <SwapFeeSplit s={d.swaps[0]} />
          </>
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

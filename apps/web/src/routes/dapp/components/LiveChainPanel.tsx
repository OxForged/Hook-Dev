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

   READS ARE MADE ONCE BY THE PARENT and passed down, but they are no longer
   one fetch: see "INDEPENDENT READS" below for why a single Promise.all was
   the wrong shape.

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


/* INDEPENDENT READS, NOT ONE Promise.all (2026-09-14). The four cards used to
   share a single `Promise.all` over status, holdings, swaps and governance, so
   one slow log scan (recent swaps) failed or stalled ALL FOUR cards — including
   three that need nothing but a handful of `eth_call`s. Each reading now
   settles on its own, and each card shows its own loading, error and ready
   states. The shared `useChainRead` hook gives each one the failure KIND too,
   so a scan timeout is not reported as an unreachable chain.

   WHAT THE GOVERNANCE AND FEE CARDS CLAIM IS NOW READ, NOT ASSUMED:
     · "CUSTODY DELAY 48h · Vault + managers" was false while the Safe owned
       the Vault and both wrappers directly. The card reads `owner()` and
       `pendingOwner()` on each and names the actual holder.
     · "POLICY DELAY · fee policy" was false: the policy timelock holds only the
       position descriptor. The card lists what it actually owns.
     · "Protocol fee actually charged 0.10%" was the controller's quote for a NEW
       0.30% pool. Existing pools charge what their own `slot0.protocolFee`
       says, which is what the gauge now draws. */

import type { ReactNode } from 'react'

import { Gauge, StackedBar } from './series-charts.tsx'
import { Methodology } from './ProtocolCharts.tsx'
import {
  DEPLOYMENTS,
  ACTIVE_CHAIN_ID,
  explorerAddress,
  explorerTx,
  formatUnits,
  readCustodyStatus,
  readGovernanceStatus,
  readPoolProtocolFees,
  readProtocolStatus,
  readRecentSwaps,
  readVaultHoldings,
  splitFee,
  type CustodyStatus,
  type GovernanceStatus,
  type HeldContract,
  type HolderKind,
  type PoolProtocolFee,
  type ProtocolStatus,
  type ReadFailureKind,
  type SwapRecord,
  type VaultHolding,
} from '../../../lib/chain'
import { useChainRead, type ReadState } from '../lib/useChainRead'

const D = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/* --------------------------------------------------------------------------
   Shared pieces
   -------------------------------------------------------------------------- */

function failureLine(kind: ReadFailureKind, message: string): string {
  if (kind === 'scan-timeout') {
    return `The log scan did not finish in time (the chain answered; the scan ran out of budget): ${message}. No figures shown rather than partial ones.`
  }
  if (kind === 'transport') {
    return `${D.name} did not answer: ${message}. No figures shown rather than stale ones.`
  }
  return `Could not read this: ${message}. No figures shown rather than stale ones.`
}

/** A card that owns its loading and error states so no caller repeats them.
    The badge renders ONLY once the card's own reading is ready — a "LIVE" chip
    over an error message is a claim the card cannot back. */
function LiveCard<T>({
  title,
  state,
  badge,
  note,
  children,
}: {
  title: string
  state: ReadState<T>
  badge?: string
  note?: ReactNode
  children: (d: T) => ReactNode
}) {
  return (
    <section className="dapp-card lc-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">{title}</h2>
        {badge !== undefined && state.k === 'ready' && (
          <span className="lc-live">
            <span className="dapp-dot dapp-dot--success" aria-hidden="true" />
            {badge}
          </span>
        )}
        {state.k === 'error' && <span className="dapp-badge dapp-badge--warn">NOT READ</span>}
      </div>

      {(state.k === 'loading' || state.k === 'idle') && (
        <p className="live-note dapp-state--loading" role="status">
          Reading contracts&hellip;
        </p>
      )}
      {state.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          {failureLine(state.kind, state.message)}
        </p>
      )}
      {state.k === 'ready' && (
        <>
          {children(state.data)}
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
function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
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

/** pips of PIPS_DENOMINATOR (1e6) as a percentage, without rounding a 999-pip
    fee up to "0.10%": up to four decimals, trailing zeros trimmed. */
const pipsPct = (pips: number) => `${Number((pips / 10_000).toFixed(4))}%`

const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`

function PoolFees({ fees, status }: { fees: ReadState<{ pools: PoolProtocolFee[] }>; status: ProtocolStatus }) {
  if (fees.k === 'loading' || fees.k === 'idle') {
    return (
      <p className="live-note dapp-state--loading" role="status">
        Reading each pool&rsquo;s <code>slot0.protocolFee</code>&hellip;
      </p>
    )
  }
  if (fees.k === 'error') {
    return (
      <p className="live-note live-note--err" role="status">
        Per-pool protocol fees not read. {failureLine(fees.kind, fees.message)}
      </p>
    )
  }
  const pools = fees.data.pools
  const highest = pools.reduce((m, p) => Math.max(m, p.zeroForOnePips, p.oneForZeroPips), 0)
  return (
    <>
      {pools.length === 0 ? (
        <p className="live-note">
          No live CL pools yet, so no pool shown here charges a protocol fee. Pools trading an
          address-book test token are not listed.
        </p>
      ) : (
        <>
          <Gauge
            value={highest}
            max={status.maxFeePips}
            label="Highest protocol fee any live CL pool charges, against the protocol fee cap"
            valueText={pipsPct(highest)}
            maxText={pipsPct(status.maxFeePips)}
            color={highest === 0 ? 'success' : 'primary'}
            caption={
              <>
                Highest <code>slot0.protocolFee</code> across {pools.length} CL pool
                {pools.length === 1 ? '' : 's'}, of <code>MAX_PROTOCOL_FEE</code>.
              </>
            }
          />
          <ul className="lc-rows dapp-mt-2">
            {pools.map((p) => (
              <li key={p.pool.id} className="lc-row">
                <span className="lc-row__name">Pool {shortId(p.pool.id)}</span>
                <span className="lc-row__v tabular">
                  {p.zeroForOnePips} / {p.oneForZeroPips} pips · LP {p.lpFeePips}
                </span>
              </li>
            ))}
          </ul>
          <p className="live-note dapp-mt-2">
            Protocol fee per direction (0→1 / 1→0), read from each pool&rsquo;s own slot0.
          </p>
        </>
      )}
      <p className="live-note dapp-mt-2">
        {!status.controllerWired ? (
          <>No pool manager points at the fee controller, so it stamps nothing on new pools.</>
        ) : status.feesDisabled ? (
          <>The guardian has the controller&rsquo;s fees <strong>disabled</strong>; new pools are stamped with 0.</>
        ) : (
          <>
            For pools initialized <em>from now on</em>, the controller quotes {status.configuredFeePips} pips (
            {pipsPct(status.configuredFeePips)}) at the 0.30% tier (<code>feeForLpFee(3000)</code>). That is
            not what existing pools charge.
          </>
        )}
      </p>
    </>
  )
}

export function ChainStatusCard({
  status,
  fees,
}: {
  status: ReadState<ProtocolStatus>
  fees: ReadState<{ pools: PoolProtocolFee[] }>
}) {
  return (
    <LiveCard title={`Live on ${D.name}`} state={status} badge="ON CHAIN">
      {(s) => (
        <>
          <PoolFees fees={fees} status={s} />
          <dl className="lc-stats dapp-mt-3">
            <Stat label="BLOCK" value={<span className="tabular">{s.blockNumber.toString()}</span>} />
            <Stat
              label="POOL MANAGERS"
              value={s.clRegistered && s.binRegistered ? 'CL + Bin' : 'not registered'}
            />
            <Stat label="CONTROLLER FEES" value={s.feesDisabled ? 'DISABLED' : 'Enabled'} />
          </dl>
        </>
      )}
    </LiveCard>
  )
}

const HOLDER_LABEL: Record<HolderKind, string> = {
  'custody-timelock': 'Custody timelock',
  'policy-timelock': 'Policy timelock',
  safe: 'Safe (no delay)',
  other: 'another address',
}

function holderSummary(rows: readonly HeldContract[]): string {
  const kinds = [...new Set(rows.map((r) => r.ownerKind))]
  if (kinds.length === 1 && kinds[0]) return HOLDER_LABEL[kinds[0]]
  return rows.map((r) => `${r.name}: ${HOLDER_LABEL[r.ownerKind]}`).join(' · ')
}

function CustodyStats({ custody }: { custody: ReadState<CustodyStatus> }) {
  if (custody.k === 'loading' || custody.k === 'idle') {
    return (
      <p className="live-note dapp-state--loading" role="status">
        Reading <code>owner()</code> on the Vault and both wrappers&hellip;
      </p>
    )
  }
  if (custody.k === 'error') {
    return <p className="live-note live-note--err">Ownership not read. {failureLine(custody.kind, custody.message)}</p>
  }
  const c = custody.data
  const core = c.contracts.filter((r) => ['Vault', 'CLPoolManagerOwner', 'BinPoolManagerOwner'].includes(r.name))
  const custodyHolds = c.contracts.filter((r) => r.ownerKind === 'custody-timelock').map((r) => r.name)
  const policyHolds = c.contracts.filter((r) => r.ownerKind === 'policy-timelock').map((r) => r.name)
  const nominated = core.filter((r) => r.pendingKind === 'custody-timelock').map((r) => r.name)
  const coreDelayed = core.length > 0 && core.every((r) => r.ownerKind === 'custody-timelock')

  return (
    <>
      <Stat
        label="VAULT + MANAGER WRAPPERS"
        value={holderSummary(core)}
        sub={
          coreDelayed
            ? `behind the ${Number(c.custodyDelaySec) / 3600}h delay`
            : nominated.length > 0
              ? `custody timelock nominated on ${nominated.length} of ${core.length}, not accepted — no delay in force`
              : 'the custody delay does not apply to these'
        }
      />
      <Stat
        label="CUSTODY TIMELOCK"
        value={<span className="tabular">{Number(c.custodyDelaySec) / 3600}h</span>}
        sub={custodyHolds.length > 0 ? `owns ${custodyHolds.join(', ')}` : 'owns none of the tracked contracts'}
      />
      <Stat
        label="POLICY TIMELOCK"
        value={<span className="tabular">{Number(c.policyDelaySec) / 3600}h</span>}
        sub={policyHolds.length > 0 ? `owns ${policyHolds.join(', ')}` : 'owns none of the tracked contracts'}
      />
    </>
  )
}

export function GovernanceCard({
  gov,
  custody,
}: {
  gov: ReadState<GovernanceStatus>
  custody: ReadState<CustodyStatus>
}) {
  return (
    <LiveCard
      title="Registry &amp; governance"
      state={gov}
      badge="ON CHAIN"
      note={
        <p className="live-note lc-note">
          A delay governs a contract only if the timelock is its <code>owner()</code>, so the holder
          is read, not assumed. The Governance screen shows every owner and queued operation.
        </p>
      }
    >
      {(g) => (
        <dl className="lc-stats">
          <Stat
            label="LATCHES LISTED"
            value={<span className="tabular">{g.hookCount.toString()}</span>}
            sub={g.hookCount === 0n ? 'none listed yet' : 'read from the registry'}
          />
          <CustodyStats custody={custody} />
          <Stat
            label="REGISTRY"
            value={
              <a
                href={explorerAddress(ACTIVE_CHAIN_ID, g.registry)}
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

export function VaultHoldingsCard({ holdings }: { holdings: ReadState<VaultHolding[]> }) {
  return (
    <LiveCard
      title="Vault holdings"
      state={holdings}
      badge="ON CHAIN"
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
      {(list) =>
        list.length === 0 ? (
          <p className="live-note">The Vault holds no tracked tokens on this deployment.</p>
        ) : (
          <>
            <ul className="lc-rows">
              {list.map((h) => (
                <Row
                  key={h.token}
                  href={explorerAddress(ACTIVE_CHAIN_ID, h.token)}
                  name={h.symbol}
                  value={formatUnits(h.balance, h.decimals, 4)}
                />
              ))}
            </ul>
            {list.map((h) => (
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
      <p className="live-note dapp-mt-2">
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


export function RecentSwapsCard({ swaps }: { swaps: ReadState<SwapRecord[]> }) {
  return (
    <LiveCard title="Recent swaps" state={swaps} badge="ON CHAIN">
      {(list) =>
        list.length === 0 || !list[0] ? (
          <p className="live-note">No swaps on a live pool yet. Pools trading an address-book test token are left out.</p>
        ) : (
          <>
            <ul className="lc-rows">
              {list.map((s) => {
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
            <SwapFeeSplit s={list[0]} />
          </>
        )
      }
    </LiveCard>
  )
}

/**
 * The four cards in a grid. Each reading is its own `useChainRead`, so a slow
 * log scan delays only the card that needs it.
 */
export function LiveChainPanel() {
  const status = useChainRead(`lc:status:${ACTIVE_CHAIN_ID}`, () => readProtocolStatus())
  const fees = useChainRead(`lc:fees:${ACTIVE_CHAIN_ID}`, () => readPoolProtocolFees())
  const gov = useChainRead(`lc:gov:${ACTIVE_CHAIN_ID}`, () => readGovernanceStatus())
  const custody = useChainRead(`lc:custody:${ACTIVE_CHAIN_ID}`, () => readCustodyStatus())
  const holdings = useChainRead(`lc:holdings:${ACTIVE_CHAIN_ID}`, () => readVaultHoldings())
  const swaps = useChainRead(`lc:swaps:${ACTIVE_CHAIN_ID}`, () => readRecentSwaps(ACTIVE_CHAIN_ID, 5))

  return (
    <div className="lc-grid">
      <ChainStatusCard status={status.state} fees={fees.state} />
      <GovernanceCard gov={gov.state} custody={custody.state} />
      <VaultHoldingsCard holdings={holdings.state} />
      <RecentSwapsCard swaps={swaps.state} />
    </div>
  )
}

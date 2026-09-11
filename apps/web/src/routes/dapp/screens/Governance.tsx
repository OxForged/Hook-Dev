/* ============================================================================
   Governance — the Safe, both LatchTimelocks, who owns what, and every
   operation ever queued behind a delay.

   Robinhood Chain mainnet went live today. A 2-of-3 Safe owns every contract
   there and the handover to the two timelocks below is queued — a timelock's
   entire value is the public window between "queued" and "executable", and
   until this screen existed the only way to see that window was `cast`.

   EVERYTHING HERE IS READ LIVE. `ops/safe/robinhood-deployment.md` records
   what was true at the last verification, but ownership is mid-migration on
   Robinhood, so this screen calls `owner()`, `getThreshold()`, `hasRole` and
   `CallScheduled` logs itself rather than trusting that file — see
   `lib/governance.ts` for why and how.

   Sepolia and Robinhood are told straight, not softened into one script: on
   Sepolia the deployer EOA still owns everything and both timelocks own
   nothing; on Robinhood the Safe owns everything and the handover is queued.
   Which is true for the selected chain comes from the reads below, never from
   a hardcoded assumption about which chain is "the real one".
   ============================================================================ */

import { useEffect, useMemo, useState } from 'react'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { DEPLOYMENTS, explorerAddress, explorerTx } from '../../../lib/chain'
import { BarList } from '../components/charts.tsx'
import { Gauge } from '../components/series-charts.tsx'
import type { LabelledBar, SeriesColor } from '../data/types.ts'
import {
  fmtCountdown,
  fmtHours,
  fmtWhen,
  nameForAddress,
  readGovernanceData,
  secondsRemaining,
  shortAddr,
  type GovernanceData,
  type OperationStatus,
  type OwnerKind,
  type OwnershipRow,
  type QueuedOperation,
  type TimelockStatus,
} from '../lib/governance.ts'
import { useChainRead } from '../lib/useChainRead.ts'
import { useDapp } from '../state.tsx'

/** Ticks once a second so long as at least one queued operation is still
 *  pending — a countdown that never moves is just a static timestamp with
 *  extra steps. Chain data is read once; only the clock it is compared
 *  against advances locally. */
function useNowSeconds(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function LiveBadge() {
  return (
    <span className="dapp-badge dapp-badge--ok gov-badge">
      <span className="dapp-dot dapp-dot--success dapp-dot--sm dapp-dot--pulse" aria-hidden="true" />
      LIVE
    </span>
  )
}

function AddrLink({ chainId, address }: { chainId: GovernanceData['chainId']; address: string }) {
  return (
    <a href={explorerAddress(chainId, address)} target="_blank" rel="noopener noreferrer" className="gov-addr" data-hit>
      {shortAddr(address)}
    </a>
  )
}

/* --------------------------------------------------------------------------
   1 — The Safe
   -------------------------------------------------------------------------- */

function SafeCard({ d }: { d: GovernanceData }) {
  const ownsAnything = d.ownership.some((row) => row.chain.some((hop) => hop.kind === 'safe'))
  return (
    <section className="dapp-card gov-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">Governance Safe</h2>
        <LiveBadge />
      </div>
      <dl className="lc-stats">
        <div className="lc-stat">
          <dt className="dapp-microlabel">THRESHOLD</dt>
          <dd className="lc-stat__v">
            <span className="tabular">
              {d.safe.threshold} of {d.safe.owners.length}
            </span>
          </dd>
        </div>
        <div className="lc-stat">
          <dt className="dapp-microlabel">NONCE</dt>
          <dd className="lc-stat__v">
            <span className="tabular">{d.safe.nonce.toString()}</span>
          </dd>
        </div>
        <div className="lc-stat">
          <dt className="dapp-microlabel">ADDRESS</dt>
          <dd className="lc-stat__v">
            <AddrLink chainId={d.chainId} address={d.safe.address} />
          </dd>
        </div>
      </dl>
      <ul className="lc-rows gov-owners">
        {d.safe.owners.map((owner, i) => (
          <li key={owner} className="lc-row">
            <span className="lc-row__name gov-owner-idx">Signer {i + 1}</span>
            <span className="lc-row__v tabular">
              <AddrLink chainId={d.chainId} address={owner} />
            </span>
          </li>
        ))}
      </ul>
      <p className="live-note gov-note">
        {ownsAnything
          ? `This Safe owns at least one contract tracked below on ${DEPLOYMENTS[d.chainId].name}.`
          : `This Safe holds no ownership over the contracts tracked below on ${DEPLOYMENTS[d.chainId].name} — it is deployed here but governs nothing on this chain.`}
      </p>
    </section>
  )
}

/* --------------------------------------------------------------------------
   2 — Both timelocks
   -------------------------------------------------------------------------- */

function TimelockBlock({ t, chainId }: { t: TimelockStatus; chainId: GovernanceData['chainId'] }) {
  const adminIsClean = !t.safeHasAdmin && !t.zeroHasAdmin
  return (
    <div className="gov-timelock">
      <div className="gov-timelock__head">
        <h3 className="dapp-card__title gov-timelock__title">{t.tier} tier</h3>
        <AddrLink chainId={chainId} address={t.address} />
      </div>
      <dl className="lc-stats">
        <div className="lc-stat">
          <dt className="dapp-microlabel">DELAY</dt>
          <dd className="lc-stat__v">
            <span className="tabular">{fmtHours(t.minDelaySec)}</span>
            <span className="lc-stat__sub">floor {fmtHours(t.minDelayFloorSec)}</span>
          </dd>
        </div>
      </dl>
      <ul className="gov-facts">
        <li>
          <span className={`dapp-dot dapp-dot--sm ${t.safeIsProposer ? 'dapp-dot--success' : 'dapp-dot--error'}`} aria-hidden="true" />
          {t.safeIsProposer
            ? 'The Safe holds PROPOSER_ROLE.'
            : 'The Safe does NOT hold PROPOSER_ROLE — checked against this one address only, AccessControl has no member list.'}
        </li>
        <li>
          <span className={`dapp-dot dapp-dot--sm ${t.executionOpen ? 'dapp-dot--success' : 'dapp-dot--warning'}`} aria-hidden="true" />
          {t.executionOpen
            ? 'EXECUTOR_ROLE is open — address(0) holds it, so anyone can execute a matured operation.'
            : 'EXECUTOR_ROLE is NOT open — execution is restricted to specific addresses.'}
        </li>
        <li>
          <span className={`dapp-dot dapp-dot--sm ${adminIsClean ? 'dapp-dot--success' : 'dapp-dot--error'}`} aria-hidden="true" />
          {adminIsClean
            ? `DEFAULT_ADMIN_ROLE is held only by the timelock itself, never by the Safe or address(0)${t.selfAdmin ? '.' : ' — though the self-grant read back false, worth a second look.'}`
            : 'DEFAULT_ADMIN_ROLE reached an address it should not — a permanent backdoor around every delay this contract enforces.'}
        </li>
      </ul>
      {!adminIsClean && (
        <p className="hx-alert hx-alert--danger gov-alert" role="alert">
          {t.safeHasAdmin && 'The Safe holds DEFAULT_ADMIN_ROLE directly. '}
          {t.zeroHasAdmin && 'address(0) holds DEFAULT_ADMIN_ROLE. '}
          Either can grant or revoke PROPOSER_ROLE / EXECUTOR_ROLE without going through the delay.
        </p>
      )}
    </div>
  )
}

function TimelocksCard({ d }: { d: GovernanceData }) {
  return (
    <section className="dapp-card gov-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">Timelocks</h2>
        <LiveBadge />
      </div>
      <div className="gov-timelocks">
        {d.timelocks.map((t) => (
          <TimelockBlock key={t.address} t={t} chainId={d.chainId} />
        ))}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   3 — Ownership table
   -------------------------------------------------------------------------- */

function OwnerChainCell({ row, chainId }: { row: OwnershipRow; chainId: GovernanceData['chainId'] }) {
  if (!row.ownable) {
    return <span className="live-fee">not Ownable — no owner() function</span>
  }
  if (row.chain.length === 0) {
    return <span className="live-fee">owner() reverted</span>
  }
  return (
    <span className="gov-chain">
      {row.chain.map((hop, i) => (
        <span key={hop.address} className="gov-chain__hop">
          {i > 0 && <span className="gov-chain__arrow" aria-hidden="true">&rarr;</span>}
          <a href={explorerAddress(chainId, hop.address)} target="_blank" rel="noopener noreferrer" data-hit>
            {hop.label}
          </a>
        </span>
      ))}
    </span>
  )
}

/* ============================================================================
   Ownership, counted — the table above as one shape.

   FED BY THE SAME READS AS THE TABLE. Each bar counts the LAST hop of a real
   `owner()` chain, the one `followOwnerChain` walked hop by hop from the
   contract itself. Nothing is assumed from the deployment record: a row lands
   in the Safe bucket because `owner()` answered with the Safe's address, and in
   the EOA bucket because the final address has no code.

   WHY NON-OWNABLE CONTRACTS ARE NOT A BAR. `LatchRegistry` is AccessControl,
   not Ownable, so it has no owner to count and a sixth "not Ownable" bar would
   put a contract that cannot be owned next to five that can. It stays in the
   table, which says so in words, and the caption below states how many rows the
   bars actually cover so the two totals can be reconciled.

   WHY THE EOA BAR IS DRAWN AT ZERO. Every other empty bucket is dropped, but
   "nothing answers to an EOA" is the single most reassuring reading this screen
   can produce, and it has no other voice — the red banner above appears only
   when the answer is the opposite. A dropped row would leave the good news
   indistinguishable from a bucket nobody thought to check.
   ============================================================================ */
const OWNER_BUCKETS: ReadonlyArray<{ kind: OwnerKind; label: string; color: SeriesColor }> = [
  { kind: 'safe', label: 'Governance Safe', color: 'success' },
  { kind: 'custody-timelock', label: 'Custody timelock', color: 'primary' },
  { kind: 'policy-timelock', label: 'Policy timelock', color: 'signal' },
  { kind: 'contract', label: 'Unrecognized contract', color: 'violet' },
  { kind: 'eoa', label: 'EOA', color: 'amber' },
]

function ownerBars(rows: readonly OwnershipRow[]): { bars: LabelledBar[]; counted: number } {
  const finals = rows
    .map((r) => r.chain[r.chain.length - 1]?.kind)
    .filter((k): k is OwnerKind => k !== undefined)
  const denom = finals.length || 1

  const bars = OWNER_BUCKETS.flatMap(({ kind, label, color }) => {
    const n = finals.filter((k) => k === kind).length
    if (n === 0 && kind !== 'eoa') return []
    return [{ name: label, value: String(n), pct: (n / denom) * 100, color }]
  })

  return { bars, counted: finals.length }
}

function OwnershipCard({ d }: { d: GovernanceData }) {
  const eoaOwned = d.ownership.filter((row) => row.isEOAOwned)
  const pending = d.ownership.filter((row) => row.pendingOwner !== null)
  const { bars, counted } = useMemo(() => ownerBars(d.ownership), [d.ownership])

  return (
    <section className="dapp-card gov-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">Ownership</h2>
        <LiveBadge />
      </div>

      {eoaOwned.length > 0 && (
        <p className="hx-alert hx-alert--danger gov-alert" role="alert">
          {eoaOwned.length} contract{eoaOwned.length === 1 ? '' : 's'} on {DEPLOYMENTS[d.chainId].name} still{' '}
          {eoaOwned.length === 1 ? 'answers' : 'answer'} to an EOA: {eoaOwned.map((r) => r.contractName).join(', ')}.
        </p>
      )}

      {pending.length > 0 && (
        <p className="live-note live-note--err gov-note">
          {pending.length} transfer{pending.length === 1 ? '' : 's'} nominated but not accepted:{' '}
          {pending.map((r) => r.contractName).join(', ')} — the previous owner keeps full control until
          acceptOwnership() is called.
        </p>
      )}

      <BarList
        items={bars}
        valueLabel="contracts"
        shareLabel="of the contracts that expose owner()"
      />
      <p className="live-note gov-note">
        Counted from the last hop of each <code>owner()</code> chain — {counted} of{' '}
        {d.ownership.length} tracked contracts answer <code>owner()</code> at all.
      </p>

      <div className="dapp-table-wrap gov-table-wrap">
        <table className="dapp-table gov-table">
          <thead>
            <tr>
              <th scope="col">CONTRACT</th>
              <th scope="col">OWNER (owner() CHAIN)</th>
              <th scope="col">PENDING OWNER</th>
            </tr>
          </thead>
          <tbody>
            {d.ownership.map((row) => (
              <tr key={row.contractAddress} className={row.isEOAOwned ? 'gov-row--danger' : undefined}>
                <th scope="row" data-label="CONTRACT">
                  <span className="gov-contract-name">{row.contractName}</span>
                  <br />
                  <AddrLink chainId={d.chainId} address={row.contractAddress} />
                </th>
                <td data-label="OWNER">
                  <OwnerChainCell row={row} chainId={d.chainId} />
                </td>
                <td data-label="PENDING OWNER">
                  {row.pendingOwner ? (
                    <AddrLink chainId={d.chainId} address={row.pendingOwner} />
                  ) : (
                    <span className="live-fee">none</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   4 — Queued timelock operations
   -------------------------------------------------------------------------- */

const STATUS_BADGE: Record<OperationStatus, string> = {
  pending: 'dapp-badge--warn',
  ready: 'dapp-badge--ok',
  done: 'dapp-badge--mute',
  unknown: 'dapp-badge--mute',
}

/* ============================================================================
   How far through its delay one queued operation is.

   BOTH NUMBERS ARE READ, THE SUBTRACTION IS NOT AN ESTIMATE. `max` is the
   `delay` field of this operation's own `CallScheduled` log; `readyAtSec` is
   `getTimestamp(id)` off the timelock. Elapsed is `delay - (readyAt - now)`,
   which reduces to `now - scheduledAt` — wall-clock against a chain timestamp,
   the one comparison this screen cannot avoid making and the reason the clock
   ticks locally while the chain data does not.

   ONLY FOR A PENDING OPERATION. A ready one has elapsed PAST its ceiling, and
   `Gauge` renders anything over its max in the error colour with "above the
   cap" — correct for a fee that exceeded a bound, a lie about an operation that
   simply matured. Ready and done keep the plain line they already had.
   ============================================================================ */
function DelayGauge({ op, remaining }: { op: QueuedOperation; remaining: number }) {
  const delay = Number(op.delaySec)
  /* Clamped at zero only against clock skew between the browser and the chain;
     it is not a floor on a real reading. */
  const elapsed = Math.max(0, delay - remaining)

  return (
    <Gauge
      value={elapsed}
      max={delay}
      color="amber"
      label={`Time elapsed of the ${op.tier} tier delay`}
      valueText={fmtHours(BigInt(Math.floor(elapsed)))}
      maxText={fmtHours(op.delaySec)}
      caption="elapsed since this operation was queued"
    />
  )
}

function OperationRow({ op, chainId, nowSec }: { op: QueuedOperation; chainId: GovernanceData['chainId']; nowSec: number }) {
  const targetName = nameForAddress(chainId, op.target)
  const remaining = secondsRemaining(op.readyAtSec, nowSec)

  return (
    <li className="gov-op">
      <div className="gov-op__head">
        <span className={`dapp-badge ${STATUS_BADGE[op.status]}`}>{op.status.toUpperCase()}</span>
        <span className="dapp-microlabel gov-op__tier">{op.tier} TIER</span>
      </div>
      <p className="gov-op__line">
        Targets{' '}
        <a href={explorerAddress(chainId, op.target)} target="_blank" rel="noopener noreferrer" data-hit>
          {targetName ?? shortAddr(op.target)}
        </a>
        {targetName && <span className="live-fee"> ({shortAddr(op.target)})</span>} &mdash; calls{' '}
        <code className="gov-op__call">{op.decodedCall ?? (op.data === '0x' ? 'no calldata' : op.data.slice(0, 10))}</code>
      </p>
      <p className="live-note gov-op__meta">
        Scheduled at block{' '}
        <a href={explorerTx(chainId, op.scheduledTxHash)} target="_blank" rel="noopener noreferrer" data-hit>
          {op.scheduledAtBlock.toString()}
        </a>{' '}
        · delay {fmtHours(op.delaySec)}
        {op.status !== 'done' && (
          <>
            {' '}
            · executable {fmtWhen(op.readyAtSec)}
          </>
        )}
      </p>
      {op.status === 'pending' && (
        <>
          <DelayGauge op={op} remaining={remaining} />
          {/* The local clock can cross readyAt before the next chain read
              reclassifies the operation. Saying so beats "ready now remaining". */}
          <p className="gov-op__countdown tabular">
            {remaining <= 0 ? 'delay elapsed — status not re-read yet' : `${fmtCountdown(remaining)} remaining`}
          </p>
        </>
      )}
      {op.status === 'ready' && <p className="gov-op__countdown gov-op__countdown--ready">ready to execute</p>}
      {op.status === 'done' && <p className="gov-op__countdown gov-op__countdown--done">executed</p>}
    </li>
  )
}

function OperationsCard({ d, nowSec }: { d: GovernanceData; nowSec: number }) {
  return (
    <section className="dapp-card gov-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">Queued timelock operations</h2>
        <LiveBadge />
      </div>
      {d.operations.length === 0 ? (
        <div className="an-empty">
          <p className="an-empty__title">Nothing has ever been queued</p>
          <p className="live-note">
            Neither timelock on {DEPLOYMENTS[d.chainId].name} has emitted a CallScheduled event since block{' '}
            {DEPLOYMENTS[d.chainId].deployedAtBlock.toString()}.
          </p>
        </div>
      ) : (
        <ul className="gov-ops">
          {d.operations.map((op) => (
            <OperationRow key={`${op.id}-${op.index}`} op={op} chainId={d.chainId} nowSec={nowSec} />
          ))}
        </ul>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Screen
   -------------------------------------------------------------------------- */

export default function Governance() {
  const { browsingChain } = useDapp()
  const { state } = useChainRead<GovernanceData>(`governance:${browsingChain}`, () =>
    readGovernanceData(browsingChain),
  )
  const chainName = DEPLOYMENTS[browsingChain].name

  const hasPending = state.k === 'ready' && state.data.operations.some((op) => op.status === 'pending')
  const nowSec = useNowSeconds(hasPending)

  const eoaCount = useMemo(
    () => (state.k === 'ready' ? state.data.ownership.filter((r) => r.isEOAOwned).length : 0),
    [state],
  )

  if (state.k !== 'ready') {
    return (
      <section className="dapp-card" role="status">
        <div className="dapp-card__bar">
          <h2 className="dapp-microlabel">GOVERNANCE</h2>
          <ChainTag chainId={browsingChain} />
        </div>
        <p className={`live-note${state.k === 'error' ? ' live-note--err' : ''}`}>
          {state.k === 'error'
            ? `Could not reach ${chainName}: ${state.message}. Nothing shown rather than placeholder figures.`
            : `Reading the Safe, both timelocks, ownership and queued operations from ${chainName}…`}
        </p>
      </section>
    )
  }

  const d = state.data

  return (
    <div className="dapp-stack gov-screen">
      <div className="dapp-card__bar gov-summary">
        <h2 className="dapp-microlabel">GOVERNANCE · {chainName.toUpperCase()}</h2>
        <ChainTag chainId={browsingChain} />
        {eoaCount > 0 && (
          <span className="dapp-badge dapp-badge--danger">
            {eoaCount} EOA-OWNED
          </span>
        )}
        <span className="live-fee gov-summary__block">head block {d.latestBlock.toString()}</span>
      </div>

      <div className="dapp-row dapp-row--pool">
        <SafeCard d={d} />
        <TimelocksCard d={d} />
      </div>

      <OwnershipCard d={d} />
      <OperationsCard d={d} nowSec={nowSec} />
    </div>
  )
}

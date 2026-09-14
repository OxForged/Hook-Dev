/* ============================================================================
   Governance — the Safe, both LatchTimelocks, who owns what, and every
   operation ever queued behind a delay.

   EVERYTHING HERE IS READ LIVE. `ops/safe/robinhood-deployment.md` records
   what was true at the last verification, but ownership is mid-migration on
   Robinhood, so this screen calls `owner()`, `pendingOwner()`, `getThreshold()`,
   `hasRole` and `CallScheduled` logs itself — see `lib/governance.ts`.

   FOUR INDEPENDENT READS (2026-09-14). The screen used to be one
   `Promise.all` over the Safe, both timelocks, the ownership table and the
   operations scan, so a slow log scan left every card — including three that
   need only `eth_call`s — on "Reading…" or on one shared error. Each section
   now loads, fails and retries on its own, and its LIVE badge appears only
   when its own reading is in.

   THE CUSTODY HANDOVER IS ITS OWN CARD. CLAUDE.md "VERIFIED LIVE STATE":
   the Safe owns the Vault and both `*PoolManagerOwner` wrappers directly, and
   three `acceptOwnership()` operations are queued on the custody timelock.
   The card pairs each queued operation with the target's CURRENT `owner()` —
   the read, not the queue, is the proof the handover happened.
   ============================================================================ */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { DEPLOYMENTS, explorerAddress, explorerTx, formatUnits, type ReadFailureKind } from '../../../lib/chain'
import { BarList } from '../components/charts.tsx'
import { Gauge } from '../components/series-charts.tsx'
import { HexReveal } from '../components/HexReveal.tsx'
import type { LabelledBar, SeriesColor } from '../data/types.ts'
import {
  CANCELLER_ADDRESS,
  EXPECTED_LABEL,
  fmtCountdown,
  fmtHours,
  fmtWhen,
  nameForAddress,
  readOperations,
  readOwnershipTable,
  readSafeStatus,
  readTimelocks,
  secondsRemaining,
  shortAddr,
  type OperationStatus,
  type OwnerKind,
  type OwnershipRow,
  type QueuedOperation,
  type SafeStatus,
  type TimelockStatus,
} from '../lib/governance.ts'
import { useChainRead, type ReadState } from '../lib/useChainRead.ts'
import { useDapp } from '../state.tsx'

type ChainId = SafeStatus['chainId']

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

function AddrLink({ chainId, address }: { chainId: ChainId; address: string }) {
  return (
    <HexReveal value={address}>
      <a
        href={explorerAddress(chainId, address)}
        target="_blank"
        rel="noopener noreferrer"
        className="gov-addr"
        title={address}
        data-hit
      >
        {shortAddr(address)}
      </a>
    </HexReveal>
  )
}

function failureCopy(kind: ReadFailureKind, chainName: string): string {
  if (kind === 'scan-timeout') return `The log scan on ${chainName} did not finish in time — the chain answered; the scan ran out of budget.`
  if (kind === 'transport') return `${chainName} did not answer.`
  if (kind === 'contract') return `A contract on ${chainName} reverted the read.`
  return `Could not read this from ${chainName}.`
}

/** One section's card: title, its own badge, and its own four states. */
function Section<T>({
  title,
  state,
  chainName,
  onRetry,
  loading,
  className = 'dapp-card gov-card',
  children,
}: {
  title: string
  state: ReadState<T>
  chainName: string
  onRetry: () => void
  loading: string
  className?: string
  children: (d: T) => ReactNode
}) {
  return (
    <section className={className}>
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">{title}</h2>
        {state.k === 'ready' ? <LiveBadge /> : state.k === 'error' ? <span className="dapp-badge dapp-badge--warn">NOT READ</span> : null}
      </div>
      {(state.k === 'loading' || state.k === 'idle') && (
        <p className="live-note dapp-state--loading" role="status">
          {loading}
        </p>
      )}
      {state.k === 'error' && (
        <div role="status">
          <p className="live-note live-note--err">
            {failureCopy(state.kind, chainName)} Nothing shown rather than placeholder figures.
          </p>
          <p className="dp-failure__raw dapp-mt-2">{state.message}</p>
          <button type="button" className="dapp-btn dapp-btn--sm dapp-mt-2" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {state.k === 'ready' && children(state.data)}
    </section>
  )
}

/* --------------------------------------------------------------------------
   1 — The Safe
   -------------------------------------------------------------------------- */

function SafeBody({ safe, ownership }: { safe: SafeStatus; ownership: ReadState<OwnershipRow[]> }) {
  const chainName = DEPLOYMENTS[safe.chainId].name
  return (
    <>
      <dl className="lc-stats">
        <div className="lc-stat">
          <dt className="dapp-microlabel">THRESHOLD</dt>
          <dd className="lc-stat__v">
            <span className="tabular">
              {safe.threshold} of {safe.owners.length}
            </span>
          </dd>
        </div>
        <div className="lc-stat">
          <dt className="dapp-microlabel">NONCE</dt>
          <dd className="lc-stat__v">
            <span className="tabular">{safe.nonce.toString()}</span>
          </dd>
        </div>
        <div className="lc-stat">
          <dt className="dapp-microlabel">ADDRESS</dt>
          <dd className="lc-stat__v">
            <AddrLink chainId={safe.chainId} address={safe.address} />
          </dd>
        </div>
      </dl>
      <ul className="lc-rows gov-owners">
        {safe.owners.map((owner, i) => (
          <li key={owner} className="lc-row">
            <span className="lc-row__name gov-owner-idx">Signer {i + 1}</span>
            <span className="lc-row__v tabular">
              <AddrLink chainId={safe.chainId} address={owner} />
            </span>
          </li>
        ))}
      </ul>
      {ownership.k === 'ready' && (
        <p className="live-note gov-note">
          {(() => {
            const owned = ownership.data.filter((row) => row.chain[row.chain.length - 1]?.kind === 'safe')
            return owned.length > 0
              ? `This Safe is the final owner of ${owned.length} tracked contract${owned.length === 1 ? '' : 's'} on ${chainName}: ${owned.map((r) => r.contractName).join(', ')}.`
              : `This Safe is the final owner of none of the tracked contracts on ${chainName}.`
          })()}
        </p>
      )}
    </>
  )
}

/* --------------------------------------------------------------------------
   2 — Both timelocks
   -------------------------------------------------------------------------- */

function TimelockBlock({ t, chainId }: { t: TimelockStatus; chainId: ChainId }) {
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
          <span className={`dapp-dot dapp-dot--sm ${t.cancellerKeyHasRole ? 'dapp-dot--success' : 'dapp-dot--error'}`} aria-hidden="true" />
          {t.cancellerKeyHasRole
            ? `The dedicated canceller key ${shortAddr(CANCELLER_ADDRESS)} holds CANCELLER_ROLE.`
            : `The dedicated canceller key ${shortAddr(CANCELLER_ADDRESS)} does NOT hold CANCELLER_ROLE here${t.safeCanCancel ? ' — only the Safe (as proposer) can cancel, so a compromised Safe’s queued operation has no veto' : ''}.`}
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

function TimelocksBody({
  d,
  chainId,
}: {
  d: Awaited<ReturnType<typeof readTimelocks>>
  chainId: ChainId
}) {
  const native = DEPLOYMENTS[chainId].nativeCurrency
  const gasBought = d.gasPriceWei > 0n ? d.cancellerBalanceWei / d.gasPriceWei : null
  return (
    <>
      <div className="gov-timelocks">
        {d.timelocks.map((t) => (
          <TimelockBlock key={t.address} t={t} chainId={chainId} />
        ))}
      </div>
      <p className="live-note gov-note">
        Canceller key <AddrLink chainId={chainId} address={CANCELLER_ADDRESS} /> holds{' '}
        {formatUnits(d.cancellerBalanceWei, native.decimals, 8)} {native.symbol}
        {gasBought !== null ? (
          <>
            {' '}
            — {gasBought.toLocaleString('en-US')} gas at the current <code>eth_gasPrice</code> of{' '}
            {d.gasPriceWei.toLocaleString('en-US')} wei, before any L1 data fee
          </>
        ) : null}
        . A canceller that cannot pay for a transaction cannot cancel one.
      </p>
    </>
  )
}

/* --------------------------------------------------------------------------
   3 — Ownership table
   -------------------------------------------------------------------------- */

function OwnerChainCell({ row, chainId }: { row: OwnershipRow; chainId: ChainId }) {
  if (!row.ownable) {
    return (
      <span className="live-fee">
        not Ownable — no owner() function
        {row.safeHasAdminRole !== null
          ? ` · Safe holds DEFAULT_ADMIN_ROLE: ${row.safeHasAdminRole ? 'yes' : 'NO'}`
          : ''}
      </span>
    )
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

function OwnershipBody({ rows, chainId }: { rows: OwnershipRow[]; chainId: ChainId }) {
  const chainName = DEPLOYMENTS[chainId].name
  const eoaOwned = rows.filter((row) => row.isEOAOwned)
  /* One nomination per contract that holds it — a pool manager and its wrapper
     both surface the wrapper's nomination, and it is one transfer, not two. */
  const nominations = [
    ...new Map(
      rows
        .filter((r) => r.pendingOwner !== null && r.pendingOwnerAt !== null)
        .map((r) => [r.pendingOwnerAt?.toLowerCase(), r] as const),
    ).values(),
  ]
  const differs = rows.filter((r) => r.matches === false)
  const { bars, counted } = useMemo(() => ownerBars(rows), [rows])

  return (
    <>
      {eoaOwned.length > 0 && (
        <p className="hx-alert hx-alert--danger gov-alert" role="alert">
          {eoaOwned.length} contract{eoaOwned.length === 1 ? '' : 's'} on {chainName} still{' '}
          {eoaOwned.length === 1 ? 'answers' : 'answer'} to an EOA: {eoaOwned.map((r) => r.contractName).join(', ')}.
        </p>
      )}

      {nominations.length > 0 && (
        <p className="live-note live-note--err gov-note">
          {nominations.length} transfer{nominations.length === 1 ? '' : 's'} nominated but not accepted:{' '}
          {nominations
            .map((r) => `${nameForAddress(chainId, r.pendingOwnerAt as `0x${string}`) ?? shortAddr(r.pendingOwnerAt ?? '')} → ${nameForAddress(chainId, r.pendingOwner as `0x${string}`) ?? shortAddr(r.pendingOwner ?? '')}`)
            .join('; ')}
          . The current owner keeps full control until <code>acceptOwnership()</code> executes.
        </p>
      )}

      {differs.length > 0 && (
        <p className="live-note live-note--err gov-note">
          {differs.length} contract{differs.length === 1 ? '' : 's'} differ from CLAUDE.md&rsquo;s ownership
          table: {differs.map((r) => `${r.contractName} (table: ${EXPECTED_LABEL[r.expected]})`).join(', ')}.
        </p>
      )}

      <BarList items={bars} valueLabel="contracts" shareLabel="of the contracts that expose owner()" />
      <p className="live-note gov-note">
        Counted from the last hop of each <code>owner()</code> chain — {counted} of {rows.length} tracked
        contracts answer <code>owner()</code> at all. &ldquo;Table says&rdquo; is CLAUDE.md&rsquo;s
        ownership table, a repository fact; the match column compares it with the chain.
      </p>

      <div className="dapp-table-wrap gov-table-wrap">
        <table className="dapp-table gov-table">
          <thead>
            <tr>
              <th scope="col">CONTRACT</th>
              <th scope="col">OWNER (owner() CHAIN)</th>
              <th scope="col">PENDING OWNER</th>
              <th scope="col">TABLE SAYS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.contractAddress} className={row.isEOAOwned ? 'gov-row--danger' : undefined}>
                <th scope="row" data-label="CONTRACT">
                  <span className="gov-contract-name">
                    {row.contractName}
                    {row.isEOAOwned ? (
                      <span className="dapp-badge dapp-badge--danger gov-eoa-badge">EOA OWNER</span>
                    ) : null}
                  </span>
                  <br />
                  <AddrLink chainId={chainId} address={row.contractAddress} />
                  {row.note ? <span className="live-fee"> · {row.note}</span> : null}
                </th>
                <td data-label="OWNER">
                  <OwnerChainCell row={row} chainId={chainId} />
                </td>
                <td data-label="PENDING OWNER">
                  {row.pendingOwner ? (
                    <>
                      <AddrLink chainId={chainId} address={row.pendingOwner} />
                      <span className="live-fee">
                        {' '}
                        {nameForAddress(chainId, row.pendingOwner) ?? ''}
                        {row.pendingOwnerAt && row.pendingOwnerAt.toLowerCase() !== row.contractAddress.toLowerCase()
                          ? ` · on ${nameForAddress(chainId, row.pendingOwnerAt) ?? shortAddr(row.pendingOwnerAt)}`
                          : ''}
                      </span>
                    </>
                  ) : (
                    <span className="live-fee">none</span>
                  )}
                </td>
                <td data-label="TABLE SAYS">
                  <span className="live-fee">{EXPECTED_LABEL[row.expected]}</span>{' '}
                  {row.matches === true && <span className="dapp-badge dapp-badge--ok">MATCHES</span>}
                  {row.matches === false && <span className="dapp-badge dapp-badge--danger">DIFFERS</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* --------------------------------------------------------------------------
   4 — The custody handover, and every queued operation
   -------------------------------------------------------------------------- */

const STATUS_BADGE: Record<OperationStatus, string> = {
  pending: 'dapp-badge--warn',
  ready: 'dapp-badge--ok',
  done: 'dapp-badge--mute',
  cancelled: 'dapp-badge--mute',
}

/* How far through its delay one PENDING operation is. `max` is the delay from
   its own CallScheduled log and `readyAtSec` is `getTimestamp(id)`; the
   remaining time is wall clock against that chain timestamp. */
function DelayGauge({ op, remaining }: { op: QueuedOperation; remaining: number }) {
  const delay = Number(op.delaySec)
  const elapsed = Math.max(0, delay - remaining)
  return (
    <Gauge
      value={Math.min(elapsed, delay)}
      max={delay}
      color="amber"
      label={`Time elapsed of the ${op.tier} tier delay`}
      valueText={fmtHours(BigInt(Math.floor(Math.min(elapsed, delay))))}
      maxText={fmtHours(op.delaySec)}
      caption="elapsed since this operation was queued"
    />
  )
}

function OpStatusLine({ op, nowSec }: { op: QueuedOperation; nowSec: number }) {
  const remaining = secondsRemaining(op.readyAtSec, nowSec)
  if (op.status === 'pending') {
    return (
      <p className="gov-op__countdown tabular">
        {remaining <= 0
          ? 'delay elapsed by this browser’s clock — status not re-read yet'
          : `${fmtCountdown(remaining)} remaining · executable ${fmtWhen(op.readyAtSec)}`}
      </p>
    )
  }
  if (op.status === 'ready') {
    return (
      <p className="gov-op__countdown gov-op__countdown--ready">
        ready to execute since {fmtWhen(op.readyAtSec)} — anyone may call execute
      </p>
    )
  }
  if (op.status === 'done') return <p className="gov-op__countdown gov-op__countdown--done">executed</p>
  return (
    <p className="gov-op__countdown gov-op__countdown--done">
      cancelled — <code>getTimestamp</code> reads 0, so it can never execute
    </p>
  )
}

function OperationRow({ op, chainId, nowSec }: { op: QueuedOperation; chainId: ChainId; nowSec: number }) {
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
        · delay {fmtHours(op.delaySec)} · id <code>{shortAddr(op.id, 10, 4)}</code>
      </p>
      {op.status === 'pending' && remaining > 0 && <DelayGauge op={op} remaining={remaining} />}
      <OpStatusLine op={op} nowSec={nowSec} />
    </li>
  )
}

function HandoverCard({
  chainId,
  ops,
  ownership,
  nowSec,
}: {
  chainId: ChainId
  ops: ReadState<Awaited<ReturnType<typeof readOperations>>>
  ownership: ReadState<OwnershipRow[]>
  nowSec: number
}) {
  const d = DEPLOYMENTS[chainId]
  const targets = [d.vault, d.clPoolManagerOwner, d.binPoolManagerOwner]
    .filter((a): a is `0x${string}` => a !== null)
    .map((a) => a.toLowerCase())

  const accepts =
    ops.k === 'ready'
      ? ops.data.operations.filter(
          (op) =>
            op.tier === 'Custody' &&
            op.decodedCall === 'acceptOwnership()' &&
            targets.includes(op.target.toLowerCase()),
        )
      : []

  return (
    <section className="dapp-card gov-card">
      <div className="dapp-card__head">
        <h2 className="dapp-card__title">Custody handover</h2>
        {ops.k === 'ready' ? <LiveBadge /> : ops.k === 'error' ? <span className="dapp-badge dapp-badge--warn">NOT READ</span> : null}
      </div>
      <p className="live-note">
        The Vault and both pool-manager wrappers are meant to answer to the custody timelock. Each needs
        its own queued <code>acceptOwnership()</code> to execute on that timelock. After it does,{' '}
        <code>owner()</code> should read the custody timelock — that read, not the queued operation, is
        the proof.
      </p>
      {(ops.k === 'loading' || ops.k === 'idle') && (
        <p className="live-note dapp-state--loading" role="status">
          Reading CallScheduled logs on the custody timelock&hellip;
        </p>
      )}
      {ops.k === 'error' && (
        <p className="live-note live-note--err" role="status">
          {failureCopy(ops.kind, d.name)} {ops.message}
        </p>
      )}
      {ops.k === 'ready' && accepts.length === 0 && (
        <p className="live-note">
          No <code>acceptOwnership()</code> for the Vault or the wrappers has been scheduled on the custody
          timelock since block {ops.data.fromBlock.toString()}.
        </p>
      )}
      {accepts.length > 0 && (
        <ul className="gov-ops">
          {accepts.map((op) => {
            const row =
              ownership.k === 'ready'
                ? ownership.data.find((r) => r.contractAddress.toLowerCase() === op.target.toLowerCase())
                : undefined
            const final = row?.chain[row.chain.length - 1]
            return (
              <li key={`${op.id}-${op.index}`} className="gov-op">
                <div className="gov-op__head">
                  <span className={`dapp-badge ${STATUS_BADGE[op.status]}`}>{op.status.toUpperCase()}</span>
                  <span className="dapp-microlabel gov-op__tier">
                    {nameForAddress(chainId, op.target) ?? shortAddr(op.target)}
                  </span>
                </div>
                <OpStatusLine op={op} nowSec={nowSec} />
                <p className="live-note gov-op__meta">
                  <code>owner()</code> now:{' '}
                  {ownership.k === 'ready'
                    ? final
                      ? `${final.label}${final.kind === 'custody-timelock' ? ' — handover confirmed by read' : ' — not handed over yet'}`
                      : 'owner() reverted'
                    : ownership.k === 'error'
                      ? 'not read'
                      : 'reading…'}
                  {' · '}operation id <code>{shortAddr(op.id, 10, 4)}</code>
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* --------------------------------------------------------------------------
   Screen
   -------------------------------------------------------------------------- */

export default function Governance() {
  const { browsingChain: chainId } = useDapp()
  const chainName = DEPLOYMENTS[chainId].name

  const safe = useChainRead(`gov:safe:${chainId}`, () => readSafeStatus(chainId))
  const timelocks = useChainRead(`gov:timelocks:${chainId}`, () => readTimelocks(chainId))
  const ownership = useChainRead(`gov:ownership:${chainId}`, () => readOwnershipTable(chainId))
  const ops = useChainRead(`gov:ops:${chainId}`, () => readOperations(chainId))

  const hasPending = ops.state.k === 'ready' && ops.state.data.operations.some((op) => op.status === 'pending')
  const nowSec = useNowSeconds(hasPending)

  const eoaCount = ownership.state.k === 'ready' ? ownership.state.data.filter((r) => r.isEOAOwned).length : 0

  return (
    <div className="dapp-stack gov-screen">
      <div className="dapp-card__bar gov-summary">
        <h2 className="dapp-microlabel">GOVERNANCE · {chainName.toUpperCase()}</h2>
        <ChainTag chainId={chainId} />
        {eoaCount > 0 && <span className="dapp-badge dapp-badge--danger">{eoaCount} EOA-OWNED</span>}
        {ops.state.k === 'ready' && (
          <span className="live-fee gov-summary__block">head block {ops.state.data.latestBlock.toString()}</span>
        )}
      </div>

      <div className="dapp-row dapp-row--pool">
        <Section
          title="Governance Safe"
          state={safe.state}
          chainName={chainName}
          onRetry={safe.reload}
          loading={`Reading the Safe from ${chainName}…`}
        >
          {(s) => <SafeBody safe={s} ownership={ownership.state} />}
        </Section>
        <Section
          title="Timelocks"
          state={timelocks.state}
          chainName={chainName}
          onRetry={timelocks.reload}
          loading={`Reading both timelocks’ delays and roles from ${chainName}…`}
        >
          {(t) => <TimelocksBody d={t} chainId={chainId} />}
        </Section>
      </div>

      <HandoverCard chainId={chainId} ops={ops.state} ownership={ownership.state} nowSec={nowSec} />

      <Section
        title="Ownership"
        state={ownership.state}
        chainName={chainName}
        onRetry={ownership.reload}
        loading={`Reading owner() and pendingOwner() on every tracked contract from ${chainName}…`}
      >
        {(rows) => <OwnershipBody rows={rows} chainId={chainId} />}
      </Section>

      <Section
        title="Queued timelock operations"
        state={ops.state}
        chainName={chainName}
        onRetry={ops.reload}
        loading={`Reading CallScheduled logs on both timelocks from ${chainName}…`}
      >
        {(o) =>
          o.operations.length === 0 ? (
            <div className="an-empty">
              <p className="an-empty__title">Nothing has ever been queued</p>
              <p className="live-note">
                Neither timelock on {chainName} has emitted a CallScheduled event between block{' '}
                {o.fromBlock.toString()} and {o.latestBlock.toString()}.
              </p>
            </div>
          ) : (
            <ul className="gov-ops">
              {o.operations.map((op) => (
                <OperationRow key={`${op.id}-${op.index}`} op={op} chainId={chainId} nowSec={nowSec} />
              ))}
            </ul>
          )
        }
      </Section>
    </div>
  )
}

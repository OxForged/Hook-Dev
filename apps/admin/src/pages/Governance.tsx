import { AlertList } from '../components/Alerts.tsx'
import { Addr, Chip, Panel, severityTone, StateView, Table, type Tone } from '../components/ui.tsx'
import { qs } from '../lib/api.ts'
import { duration, group, shortHash, utc } from '../lib/format.ts'
import { useApi, useNow } from '../lib/useApi.ts'
import type { Alert, TimelockOperation } from './types.ts'

interface Cell { observed: string | null; expected: string | null; expectedTier: string; matches: boolean | null; readError: string | null; readAtBlock: string; readAt: string }
interface Ownership {
  chainId: number
  source: string
  addresses: { safe: string; timelockCustody: string; timelockPolicy: string }
  contracts: { contractKey: string; address: string; expectedTier: string; expectedAddress: string | null; owner: Cell | null; pendingOwner: Cell | null; alert: Alert | null }[]
  otherChecks: { contractKey: string; address: string; check: string; observed: string | null; expectedTier: string; expected: string | null; matches: boolean | null; readError: string | null; readAtBlock: string }[]
  alerts: Alert[]
}
interface Timelock {
  now: string
  source: string
  timelocks: { tier: string; address: string }[]
  doNotQueue: string[]
  custodyHandover: { note: string; items: { contractKey: string; target: string | null; operationId: string | null; status: string; readyAt: string | null; saltIndexed: boolean }[] }
  operations: TimelockOperation[]
  delayChanges: { timelock: string; tier: string; newDelaySeconds: string | null; blockNumber: string }[]
}
interface Roles {
  source: string
  holders: { contractKey: string; contract: string; role: string; account: string; accountLabel: string | null; lastChange: { event: string; blockNumber: string; txHash: string } }[]
  revoked: { contractKey: string; role: string; account: string; accountLabel: string | null; lastChange: { blockNumber: string } }[]
  currentReads: { contractKey: string; check: string; observed: string | null; observedLabel: string | null; expectedTier: string; matches: boolean | null; readError: string | null; readAtBlock: string }[]
}

const statusTone = (s: string): Tone => (s === 'READY' ? 'high' : s === 'PENDING' ? 'medium' : s === 'EXECUTED' ? 'ok' : 'muted')
const matchChip = (m: boolean | null, err: string | null) =>
  err ? <Chip tone="medium" title={err}>unreadable</Chip> : m === null ? <Chip tone="muted">not read</Chip> : m ? <Chip tone="ok">matches</Chip> : <Chip tone="high">differs</Chip>

function Countdown({ readyAt, status }: { readyAt: string | null; status: string }) {
  const now = useNow(1000)
  if (status === 'CANCELLED') return <span className="muted">cancelled; never executable</span>
  if (status === 'EXECUTED') return <span className="muted">done</span>
  if (!readyAt) return <span className="muted">no ready time</span>
  const s = (new Date(readyAt).getTime() - now.getTime()) / 1000
  return s > 0 ? <span>executable in <strong className="tabular">{duration(s)}</strong><div className="muted small">{utc(readyAt)}</div></span> : <span><strong>executable now</strong> by anyone<div className="muted small">since {utc(readyAt)}</div></span>
}

export function GovernancePage({ chainId }: { chainId: number }) {
  const own = useApi<Ownership>(`/governance/ownership${qs({ chainId })}`)
  const tl = useApi<Timelock>(`/governance/timelock${qs({ chainId })}`)
  const roles = useApi<Roles>(`/governance/roles${qs({ chainId })}`)

  return (
    <div className="stack">
      <Panel title="Ownership check: expected tier vs owner() and pendingOwner()" id="ownership" provenance="ownership_snapshots, read by the worker's governance pass at the stated block. pendingOwner is read on the owner wrappers, not the pool managers.">
        <StateView state={own.state} reload={own.reload} isEmpty={(o) => o.contracts.length === 0} empty="The governance pass has not written any ownership read yet. Run governance:once or start the worker.">
          {(o) => (
            <>
              {o.alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH').length > 0 ? <AlertList alerts={o.alerts.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH')} /> : null}
              <Table caption="Ownership check">
                <thead>
                  <tr>
                    <th scope="col">Contract</th>
                    <th scope="col">Expected tier</th>
                    <th scope="col">owner()</th>
                    <th scope="col">pendingOwner()</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {o.contracts.map((c) => {
                    const label = (a: string | null) => (a === o.addresses.safe.toLowerCase() ? 'Safe' : a === o.addresses.timelockCustody.toLowerCase() ? 'custody timelock' : a === o.addresses.timelockPolicy.toLowerCase() ? 'policy timelock' : a && /^0x0{40}$/.test(a) ? 'none' : null)
                    return (
                      <tr key={c.contractKey} className={c.alert ? `row--${c.alert.severity.toLowerCase()}` : undefined}>
                        <th scope="row"><code>{c.contractKey}</code><div><Addr value={c.address} /></div></th>
                        <td>{c.expectedTier}</td>
                        <td>{c.owner ? <Addr value={c.owner.observed} label={label(c.owner.observed)} /> : '—'}{c.owner ? <div className="muted small">block {group(c.owner.readAtBlock)}</div> : null}</td>
                        <td>{c.pendingOwner ? <Addr value={c.pendingOwner.observed} label={label(c.pendingOwner.observed)} /> : <span className="muted">not checked</span>}</td>
                        <td>{c.alert ? <Chip tone={severityTone(c.alert.severity)} title={c.alert.detail}>{c.alert.severity}: {c.alert.title.split(': ').slice(1).join(': ') || 'differs'}</Chip> : matchChip(c.owner?.matches ?? null, c.owner?.readError ?? null)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <h3 className="subhead">Guardians, treasury and role reads</h3>
              <Table caption="Other governance checks">
                <thead><tr><th scope="col">Contract</th><th scope="col">Check</th><th scope="col">Expected</th><th scope="col">Observed</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {o.otherChecks.map((r) => (
                    <tr key={`${r.contractKey}-${r.check}`}>
                      <td><code>{r.contractKey}</code></td>
                      <td><code className="small">{r.check.replace(/:0x[0-9a-f]{40}$/, (m) => `:${m.slice(1, 7)}…`)}</code></td>
                      <td>{r.expectedTier}</td>
                      <td>{r.observed && /^0x[0-9a-f]{40}$/.test(r.observed) ? <Addr value={r.observed} /> : <code>{r.observed ?? '—'}</code>}</td>
                      <td>{matchChip(r.matches, r.readError)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </StateView>
      </Panel>

      <Panel title="Timelock operations" id="timelock" provenance="timelock_events (CallScheduled, CallSalt, CallExecuted, Cancelled) on the SDK timelocks; ready time = scheduling block timestamp + delay, exactly as TimelockController stores it">
        <StateView state={tl.state} reload={tl.reload}>
          {(t) => (
            <>
              <h3 className="subhead">Custody handover: acceptOwnership() queued on the custody timelock</h3>
              <p className="muted small">{t.custodyHandover.note} Do-not-queue selectors: {t.doNotQueue.map((s) => <code key={s}>{s} </code>)}</p>
              <Table caption="Custody handover operations">
                <thead><tr><th scope="col">Contract</th><th scope="col">Operation</th><th scope="col">Status</th><th scope="col">When</th><th scope="col">Action</th></tr></thead>
                <tbody>
                  {t.custodyHandover.items.map((h) => {
                    const op = t.operations.find((o) => o.operationId === h.operationId)
                    return (
                      <tr key={h.contractKey}>
                        <th scope="row"><code>{h.contractKey}</code><div><Addr value={h.target} /></div></th>
                        <td>{h.operationId ? <code title={h.operationId}>{shortHash(h.operationId)}</code> : <span className="muted">none indexed</span>}</td>
                        <td><Chip tone={statusTone(h.status)}>{h.status}</Chip></td>
                        <td>{op ? <Countdown readyAt={op.readyAt} status={op.status} /> : <span className="muted">—</span>}</td>
                        <td>{h.status === 'READY' ? <a className="btn btn--xs" href="#/safe-actions">Prepare execute()</a> : <span className="muted small">{h.status === 'PENDING' ? 'wait for the delay' : '—'}</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>

              <h3 className="subhead">All operations ({t.operations.length})</h3>
              {t.operations.length === 0 ? <div className="state state--empty">No CallScheduled event on either timelock.</div> : (
                <Table caption="Timelock operations">
                  <thead><tr><th scope="col">Tier</th><th scope="col">Operation</th><th scope="col">Calls (decoded)</th><th scope="col">Status</th><th scope="col">When</th><th scope="col">Review flags</th></tr></thead>
                  <tbody>
                    {t.operations.map((o) => (
                      <tr key={`${o.timelock}-${o.operationId}`} className={o.hazards.length && (o.status === 'PENDING' || o.status === 'READY') ? 'row--critical' : undefined}>
                        <td>{o.tier}</td>
                        <td><code title={o.operationId}>{shortHash(o.operationId)}</code><div className="muted small">scheduled block {group(o.scheduledAt.blockNumber)}</div>{o.salt ? <div className="muted small" title={o.salt}>salt {shortHash(o.salt)}</div> : null}</td>
                        <td>
                          {o.calls.map((c) => (
                            <div key={c.index} className="call">
                              <code>{c.decoded ? `${c.decoded.functionName}(${c.decoded.args.map((a) => (Array.isArray(a.value) ? `[${a.value.length}]` : a.value.length > 20 ? `${a.value.slice(0, 10)}…` : a.value)).join(', ')})` : (c.functionSignature ?? c.selector ?? 'raw data')}</code>
                              <span className="muted small"> on <Addr value={c.target} /></span>
                              {c.roleName ? <Chip tone="info">{c.roleName}</Chip> : null}
                            </div>
                          ))}
                        </td>
                        <td><Chip tone={statusTone(o.status)}>{o.status}</Chip></td>
                        <td><Countdown readyAt={o.readyAt} status={o.status} /></td>
                        <td>{o.hazards.length ? o.hazards.map((h) => <Chip key={h} tone="critical" title={o.calls.find((c) => c.hazard === h)?.hazardNote ?? undefined}>{h}</Chip>) : <span className="muted">none</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {t.delayChanges.length > 0 ? (
                <p className="state state--error">MinDelayChange recorded: {t.delayChanges.map((c) => `${c.tier} -> ${c.newDelaySeconds}s at block ${c.blockNumber}`).join('; ')}</p>
              ) : null}
            </>
          )}
        </StateView>
      </Panel>

      <Panel title="Role holders" id="roles" provenance="RoleGranted/RoleRevoked and PausableRoleGranted/Revoked replayed from logs; guardian(), treasury() and hasRole() read by the governance pass">
        <StateView state={roles.state} reload={roles.reload}>
          {(r) => (
            <>
              {r.holders.length === 0 ? (
                <div className="state state--empty">No role event indexed yet. Role events were added to the watch set in this release; the first worker pass re-reads history from the deployment block.</div>
              ) : (
                <Table caption="Role holders">
                  <thead><tr><th scope="col">Contract</th><th scope="col">Role</th><th scope="col">Holder</th><th scope="col">Granted at</th></tr></thead>
                  <tbody>
                    {r.holders.map((h) => (
                      <tr key={`${h.contract}-${h.role}-${h.account}`}>
                        <td><code>{h.contractKey}</code></td>
                        <td><Chip tone={h.role === 'CANCELLER_ROLE' ? 'info' : 'muted'}>{h.role}</Chip></td>
                        <td><Addr value={h.account} label={h.accountLabel} /></td>
                        <td className="muted">block {group(h.lastChange.blockNumber)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {r.revoked.length > 0 ? <p className="muted small">Revoked: {r.revoked.map((x) => `${x.role} ${x.accountLabel ?? x.account.slice(0, 8)} on ${x.contractKey}`).join('; ')}</p> : null}
            </>
          )}
        </StateView>
      </Panel>
    </div>
  )
}

import { useId, useState } from 'react'
import { Field, Panel, StateView, Table } from '../components/ui.tsx'
import { qs } from '../lib/api.ts'
import { shortAddr, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface AuditPageData { total: number; limit: number; offset: number; items: { id: string; actor: string; actorRoles: string[]; action: string; targetType: string | null; targetId: string | null; before: unknown; after: unknown; requestId: string | null; ip: string | null; createdAt: string }[] }

export function AuditPage() {
  const id = useId()
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
  const [from, setFrom] = useState('')
  const [offset, setOffset] = useState(0)
  const actorOk = actor === '' || /^0x[0-9a-fA-F]{40}$/.test(actor)
  const { state, reload } = useApi<AuditPageData>(`/audit${qs({ actor: actorOk ? actor.toLowerCase() || undefined : undefined, action: action || undefined, targetType: targetType || undefined, from: from || undefined, limit: 50, offset })}`)

  return (
    <div className="stack">
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Audit filters">
        <Field label="Actor address" htmlFor={`${id}-actor`} hint={actorOk ? undefined : 'Enter a full 0x address'}><input id={`${id}-actor`} value={actor} aria-invalid={!actorOk} onChange={(e) => (setActor(e.target.value.trim()), setOffset(0))} spellCheck={false} /></Field>
        <Field label="Action starts with" htmlFor={`${id}-action`} hint="e.g. apikey, listing, auth, safe.prepare"><input id={`${id}-action`} value={action} pattern="[a-z0-9.-]{1,64}" onChange={(e) => (setAction(e.target.value.trim().toLowerCase()), setOffset(0))} /></Field>
        <Field label="Target type" htmlFor={`${id}-tt`}>
          <select id={`${id}-tt`} value={targetType} onChange={(e) => (setTargetType(e.target.value), setOffset(0))}>
            <option value="">Any</option>
            {['session', 'api_key', 'api_account', 'listing_submission', 'fee_controller', 'timelock_operation', 'latch', 'revenue_ledger'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="From (UTC date)" htmlFor={`${id}-from`}><input id={`${id}-from`} type="date" value={from} onChange={(e) => (setFrom(e.target.value), setOffset(0))} /></Field>
      </form>
      <Panel title="Audit log" provenance="audit_log: every sign-in, sign-out, denial, role change, mutation, payload preparation and export. Written by the API; never editable from here." actions={<button type="button" className="btn btn--xs" onClick={reload}>Refresh</button>}>
        <StateView state={state} reload={reload} isEmpty={(a) => a.items.length === 0} empty="No audit entries match these filters.">
          {(a) => (
            <>
              <Table caption="Audit entries">
                <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Change</th><th scope="col">Request</th></tr></thead>
                <tbody>
                  {a.items.map((e) => (
                    <tr key={e.id}>
                      <td className="small">{utc(e.createdAt)}</td>
                      <td><code title={e.actor}>{shortAddr(e.actor)}</code><div className="muted small">{e.actorRoles.join(', ') || 'no role'}</div></td>
                      <td><code>{e.action}</code></td>
                      <td className="small">{e.targetType ?? '—'}<div className="muted"><code>{e.targetId ?? ''}</code></div></td>
                      <td className="small">
                        {e.before || e.after ? (
                          <details>
                            <summary>before / after</summary>
                            <pre className="json">{JSON.stringify({ before: e.before ?? null, after: e.after ?? null }, null, 2)}</pre>
                          </details>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="small muted">{e.requestId ? <code title={e.requestId}>{e.requestId.slice(0, 8)}</code> : '—'}{e.ip ? <div>{e.ip}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="pager">
                <button type="button" className="btn btn--xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
                <span className="muted">{offset + 1}–{Math.min(offset + 50, a.total)} of {a.total}</span>
                <button type="button" className="btn btn--xs" disabled={offset + 50 >= a.total} onClick={() => setOffset(offset + 50)}>Next</button>
              </div>
            </>
          )}
        </StateView>
      </Panel>
    </div>
  )
}

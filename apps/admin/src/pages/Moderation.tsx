import { useId, useState } from 'react'
import { Chip, Field, KV, Panel, StateView, Table, type Tone } from '../components/ui.tsx'
import { apiPost, ApiError, BASE, qs } from '../lib/api.ts'
import { utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface ListingRow { id: string; kind: string; status: string; name: string; description: string; websiteUrl: string | null; sourceUrl: string | null; category: string | null; categoryOther: string | null; uses: string[]; ownLatch: string | null; chains: number[]; iconSourceUrl: string | null; hasIcon: boolean; turnstileVerified: boolean; reviewer: string | null; reviewNotes: string | null; reviewedAt: string | null; createdAt: string }
interface Queue { total: number; counts: Record<string, number>; items: ListingRow[] }
interface Detail extends ListingRow { contactPrivate: string | null; icon: { contentType: string; byteLength: number; width: number | null; height: number | null; sha256: string } | null }

const STATUSES = ['PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'] as const
const tone = (s: string): Tone => (s === 'PENDING' ? 'medium' : s === 'APPROVED' ? 'ok' : s === 'REJECTED' ? 'high' : 'info')

/** Only http(s) is ever rendered as a link; anything else is inert text. */
function SafeLink({ href }: { href: string | null }) {
  if (!href) return <span className="muted">—</span>
  return /^https:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {href}
    </a>
  ) : (
    <code>{href}</code>
  )
}

export function ModerationPage() {
  const id = useId()
  const [status, setStatus] = useState<string>('PENDING')
  const [selected, setSelected] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const queue = useApi<Queue>(`/moderation/listings${qs({ status, limit: 100 })}`)
  const detail = useApi<Detail>(selected ? `/moderation/listings/${selected}` : null)

  const act = (action: 'approve' | 'reject' | 'request-changes') => {
    if (!selected) return
    setBusy(true)
    setResult(null)
    apiPost<{ status: string }>(`/moderation/listings/${selected}/${action}`, action === 'approve' ? (reason.trim() ? { note: reason.trim() } : {}) : { reason: reason.trim() })
      .then((r) => {
        setResult({ ok: true, text: `Recorded: ${r.status}. The audit log has the entry.` })
        setReason('')
        queue.reload()
        detail.reload()
      })
      .catch((e: unknown) => setResult({ ok: false, text: e instanceof ApiError ? (e.failure.kind === 'error' && e.failure.details ? `${e.failure.message}: ${e.failure.details.map((d) => d.message).join('; ')}` : e.failure.message) : String(e) }))
      .finally(() => setBusy(false))
  }

  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Submission status">
        {STATUSES.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} className={`tab ${status === s ? 'tab--active' : ''}`} onClick={() => (setStatus(s), setSelected(null))}>
            {s.replace('_', ' ').toLowerCase()}
            {queue.state.kind === 'ok' && queue.state.data.counts[s] !== undefined ? <span className="tab__count">{queue.state.data.counts[s]}</span> : null}
          </button>
        ))}
      </div>
      <div className="grid-split">
        <Panel title="Submissions" provenance="listing_submissions, from the public POST /v1/listings. Nothing is public until approved.">
          <StateView state={queue.state} reload={queue.reload} isEmpty={(q) => q.items.length === 0} empty={`No ${status.replace('_', ' ').toLowerCase()} submissions.`}>
            {(q) => (
              <Table caption="Listing submissions">
                <thead><tr><th scope="col">Submitted</th><th scope="col">Name</th><th scope="col">Category</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {q.items.map((l) => (
                    <tr key={l.id} className={selected === l.id ? 'row--selected' : undefined}>
                      <td className="small">{utc(l.createdAt)}</td>
                      <td>
                        <button type="button" className="linkish" onClick={() => (setSelected(l.id), setResult(null))} aria-pressed={selected === l.id}>
                          {l.name}
                        </button>
                      </td>
                      <td>{l.category}{l.categoryOther ? `: ${l.categoryOther}` : ''}</td>
                      <td><Chip tone={tone(l.status)}>{l.status}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </StateView>
        </Panel>

        <Panel title="Review" provenance="Submitted by the project · not verified by Latch Protocol. Contact is private: never published, shown to curators only.">
          {!selected ? (
            <div className="state state--empty">Choose a submission to review it.</div>
          ) : (
            <StateView state={detail.state} reload={detail.reload}>
              {(d) => (
                <div className="stack stack--tight">
                  <div className="review-head">
                    {d.icon ? <img className="review-icon" src={`${BASE}/moderation/listings/${d.id}/icon`} alt={`Icon submitted by ${d.name} (processed server-side)`} width={48} height={48} /> : <span className="review-icon review-icon--none" aria-hidden="true">{d.name.slice(0, 2).toUpperCase()}</span>}
                    <div>
                      <h3 className="subhead">{d.name}</h3>
                      <Chip tone={tone(d.status)}>{d.status}</Chip>
                    </div>
                  </div>
                  <p>{d.description}</p>
                  <KV
                    rows={[
                      ['Website', <SafeLink key="w" href={d.websiteUrl} />],
                      ['Source', <SafeLink key="s" href={d.sourceUrl} />],
                      ['Category', `${d.category ?? '—'}${d.categoryOther ? `: ${d.categoryOther}` : ''}`],
                      ['Latch families', d.uses.join(', ') || '—'],
                      ['Own Latch', d.ownLatch ?? '—'],
                      ['Chains (claimed)', d.chains.join(', ') || '—'],
                      ['Icon', d.icon ? `${d.icon.contentType}, ${d.icon.byteLength} bytes${d.icon.width ? `, ${d.icon.width}x${d.icon.height}` : ''} (rebuilt server-side)` : 'none'],
                      ['Icon published at', <SafeLink key="i" href={d.iconSourceUrl} />],
                      ['Contact (private)', d.contactPrivate ?? '—'],
                      ['Captcha', d.turnstileVerified ? 'Turnstile verified' : 'not required at submission'],
                      ['Reviewed', d.reviewedAt ? `${utc(d.reviewedAt)} by ${d.reviewer}: ${d.reviewNotes ?? ''}` : 'not yet'],
                    ]}
                  />
                  <Field label="Reason or note" htmlFor={`${id}-reason`} hint="Required to reject or request changes (10+ characters); shown to the submitter. Optional note on approve.">
                    <textarea id={`${id}-reason`} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <div className="actions">
                    <button type="button" className="btn btn--primary" disabled={busy || d.status !== 'PENDING'} onClick={() => act('approve')}>Approve</button>
                    <button type="button" className="btn" disabled={busy || d.status !== 'PENDING' || reason.trim().length < 10} onClick={() => act('request-changes')}>Request changes</button>
                    <button type="button" className="btn btn--danger" disabled={busy || !(d.status === 'PENDING' || d.status === 'APPROVED') || reason.trim().length < 10} onClick={() => act('reject')}>{d.status === 'APPROVED' ? 'Take down' : 'Reject'}</button>
                  </div>
                  {result ? <p className={`state ${result.ok ? 'state--ok' : 'state--error'}`} role="status">{result.text}</p> : null}
                </div>
              )}
            </StateView>
          )}
        </Panel>
      </div>
    </div>
  )
}

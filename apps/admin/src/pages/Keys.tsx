import { useId, useState } from 'react'
import { Chip, CopyButton, Field, Panel, StateView, Table } from '../components/ui.tsx'
import { apiPost, ApiError } from '../lib/api.ts'
import { ago, group, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface Accounts { items: { id: string; name: string; plan: string; keys: number; billingProvider: string | null; createdAt: string }[] }
interface Keys { period: string; usageSource: string; items: { id: string; account: { id: string; name: string }; name: string; prefix: string; scopes: string[]; status: string; rateLimitPerMinute: number; monthlyQuota: number; createdAt: string; expiresAt: string | null; revokedAt: string | null; revokedReason: string | null; lastUsedAt: string | null; usage: { period: string; requests: string; flushedAt: string }[] }[] }

const errText = (e: unknown) => (e instanceof ApiError ? (e.failure.kind === 'error' && e.failure.details ? `${e.failure.message}: ${e.failure.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : e.failure.message) : String(e))

export function KeysPage() {
  const id = useId()
  const accounts = useApi<Accounts>('/keys/accounts')
  const keys = useApi<Keys>('/keys')
  const [accName, setAccName] = useState('')
  const [accPlan, setAccPlan] = useState('free')
  const [mint, setMint] = useState({ accountId: '', name: '', dex: true, rpm: '', quota: '' })
  const [secret, setSecret] = useState<{ prefix: string; secret: string } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (p: Promise<unknown>, ok: string) => {
    setBusy(true)
    setMsg(null)
    p.then(() => setMsg({ ok: true, text: ok }))
      .catch((e: unknown) => setMsg({ ok: false, text: errText(e) }))
      .finally(() => {
        setBusy(false)
        accounts.reload()
        keys.reload()
      })
  }

  return (
    <div className="stack">
      {secret ? (
        <div className="secret" role="alert">
          <strong>Copy this key now. It is shown once and cannot be recovered.</strong>
          <div className="secret__row">
            <code className="secret__value">{secret.secret}</code>
            <CopyButton text={secret.secret} label="Copy key" />
          </div>
          <p className="small">Stored server-side as an HMAC only. Listings show the prefix {secret.prefix}. A lost key is revoked and re-minted.</p>
          <button type="button" className="btn btn--xs" onClick={() => setSecret(null)}>I have stored it; hide</button>
        </div>
      ) : null}
      {msg ? <p className={`state ${msg.ok ? 'state--ok' : 'state--error'}`} role="status">{msg.text}</p> : null}

      <div className="grid-2">
        <Panel title="Accounts" provenance="api_accounts. Billing is not wired: plan is a label.">
          <StateView state={accounts.state} reload={accounts.reload} isEmpty={(a) => a.items.length === 0} empty="No API account yet.">
            {(a) => (
              <Table caption="API accounts">
                <thead><tr><th scope="col">Name</th><th scope="col">Plan</th><th scope="col" className="num">Keys</th><th scope="col">Created</th></tr></thead>
                <tbody>{a.items.map((x) => (<tr key={x.id}><td>{x.name}<div className="muted small"><code>{x.id}</code></div></td><td>{x.plan}</td><td className="num">{x.keys}</td><td className="small">{utc(x.createdAt)}</td></tr>))}</tbody>
              </Table>
            )}
          </StateView>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              run(apiPost('/keys/accounts', { name: accName.trim(), plan: accPlan.trim() || 'free' }).then(() => setAccName('')), 'Account created (audited).')
            }}
          >
            <Field label="New account name" htmlFor={`${id}-acc`}><input id={`${id}-acc`} value={accName} maxLength={120} onChange={(e) => setAccName(e.target.value)} required /></Field>
            <Field label="Plan" htmlFor={`${id}-plan`}><input id={`${id}-plan`} value={accPlan} pattern="[a-z0-9-]{1,32}" onChange={(e) => setAccPlan(e.target.value)} /></Field>
            <button type="submit" className="btn" disabled={busy || !accName.trim()}>Create account</button>
          </form>
        </Panel>

        <Panel title="Mint a key" provenance="POST /v1/admin/keys (admin role, CSRF, audited with the prefix only)">
          <form
            className="stack stack--tight"
            onSubmit={(e) => {
              e.preventDefault()
              const body = { accountId: mint.accountId, name: mint.name.trim(), scopes: mint.dex ? ['public:read', 'dexscreener:read'] : ['public:read'], ...(mint.rpm ? { rateLimitPerMinute: Number(mint.rpm) } : {}), ...(mint.quota ? { monthlyQuota: Number(mint.quota) } : {}) }
              run(
                apiPost<{ key: { prefix: string }; secret: string }>('/keys', body).then((r) => {
                  setSecret({ prefix: r.key.prefix, secret: r.secret })
                  setMint((m) => ({ ...m, name: '' }))
                }),
                'Key minted (audited).',
              )
            }}
          >
            <Field label="Account" htmlFor={`${id}-macc`}>
              <select id={`${id}-macc`} value={mint.accountId} onChange={(e) => setMint({ ...mint, accountId: e.target.value })} required>
                <option value="">Choose an account</option>
                {accounts.state.kind === 'ok' ? accounts.state.data.items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>) : null}
              </select>
            </Field>
            <Field label="Key name" htmlFor={`${id}-mname`}><input id={`${id}-mname`} value={mint.name} maxLength={120} onChange={(e) => setMint({ ...mint, name: e.target.value })} required /></Field>
            <div className="field field--check"><input id={`${id}-dex`} type="checkbox" checked={mint.dex} onChange={(e) => setMint({ ...mint, dex: e.target.checked })} /><label htmlFor={`${id}-dex`}>Include dexscreener:read (public:read always)</label></div>
            <div className="grid-2 grid-2--tight">
              <Field label="Requests / minute" htmlFor={`${id}-rpm`} hint="Blank = server default"><input id={`${id}-rpm`} inputMode="numeric" pattern="[0-9]*" value={mint.rpm} onChange={(e) => setMint({ ...mint, rpm: e.target.value })} /></Field>
              <Field label="Monthly quota" htmlFor={`${id}-quota`} hint="Blank = server default"><input id={`${id}-quota`} inputMode="numeric" pattern="[0-9]*" value={mint.quota} onChange={(e) => setMint({ ...mint, quota: e.target.value })} /></Field>
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy || !mint.accountId || !mint.name.trim()}>Mint key</button>
          </form>
        </Panel>
      </div>

      <Panel title="Keys and usage" provenance={keys.state.kind === 'ok' ? keys.state.data.usageSource : 'api_keys, api_usage_monthly'}>
        <StateView state={keys.state} reload={keys.reload} isEmpty={(k) => k.items.length === 0} empty="No API key has been minted.">
          {(k) => (
            <Table caption="API keys">
              <thead><tr><th scope="col">Key</th><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Limits</th><th scope="col">Usage by month</th><th scope="col">Last used</th><th scope="col">Revoke</th></tr></thead>
              <tbody>
                {k.items.map((x) => (
                  <tr key={x.id}>
                    <th scope="row"><code>{x.prefix}</code><div className="muted small">{x.name} · {x.scopes.join(', ')}</div></th>
                    <td>{x.account.name}</td>
                    <td><Chip tone={x.status === 'ACTIVE' ? 'ok' : 'muted'} title={x.revokedReason ?? undefined}>{x.status}</Chip>{x.expiresAt ? <div className="muted small">expires {utc(x.expiresAt)}</div> : null}</td>
                    <td className="small">{group(x.rateLimitPerMinute)}/min<br />{group(x.monthlyQuota)}/month</td>
                    <td className="small">{x.usage.length === 0 ? <span className="muted">no flushed usage</span> : x.usage.slice(0, 4).map((u) => <div key={u.period}>{u.period}: {group(u.requests)}</div>)}</td>
                    <td className="small">{x.lastUsedAt ? ago(x.lastUsedAt) : <span className="muted">never</span>}</td>
                    <td>{x.status === 'ACTIVE' ? <RevokeButton keyId={x.id} prefix={x.prefix} onDone={(t, ok) => (setMsg({ ok, text: t }), keys.reload())} /> : <span className="muted small">{x.revokedAt ? utc(x.revokedAt) : ''}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </StateView>
      </Panel>
    </div>
  )
}

function RevokeButton({ keyId, prefix, onDone }: { keyId: string; prefix: string; onDone: (text: string, ok: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const id = useId()
  if (!open) return <button type="button" className="btn btn--danger btn--xs" onClick={() => setOpen(true)}>Revoke</button>
  return (
    <form className="inline-form" onSubmit={(e) => {
      e.preventDefault()
      apiPost<{ effective: string }>(`/keys/${keyId}/revoke`, { reason: reason.trim() })
        .then((r) => onDone(`Revoked ${prefix}: effective ${r.effective}.`, true))
        .catch((err: unknown) => onDone(errText(err), false))
    }}>
      <label className="sr-only" htmlFor={`${id}-r`}>Reason for revoking {prefix}</label>
      <input id={`${id}-r`} value={reason} placeholder="reason" minLength={3} maxLength={300} onChange={(e) => setReason(e.target.value)} required />
      <button type="submit" className="btn btn--danger btn--xs" disabled={reason.trim().length < 3}>Confirm</button>
      <button type="button" className="btn btn--ghost btn--xs" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  )
}

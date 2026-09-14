import { useId, useState } from 'react'
import { PayloadView, SimulationView } from '../components/Payload.tsx'
import { Addr, Chip, Field, Panel, StateView } from '../components/ui.tsx'
import { apiPost, ApiError, hasRole, qs, type Session } from '../lib/api.ts'
import { duration, shortHash, utc } from '../lib/format.ts'
import { useApi, useNow } from '../lib/useApi.ts'
import type { SimulationResult, TimelockOperation, TxPayload } from './types.ts'

interface SafeContext { chainId: number; chainName: string; safe: string; safeAppUrl: string | null; safeAppSource: string | null; contracts: Record<string, string | null>; note: string }
interface TimelockView { custodyHandover: { items: { contractKey: string; target: string | null; operationId: string | null; status: string; readyAt: string | null }[] }; operations: TimelockOperation[] }
type Built =
  | { kind: 'execute'; payload: { operationId: string; recomputedId: string; saltSource: string; direct: TxPayload; safeTx: TxPayload }; isOperationReady: { ready?: boolean; status: string; error?: string }; simulation: SimulationResult; simulatedFrom: string; note: string }
  | { kind: 'safe'; payload: TxPayload; simulation: SimulationResult; simulatedFrom: string }
  | { kind: 'direct'; payload: TxPayload; simulation: SimulationResult; simulatedFrom: string; note: string }

const errText = (e: unknown) => (e instanceof ApiError ? (e.failure.kind === 'error' && e.failure.details ? `${e.failure.message}: ${e.failure.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : e.failure.message) : String(e))

export function SafeActionsPage({ session }: { session: Session }) {
  const id = useId()
  const now = useNow(1000)
  const ctx = useApi<SafeContext>(`/safe/context${qs({ chainId: session.chainId })}`)
  const tl = useApi<TimelockView>(`/governance/timelock${qs({ chainId: session.chainId })}`)
  const [built, setBuilt] = useState<Built | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fee, setFee] = useState({ poolManager: '', currency: '', amount: '0' })
  const [flag, setFlag] = useState({ hook: '', action: 'flag', reason: '' })
  const isAdmin = hasRole(session, 'admin')
  const isCurator = hasRole(session, 'curator')

  const build = <T,>(p: Promise<T>, as: (r: T) => Built) => {
    setBusy(true)
    setError(null)
    setBuilt(null)
    p.then((r) => setBuilt(as(r)))
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="stack">
      <Panel title="Governance Safe" provenance="SDK address book; Safe app short name from ops/safe/README.md">
        <StateView state={ctx.state} reload={ctx.reload}>
          {(c) => (
            <div className="safe-head">
              <div>
                <p className="small muted">{c.chainName} (chain {c.chainId})</p>
                <Addr value={c.safe} label="2-of-3 governance Safe" />
                <p className="small">{c.note}</p>
              </div>
              {c.safeAppUrl ? (
                <a className="btn btn--primary" href={c.safeAppUrl} target="_blank" rel="noopener noreferrer">
                  Open the Safe app
                </a>
              ) : (
                <span className="state state--unconfigured">No Safe app short name configured for this chain; open the Safe app manually with the address above.</span>
              )}
            </div>
          )}
        </StateView>
      </Panel>

      <Panel title="Execute the queued custody handover" provenance="Operations from indexed CallScheduled + CallSalt events on the custody timelock. Nothing new is scheduled here: that would duplicate the queued operations.">
        <StateView state={tl.state} reload={tl.reload} isEmpty={(t) => t.custodyHandover.items.every((i) => !i.operationId)} empty="No acceptOwnership() operation is indexed on the custody timelock. Check the chain before scheduling anything.">
          {(t) => (
            <ul className="ops">
              {t.custodyHandover.items.map((h) => {
                const s = h.readyAt ? (new Date(h.readyAt).getTime() - now.getTime()) / 1000 : null
                const ready = h.status === 'READY' || (h.status === 'PENDING' && s !== null && s <= 0)
                return (
                  <li key={h.contractKey} className="op">
                    <div>
                      <strong><code>{h.contractKey}</code></strong> <Addr value={h.target} />
                      <div className="small muted">operation {h.operationId ? <code title={h.operationId}>{shortHash(h.operationId)}</code> : 'none'}</div>
                    </div>
                    <Chip tone={h.status === 'EXECUTED' ? 'ok' : ready ? 'high' : h.status === 'CANCELLED' ? 'muted' : 'medium'}>{h.status}</Chip>
                    <span className="small">{h.status === 'CANCELLED' ? 'cancelled: never executable' : h.status === 'EXECUTED' ? 'executed; confirm owner() on Governance' : s !== null && s > 0 ? `executable in ${duration(s)} (${utc(h.readyAt)})` : h.readyAt ? 'executable now, by anyone' : '—'}</span>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || !h.operationId || !ready}
                      onClick={() => build(apiPost<Omit<Extract<Built, { kind: 'execute' }>, 'kind'>>('/timelock/execute', { chainId: session.chainId, operationId: h.operationId }), (r) => ({ kind: 'execute', ...r }))}
                    >
                      Prepare execute()
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </StateView>
      </Panel>

      <div className="grid-2">
        <Panel title="Protocol fees: collect or sweep" provenance="LatchProtocolFeeControllerV2. collect is Safe-only; sweep is permissionless and pays only treasury().">
          {!isAdmin ? (
            <div className="state state--forbidden">Requires the admin role (a Safe owner).</div>
          ) : (
            <form className="stack stack--tight" onSubmit={(e) => e.preventDefault()}>
              <Field label="Pool manager" htmlFor={`${id}-pm`}>
                <select id={`${id}-pm`} value={fee.poolManager} onChange={(e) => setFee({ ...fee, poolManager: e.target.value })}>
                  <option value="">Choose</option>
                  {ctx.state.kind === 'ok' ? (
                    <>
                      <option value={ctx.state.data.contracts.clPoolManager ?? ''}>CLPoolManager {shortHash(ctx.state.data.contracts.clPoolManager)}</option>
                      <option value={ctx.state.data.contracts.binPoolManager ?? ''}>BinPoolManager {shortHash(ctx.state.data.contracts.binPoolManager)}</option>
                    </>
                  ) : null}
                </select>
              </Field>
              <Field label="Currency (token address; 0x0…0 for native)" htmlFor={`${id}-cur`}><input id={`${id}-cur`} value={fee.currency} spellCheck={false} onChange={(e) => setFee({ ...fee, currency: e.target.value.trim() })} /></Field>
              <Field label="Amount for collect (raw units; 0 = everything accrued)" htmlFor={`${id}-amt`}><input id={`${id}-amt`} inputMode="numeric" pattern="[0-9]*" value={fee.amount} onChange={(e) => setFee({ ...fee, amount: e.target.value.trim() })} /></Field>
              <div className="actions">
                <button type="button" className="btn" disabled={busy || !fee.poolManager || !/^0x[0-9a-fA-F]{40}$/.test(fee.currency) || !/^\d+$/.test(fee.amount)} onClick={() => build(apiPost<Omit<Extract<Built, { kind: 'safe' }>, 'kind'>>('/safe/fee-controller/collect', { chainId: session.chainId, poolManager: fee.poolManager, currency: fee.currency, amount: fee.amount }), (r) => ({ kind: 'safe', ...r }))}>Prepare collect() to the Safe</button>
                <button type="button" className="btn btn--ghost" disabled={busy || !fee.poolManager || !/^0x[0-9a-fA-F]{40}$/.test(fee.currency)} onClick={() => build(apiPost<Omit<Extract<Built, { kind: 'safe' }>, 'kind'>>('/safe/fee-controller/sweep', { chainId: session.chainId, poolManager: fee.poolManager, currency: fee.currency }), (r) => ({ kind: 'safe', ...r }))}>Prepare sweep()</button>
              </div>
            </form>
          )}
        </Panel>

        <Panel title="Registry: flag or unflag a Latch" provenance="LatchRegistry.setListing, sent DIRECTLY by a curator (or, for flag, a guardian) key. Not a Safe transaction: a queue on flagging a draining Latch makes the flag useless.">
          {!isCurator ? (
            <div className="state state--forbidden">Requires the curator role.</div>
          ) : (
            <form className="stack stack--tight" onSubmit={(e) => e.preventDefault()}>
              <Field label="Latch (hook) address" htmlFor={`${id}-hook`}><input id={`${id}-hook`} value={flag.hook} spellCheck={false} onChange={(e) => setFlag({ ...flag, hook: e.target.value.trim() })} /></Field>
              <Field label="Action" htmlFor={`${id}-act`}>
                <select id={`${id}-act`} value={flag.action} onChange={(e) => setFlag({ ...flag, action: e.target.value })}>
                  <option value="flag">Flag Malicious (also resets verification)</option>
                  <option value="unflag">Restore Active (curator only)</option>
                </select>
              </Field>
              <Field label="Reason shown next to the warning" htmlFor={`${id}-why`} hint="10 to 512 bytes; a sentence a user can act on"><textarea id={`${id}-why`} rows={2} maxLength={512} value={flag.reason} onChange={(e) => setFlag({ ...flag, reason: e.target.value })} /></Field>
              <button type="button" className="btn btn--danger" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(flag.hook) || flag.reason.trim().length < 10} onClick={() => build(apiPost<Omit<Extract<Built, { kind: 'direct' }>, 'kind'>>('/registry/listing', { chainId: session.chainId, hook: flag.hook, action: flag.action, reason: flag.reason.trim() }), (r) => ({ kind: 'direct', ...r }))}>Prepare setListing()</button>
            </form>
          )}
        </Panel>
      </div>

      <Panel title="Prepared payload" id="payload" provenance="Built by the API from the SDK address book and simulated with eth_call. The console never signs, never proposes to the Safe Transaction Service and never sends.">
        {busy ? <div className="state state--loading" role="status"><span className="spinner" aria-hidden="true" /> Building and simulating…</div> : null}
        {error ? <div className="state state--error" role="alert">{error}</div> : null}
        {!busy && !error && !built ? <div className="state state--empty">Nothing prepared yet. Choose an action above.</div> : null}
        {built?.kind === 'execute' ? (
          <div className="stack stack--tight">
            <p className="small">
              Operation <code>{built.payload.operationId}</code>; arguments re-hash to <code>{built.payload.recomputedId}</code> (salt from {built.payload.saltSource}). On-chain <code>isOperationReady</code>: <strong>{built.isOperationReady.ready === undefined ? built.isOperationReady.status : String(built.isOperationReady.ready)}</strong>. {built.note}
            </p>
            <SimulationView sim={built.simulation} from={built.simulatedFrom} />
            <div className="grid-2">
              <PayloadView payload={built.payload.direct} title="Send from any wallet" />
              <PayloadView payload={built.payload.safeTx} title="Or as a Safe transaction" />
            </div>
          </div>
        ) : built ? (
          <div className="stack stack--tight">
            <SimulationView sim={built.simulation} from={built.simulatedFrom} />
            {built.kind === 'direct' ? <p className="small">{built.note}</p> : null}
            <PayloadView payload={built.payload} title={built.kind === 'safe' ? 'Safe transaction' : 'Direct transaction'} />
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

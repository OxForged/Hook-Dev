import { useId, useState } from 'react'
import { PayloadView, SimulationView } from '../components/Payload.tsx'
import { Addr, Chip, Field, KV, Panel, StateView, Table, type Tone } from '../components/ui.tsx'
import { apiPost, ApiError, hasRole, qs, type Session } from '../lib/api.ts'
import { ago, duration, group, parseUnits, shortHash, units, utc } from '../lib/format.ts'
import { useApi, useNow } from '../lib/useApi.ts'
import type { KitAmount, KitFeeState, KitLaunchesView, KitPrepared, SimulationResult, TxPayload } from './types.ts'

const errText = (e: unknown) => (e instanceof ApiError ? (e.failure.kind === 'error' && e.failure.details ? `${e.failure.message}: ${e.failure.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : e.failure.message) : String(e))
const amt = (a: KitAmount | null | undefined) => (!a ? '—' : a.units !== null ? `${group(a.units)} ${a.symbol ?? '(symbol unread)'}` : `${group(a.raw)} raw units (decimals unread)`)
const checkTone = (l: string): Tone => (l === 'high' ? 'high' : l === 'warn' ? 'medium' : 'ok')
const PAGE = 25

export function LaunchesPage({ session }: { session: Session }) {
  const [offset, setOffset] = useState(0)
  const fee = useApi<KitFeeState>(`/kit-v2/fee-state${qs({ chainId: session.chainId })}`)
  const list = useApi<KitLaunchesView>(`/kit-v2/launches${qs({ chainId: session.chainId, limit: PAGE, offset })}`)

  return (
    <div className="stack">
      <StateView state={fee.state} reload={fee.reload}>
        {(f) =>
          !f.configured ? (
            <div className="state state--unconfigured">
              <strong>Kit v2 is not configured for chain {f.chainId}.</strong> {f.message}
            </div>
          ) : (
            <>
              <FeePanel f={f} reload={fee.reload} />
              <AccrualsPanel f={f} />
              <FeeBuilder session={session} f={f} />
            </>
          )
        }
      </StateView>

      <StateView state={list.state} reload={list.reload}>
        {(l) =>
          !l.configured ? null : (
            <Panel
              title={`Kit v2 launches (${l.total})`}
              provenance={`${l.provenance}. Launch fees are native and frozen at creation; lock splits are frozen at lock. Token units only.`}
            >
              <KV
                rows={[
                  ['LaunchpadKitV2', <Addr key="k" value={l.contracts.kit} />],
                  ['LatchLPLocker (CL)', l.contracts.clLocker ? <Addr key="c" value={l.contracts.clLocker} /> : <span key="c" className="muted">not configured: CL lock events are not indexed</span>],
                  ['LatchBinLPLocker', l.contracts.binLocker ? <Addr key="b" value={l.contracts.binLocker} /> : <span key="b" className="muted">not configured: Bin lock events are not indexed</span>],
                  ['How the addresses were verified', <span key="v" className="small">{l.contracts.verification}</span>],
                ]}
              />
              {!l.indexed ? (
                <div className="state state--unconfigured">This chain has no indexer checkpoint yet: launches are unmeasured, not zero.</div>
              ) : l.items.length === 0 ? (
                <div className="state state--empty">No LaunchCreated event from this kit in the indexed range. Indexed and empty.</div>
              ) : (
                <>
                  <Table caption="Kit v2 launches" stackOnPhone>
                    <thead>
                      <tr>
                        <th scope="col">Launch token</th>
                        <th scope="col">Creator / tenant</th>
                        <th scope="col">Pools (locked)</th>
                        <th scope="col" className="num">Launch fees paid</th>
                        <th scope="col">Opens</th>
                        <th scope="col">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.items.map((x) => (
                        <tr key={x.token}>
                          <td data-label="Launch token">
                            <Addr value={x.token} label={x.launchToken.symbol} />
                            <div className="muted small">supply {amt(x.totalSupply)}; seeded {amt(x.seedSupply)}</div>
                          </td>
                          <td data-label="Creator / tenant">
                            <Addr value={x.creator} label="creator" />
                            {x.tenant ? <Addr value={x.tenant} label="tenant" /> : <div className="muted small">direct launch (no tenant)</div>}
                          </td>
                          <td data-label="Pools (locked)">
                            <ul className="plain-list">
                              {x.legs.map((g) => (
                                <li key={g.poolId} className="small">
                                  <Chip tone="info">{g.kind}</Chip> <code title={g.poolId}>{shortHash(g.poolId)}</code> vs {g.quote.address === '0x0000000000000000000000000000000000000000' ? 'native' : (g.quote.symbol ?? shortHash(g.quote.address))} · {(g.weightBps / 100).toFixed(2)}% of seed
                                  <div className="muted">
                                    {g.lock.status === 'indexed'
                                      ? `split creator ${(g.lock.frozenAtCreation.creatorBps / 100).toFixed(2)}% / integrator ${(g.lock.frozenAtCreation.integratorBps / 100).toFixed(2)}% / protocol ${(g.lock.frozenAtCreation.protocolBps / 100).toFixed(2)}%, lock ${g.lockId}`
                                      : g.lock.note}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td className="num" data-label="Launch fees paid">
                            <div>{amt(x.launchFees.protocol)} <span className="muted small">protocol</span></div>
                            <div>{x.launchFees.integrator ? <>{amt(x.launchFees.integratorFee)} <span className="muted small">integrator</span></> : <span className="muted small">no integrator</span>}</div>
                          </td>
                          <td data-label="Opens">{utc(x.schedule.startTimeIso)}<div className="muted small">block.timestamp clock</div></td>
                          <td data-label="Created">{utc(x.createdAt.blockTimestamp)}<div className="muted small">block {group(x.createdAt.blockNumber)} · <code title={x.createdAt.txHash}>{shortHash(x.createdAt.txHash)}</code></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="pager">
                    <button type="button" className="btn btn--xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
                    <span className="muted">{offset + 1}–{Math.min(offset + PAGE, l.total)} of {l.total}</span>
                    <button type="button" className="btn btn--xs" disabled={offset + PAGE >= l.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
                  </div>
                </>
              )}
            </Panel>
          )
        }
      </StateView>
    </div>
  )
}

type Configured = Extract<KitFeeState, { configured: true }>

function FeePanel({ f, reload }: { f: Configured; reload: () => void }) {
  const now = useNow(1000)
  const c = f.chain
  const sym = f.nativeSymbol
  const eth = (wei: string | null | undefined) => (wei === null || wei === undefined ? '—' : `${group(units(wei, 18))} ${sym}`)
  const ev = 'effectiveWei' in f.events ? f.events : null
  const pending = c.status === 'read' ? c.pendingLaunchFee : ev?.pendingStatus === 'scheduled' ? ev.pending : null
  const landsIn = pending ? Number(pending.effectiveAt) - now.getTime() / 1000 : null
  return (
    <Panel
      title="Protocol launch fee"
      provenance={c.status === 'read' ? `LaunchpadKitV2 views read by eth_call at block ${group(c.blockNumber)} (block time ${utc(c.blockTimestampIso)}). ${ev ? ev.provenance : ''}` : `Chain read unavailable: ${c.error}. ${ev ? ev.provenance : ''}`}
      actions={<button type="button" className="btn btn--xs" onClick={reload}>Re-read</button>}
    >
      <div className="stack stack--tight">
        <Addr value={f.kit} label="LaunchpadKitV2" />
        <dl className="figures">
          <div><dt>Fee a launch pays now</dt><dd>{c.status === 'read' ? eth(c.launchFeeWei) : ev ? <>{eth(ev.effectiveWei)}<div className="muted small">from indexed events, judged at {utc(ev.asOfIso)}</div></> : <span className="muted small">unread</span>}</dd></div>
          <div>
            <dt>Scheduled increase</dt>
            <dd>
              {pending ? (
                <>
                  {eth(pending.feeWei)}
                  <div className="small">lands {utc(pending.effectiveAtIso)}{landsIn !== null ? (landsIn > 0 ? `, in ${duration(landsIn)}` : ' (matured; applies by itself)') : ''}</div>
                </>
              ) : ev?.pendingStatus === 'matured' && c.status !== 'read' ? (
                <span className="small">matured, in force; no event until the next owner call</span>
              ) : (
                <span className="muted">none</span>
              )}
            </dd>
          </div>
          <div><dt>Immutable cap</dt><dd>{c.status === 'read' ? eth(c.maxLaunchFeeWei) : <span className="muted small">unread</span>}</dd></div>
          <div><dt>Notice on increases</dt><dd>{c.status === 'read' ? duration(c.launchFeeNoticeSeconds) : <span className="muted small">unread</span>}</dd></div>
          <div><dt>Integrator fee cap</dt><dd>{c.status === 'read' ? eth(c.maxIntegratorLaunchFeeWei) : <span className="muted small">unread</span>}</dd></div>
          <div><dt>Owed to the Safe on the kit</dt><dd>{c.status === 'read' ? eth(c.feesOwedToSafe) : <span className="muted small">unread</span>}<div className="muted small">flushProtocolFees is permissionless</div></dd></div>
        </dl>
        {c.status === 'read' ? (
          <KV
            rows={[
              ['owner()', <Addr key="o" value={c.owner} label={c.owner === f.safe ? 'governance Safe' : null} />],
              ['protocolFeeRecipient() (immutable)', <Addr key="r" value={c.protocolFeeRecipient} label={c.protocolFeeRecipient === f.safe ? 'governance Safe' : null} />],
            ]}
          />
        ) : null}
        {f.checks.length ? (
          <ul className="plain-list">
            {f.checks.map((k) => (
              <li key={k.check} className="small">
                <Chip tone={checkTone(k.level)}>{k.level === 'ok' ? 'ok' : k.level}</Chip> {k.check}{k.level !== 'ok' ? `: ${k.detail}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="small muted">
          <li>{f.rules.decrease}</li>
          <li>{f.rules.increase}</li>
          <li>{f.rules.cap} {f.rules.retroactivity}</li>
        </ul>
        {ev && ev.history.length ? (
          <details>
            <summary>{ev.history.length} launch fee event(s){ev.inconsistencies.length ? `, ${ev.inconsistencies.length} inconsistent` : ''}</summary>
            {ev.inconsistencies.length ? <ul className="warnings">{ev.inconsistencies.map((i) => <li key={i}>{i}</li>)}</ul> : null}
            <ol className="plain-list">
              {ev.history.map((h) => (
                <li key={h.txHash + h.event + h.blockNumber} className="small">
                  <code>{h.event}</code> {Object.entries(h.args).map(([k, v]) => `${k}=${String(v)}`).join(', ')} <span className="muted">· {utc(h.blockTimestamp)} ({ago(h.blockTimestamp, now)})</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </Panel>
  )
}

function AccrualsPanel({ f }: { f: Configured }) {
  const a = f.accruals
  return (
    <Panel title="Owed to the protocol, not yet claimed" provenance={a.status === 'indexed' ? a.provenance : a.message}>
      {a.status !== 'indexed' ? (
        <div className="state state--unconfigured">{a.message}</div>
      ) : a.items.length === 0 ? (
        <div className="state state--empty">No launch fee credited to the Safe and no locker fee collected in the indexed range.</div>
      ) : (
        <>
          <Table caption="Protocol accruals by contract and token" stackOnPhone>
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Token</th>
                <th scope="col" className="num">Credited</th>
                <th scope="col" className="num">Claimed</th>
                <th scope="col" className="num">Owed (events)</th>
                <th scope="col">On chain</th>
              </tr>
            </thead>
            <tbody>
              {a.items.map((i) => (
                <tr key={i.contract + i.token}>
                  <td data-label="Contract"><code title={i.contract}>{shortHash(i.contract)}</code><div className="muted small">{i.role === 'launchpadKitV2' ? 'kit launch fees' : i.role === 'clLpLocker' ? 'CL locker' : 'Bin locker'}</div></td>
                  <td data-label="Token">{i.token === '0x0000000000000000000000000000000000000000' ? 'native' : <Addr value={i.token} label={i.symbol} />}</td>
                  <td className="num" data-label="Credited">{i.credited.units ?? `${i.credited.raw} raw`}{i.skimmed.raw !== '0' ? <div className="muted small">+ {i.skimmed.units ?? i.skimmed.raw} skimmed</div> : null}</td>
                  <td className="num" data-label="Claimed">{i.claimed.units ?? `${i.claimed.raw} raw`}</td>
                  <td className="num" data-label="Owed (events)"><strong>{i.owed.units ?? `${i.owed.raw} raw`}</strong> {i.symbol ?? ''}</td>
                  <td data-label="On chain">{i.onChain.status === 'read' ? <><Chip tone={i.onChain.matchesEvents ? 'ok' : 'medium'}>{i.onChain.matchesEvents ? 'matches' : 'differs'}</Chip> <span className="small">{i.onChain.raw} raw @ {group(i.onChain.atBlock)}</span></> : <span className="muted small">unread</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <ul className="small muted">
            {Object.entries(a.definitions).map(([k, v]) => <li key={k}><strong>{k}</strong>: {v}</li>)}
          </ul>
        </>
      )}
    </Panel>
  )
}

type Built = { kind: 'set'; r: KitPrepared } | { kind: 'cancel'; r: { payload: TxPayload; simulation: SimulationResult; simulatedFrom: string } }

function FeeBuilder({ session, f }: { session: Session; f: Configured }) {
  const id = useId()
  const isAdmin = hasRole(session, 'admin')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [built, setBuilt] = useState<Built | null>(null)
  const sym = f.nativeSymbol
  const wei = parseUnits(input, 18)
  const c = f.chain.status === 'read' ? f.chain : null
  const overCap = wei !== null && c !== null && BigInt(wei) > BigInt(c.maxLaunchFeeWei)
  const preview = wei === null || c === null ? null : BigInt(wei) < BigInt(c.launchFeeWei) ? 'decrease: applies immediately' : BigInt(wei) === BigInt(c.launchFeeWei) ? 'no change' : `increase: scheduled, lands ${duration(c.launchFeeNoticeSeconds)} after execution`

  const run = <T,>(p: Promise<T>, as: (r: T) => Built) => {
    setBusy(true)
    setError(null)
    setBuilt(null)
    // No reload of the fee state here: preparing changes nothing on chain, and a reload would
    // unmount this panel and discard the payload the operator is about to review.
    p.then((r) => setBuilt(as(r)))
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Panel title="Change the launch fee (Safe payload)" id="kit-fee" provenance="Builds LaunchpadKitV2.setLaunchFee / cancelPendingLaunchFee for the governance Safe and simulates it with eth_call from the Safe. Never signed, proposed or sent here.">
      {!isAdmin ? (
        <div className="state state--forbidden">Requires the admin role (a Safe owner).</div>
      ) : (
        <div className="stack stack--tight">
          <form
            className="filters"
            aria-label="New launch fee"
            onSubmit={(e) => {
              e.preventDefault()
              if (wei === null || overCap) return
              run(apiPost<KitPrepared>('/safe/kit-v2/launch-fee', { chainId: session.chainId, feeWei: wei }), (r) => ({ kind: 'set', r }))
            }}
          >
            <Field label={`New fee in ${sym}`} htmlFor={`${id}-fee`} hint={input && wei === null ? 'A non-negative amount with at most 18 decimals' : overCap ? `Above the immutable cap of ${units(c!.maxLaunchFeeWei, 18)} ${sym}: it would revert` : (preview ?? undefined)}>
              <input id={`${id}-fee`} inputMode="decimal" value={input} placeholder={`0.001 ${sym}`} aria-invalid={!!input && (wei === null || overCap)} onChange={(e) => setInput(e.target.value.trim())} />
            </Field>
            <button type="submit" className="btn btn--primary" disabled={busy || wei === null || overCap}>Prepare setLaunchFee()</button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy || (c !== null && c.pendingLaunchFee === null)}
              title={c !== null && c.pendingLaunchFee === null ? 'Nothing is scheduled' : undefined}
              onClick={() => run(apiPost<Extract<Built, { kind: 'cancel' }>['r']>('/safe/kit-v2/cancel-pending-fee', { chainId: session.chainId }), (r) => ({ kind: 'cancel', r }))}
            >
              Prepare cancelPendingLaunchFee()
            </button>
          </form>
          {busy ? <div className="state state--loading" role="status"><span className="spinner" aria-hidden="true" /> Building and simulating…</div> : null}
          {error ? <div className="state state--error" role="alert"><strong>Not prepared.</strong> {error}</div> : null}
          {built?.kind === 'set' ? (
            <div className="stack stack--tight" id="payload">
              <p className="small">
                Effect: <strong>{built.r.effect === 'immediate-decrease' ? 'immediate decrease' : built.r.effect === 'scheduled-increase' ? 'scheduled increase' : built.r.effect === 'no-change' ? 'no change' : 'not stated (fee in force unread)'}</strong>
                {built.r.effectiveAtUnix ? <> · not before {utc(new Date(Number(built.r.effectiveAtUnix) * 1000).toISOString())} (later if signed later)</> : null}
              </p>
              <SimulationView sim={built.r.simulation} from={built.r.simulatedFrom} />
              <PayloadView payload={built.r.payload} title="Safe transaction" />
            </div>
          ) : built?.kind === 'cancel' ? (
            <div className="stack stack--tight" id="payload">
              <SimulationView sim={built.r.simulation} from={built.r.simulatedFrom} />
              <PayloadView payload={built.r.payload} title="Safe transaction" />
            </div>
          ) : !busy && !error ? (
            <div className="state state--empty">Nothing prepared yet. Decreases apply in the block they execute; increases wait the notice.</div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

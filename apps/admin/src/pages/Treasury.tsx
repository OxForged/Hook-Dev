import { useEffect, useId, useState } from 'react'
import { PayloadView } from '../components/Payload.tsx'
import { Addr, Chip, Field, KV, Panel, StateView, Table } from '../components/ui.tsx'
import { apiPost, ApiError, hasRole, qs, type Session } from '../lib/api.ts'
import { bps, duration, group, parseUnits, shortHash, units, utc } from '../lib/format.ts'
import { useApi, type Loadable } from '../lib/useApi.ts'
import type { ConversionPrepared, ConversionSimulation, RouteView, TreasuryView } from './types.ts'

type Configured = Extract<TreasuryView, { configured: true }>
type TokenRow = Configured['tokens'][number]

const errText = (e: unknown) => (e instanceof ApiError ? (e.failure.kind === 'error' && e.failure.details ? `${e.failure.message}: ${e.failure.details.map((d) => `${d.path} ${d.message}`).join('; ')}` : e.failure.message) : String(e))
const eth = (wei: string | null | undefined, symbol: string) => (wei ? `${group(units(wei, 18))} ${symbol}` : '—')

export function TreasuryPage({ session }: { session: Session }) {
  const id = useId()
  const [usd, setUsd] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const view = useApi<TreasuryView>(`/treasury${qs({ chainId: session.chainId, usd: usd ? 'true' : undefined })}`)

  return (
    <div className="stack">
      <StateView state={view.state} reload={view.reload}>
        {(v) =>
          !v.configured ? (
            <div className="state state--unconfigured">
              <strong>Treasury conversion is not configured for chain {v.chainId}.</strong> {v.message}
            </div>
          ) : (
            <>
              <Panel
                title="Governance Safe treasury"
                provenance={`Balances read on chain${v.readAtBlock ? ` at block ${group(v.readAtBlock)} (${utc(v.readAt)})` : ''}. ${v.venue}`}
                actions={v.safeAppUrl ? <a className="btn btn--primary btn--xs" href={v.safeAppUrl} target="_blank" rel="noopener noreferrer">Open the Safe app</a> : null}
              >
                <div className="stack stack--tight">
                  <Addr value={v.safe} label="2-of-3 governance Safe" />
                  <dl className="figures">
                    <div><dt>Converts to</dt><dd>native {v.target.name} ({v.target.symbol}), never a wrapped or third-party token</dd></div>
                    <div><dt>Safe {v.target.symbol} balance</dt><dd>{v.target.balance ? `${group(v.target.balance.units)} ${v.target.symbol}` : <span className="muted small">unread: {v.target.balanceError}</span>}</dd></div>
                    <div><dt>Max price impact</dt><dd>{bps(v.policy.maxPriceImpactBps)}</dd></div>
                    <div><dt>Slippage bound</dt><dd>{bps(v.policy.slippageBps)}</dd></div>
                    <div><dt>Minimum guaranteed output</dt><dd>{eth(v.policy.minValueWei, v.target.symbol)}</dd></div>
                    <div><dt>Signing window</dt><dd>{duration(v.policy.deadlineSeconds)}, then the batch expires</dd></div>
                  </dl>
                  <p className="small muted">{v.allowlistNote}</p>
                </div>
              </Panel>

              <Panel
                title="Allowlisted tokens"
                provenance={v.inflowsProvenance}
                actions={
                  <div className="field field--check">
                    <input id={`${id}-usd`} type="checkbox" checked={usd} onChange={(e) => setUsd(e.target.checked)} />
                    <label htmlFor={`${id}-usd`}>Chainlink USD where a feed prices the token</label>
                  </div>
                }
              >
                {v.tokens.length === 0 ? (
                  <div className="state state--empty">The allowlist is empty: nothing on this chain is offered for conversion. Adding a token is a reviewed commit to the chain config.</div>
                ) : (
                  <Table caption="Allowlisted tokens: balance, inflows and route to native ETH" stackOnPhone>
                    <thead>
                      <tr>
                        <th scope="col">Token</th>
                        <th scope="col" className="num">Safe balance</th>
                        <th scope="col" className="num">Revenue inflows</th>
                        {usd ? <th scope="col">USD (current feed)</th> : null}
                        <th scope="col">Latch route to {v.target.symbol}</th>
                        <th scope="col"><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.tokens.map((t) => (
                        <tr key={t.token} className={selected === t.token ? 'row--selected' : undefined}>
                          <td>
                            <Addr value={t.token} label={t.symbol} />
                            {t.balance?.mismatch ? <div className="small" style={{ color: 'var(--warning)' }}>{t.balance.mismatch}</div> : null}
                          </td>
                          <td className="num" data-label="Safe balance">{t.balance ? `${group(t.balance.units)} ${t.symbol}` : <span className="muted small">unread: {t.balanceError}</span>}</td>
                          <td className="num" data-label="Revenue inflows">
                            {v.indexed ? `${group(t.inflows.units)} ${t.symbol}` : <span className="muted small">unmeasured</span>}
                            {v.indexed ? <div className="muted small">{t.inflows.entries} ledger entr{t.inflows.entries === 1 ? 'y' : 'ies'}</div> : null}
                          </td>
                          {usd ? (
                            <td data-label="USD (current feed)">
                              {t.usd?.usdPerToken && t.balance ? (
                                <span title={t.usd.method}>
                                  ${group(usdValue(t.balance.units, t.usd.usdPerToken))}{' '}
                                  <span className="muted small">{t.usd.source} {t.usd.feed}, updated {utc(t.usd.feedUpdatedAt)}</span>
                                </span>
                              ) : (
                                <span className="muted small">withheld: {t.usd?.reason ?? 'no feed'}</span>
                              )}
                            </td>
                          ) : null}
                          <td data-label={`Latch route to ${v.target.symbol}`}><RouteCell chainId={session.chainId} token={t} nativeSymbol={v.target.symbol} /></td>
                          <td>
                            <button type="button" className="btn btn--xs" aria-expanded={selected === t.token} onClick={() => setSelected(selected === t.token ? null : t.token)}>
                              {selected === t.token ? 'Close' : 'Prepare conversion'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Panel>

              {selected && v.tokens.find((t) => t.token === selected) ? (
                <ConvertPanel key={selected} session={session} token={v.tokens.find((t) => t.token === selected)!} view={v} />
              ) : null}
            </>
          )
        }
      </StateView>
    </div>
  )
}

/** USD for display only: decimal string x decimal string, 2 places, via integer math. */
function usdValue(amountUnits: string, usdPerToken: string): string {
  const toRatio = (s: string) => {
    const [w, f = ''] = s.split('.')
    return { n: BigInt(w! + f), d: 10n ** BigInt(f.length) }
  }
  const a = toRatio(amountUnits)
  const p = toRatio(usdPerToken)
  const cents = (a.n * p.n * 100n) / (a.d * p.d)
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
}

function RouteCell({ chainId, token, nativeSymbol }: { chainId: number; token: TokenRow; nativeSymbol: string }) {
  const r = useApi<RouteView>(`/treasury/route${qs({ chainId, token: token.token })}`)
  return <RouteSummary state={r.state} nativeSymbol={nativeSymbol} compact />
}

function RouteSummary({ state, nativeSymbol, compact = false }: { state: Loadable<RouteView>; nativeSymbol: string; compact?: boolean }) {
  if (state.kind === 'loading') return <span className="muted small"><span className="spinner" aria-hidden="true" /> reading Latch pools…</span>
  if (state.kind !== 'ok') return <span className="small" style={{ color: 'var(--error)' }}>{'message' in state ? state.message : 'unavailable'}</span>
  const r = state.data
  if (r.status === 'no-route') return <><Chip tone="muted">no Latch route to {nativeSymbol} yet</Chip>{compact ? null : <p className="small">{r.message}</p>}</>
  if (r.status === 'unavailable') return <><Chip tone="medium">unavailable</Chip><div className="small muted">{r.message}</div></>
  if (r.status === 'no-acceptable-route') return <><Chip tone="high">every Latch route refused</Chip>{compact ? <div className="small muted">{r.candidates.length} route(s); open to see why</div> : <p className="small">{r.message}</p>}</>
  const b = r.best!
  return (
    <>
      <Chip tone={b.blockers.length ? 'medium' : 'ok'}>{b.blockers.length ? 'route, but refused for this amount' : 'Latch route'}</Chip>
      <div className="small">
        {b.hops.length} pool{b.hops.length === 1 ? '' : 's'}{b.end === 'weth' ? ' via WETH, unwrapped' : ''} · impact {b.impact ? bps(b.impact.priceImpactBps) : '—'} · min-out {group(b.minOutUnits)} {nativeSymbol}
      </div>
      <div className="muted small">{r.amountSource === 'probe-one-token' ? `quoted for 1 ${r.symbol} (the Safe holds none)` : `for ${group(r.amountInUnits)} ${r.symbol}`}, block {group(r.readAtBlock)}</div>
    </>
  )
}

function ConvertPanel({ session, token, view }: { session: Session; token: TokenRow; view: Configured }) {
  const id = useId()
  const isAdmin = hasRole(session, 'admin')
  const initial = token.balance && token.balance.raw !== '0' ? token.balance.units : ''
  const [input, setInput] = useState(initial)
  const raw = parseUnits(input, token.decimals)
  const valid = raw !== null && raw !== '0'
  const [quoted, setQuoted] = useState<string | null>(valid ? raw : null)
  const route = useApi<RouteView>(quoted ? `/treasury/route${qs({ chainId: session.chainId, token: token.token, amount: quoted })}` : null)
  const [prepared, setPrepared] = useState<ConversionPrepared | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sym = view.target.symbol

  useEffect(() => {
    setPrepared(null)
    setError(null)
  }, [quoted])

  const r = route.state.kind === 'ok' ? route.state.data : null
  const canPrepare = isAdmin && r?.status === 'route' && r.best !== null && r.best.blockers.length === 0 && !busy

  const prepare = () => {
    if (!r?.best || !r.quotedAt) return
    setBusy(true)
    setError(null)
    setPrepared(null)
    apiPost<ConversionPrepared>('/treasury/convert/prepare', { chainId: session.chainId, token: token.token, amount: r.amountIn, routeId: r.best.routeId, quotedAt: r.quotedAt })
      .then(setPrepared)
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Panel title={`Prepare conversion: ${token.symbol} to native ${sym}`} id="convert" provenance="Quoted by the Latch CLQuoter with eth_call through Latch pools only. The console prepares a Safe batch and never signs, proposes or sends it.">
      <div className="stack">
        <form className="filters" onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            if (raw === quoted) route.reload()
            else setQuoted(raw)
          }} aria-label="Conversion amount">
          <Field label={`Amount of ${token.symbol}`} htmlFor={`${id}-amt`} hint={input && !valid ? `Enter a positive amount with at most ${token.decimals} decimals` : token.balance ? `Safe holds ${group(token.balance.units)} ${token.symbol}` : undefined}>
            <input id={`${id}-amt`} inputMode="decimal" value={input} aria-invalid={!!input && !valid} placeholder={`0 ${token.symbol}`} onChange={(e) => setInput(e.target.value.trim())} />
          </Field>
          <button type="submit" className="btn" disabled={!valid}>Quote through Latch pools</button>
        </form>

        {quoted === null ? (
          <div className="state state--empty">{token.balance?.raw === '0' ? `The Safe holds no ${token.symbol}. Enter an amount to see whether a Latch route exists; a conversion is refused above the Safe's balance.` : 'Enter an amount to quote.'}</div>
        ) : (
          <StateView state={route.state} reload={route.reload}>
            {(rv) => <RouteDetail r={rv} nativeSymbol={sym} />}
          </StateView>
        )}

        {r?.status === 'route' ? (
          <div className="actions">
            <button type="button" className="btn btn--primary" disabled={!canPrepare} onClick={prepare}>
              {busy ? 'Building and simulating…' : 'Prepare Safe batch'}
            </button>
            {!isAdmin ? <span className="small muted">Requires the admin role (a Safe owner).</span> : r.best?.blockers.length ? <span className="small muted">Refused for this amount; see above.</span> : <span className="small muted">Re-quotes on the server; refused if the route changed or this quote is older than {duration(view.policy.maxQuoteAgeSeconds)}.</span>}
          </div>
        ) : null}

        {error ? <div className="state state--error" role="alert"><strong>Not prepared.</strong> {error}</div> : null}
        {prepared ? <PreparedView p={prepared} nativeSymbol={sym} tokenSymbol={token.symbol} decimals={token.decimals} /> : null}
      </div>
    </Panel>
  )
}

function RouteDetail({ r, nativeSymbol }: { r: RouteView; nativeSymbol: string }) {
  if (r.status === 'no-route') {
    return (
      <div className="state state--empty">
        <strong>No Latch route to {nativeSymbol} yet.</strong> {r.message} {r.consideredPools} indexed Latch pool{r.consideredPools === 1 ? '' : 's'} checked at block {group(r.readAtBlock)}.
      </div>
    )
  }
  if (r.status === 'unavailable') return <div className="state state--error" role="alert"><strong>Chain unreachable or reads disabled.</strong> {r.message}</div>
  const best = r.best
  return (
    <div className="stack stack--tight">
      {r.status === 'no-acceptable-route' ? <div className="state state--unconfigured"><strong>Every Latch route was refused.</strong> {r.message}</div> : null}
      {best ? (
        <>
          <dl className="figures">
            <div><dt>You convert</dt><dd>{group(r.amountInUnits)} {r.symbol}</dd></div>
            <div><dt>Quoted output</dt><dd>{group(units(best.quote?.amountOut, 18))} {nativeSymbol}</dd></div>
            <div><dt>Guaranteed (min-out)</dt><dd>{group(best.minOutUnits)} {nativeSymbol}</dd></div>
            <div><dt>Price impact (incl. hook cuts)</dt><dd>{best.impact ? bps(best.impact.priceImpactBps) : '—'} <span className="muted small">max {bps(r.policy.maxPriceImpactBps)}</span></dd></div>
            <div><dt>Total cost vs mid price</dt><dd>{best.impact ? bps(best.impact.totalCostBps) : '—'}</dd></div>
            <div><dt>Quoted at</dt><dd>block {group(r.readAtBlock)}<div className="muted small">{utc(r.quotedAt)}</div></dd></div>
          </dl>
          {best.blockers.length ? (
            <div className="state state--unconfigured" role="alert">
              <strong>Refused for this amount.</strong>
              <ul className="warnings">{best.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : null}
          <RouteHops c={best} nativeSymbol={nativeSymbol} />
        </>
      ) : null}
      {r.candidates.filter((c) => c.routeId !== best?.routeId).length ? (
        <details>
          <summary>{r.candidates.length - (best ? 1 : 0)} other Latch route(s) and why they were not chosen</summary>
          <ul className="route-hops">
            {r.candidates.filter((c) => c.routeId !== best?.routeId).map((c) => (
              <li key={c.routeId} className="small">
                <code title={c.routeId}>{shortHash(c.routeId)}</code> ({c.hops.length} pool{c.hops.length === 1 ? '' : 's'}, ends in {c.end === 'weth' ? 'WETH' : nativeSymbol}):{' '}
                {c.refusals.length ? c.refusals.join('; ') : c.quote ? `quoted ${group(units(c.quote.amountOut, 18))} ${nativeSymbol}, less than the chosen route` : 'not quoted'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function RouteHops({ c, nativeSymbol }: { c: NonNullable<RouteView['best']>; nativeSymbol: string }) {
  return (
    <ol className="route-hops" aria-label="Pools on the chosen route">
      {c.hops.map((h) => (
        <li key={h.poolId} className="small">
          Latch pool <code title={h.poolId}>{shortHash(h.poolId)}</code>, fee {(h.fee / 10_000).toFixed(2)}%:{' '}
          <code>{shortHash(h.currencyIn)}</code> → <code>{h.currencyOut === '0x0000000000000000000000000000000000000000' ? nativeSymbol : shortHash(h.currencyOut)}</code>
          {' · '}
          {h.hooks ? (h.hook.ok ? <>hook <code>{shortHash(h.hooks)}</code> accepted ({h.hook.basis}){h.hook.warnings.length ? `; ${h.hook.warnings.join(' ')}` : ''}</> : <span style={{ color: 'var(--error)' }}>hook refused: {h.hook.reason}</span>) : 'no hook'}
        </li>
      ))}
      {c.end === 'weth' ? <li className="small">WETH is unwrapped to native {nativeSymbol} by the router, with the same min-out.</li> : null}
    </ol>
  )
}

function PreparedView({ p, nativeSymbol, tokenSymbol, decimals }: { p: ConversionPrepared; nativeSymbol: string; tokenSymbol: string; decimals: number }) {
  return (
    <div className="stack" id="payload">
      <div className="state state--ok" role="status">
        {p.note}
      </div>
      <dl className="figures">
        <div><dt>Converts</dt><dd>{group(units(p.quote.amountIn, decimals))} {tokenSymbol}</dd></div>
        <div><dt>Quoted</dt><dd>{group(units(p.quote.amountOut, 18))} {nativeSymbol}</dd></div>
        <div><dt>Min-out (router enforced)</dt><dd>{group(p.quote.minOutUnits)} {nativeSymbol}</dd></div>
        <div><dt>Price impact</dt><dd>{bps(p.quote.priceImpactBps)}</dd></div>
        <div><dt>Expires</dt><dd>{utc(p.quote.deadlineAt)}</dd></div>
        <div><dt>MultiSendCallOnly</dt><dd><code title={p.multiSendCallOnly.address}>{shortHash(p.multiSendCallOnly.address)}</code> v{p.multiSendCallOnly.version}<div className="muted small">code hash verified at block {group(p.multiSendCallOnly.verifiedAtBlock)}</div></dd></div>
      </dl>
      <ConversionSimulationView sim={p.simulation} minOut={p.quote.minOut} nativeSymbol={nativeSymbol} />
      <PayloadView payload={p.payload} title="Safe transaction batch" />
      {p.safeAppUrl ? (
        <div className="actions">
          <a className="btn btn--primary" href={p.safeAppUrl} target="_blank" rel="noopener noreferrer">Open the Safe app</a>
          <span className="small muted">Create the transaction there with the to, data and operation above; two of three owners sign.</span>
        </div>
      ) : null}
    </div>
  )
}

function ConversionSimulationView({ sim, minOut, nativeSymbol }: { sim: ConversionSimulation; minOut: string; nativeSymbol: string }) {
  const tone = sim.status === 'success' ? 'ok' : sim.status === 'reverted' ? 'high' : 'muted'
  return (
    <div className={`sim sim--${sim.status}`} role="status">
      <div className="sim__head">
        <Chip tone={tone}>simulation: {sim.status}</Chip>
        <span className="small muted">{sim.method}, from <code>{sim.from}</code> at block {group(sim.blockNumber)}</span>
      </div>
      {sim.status === 'success' ? (
        <p className="small">
          The Safe would receive <strong>{group(units(sim.nativeReceived, 18))} {nativeSymbol}</strong> (min-out {group(units(minOut, 18))} {nativeSymbol}){sim.meetsMinOut === false ? ' — BELOW min-out: do not sign.' : '.'} Simulation is not a guarantee: state can change before execution.
        </p>
      ) : null}
      {sim.status === 'reverted' ? <p className="small"><strong>The batch reverts against current state. Do not sign it.</strong> {sim.revert?.message}</p> : null}
      {sim.status === 'unavailable' ? <p className="small">Not fully simulated: {sim.error}</p> : null}
      {sim.steps ? (
        <KV rows={sim.steps.map((s) => [`Call ${s.index}`, <span key={s.index}><Chip tone={s.status === 'success' ? 'ok' : s.status === 'reverted' ? 'high' : 'muted'}>{s.status}</Chip> <span className="small">{s.detail}</span></span>])} />
      ) : null}
      <div className="grid-2 grid-2--tight">
        <div>
          <p className="small"><strong>Simulated</strong></p>
          <ul className="small">{sim.simulated.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <p className="small"><strong>Not simulated</strong></p>
          <ul className="small">{sim.notSimulated.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
      <p className="small muted">Safe version read: {sim.safe.version ?? 'unread'}; transaction guard: {sim.safe.guard ?? (sim.safe.error ? `unread (${sim.safe.error})` : 'none')}.</p>
    </div>
  )
}

import { useId, useState } from 'react'
import { Addr, Chip, Field, Panel, StateView, Table } from '../components/ui.tsx'
import { BASE, qs } from '../lib/api.ts'
import { amount, group, shortHash, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface Revenue {
  chainId: number
  filters: { token: string | null; source: string | null; window: string | null; usd: boolean }
  provenance: { source: string; fromBlock: string; toBlock: string; toBlockTimestamp: string; note: string }
  totalsBySource: { source: string; label: string; status: 'indexed' | 'not-deployed' | 'not-attributed'; contract: string; note: string; byToken: { token: string; symbol: string | null; entries: number; raw: string; units: string | null }[] | null }[]
  protocolFees: {
    charged: { definition: string; byToken: { token: string; symbol: string | null; swaps: number; raw: string; units: string | null }[] }
    collected: { definition: string; byTokenAndMethod: { token: string; symbol: string | null; via: string; count: number; raw: string; units: string | null }[] }
    accruedUncollected: { definition: string; items: { poolManager: string; token: string; symbol: string | null; raw: string; units: string | null; readAtBlock: string; usd: null | { value: string | null; reason?: string | null; source?: string; feed?: string; feedUpdatedAt?: string; method?: string } }[] }
  }
  ledger: { total: number; limit: number; offset: number; items: { id: string; source: string; token: string; symbol: string | null; raw: string; units: string | null; counterparty: string | null; contract: string; blockNumber: string; blockTimestamp: string; txHash: string; usd: { value: string; source: string; pricedAt: string } | null }[] }
}

const SOURCES = ['PROTOCOL_FEE_COLLECTED', 'PROTOCOL_FEE_SWEPT', 'REVSHARE_PROTOCOL_CLAIM', 'LP_LOCKER_PROTOCOL_CLAIM', 'LP_LOCKER_INTEGRATOR_CLAIM', 'KIT_LAUNCH_FEE']

export function RevenuePage({ chainId }: { chainId: number }) {
  const id = useId()
  const [source, setSource] = useState('')
  const [token, setToken] = useState('')
  const [win, setWin] = useState('all')
  const [usd, setUsd] = useState(false)
  const [offset, setOffset] = useState(0)
  const tokenOk = token === '' || /^0x[0-9a-fA-F]{40}$/.test(token)
  const filters = { chainId, source: source || undefined, token: tokenOk ? token || undefined : undefined, window: win, usd: usd ? 'true' : undefined }
  const { state, reload } = useApi<Revenue>(`/revenue${qs({ ...filters, limit: 50, offset })}`)

  return (
    <div className="stack">
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Revenue filters">
        <Field label="Source" htmlFor={`${id}-src`}>
          <select id={`${id}-src`} value={source} onChange={(e) => (setSource(e.target.value), setOffset(0))}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Token address" htmlFor={`${id}-tok`} hint={tokenOk ? undefined : 'Enter a full 0x address'}>
          <input id={`${id}-tok`} value={token} placeholder="0x… (optional)" aria-invalid={!tokenOk} onChange={(e) => (setToken(e.target.value.trim()), setOffset(0))} spellCheck={false} />
        </Field>
        <Field label="Window" htmlFor={`${id}-win`} hint="Ends at the last indexed block">
          <select id={`${id}-win`} value={win} onChange={(e) => (setWin(e.target.value), setOffset(0))}>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="all">All time</option>
          </select>
        </Field>
        <div className="field field--check">
          <input id={`${id}-usd`} type="checkbox" checked={usd} onChange={(e) => setUsd(e.target.checked)} />
          <label htmlFor={`${id}-usd`}>Oracle USD where a Chainlink feed prices the token</label>
        </div>
        <a className="btn" href={`${BASE}/revenue/export.csv${qs(filters)}`} download>
          Export CSV
        </a>
      </form>

      <StateView state={state} reload={reload}>
        {(r) => (
          <>
            <Panel title="Totals by source" provenance={`${r.provenance.source}; blocks ${group(r.provenance.fromBlock)} to ${group(r.provenance.toBlock)} (${utc(r.provenance.toBlockTimestamp)}). ${r.provenance.note}`}>
              <Table caption="Revenue totals by source">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Status</th>
                    <th scope="col">Token</th>
                    <th scope="col" className="num">Entries</th>
                    <th scope="col" className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.totalsBySource.flatMap((s) => {
                    if (s.status !== 'indexed' || !s.byToken) {
                      return [
                        <tr key={s.source}>
                          <th scope="row">{s.label}<div className="muted small">{s.contract}</div></th>
                          <td><Chip tone="muted" title={s.note}>{s.status === 'not-attributed' ? 'not attributed' : 'not deployed yet'}</Chip></td>
                          <td colSpan={3} className="muted">{s.note}</td>
                        </tr>,
                      ]
                    }
                    if (s.byToken.length === 0) {
                      return [
                        <tr key={s.source}>
                          <th scope="row">{s.label}<div className="muted small">{s.contract}</div></th>
                          <td><Chip tone="ok">indexed</Chip></td>
                          <td colSpan={3} className="muted">No entries in this window. Indexed and empty, which is a reading, not a missing number.</td>
                        </tr>,
                      ]
                    }
                    return s.byToken.map((t, i) => (
                      <tr key={`${s.source}-${t.token}`}>
                        {i === 0 ? <th scope="row" rowSpan={s.byToken!.length}>{s.label}<div className="muted small">{s.contract}</div></th> : null}
                        {i === 0 ? <td rowSpan={s.byToken!.length}><Chip tone="ok">indexed</Chip></td> : null}
                        <td><Addr value={t.token} label={t.symbol} /></td>
                        <td className="num">{t.entries}</td>
                        <td className="num">{amount(t.units, t.symbol, t.raw)}</td>
                      </tr>
                    ))
                  })}
                </tbody>
              </Table>
            </Panel>

            <div className="grid-3">
              <Panel title="Protocol fees charged" provenance={r.protocolFees.charged.definition}>
                {r.protocolFees.charged.byToken.length === 0 ? <div className="state state--empty">No swaps in this window.</div> : (
                  <Table caption="Protocol fees charged">
                    <thead><tr><th scope="col">Token</th><th scope="col" className="num">Swaps</th><th scope="col" className="num">Charged</th></tr></thead>
                    <tbody>{r.protocolFees.charged.byToken.map((t) => (<tr key={t.token}><td>{t.symbol ?? <Addr value={t.token} />}</td><td className="num">{t.swaps}</td><td className="num">{amount(t.units, t.symbol, t.raw)}</td></tr>))}</tbody>
                  </Table>
                )}
              </Panel>
              <Panel title="Protocol fees collected" provenance={r.protocolFees.collected.definition}>
                {r.protocolFees.collected.byTokenAndMethod.length === 0 ? <div className="state state--empty">No ProtocolFeesCollected event in this window.</div> : (
                  <Table caption="Protocol fees collected">
                    <thead><tr><th scope="col">Token</th><th scope="col">Via</th><th scope="col" className="num">Amount</th></tr></thead>
                    <tbody>{r.protocolFees.collected.byTokenAndMethod.map((t) => (<tr key={`${t.token}-${t.via}`}><td>{t.symbol ?? <Addr value={t.token} />}</td><td><code>{t.via}</code></td><td className="num">{amount(t.units, t.symbol, t.raw)}</td></tr>))}</tbody>
                  </Table>
                )}
              </Panel>
              <Panel title="Accrued, not collected" provenance={r.protocolFees.accruedUncollected.definition}>
                {r.protocolFees.accruedUncollected.items.length === 0 ? <div className="state state--empty">No accrual snapshot.</div> : (
                  <Table caption="Accrued protocol fees">
                    <thead><tr><th scope="col">Token</th><th scope="col" className="num">Accrued</th>{r.filters.usd ? <th scope="col">USD (current feed)</th> : null}</tr></thead>
                    <tbody>{r.protocolFees.accruedUncollected.items.map((t) => (
                      <tr key={`${t.poolManager}-${t.token}`}>
                        <td>{t.symbol ?? <Addr value={t.token} />}<div className="muted small">block {group(t.readAtBlock)}</div></td>
                        <td className="num">{amount(t.units, t.symbol, t.raw)}</td>
                        {r.filters.usd ? <td>{t.usd?.value ? <span title={t.usd.method}>${group(t.usd.value)} <span className="muted small">{t.usd.source} {t.usd.feed}, updated {utc(t.usd.feedUpdatedAt)}</span></span> : <span className="muted small">withheld: {t.usd?.reason ?? 'no feed'}</span>}</td> : null}
                      </tr>))}
                    </tbody>
                  </Table>
                )}
              </Panel>
            </div>

            <Panel title={`Ledger (${r.ledger.total} entries)`} provenance="revenue_ledger rows, newest first; each is one log">
              {r.ledger.items.length === 0 ? (
                <div className="state state--empty">No ledger entries match these filters.</div>
              ) : (
                <>
                  <Table caption="Revenue ledger">
                    <thead>
                      <tr>
                        <th scope="col">Time (block)</th>
                        <th scope="col">Source</th>
                        <th scope="col" className="num">Amount</th>
                        <th scope="col">Counterparty</th>
                        <th scope="col">Tx</th>
                        <th scope="col">USD at write</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.ledger.items.map((e) => (
                        <tr key={e.id}>
                          <td>{utc(e.blockTimestamp)}<div className="muted small">{group(e.blockNumber)}</div></td>
                          <td><code>{e.source}</code></td>
                          <td className="num">{amount(e.units, e.symbol, e.raw)}</td>
                          <td><Addr value={e.counterparty} /></td>
                          <td><code title={e.txHash}>{shortHash(e.txHash)}</code></td>
                          <td>{e.usd ? `$${group(e.usd.value)} (${e.usd.source}, ${utc(e.usd.pricedAt)})` : <span className="muted">not priced</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="pager">
                    <button type="button" className="btn btn--xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
                    <span className="muted">{offset + 1}–{Math.min(offset + 50, r.ledger.total)} of {r.ledger.total}</span>
                    <button type="button" className="btn btn--xs" disabled={offset + 50 >= r.ledger.total} onClick={() => setOffset(offset + 50)}>Next</button>
                  </div>
                </>
              )}
            </Panel>
          </>
        )}
      </StateView>
    </div>
  )
}

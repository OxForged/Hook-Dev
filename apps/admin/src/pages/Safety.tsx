import { Addr, Chip, Panel, StateView, Table, type Tone } from '../components/ui.tsx'
import { qs } from '../lib/api.ts'
import { ago, duration, group, shortHash, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface Safety {
  chainId: number
  contractClock: { contractBlockNumber: string; method: string | null; readAt: string | null } | null
  pendingConfigs: { note: string; items: { hook: string; poolId: string; shape: string; status: string; effectiveContractBlock: string; expiryContractBlock: string | null; params: { feePips?: number; enabled?: boolean; beneficiaryBps?: number }; contractBlockNumber: string; readAtBlock: string; readAt: string; readError: string | null }[] }
  opsBalances: { gasReference: { referenceGasPriceWei: string; referenceSource: string } | null; items: { label: string; address: string; purpose: string; balanceWei: string; balance: string; nativeSymbol: string; criticalWei: string | null; warnWei: string | null; gasPriceWei: string | null; gasPriceSource: string | null; actionsAffordable: string | null; severity: string | null; rationale: string | null; readAtBlock: string; readAt: string }[] }
  feeds: { label: string; proxy: string; description: string | null; answer: string | null; decimals: number | null; feedUpdatedAt: string | null; stalenessSeconds: number | null; heartbeatSeconds: number; heartbeatViolation: boolean | null; error: string | null; readAt: string }[]
  stockTokens: { note: string; current: { token: string; symbol: string | null; tokenPaused: boolean | null; uiMultiplier: string | null; pools: string[]; readAtBlock: string; readAt: string; readError: string | null }[]; changes: { token: string; symbol: string | null; previousPaused: boolean | null; tokenPaused: boolean | null; previousUiMultiplier: string | null; uiMultiplier: string | null; readAt: string }[] }
}

const pcTone = (s: string): Tone => (s === 'ARMED' ? 'high' : s === 'UNKNOWN' ? 'medium' : s === 'QUEUED' ? 'low' : 'muted')
const sevTone = (s: string | null): Tone => (s === 'CRITICAL' ? 'critical' : s === 'WARN' ? 'medium' : s === 'OK' ? 'ok' : 'muted')

/** 1e18-scaled multiplier -> exact decimal. */
function scaled18(v: string | null): string {
  if (v === null) return '—'
  const s = v.padStart(19, '0')
  const whole = s.slice(0, -18).replace(/^0+(?=\d)/, '')
  const frac = s.slice(-18).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

export function SafetyPage({ chainId }: { chainId: number }) {
  const { state, reload } = useApi<Safety>(`/safety${qs({ chainId })}`)
  return (
    <StateView state={state} reload={reload}>
      {(s) => (
        <div className="stack">
          <Panel title="Ops balances against gas-denominated thresholds" provenance={`ops_balances, read by the governance pass. Thresholds = gas units per action x gas price x action count, from config/chains/${s.chainId}.json${s.opsBalances.gasReference ? `; fallback price ${group(s.opsBalances.gasReference.referenceGasPriceWei)} wei` : ''}`}>
            {s.opsBalances.items.length === 0 ? <div className="state state--empty">No ops balance read yet (governance pass has not run), or no ops account is configured.</div> : (
              <Table caption="Ops balances">
                <thead><tr><th scope="col">Account</th><th scope="col">Status</th><th scope="col" className="num">Balance</th><th scope="col" className="num">Affords</th><th scope="col" className="num">Critical below</th><th scope="col" className="num">Warn below</th><th scope="col">Gas price used</th><th scope="col">Why these thresholds</th></tr></thead>
                <tbody>
                  {s.opsBalances.items.map((b) => (
                    <tr key={b.label} className={b.severity === 'CRITICAL' ? 'row--critical' : undefined}>
                      <th scope="row"><strong>{b.label}</strong><div><Addr value={b.address} /></div><div className="muted small">{b.purpose}</div></th>
                      <td><Chip tone={sevTone(b.severity)}>{b.severity ?? 'no budget'}</Chip></td>
                      <td className="num">{group(b.balance)} {b.nativeSymbol}<div className="muted small">{group(b.balanceWei)} wei</div></td>
                      <td className="num">{b.actionsAffordable ?? '—'}</td>
                      <td className="num">{group(b.criticalWei)} wei</td>
                      <td className="num">{group(b.warnWei)} wei</td>
                      <td className="small">{group(b.gasPriceWei)} wei<div className="muted">{b.gasPriceSource}</div></td>
                      <td>{b.rationale ? <details><summary>Gas-cost rationale</summary><p className="small">{b.rationale}</p></details> : <span className="muted">none configured</span>}<div className="muted small">block {group(b.readAtBlock)}, {ago(b.readAt)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="RevShare pending configs" provenance={`pending_config_hazards. ${s.pendingConfigs.note} Contract clock: ${s.contractClock ? `${group(s.contractClock.contractBlockNumber)} (${s.contractClock.method}, read ${ago(s.contractClock.readAt)})` : 'not read'}`}>
            {s.pendingConfigs.items.length === 0 ? <div className="state state--empty">No pool on Latch's own RevShareHooks has been read (none indexed, or the snapshot pass has not run).</div> : (
              <Table caption="Pending configs">
                <thead><tr><th scope="col">Pool</th><th scope="col">Hook (shape)</th><th scope="col">Status</th><th scope="col">Effective (contract block)</th><th scope="col">Expiry</th><th scope="col">Proposed params</th></tr></thead>
                <tbody>
                  {s.pendingConfigs.items.map((p) => (
                    <tr key={`${p.hook}-${p.poolId}`} className={p.status === 'ARMED' ? 'row--high' : undefined}>
                      <td><code title={p.poolId}>{shortHash(p.poolId)}</code></td>
                      <td><Addr value={p.hook} /><div className="muted small">{p.shape === 'legacy' ? 'legacy: no expiry; disable does not clear it' : p.shape}</div></td>
                      <td><Chip tone={pcTone(p.status)} title={p.readError ?? undefined}>{p.status}</Chip></td>
                      <td className="num">{p.status === 'NONE' ? '—' : group(p.effectiveContractBlock)}<div className="muted small">now {group(p.contractBlockNumber)}</div></td>
                      <td className="num">{p.expiryContractBlock ? group(p.expiryContractBlock) : p.shape === 'legacy' ? <strong>never</strong> : '—'}</td>
                      <td className="small">{p.status === 'NONE' || p.status === 'UNKNOWN' ? '—' : `fee ${p.params.feePips ?? '?'} pips, enabled ${String(p.params.enabled)}, beneficiary ${p.params.beneficiaryBps ?? '?'} bps`}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <div className="grid-2">
            <Panel title="Oracle feeds vs heartbeat" provenance="feed_observations, latest per proxy; staleness measured against the block timestamp of the read">
              {s.feeds.length === 0 ? <div className="state state--empty">No feed read yet, or none configured for this chain.</div> : (
                <Table caption="Feeds">
                  <thead><tr><th scope="col">Feed</th><th scope="col">Status</th><th scope="col" className="num">Since update</th><th scope="col" className="num">Heartbeat</th></tr></thead>
                  <tbody>
                    {s.feeds.map((f) => (
                      <tr key={f.proxy}>
                        <th scope="row">{f.label}<div><Addr value={f.proxy} /></div></th>
                        <td>{f.error ? <Chip tone="medium" title={f.error}>read failed</Chip> : f.heartbeatViolation ? <Chip tone="medium">stale</Chip> : <Chip tone="ok">fresh</Chip>}</td>
                        <td className="num">{f.stalenessSeconds === null ? '—' : duration(f.stalenessSeconds)}<div className="muted small">{utc(f.feedUpdatedAt)}</div></td>
                        <td className="num">{duration(f.heartbeatSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
            <Panel title="Stock tokens in pools: tokenPaused and uiMultiplier" provenance={`stock_token_observations. ${s.stockTokens.note}`}>
              {s.stockTokens.current.length === 0 ? <div className="state state--empty">No token in an indexed pool answers tokenPaused() or uiMultiplier().</div> : (
                <Table caption="Stock tokens">
                  <thead><tr><th scope="col">Token</th><th scope="col">tokenPaused</th><th scope="col" className="num">uiMultiplier</th><th scope="col" className="num">Pools</th></tr></thead>
                  <tbody>
                    {s.stockTokens.current.map((t) => (
                      <tr key={t.token}>
                        <th scope="row"><Addr value={t.token} label={t.symbol} /></th>
                        <td>{t.tokenPaused === null ? <span className="muted">does not answer</span> : t.tokenPaused ? <Chip tone="high">PAUSED</Chip> : <Chip tone="ok">not paused</Chip>}</td>
                        <td className="num">{scaled18(t.uiMultiplier)}</td>
                        <td className="num">{t.pools.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <h3 className="subhead">Changes observed</h3>
              {s.stockTokens.changes.length === 0 ? <div className="state state--empty">No issuer state change observed since the worker started recording.</div> : (
                <ul className="changes">
                  {s.stockTokens.changes.map((c) => (
                    <li key={`${c.token}-${c.readAt}`}>
                      {utc(c.readAt)}: {c.symbol ?? shortHash(c.token)}{' '}
                      {c.previousUiMultiplier !== c.uiMultiplier ? `uiMultiplier ${scaled18(c.previousUiMultiplier)} -> ${scaled18(c.uiMultiplier)}` : `tokenPaused ${String(c.previousPaused)} -> ${String(c.tokenPaused)}`}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </StateView>
  )
}

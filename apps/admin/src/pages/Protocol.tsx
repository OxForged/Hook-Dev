import { Addr, Chip, Panel, StateView, Table, type Tone } from '../components/ui.tsx'
import { qs } from '../lib/api.ts'
import { group, shortHash, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'

interface Protocol {
  chainId: number
  provenance: { toBlock: string; toBlockTimestamp: string; fromBlock: string; note: string }
  pools: { poolId: string; poolType: string; token0: { address: string; symbol: string | null }; token1: { address: string; symbol: string | null }; hooks: string | null; feeRaw: number; swaps: number; lastSwapAt: string | null; byInputToken: { token: string; symbol: string | null; swaps: number; volumeIn: string | null; feesTotal: string | null; feesLp: string | null; feesProtocol: string | null; volumeInRaw: string }[]; createdAt: { blockNumber: string; txHash: string } }[]
  volumeAllTime: { token: string; symbol: string | null; swapsIn: number; volumeIn: string | null; volumeInRaw: string | null; fees: { total: string | null; lp: string | null; protocol: string | null } }[]
  launches: { total: number; items: { poolId: string; launchToken: string; quoteToken: string; operator: string; schedule: { phase: string; startContractBlock: string }; createdAt: { blockNumber: string } }[] }
  registry: { note: string; listings: { hook: string; name: string | null; riskClass: string | null; permissions: string | null; listing: string; verification: string; registeredAt: { blockNumber: string; txHash: string } | null; lastChangeReason: string | null }[] }
  appRegistrations: { app: string; blockNumber: string; txHash: string; note: string }[]
}

const riskTone = (r: string | null): Tone => (r === 'ValueExtracting' ? 'high' : r === 'Restrictive' ? 'medium' : r === 'Passive' ? 'ok' : 'muted')
const listingTone = (l: string): Tone => (l === 'Malicious' ? 'critical' : l === 'Deprecated' ? 'medium' : 'ok')
const unitsOr = (u: string | null, sym: string | null) => (u === null ? 'decimals unread' : `${group(u)} ${sym ?? ''}`)

export function ProtocolPage({ chainId }: { chainId: number }) {
  const { state, reload } = useApi<Protocol>(`/protocol${qs({ chainId })}`)
  return (
    <StateView state={state} reload={reload}>
      {(p) => {
        const prov = `logs from block ${group(p.provenance.fromBlock)} to ${group(p.provenance.toBlock)} (${utc(p.provenance.toBlockTimestamp)}). ${p.provenance.note}`
        return (
          <div className="stack">
            <Panel title={`Pools (${p.pools.length})`} provenance={prov}>
              {p.pools.length === 0 ? (
                <div className="state state--empty">No pool has been initialised on the Latch pool managers of chain {p.chainId}.</div>
              ) : (
                <Table caption="Pools">
                  <thead>
                    <tr>
                      <th scope="col">Pool</th>
                      <th scope="col">Pair</th>
                      <th scope="col">Latch (hook)</th>
                      <th scope="col" className="num">Swaps</th>
                      <th scope="col">Volume in, by input token</th>
                      <th scope="col">Fees total / LP / protocol</th>
                      <th scope="col">Last swap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.pools.map((pool) => (
                      <tr key={pool.poolId}>
                        <td><code title={pool.poolId}>{shortHash(pool.poolId)}</code><div className="muted small">{pool.poolType} · fee {pool.feeRaw} pips</div></td>
                        <td>{pool.token0.symbol ?? '?'} / {pool.token1.symbol ?? '?'}</td>
                        <td>{pool.hooks ? <Addr value={pool.hooks} /> : <span className="muted">none</span>}</td>
                        <td className="num">{pool.swaps}</td>
                        <td>{pool.byInputToken.length === 0 ? <span className="muted">no swaps</span> : pool.byInputToken.map((t) => <div key={t.token}>{unitsOr(t.volumeIn, t.symbol)} <span className="muted small">({t.swaps})</span></div>)}</td>
                        <td>{pool.byInputToken.map((t) => <div key={t.token} className="small">{t.feesTotal ?? '?'} / {t.feesLp ?? '?'} / {t.feesProtocol ?? '?'} {t.symbol}</div>)}</td>
                        <td>{pool.lastSwapAt ? utc(pool.lastSwapAt) : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <div className="grid-2">
              <Panel title="Volume, all time, by input token" provenance="swaps: the INPUT leg of each Swap log; fees from each swap's own fee and protocolFee">
                {p.volumeAllTime.length === 0 ? <div className="state state--empty">No swaps indexed.</div> : (
                  <Table caption="Volume by token">
                    <thead><tr><th scope="col">Token</th><th scope="col" className="num">Swaps</th><th scope="col" className="num">Volume in</th><th scope="col" className="num">Protocol fees</th></tr></thead>
                    <tbody>{p.volumeAllTime.map((v) => (<tr key={v.token}><td><Addr value={v.token} label={v.symbol} /></td><td className="num">{v.swapsIn}</td><td className="num">{unitsOr(v.volumeIn, v.symbol)}</td><td className="num">{unitsOr(v.fees.protocol, v.symbol)}</td></tr>))}</tbody>
                  </Table>
                )}
              </Panel>
              <Panel title={`Kit launches (${p.launches.total})`} provenance="LaunchpadKit LaunchCreated; phase judged on the contract clock">
                {p.launches.items.length === 0 ? <div className="state state--empty">No LaunchCreated event from the SDK's LaunchpadKit on this chain.</div> : (
                  <Table caption="Launches">
                    <thead><tr><th scope="col">Pool</th><th scope="col">Token</th><th scope="col">Operator</th><th scope="col">Phase</th></tr></thead>
                    <tbody>{p.launches.items.map((l) => (<tr key={l.poolId}><td><code>{shortHash(l.poolId)}</code></td><td><Addr value={l.launchToken} /></td><td><Addr value={l.operator} /></td><td><Chip tone="info">{l.schedule.phase}</Chip></td></tr>))}</tbody>
                  </Table>
                )}
              </Panel>
            </div>

            <Panel title={`Registry listings (${p.registry.listings.length})`} provenance={`LatchRegistry events. ${p.registry.note}`} actions={<a className="btn btn--xs" href="#/safe-actions">Flag a malicious Latch</a>}>
              {p.registry.listings.length === 0 ? <div className="state state--empty">No LatchRegistered event on the SDK registry.</div> : (
                <Table caption="Registry listings">
                  <thead><tr><th scope="col">Latch</th><th scope="col">Name</th><th scope="col">Risk class</th><th scope="col">Listing</th><th scope="col">Verification</th><th scope="col">Registered</th></tr></thead>
                  <tbody>
                    {p.registry.listings.map((l) => (
                      <tr key={l.hook}>
                        <td><Addr value={l.hook} /></td>
                        <td>{l.name ?? <span className="muted">no metadata event</span>}</td>
                        <td><Chip tone={riskTone(l.riskClass)} title="As recorded at registration">{l.riskClass ?? 'unknown'}</Chip></td>
                        <td><Chip tone={listingTone(l.listing)} title={l.lastChangeReason ?? undefined}>{l.listing}</Chip></td>
                        <td>{l.verification}</td>
                        <td className="muted">{l.registeredAt ? `block ${group(l.registeredAt.blockNumber)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <Panel title="Vault app registrations" provenance="Vault AppRegistered. registerApp is irreversible: a registered app can move funds against the Vault permanently.">
              {p.appRegistrations.length === 0 ? <div className="state state--empty">No AppRegistered event indexed.</div> : (
                <Table caption="App registrations">
                  <thead><tr><th scope="col">App</th><th scope="col">Block</th><th scope="col">Tx</th></tr></thead>
                  <tbody>{p.appRegistrations.map((a) => (<tr key={a.txHash + a.app}><td><Addr value={a.app} /></td><td>{group(a.blockNumber)}</td><td><code>{shortHash(a.txHash)}</code></td></tr>))}</tbody>
                </Table>
              )}
            </Panel>
          </div>
        )
      }}
    </StateView>
  )
}

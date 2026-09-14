import { AlertList, SeverityBar } from '../components/Alerts.tsx'
import { Addr, KV, Panel, StateView, Table } from '../components/ui.tsx'
import { qs } from '../lib/api.ts'
import { ago, amount, group, utc } from '../lib/format.ts'
import { useApi } from '../lib/useApi.ts'
import type { Overview } from './types.ts'

export function OverviewPage({ chainId }: { chainId: number }) {
  const { state, reload } = useApi<Overview>(`/overview${qs({ chainId })}`)
  return (
    <StateView state={state} reload={reload}>
      {(o) => (
        <div className="stack">
          <SeverityBar counts={o.alerts.counts} />
          <Panel title="Alerts, most severe first" id="alerts" provenance={`computed at ${utc(o.generatedAt)} from the worker's latest reads (each alert names its own read)`} actions={<button type="button" className="btn btn--xs" onClick={reload}>Refresh</button>}>
            <AlertList alerts={o.alerts.top} />
          </Panel>

          <div className="grid-2">
            <Panel title="Indexer" provenance="indexer_checkpoints (the worker's own head observation; the API never asks a chain per request)">
              {o.indexer.indexed ? (
                <KV
                  rows={[
                    ['Indexed to block', group(o.indexer.lastIndexedBlock)],
                    ['Block time', utc(o.indexer.lastIndexedBlockTimestamp)],
                    ['Observed head', `${group(o.indexer.headBlock)} (${ago(o.indexer.headObservedAt)})`],
                    ['Lag', `${group(o.indexer.lagBlocks)} blocks`],
                    ['Contract clock', o.indexer.contractBlockNumber ? `${group(o.indexer.contractBlockNumber)} (read ${ago(o.indexer.contractClockReadAt)})` : 'not read'],
                  ]}
                />
              ) : (
                <div className="state state--unconfigured">
                  <strong>Not indexed.</strong> No checkpoint exists for chain {o.chainId}. Start the worker (<code>node dist/worker.js</code>) or run <code>index:once</code>.
                </div>
              )}
            </Panel>

            <Panel title="Queues and keys" provenance="listing_submissions, api_keys, api_usage_monthly">
              <KV
                rows={[
                  ['Listings pending', String(o.moderation.PENDING ?? 0)],
                  ['Listings approved', String(o.moderation.APPROVED ?? 0)],
                  ['API keys active', String(o.apiKeys.byStatus.ACTIVE ?? 0)],
                  ['API keys revoked', String(o.apiKeys.byStatus.REVOKED ?? 0)],
                  [`Requests ${o.apiKeys.period}`, group(o.apiKeys.requestsThisMonth)],
                ]}
              />
            </Panel>
          </div>

          <Panel title="Revenue headlines (token units)" provenance={`${o.revenue.provenance}. No USD: flows are never multiplied by a current price.`} actions={<a className="btn btn--xs" href="#/revenue">Revenue ledger</a>}>
            <div className="grid-2">
              <div>
                <h3 className="subhead">Received by the protocol, all indexed sources</h3>
                {o.revenue.received.length === 0 ? (
                  <div className="state state--empty">No protocol revenue flow has been indexed on chain {o.chainId}: no collect(), sweep() or treasury RevShare claim in the logs.</div>
                ) : (
                  <Table caption="Revenue received by token">
                    <thead>
                      <tr>
                        <th scope="col">Token</th>
                        <th scope="col" className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.revenue.received.map((r) => (
                        <tr key={r.token}>
                          <td><Addr value={r.token} label={r.symbol} /></td>
                          <td className="num">{amount(r.units, r.symbol, r.raw)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
              <div>
                <h3 className="subhead">Protocol fees accrued, not yet collected</h3>
                {o.revenue.uncollectedAccrued.length === 0 ? (
                  <div className="state state--empty">No protocolFeesAccrued snapshot yet (no pool, or the snapshot pass has not run).</div>
                ) : (
                  <Table caption="Uncollected protocol fees">
                    <thead>
                      <tr>
                        <th scope="col">Manager</th>
                        <th scope="col">Token</th>
                        <th scope="col" className="num">Accrued</th>
                        <th scope="col">Read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.revenue.uncollectedAccrued.map((r) => (
                        <tr key={`${r.poolManager}-${r.token}`}>
                          <td><Addr value={r.poolManager} /></td>
                          <td><Addr value={r.token} label={r.symbol} /></td>
                          <td className="num">{amount(r.units, r.symbol, r.raw)}</td>
                          <td className="muted">block {group(r.readAtBlock)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </div>
            <ul className="notdeployed">
              {o.revenue.notDeployed.map((n) => (
                <li key={n.source}>
                  <span className="chip chip--muted">not deployed yet</span> {n.label}: <span className="muted">{n.note}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </StateView>
  )
}

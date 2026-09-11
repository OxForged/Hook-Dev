/* ============================================================================
   A · /app/protocol — the pools this address owns on a RevShareHook.

   There is no `poolsOf(address)` on the hook, so ownership is ENUMERATED FROM
   LOGS and then VERIFIED BY CALL:

     PoolClaimed(poolId, owner)            first configuration of a pool
     PoolOwnerChanged(poolId, from, to)    every transfer since

   Both are indexed on the address, so the RPC filters them. The union of the
   three queries is a candidate list only — `poolOwner(poolId)` decides. That
   check is what reconciles a pool this address claimed and later handed on,
   and it keeps the answer right even if the scan missed a transfer.

   Wallet-not-connected is a first-class state here, not a wall: screen B is
   public, so this screen offers a pool id lookup instead of a dead end.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { Link } from 'react-router-dom'
import { useAccount, useSwitchChain } from 'wagmi'

import { DEPLOYMENTS } from '../../../lib/chain'
import { BarList } from '../components/charts'
import { Methodology } from '../components/ProtocolCharts'
import {
  REVSHARE_CHAIN_ID,
  bpsPct,
  pipsPct,
  shortHex,
  type OwnedPools,
} from '../lib/revshare'
import {
  Addr,
  Empty,
  Kpi,
  NotDeployed,
  PoolIdLookup,
  PoolIdText,
  Reading,
  ScreenIntro,
  Unreachable,
} from '../lib/revshareParts'
import { readOwnedPools } from '../lib/revshare'
import { useChainRead } from '../lib/useChainRead'
import { useHookRef } from '../lib/useHookRef'
import { dappPath } from '../paths'

const CHAIN = DEPLOYMENTS[REVSHARE_CHAIN_ID]

export default function ProtocolRevenue() {
  const { ref: hook, malformed, withHook } = useHookRef()
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()

  const onChain = chainId === REVSHARE_CHAIN_ID
  const readable = hook !== null && address !== undefined && onChain
  const key = readable ? `owned:${hook.address}:${address}` : null

  const { state, reload } = useChainRead<OwnedPools>(key, async () => {
    if (!hook || !address) throw new Error('unreachable')
    return readOwnedPools(hook.address, address)
  })

  return (
    <>
      <ScreenIntro title="Revenue share you operate" hook={hook ?? undefined}>
        <p>Pools whose RevShareHook configuration is owned by the connected address.</p>
        <Methodology label="How ownership is established">
          <p className="live-note">
            Candidates come from <code>PoolClaimed</code> and <code>PoolOwnerChanged</code> logs and
            are then confirmed against <code>poolOwner(poolId)</code>, which is the only current
            truth — a pool that appears in the logs but has since been transferred is not listed.
          </p>
        </Methodology>
      </ScreenIntro>

      {!hook && <NotDeployed malformed={malformed} />}

      {hook && !isConnected && (
        <section className="dapp-card">
          <h3 className="dapp-card__title">Connect a wallet to list the pools you own</h3>
          <p className="live-note">
            Pool ownership on the hook is an address, so there is nothing to look up until one is
            known. Connecting reads only; it signs nothing.
          </p>
          <ul className="live-list" style={{ marginTop: 10 }}>
            <li>
              <span>Every pool you configured or were handed</span>
              <span className="live-fee">PoolClaimed + PoolOwnerChanged, verified by poolOwner</span>
            </li>
            <li>
              <span>Its cut, its three-way split and whether it is enabled</span>
              <span className="live-fee">getConfig(poolId)</span>
            </li>
            <li>
              <span>Whether a config change is waiting to be applied</span>
              <span className="live-fee">getPendingConfig(poolId).effectiveBlock</span>
            </li>
          </ul>
          <div style={{ marginTop: 12 }}>
            <LatchConnectButton variant="inline" label="Connect wallet" />
          </div>
          <p className="live-note" style={{ marginTop: 14 }}>
            A pool&rsquo;s revenue share is public — you do not need a wallet to read one. If you
            already have the pool id, open it directly.
          </p>
          <PoolIdLookup withHook={withHook} />
        </section>
      )}

      {hook && isConnected && !onChain && (
        <section className="dapp-card dp-gate dp-gate--warn">
          <p className="dp-gate__title">Wrong network</p>
          <p className="dp-gate__body">
            The contracts these screens read exist on {CHAIN.name} only. Your wallet is on chain{' '}
            {chainId ?? 'unknown'}.
          </p>
          <button
            type="button"
            className="dapp-btn dapp-btn--sm"
            onClick={() => switchChain({ chainId: REVSHARE_CHAIN_ID })}
            disabled={switching}
          >
            {switching ? 'Switching…' : `Switch to ${CHAIN.name}`}
          </button>
        </section>
      )}

      {state.k === 'loading' && <Reading what="pool ownership logs" />}
      {state.k === 'error' && <Unreachable message={state.message} onRetry={reload} />}

      {state.k === 'ready' && state.data.pools.length === 0 && (
        <Empty title="This address owns no revenue-share pools">
          <p>
            No pool on <Addr value={hook?.address ?? ''} /> currently names this address as its
            owner. That is a real answer from the chain, not a failed read — the scan covered
            blocks {state.data.fromBlock.toString()} to {state.data.toBlock.toString()} and found{' '}
            {state.data.transferredAway === 0
              ? 'no pools at all for this address'
              : `${state.data.transferredAway} pool(s) it once owned but has since transferred`}
            .
          </p>
          <p style={{ marginTop: 8 }}>
            A pool appears here once its owner calls <code>configure(key, params)</code> — an
            owner-only action, not offered from this screen.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.pools.length > 0 && (
        <>
          <div className="dapp-kpis">
            <Kpi
              label="POOLS OWNED"
              value={state.data.pools.length}
              sub="verified with poolOwner(poolId)"
            />
            <Kpi
              label="ENABLED"
              value={state.data.pools.filter((p) => p.config.enabled).length}
              sub="getConfig(poolId).enabled"
            />
            <Kpi
              label="CHANGES PENDING"
              value={state.data.pools.filter((p) => p.pendingEffectiveBlock !== 0n).length}
              sub="getPendingConfig(poolId).effectiveBlock ≠ 0"
            />
          </div>

          <section className="dapp-card">
            <div className="dapp-card__head">
              <h3 className="dapp-card__title">Your pools</h3>
              <span className="dapp-badge dapp-badge--mute">
                head block {state.data.blockNumber.toString()}
              </span>
            </div>

            {/* Pips against pips — the one figure on this screen that compares
                cleanly across pools, because every pool's cut is a rate on its
                own input and no token amount is involved. Drawn only with
                something to compare: a bar list of one row ranks nothing. */}
            {state.data.pools.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <BarList
                  items={[...state.data.pools]
                    .sort((a, b) => b.config.feePips - a.config.feePips)
                    .map((p) => {
                      const max = Math.max(...state.data.pools.map((q) => q.config.feePips), 1)
                      return {
                        name: shortHex(p.poolId, 10, 6),
                        value: `${pipsPct(p.config.feePips)} · ${p.config.feePips} pips`,
                        pct: (p.config.feePips / max) * 100,
                        color: p.config.enabled ? ('primary' as const) : ('amber' as const),
                      }
                    })}
                  valueLabel="cut of each swap"
                  shareLabel="of your largest cut"
                  /* Only the states that actually occur. A "Disabled" toggle
                     with nothing behind it invites a click that dims the whole
                     list and says nothing. */
                  series={[
                    ...(state.data.pools.some((p) => p.config.enabled)
                      ? [{ key: 'primary' as const, label: 'Enabled' }]
                      : []),
                    ...(state.data.pools.some((p) => !p.config.enabled)
                      ? [{ key: 'amber' as const, label: 'Disabled' }]
                      : []),
                  ]}
                />
              </div>
            )}

            <div className="dapp-table-wrap">
              <table className="dapp-table">
                <thead>
                  <tr>
                    <th scope="col">Pool</th>
                    <th scope="col">Cut</th>
                    <th scope="col">LP / beneficiaries / distributor</th>
                    <th scope="col">Distributor</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.pools.map((p) => (
                    <tr key={p.poolId}>
                      <th scope="row">
                        <Link to={withHook(dappPath(`protocol/${p.poolId}`))}>
                          <PoolIdText value={p.poolId} />
                        </Link>
                      </th>
                      <td className="dapp-table__num">
                        {pipsPct(p.config.feePips)}
                        <span className="dapp-microlabel"> {p.config.feePips} pips</span>
                      </td>
                      <td className="dapp-table__num">
                        {bpsPct(p.config.lpDonateBps)} / {bpsPct(p.config.beneficiaryBps)} /{' '}
                        {bpsPct(p.config.distributorBps)}
                      </td>
                      <td>{p.distributor ? <Addr value={p.distributor} /> : <span className="hx-muted">none</span>}</td>
                      <td>
                        <span
                          className={
                            p.config.enabled ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'
                          }
                        >
                          {p.config.enabled ? 'enabled' : 'disabled'}
                        </span>{' '}
                        {p.config.frozen && <span className="dapp-badge dapp-badge--info">frozen</span>}{' '}
                        {p.pendingEffectiveBlock !== 0n && (
                          <span className="dapp-badge dapp-badge--warn">
                            change at block {p.pendingEffectiveBlock.toString()}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="live-note" style={{ marginTop: 10 }}>
              <strong>
                Log scan covered blocks {state.data.fromBlock.toString()} →{' '}
                {state.data.toBlock.toString()}
              </strong>{' '}
              — a pool claimed outside that range would not appear.
            </p>
            <Methodology label="Why the scan has a range at all">
              <p className="live-note">
                The hook keeps no cumulative index of pools, so the only way to find them is by log,
                and how far back that reaches is whatever this RPC serves.
              </p>
            </Methodology>
          </section>
        </>
      )}

      {hook && (
        <section className="dapp-card">
          <h3 className="dapp-card__title">Open any pool by id</h3>
          <p className="live-note">
            A pool&rsquo;s revenue share, roster and epoch history are public reads. This box takes a
            32-byte pool id and needs no wallet.
          </p>
          <PoolIdLookup withHook={withHook} />
        </section>
      )}
    </>
  )
}

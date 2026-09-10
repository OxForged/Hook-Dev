/* ============================================================================
   C · /app/protocol/:poolId/epochs — the distributor's epoch timeline.

   The pool's distributor comes from `distributorOf(poolId)`, which returns a
   BARE ADDRESS. There is no `kind()`, no shared interface and no registry, and
   the two distributors' epoch structs are both nine fields with DIFFERENT
   meanings in slot five — a vote total on the snapshot distributor, a merkle
   root on the merkle one. Decoding with the wrong ABI succeeds and produces
   plausible nonsense.

   So the type is probed by selector before anything is decoded: `token()`
   answers only on `SnapshotEpochDistributor`, `challengeDelay()` only on
   `MerkleEpochDistributor`. Neither answering is reported as `unknown` and the
   screen stops there rather than guessing.

   Two permissionless calls live here, `closeEpoch` and `rollover`. Both are
   simulated before the button is enabled, which is how `EpochTooSoon`,
   `NothingToDistribute`, `NotExpiredYet` and `AlreadyRolledOver` are surfaced
   as the ordinary states they are instead of as failed transactions.

   `postRoot` and `cancelRoot` on the merkle distributor are owner and guardian
   actions. They are shown as state below and are not wired to a button.
   ============================================================================ */

import { Link, useParams } from 'react-router-dom'

import {
  MERKLE_DISTRIBUTOR_ABI,
  SNAPSHOT_DISTRIBUTOR_ABI,
} from '../lib/revshareAbi'
import {
  fmtDuration,
  fmtTimestamp,
  isPoolId,
  readDistributor,
  readDistributorFor,
  shortHex,
  type DistributorCommon,
  type DistributorState,
  type MerkleEpoch,
  type SnapshotEpoch,
} from '../lib/revshare'
import {
  Addr,
  Empty,
  Kpi,
  Money,
  NotDeployed,
  PoolIdText,
  Reading,
  ScreenIntro,
  Unreachable,
} from '../lib/revshareParts'
import { PermissionlessAction } from '../lib/revshareWrite'
import { useChainRead } from '../lib/useChainRead'
import { useHookRef } from '../lib/useHookRef'
import { dappPath } from '../paths'

type Load =
  | { k: 'no-code' }
  | { k: 'not-a-hook' }
  | { k: 'not-configured' }
  | { k: 'no-distributor' }
  | { k: 'ready'; d: DistributorState }

export default function ProtocolEpochs() {
  const { poolId: raw } = useParams<{ poolId: string }>()
  const { ref: hook, malformed, withHook } = useHookRef()

  const poolId = raw && isPoolId(raw) ? (raw.trim() as `0x${string}`) : null
  const key = hook && poolId ? `epochs:${hook.address}:${poolId}` : null

  const { state, reload } = useChainRead<Load>(key, async () => {
    if (!hook || !poolId) throw new Error('unreachable')
    const found = await readDistributorFor(hook.address, poolId)
    if (!found.hasCode) return { k: 'no-code' }
    if (!found.answersAsHook) return { k: 'not-a-hook' }
    if (!found.configured) return { k: 'not-configured' }
    if (!found.distributor) return { k: 'no-distributor' }
    return { k: 'ready', d: await readDistributor(found.distributor) }
  })

  return (
    <>
      <ScreenIntro title="Epoch timeline" hook={hook ?? undefined}>
        <p>
          The distributor named by <code>distributorOf(poolId)</code>, its epoch history and the two
          permissionless calls that keep it moving. Without something calling{' '}
          <code>closeEpoch</code> and <code>rollover</code>, an epoch never closes and unclaimed
          funds never return to the next one.
        </p>
        {poolId && (
          <p style={{ marginTop: 6 }}>
            Pool <PoolIdText value={poolId} /> ·{' '}
            <Link to={withHook(dappPath(`protocol/${poolId}`))}>← back to the pool</Link>
          </p>
        )}
      </ScreenIntro>

      {!hook && <NotDeployed malformed={malformed} />}

      {hook && !poolId && (
        <Empty title="That is not a pool id">
          <p>A pool id is 32 bytes — 0x followed by 64 hex characters.</p>
        </Empty>
      )}

      {state.k === 'loading' && <Reading what="the distributor and its epochs" />}
      {state.k === 'error' && <Unreachable message={state.message} onRetry={reload} />}

      {state.k === 'ready' && state.data.k === 'no-code' && (
        <Empty title="There is no contract at that hook address">
          <p>Nothing was read. The address in this URL has no deployed bytecode on this chain.</p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'not-a-hook' && (
        <Empty title="That address does not answer as a RevShareHook">
          <p>
            There is contract code at the address in this URL, but <code>poolOwner(bytes32)</code>{' '}
            reverted on it — it is a different contract. The chain answered; the address is wrong.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'not-configured' && (
        <Empty title="This pool has no revenue-share configuration">
          <p>
            <code>poolOwner(poolId)</code> is <code>address(0)</code>, so there is no configuration
            and therefore no distributor.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'no-distributor' && (
        <Empty title="This pool routes nothing to a distributor">
          <p>
            <code>distributorOf(poolId)</code> returns <code>address(0)</code>. The pool&rsquo;s cut
            goes to LPs and to its beneficiary roster only, so there are no epochs — this is a
            configuration, not a missing piece.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'ready' && state.data.d.kind === 'unknown' && (
        <Empty title="The distributor's type could not be identified">
          <p>
            <Addr value={state.data.d.address} /> answered neither <code>token()</code> nor{' '}
            <code>challengeDelay()</code>. Those two selectors are the only way to tell a{' '}
            <code>SnapshotEpochDistributor</code> from a <code>MerkleEpochDistributor</code> — there
            is no <code>kind()</code> and no common interface.
          </p>
          <p style={{ marginTop: 8 }}>
            The two epoch structs are both nine fields, so decoding this with either ABI would
            succeed and return numbers that mean nothing. This screen stops instead.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'ready' && state.data.d.kind === 'snapshot' && (
        <SnapshotView d={state.data.d} />
      )}
      {state.k === 'ready' && state.data.k === 'ready' && state.data.d.kind === 'merkle' && (
        <MerkleView d={state.data.d} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ shared */

function CloseEpochCard({
  common,
  abi,
  kindLabel,
}: {
  common: DistributorCommon
  abi: typeof SNAPSHOT_DISTRIBUTOR_ABI | typeof MERKLE_DISTRIBUTOR_ABI
  kindLabel: string
}) {
  const earliest = common.lastCloseAt + common.minEpochDuration
  const remaining = earliest - common.now
  const open = remaining <= 0n

  return (
    <section className="dapp-card">
      <div className="dapp-card__head">
        <h3 className="dapp-card__title">Closing the next epoch</h3>
        <span className={open ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}>
          {open ? 'minimum duration elapsed' : `${fmtDuration(remaining)} to go`}
        </span>
      </div>
      <p className="live-note">
        <code>lastCloseAt</code> {fmtTimestamp(common.lastCloseAt)} +{' '}
        <code>minEpochDuration</code> {fmtDuration(common.minEpochDuration)} ={' '}
        {fmtTimestamp(earliest)}. Chain time when this was read: {fmtTimestamp(common.now)}.
        {!open && ' Closing before that reverts EpochTooSoon.'}
      </p>
      <p className="live-note" style={{ marginTop: 6 }}>
        The pot to be closed over is whatever the distributor has pulled from the hook plus the
        carry-over: <Money v={common.carryOver0} token={common.token0} /> and{' '}
        <Money v={common.carryOver1} token={common.token1} />.
      </p>

      <PermissionlessAction
        label="closeEpoch"
        describes={`Snapshots and seals the current pot as a new epoch on this ${kindLabel} distributor. Permissionless — the contract defends itself by reverting when it is not due.`}
        address={common.address}
        abi={abi}
        functionName="closeEpoch"
        args={[]}
      />
    </section>
  )
}

function RolloverAction({
  common,
  abi,
  epochId,
}: {
  common: DistributorCommon
  abi: typeof SNAPSHOT_DISTRIBUTOR_ABI | typeof MERKLE_DISTRIBUTOR_ABI
  epochId: bigint
}) {
  return (
    <PermissionlessAction
      label={`rollover · epoch ${epochId.toString()}`}
      describes="Returns an expired epoch's unclaimed funds to the carry-over, where the next epoch picks them up. Permissionless, and idempotent — a second call reverts AlreadyRolledOver."
      address={common.address}
      abi={abi}
      functionName="rollover"
      args={[epochId]}
    />
  )
}

function CommonKpis({ common, epochCount }: { common: DistributorCommon; epochCount: bigint }) {
  return (
    <div className="dapp-kpis">
      <Kpi label="EPOCHS CLOSED" value={epochCount.toString()} sub="epochCount()" />
      <Kpi label="MIN EPOCH DURATION" value={fmtDuration(common.minEpochDuration)} sub="immutable at construction" />
      <Kpi label="CLAIM WINDOW" value={fmtDuration(common.claimWindow)} sub="how long an epoch stays claimable" />
      <Kpi
        label="CARRY-OVER"
        value={
          <>
            <Money v={common.carryOver0} token={common.token0} />
            <br />
            <Money v={common.carryOver1} token={common.token1} />
          </>
        }
        sub="carryOver0 / carryOver1 — waiting for the next close"
      />
    </div>
  )
}

/* ---------------------------------------------------------------- snapshot */

function SnapshotView({ d }: { d: Extract<DistributorState, { kind: 'snapshot' }> }) {
  const { common, epochs } = d
  return (
    <>
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Snapshot distributor</h3>
          <span className="dapp-badge dapp-badge--info">pro-rata by delegated votes</span>
        </div>
        <p className="live-note">
          <Addr value={common.address} /> pays holders of <Addr value={d.token.address} />{' '}
          ({d.token.symbol}) in proportion to their ERC-5805 delegated votes at each epoch&rsquo;s
          snapshot. The token&rsquo;s clock is{' '}
          {d.clockIsBlockNumber ? 'block-numbered' : 'timestamped'} (<code>clockIsBlockNumber</code>),
          which is what the <code>timepoint</code> column below counts in.
        </p>
        <p className="live-note" style={{ marginTop: 6 }}>
          The snapshot is taken at close, i.e. after the fees accrued — an address that buys in the
          same block an epoch closes still collects a share of fees generated before it held
          anything. That is inherent to snapshot dividends and is bounded by the minimum epoch
          duration, not by anything this screen can show.
        </p>
      </section>

      <CommonKpis common={common} epochCount={common.epochCount} />
      <CloseEpochCard common={common} abi={SNAPSHOT_DISTRIBUTOR_ABI} kindLabel="snapshot" />

      <section className="dapp-card">
        <h3 className="dapp-card__title">Epochs</h3>
        {epochs.length === 0 ? (
          <div className="an-empty">
            <p className="an-empty__title">No epoch has ever closed</p>
            <p className="live-note">
              <code>epochCount()</code> is 0. Until <code>closeEpoch</code> is called for the first
              time there is no epoch to claim from, and every holder&rsquo;s share is undefined
              rather than zero.
            </p>
          </div>
        ) : (
          <SnapshotTable epochs={epochs} common={common} />
        )}
      </section>

      {epochs
        .filter((e) => !e.rolledOver && common.now >= e.expiresAt)
        .map((e) => (
          <section className="dapp-card" key={`ro-${e.id.toString()}`}>
            <p className="dapp-microlabel">EPOCH {e.id.toString()} EXPIRED</p>
            <p className="live-note">
              Its claim window closed at {fmtTimestamp(e.expiresAt)}. Unclaimed:{' '}
              <Money v={e.amount0 - e.claimed0} token={common.token0} /> and{' '}
              <Money v={e.amount1 - e.claimed1} token={common.token1} />.
            </p>
            <RolloverAction common={common} abi={SNAPSHOT_DISTRIBUTOR_ABI} epochId={e.id} />
          </section>
        ))}
    </>
  )
}

function SnapshotTable({ epochs, common }: { epochs: SnapshotEpoch[]; common: DistributorCommon }) {
  return (
    <>
      <div className="dapp-table-wrap">
        <table className="dapp-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Closed</th>
              <th scope="col">Timepoint</th>
              <th scope="col">Voting supply</th>
              <th scope="col">Pot</th>
              <th scope="col">Claimed</th>
              <th scope="col">Claim window</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map((e) => {
              const expired = common.now >= e.expiresAt
              return (
                <tr key={e.id.toString()}>
                  <th scope="row">{e.id.toString()}</th>
                  <td>{fmtTimestamp(e.closedAt)}</td>
                  <td className="dapp-table__num">{e.timepoint}</td>
                  <td className="dapp-table__num">{e.totalVotingSupply.toString()}</td>
                  <td>
                    <Money v={e.amount0} token={common.token0} />
                    <br />
                    <Money v={e.amount1} token={common.token1} />
                  </td>
                  <td>
                    <Money v={e.claimed0} token={common.token0} />
                    <br />
                    <Money v={e.claimed1} token={common.token1} />
                  </td>
                  <td>
                    {e.rolledOver ? (
                      <span className="dapp-badge dapp-badge--mute">rolled over</span>
                    ) : expired ? (
                      <span className="dapp-badge dapp-badge--warn">
                        expired {fmtTimestamp(e.expiresAt)}
                      </span>
                    ) : (
                      <span className="dapp-badge dapp-badge--ok">
                        open, {fmtDuration(e.expiresAt - common.now)} left
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="live-note" style={{ marginTop: 8 }}>
        Each row is one <code>getEpoch(id)</code>. Voting supply is{' '}
        <code>totalVotingSupply</code> at that epoch&rsquo;s <code>timepoint</code>; a holder&rsquo;s
        share is their <code>getPastVotes</code> at the same timepoint over it. At most the newest
        24 epochs are listed — the list is unbounded on chain.
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ merkle */

function MerkleView({ d }: { d: Extract<DistributorState, { kind: 'merkle' }> }) {
  const { common, epochs } = d
  return (
    <>
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Merkle distributor</h3>
          <span className="dapp-badge dapp-badge--info">claims against a posted root</span>
        </div>
        <p className="live-note">
          <Addr value={common.address} /> pays against a merkle root the owner posts per epoch. A
          posted root does not become claimable immediately: <code>challengeDelay</code> is{' '}
          {fmtDuration(d.challengeDelay)}, during which the guardian (
          <Addr value={d.guardian} />) may cancel a bad root. <code>postRoot</code> and{' '}
          <code>cancelRoot</code> are privileged and are shown here as state only.
        </p>
      </section>

      <CommonKpis common={common} epochCount={common.epochCount} />

      <section className="dapp-card hx-alert">
        <h3 className="dapp-card__title">Self-service merkle claims are not buildable</h3>
        <p className="live-note">
          <code>MerkleEpochDistributor.claim</code> takes{' '}
          <code>(epochId, index, account, amount0, amount1, proof)</code>. The chain stores only the
          root — <strong>nothing on chain publishes the tree</strong>, and there is no event, no URI
          field and no registry that carries one. A claim UI here would have to invent a proof
          source, so there is none: this screen shows root and challenge state, and the claim itself
          has to come from wherever the operator published the tree.
        </p>
        <p className="live-note" style={{ marginTop: 6 }}>
          <code>claim</code> is deliberately absent from the merkle ABI this app ships, so it cannot
          be called from here even by accident.
        </p>
      </section>

      <CloseEpochCard common={common} abi={MERKLE_DISTRIBUTOR_ABI} kindLabel="merkle" />

      <section className="dapp-card">
        <h3 className="dapp-card__title">Epochs</h3>
        {epochs.length === 0 ? (
          <div className="an-empty">
            <p className="an-empty__title">No epoch has ever closed</p>
            <p className="live-note">
              <code>epochCount()</code> is 0, so there is no root to post against and nothing to
              claim.
            </p>
          </div>
        ) : (
          <MerkleTable epochs={epochs} common={common} />
        )}
      </section>

      {epochs
        .filter((e) => !e.rolledOver && common.now >= e.expiresAt && e.expiresAt !== 0n)
        .map((e) => (
          <section className="dapp-card" key={`ro-${e.id.toString()}`}>
            <p className="dapp-microlabel">EPOCH {e.id.toString()} EXPIRED</p>
            <p className="live-note">
              Claim window closed at {fmtTimestamp(e.expiresAt)}. Unclaimed:{' '}
              <Money v={e.amount0 - e.claimed0} token={common.token0} /> and{' '}
              <Money v={e.amount1 - e.claimed1} token={common.token1} />.
            </p>
            <RolloverAction common={common} abi={MERKLE_DISTRIBUTOR_ABI} epochId={e.id} />
          </section>
        ))}
    </>
  )
}

const NO_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000'

function MerkleTable({ epochs, common }: { epochs: MerkleEpoch[]; common: DistributorCommon }) {
  return (
    <>
      <div className="dapp-table-wrap">
        <table className="dapp-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Closed</th>
              <th scope="col">Root</th>
              <th scope="col">Pot</th>
              <th scope="col">Claimed</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {epochs.map((e) => {
              const posted = e.root !== NO_ROOT
              const inChallenge = posted && common.now < e.claimableAt
              const expired = posted && e.expiresAt !== 0n && common.now >= e.expiresAt
              return (
                <tr key={e.id.toString()}>
                  <th scope="row">{e.id.toString()}</th>
                  <td>{fmtTimestamp(e.closedAt)}</td>
                  <td>{posted ? <code>{shortHex(e.root, 10, 8)}</code> : <span className="hx-muted">not posted</span>}</td>
                  <td>
                    <Money v={e.amount0} token={common.token0} />
                    <br />
                    <Money v={e.amount1} token={common.token1} />
                  </td>
                  <td>
                    <Money v={e.claimed0} token={common.token0} />
                    <br />
                    <Money v={e.claimed1} token={common.token1} />
                  </td>
                  <td>
                    {e.rolledOver ? (
                      <span className="dapp-badge dapp-badge--mute">rolled over</span>
                    ) : !posted ? (
                      <span className="dapp-badge dapp-badge--warn">awaiting postRoot (owner)</span>
                    ) : inChallenge ? (
                      <span className="dapp-badge dapp-badge--info">
                        challenge period, opens {fmtTimestamp(e.claimableAt)}
                      </span>
                    ) : expired ? (
                      <span className="dapp-badge dapp-badge--warn">
                        expired {fmtTimestamp(e.expiresAt)}
                      </span>
                    ) : (
                      <span className="dapp-badge dapp-badge--ok">
                        claimable, {fmtDuration(e.expiresAt - common.now)} left
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="live-note" style={{ marginTop: 8 }}>
        Each row is one <code>getEpoch(id)</code>. Note the struct differs from the snapshot
        distributor&rsquo;s: field five is the merkle <code>root</code> here and a voting supply
        there, which is why the two are decoded with separate ABIs.
      </p>
    </>
  )
}

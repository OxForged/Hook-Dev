/* ============================================================================
   B · /app/protocol/:poolId — one pool's revenue share, in full.

   Public: no wallet is needed to read any of it. A wallet is needed only to
   SEND one of the two permissionless maintenance calls this screen offers.

   Three contract facts govern the layout, and the screen states each one
   rather than working around it:

   · TOTAL TAKEN IS SUMMED FROM LOGS. `RevShareHook` keeps no
     `totalTaken(poolId, currency)`. The hero decomposes `RevShareTaken` into
     its three fields — `lpDonated`, `toBeneficiaries`, `toDistributor` — and
     prints the block range it summed over, every time. It is a total over a
     scanned window and is labelled as one.

   · A PoolKey CANNOT BE DERIVED FROM A PoolId, and every write takes one.
     Where the key resolves (a distributor's `poolKey()`, or the CL pool
     manager's `Initialize` log) the buttons are live and the screen says which
     source answered. Where it does not, the buttons are replaced by the reason
     — never rendered dead.

   · `claimable` IS GLOBAL, keyed (recipient, currency) with no pool in it. The
     roster below shows each recipient's WEIGHT, which is per-pool and real. It
     does not show "their claimable from this pool", because no view function
     can answer that. The global balance lives on /app/claim.

   NOT-CONFIGURED IS NOT A ZEROED CONFIG. `getConfig` is a plain mapping read:
   for a pool it has never seen it returns a zero struct, which would render as
   a real, deliberately-disabled 0% configuration. `readPoolOverview` tests
   `owner == address(0)` and returns a not-found instead.
   ============================================================================ */

import { Link, useParams } from 'react-router-dom'

import { DEPLOYMENTS } from '../../../lib/chain'
import { BarList } from '../components/charts'
import { PoolOwnerActions } from '../components/PoolOwnerActions'
import { Methodology } from '../components/ProtocolCharts'
import { Gauge, StackedBar } from '../components/series-charts'
import { REV_SHARE_HOOK_ABI } from '../lib/revshareAbi'
import {
  REVSHARE_CHAIN_ID,
  amountWithUnit,
  bpsPct,
  isPoolId,
  keyTuple,
  pipsPct,
  readPoolOverview,
  shortHex,
  type PoolLoad,
  type PoolOverview,
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

const CHAIN = DEPLOYMENTS[REVSHARE_CHAIN_ID]

/**
 * `RevShareHook.MAX_FEE_PIPS` — `uint24 public constant MAX_FEE_PIPS = 100_000`
 * at packages/hooks-revshare/src/RevShareHook.sol:140, checked by `configure`
 * at :642.
 *
 * A constant, not a stored value: it cannot be raised, so there is nothing to
 * read and nothing that can drift. It is written here rather than fetched
 * because `readPoolOverview` does not call it, and a gauge without its ceiling
 * is a bare percentage — which is precisely what a gauge exists to improve on.
 */
const MAX_FEE_PIPS = 100_000

/** The three-way split, in the order the contract stores it. */
const SPLIT_TOTAL_BPS = 10_000

export default function ProtocolPool() {
  const { poolId: raw } = useParams<{ poolId: string }>()
  const { ref: hook, malformed, withHook } = useHookRef()

  const poolId = raw && isPoolId(raw) ? (raw.trim() as `0x${string}`) : null
  const key = hook && poolId ? `pool:${hook.address}:${poolId}` : null

  const { state, reload } = useChainRead<PoolLoad>(key, async () => {
    if (!hook || !poolId) throw new Error('unreachable')
    return readPoolOverview(hook.address, poolId)
  })

  return (
    <>
      <ScreenIntro title="Revenue share for one pool" hook={hook ?? undefined}>
        <p>
          {poolId ? (
            <>
              Pool <PoolIdText value={poolId} />. Everything below is a call to the hook: the
              configuration from <code>getConfig</code>, the roster from <code>getBeneficiaries</code>
              , unsettled pots from <code>pendingBeneficiary</code> and{' '}
              <code>pendingDistributorShare</code>, and lifetime figures summed from{' '}
              <code>RevShareTaken</code> logs.
            </>
          ) : (
            'No pool id in this URL.'
          )}
        </p>
        <p style={{ marginTop: 6 }}>
          <Link to={withHook(dappPath('protocol'))}>← pools you own</Link>
        </p>
      </ScreenIntro>

      {!hook && <NotDeployed malformed={malformed} />}

      {hook && !poolId && (
        <Empty title="That is not a pool id">
          <p>
            A pool id is 32 bytes — <code>0x</code> followed by 64 hex characters. The URL carries{' '}
            <code>{raw ? shortHex(raw, 12, 8) : '(nothing)'}</code>.
          </p>
        </Empty>
      )}

      {state.k === 'loading' && <Reading what="this pool’s configuration and log history" />}
      {state.k === 'error' && <Unreachable message={state.message} onRetry={reload} />}

      {state.k === 'ready' && state.data.k === 'no-code' && (
        <Empty title="There is no contract at that address">
          <p>
            <Addr value={state.data.hook} /> has no deployed bytecode on {CHAIN.name}. It is an EOA,
            a typo, or a contract on a different chain. Nothing was read.
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'not-a-hook' && (
        <Empty title="That address does not answer as a RevShareHook">
          <p>
            <Addr value={state.data.hook} /> has contract code on {CHAIN.name}, but{' '}
            <code>getConfig(bytes32)</code> reverted on it. It is some other contract.
          </p>
          <p style={{ marginTop: 8 }}>
            This is a verdict about the address, not about the chain — the RPC answered fine. The
            raw error was: <code>{state.data.detail}</code>
          </p>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'not-configured' && (
        <Empty title="This pool has no revenue-share configuration">
          <p>
            <code>getConfig</code> on <Addr value={state.data.hook} /> returns an owner of{' '}
            <code>address(0)</code> for <PoolIdText value={state.data.poolId} />, which means the
            pool has never been configured on this hook.
          </p>
          <Methodology label="Why nothing is shown instead of a 0% configuration">
            <p className="live-note">
              The zero struct decodes to a 0% cut with a 0/0/0 split and a disabled flag, which is
              indistinguishable from a real configuration somebody switched off deliberately. The
              owner field is the only thing that tells the two apart, so it is what this screen
              tests.
            </p>
          </Methodology>
        </Empty>
      )}

      {state.k === 'ready' && state.data.k === 'ready' && (
        <PoolBody o={state.data.o} withHook={withHook} onChanged={reload} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function PoolBody({
  o,
  withHook,
  onChanged,
}: {
  o: PoolOverview
  withHook: (p: string) => string
  onChanged: () => void
}) {
  const resolved = o.resolution
  const keyBlocked =
    resolved === null
      ? 'A PoolKey cannot be derived from a PoolId — the id is a hash of the key, and every write on the hook takes the key. ' +
        'Neither source has it for this pool: it has no epoch distributor to read poolKey() from, and no CLPoolManager Initialize log for this id was found in the scanned range. ' +
        'Until the key is known, this transaction cannot be built at all.'
      : null

  const pending = o.pending
  const hasPending = pending.effectiveBlock !== 0n
  const blocksToGo = hasPending ? pending.effectiveBlock - o.blockNumber : 0n
  const pendingDue = hasPending && blocksToGo <= 0n

  const lifetimeTotal = (row: { lpDonated: bigint; toBeneficiaries: bigint; toDistributor: bigint }) =>
    row.lpDonated + row.toBeneficiaries + row.toDistributor

  return (
    <>
      {/* ---------------------------------------------------------- HERO */}
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Taken by this pool</h3>
          <span className="dapp-badge dapp-badge--mute">
            summed from {o.lifetime.events} log{o.lifetime.events === 1 ? '' : 's'}
          </span>
        </div>

        {o.lifetime.rows.length === 0 ? (
          <div className="an-empty" style={{ marginTop: 10 }}>
            <p className="an-empty__title">No revenue taken yet</p>
            <p className="live-note">
              No <code>RevShareTaken</code> log for this pool between block{' '}
              {o.lifetime.fromBlock.toString()} and {o.lifetime.toBlock.toString()}. Either the pool
              has not been swapped through since it was configured, or its cut is disabled. This is
              an empty result, not a failed read.
            </p>
          </div>
        ) : (
          <div className="dapp-table-wrap">
            <table className="dapp-table">
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col">Donated to LPs</th>
                  <th scope="col">To beneficiaries</th>
                  <th scope="col">To distributor</th>
                  <th scope="col">Total taken</th>
                </tr>
              </thead>
              <tbody>
                {o.lifetime.rows.map((r) => (
                  <tr key={r.token.address}>
                    <th scope="row">
                      {r.token.symbol} <Addr value={r.token.address} label="↗" />
                    </th>
                    <td>
                      <Money v={r.lpDonated} token={r.token} />
                    </td>
                    <td>
                      <Money v={r.toBeneficiaries} token={r.token} />
                    </td>
                    <td>
                      <Money v={r.toDistributor} token={r.token} />
                    </td>
                    <td>
                      <Money v={lifetimeTotal(r)} token={r.token} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* One bar per currency, because the three destinations are amounts of
            the SAME token and add to exactly what was taken. Charting one
            currency's total against another's would need a price neither has. */}
        {o.lifetime.rows.map((r) => {
          const total = lifetimeTotal(r)
          if (total === 0n) return null
          /* Two floors and a remainder, so the three shares sum to exactly
             10,000. Flooring all three would leave the bar short, and a short
             bar is how `StackedBar` reports a split that genuinely does not add
             up — which this one does. Every `value` string stays exact. */
          const bps = (v: bigint) => Number((v * 10_000n) / total)
          const lpBps = bps(r.lpDonated)
          const benBps = bps(r.toBeneficiaries)
          return (
            <div key={`split-${r.token.address}`} style={{ marginTop: 12 }}>
              <StackedBar
                total={SPLIT_TOTAL_BPS}
                unit={`of the ${r.token.symbol} taken`}
                label={`${r.token.symbol} taken by this pool, split between liquidity providers, the beneficiary roster and the distributor`}
                segments={[
                  {
                    name: `${r.token.symbol} · to LPs`,
                    amount: lpBps,
                    value: amountWithUnit(r.lpDonated, r.token),
                    color: 'success',
                  },
                  {
                    name: `${r.token.symbol} · to beneficiaries`,
                    amount: benBps,
                    value: amountWithUnit(r.toBeneficiaries, r.token),
                    color: 'primary',
                  },
                  {
                    name: `${r.token.symbol} · to distributor`,
                    amount: 10_000 - lpBps - benBps,
                    value: amountWithUnit(r.toDistributor, r.token),
                    color: 'violet',
                  },
                ]}
              />
            </div>
          )
        })}

        <p className="live-note" style={{ marginTop: 10 }}>
          <strong>Summed from logs since block {o.lifetime.fromBlock.toString()}</strong> (head{' '}
          {o.lifetime.toBlock.toString()}) — a window total, not a lifetime total.
        </p>
        <Methodology label="Why there is no lifetime total to read">
          <p className="live-note">
            <code>RevShareHook</code> keeps no cumulative counter: there is no{' '}
            <code>totalTaken(poolId, currency)</code>, so this is a sum over the scanned window
            only, bounded by how far back this RPC serves logs. The three columns are the three
            fields of <code>RevShareTaken</code>, so they add up to exactly what the swap path took.
          </p>
        </Methodology>
      </section>

      {/* ------------------------------------------------------- PENDING */}
      {hasPending && (
        <section className={pendingDue ? 'dapp-card hx-alert' : 'dapp-card'}>
          <div className="dapp-card__head">
            <h3 className="dapp-card__title">A configuration change is waiting</h3>
            <span className={pendingDue ? 'dapp-badge dapp-badge--warn' : 'dapp-badge dapp-badge--info'}>
              {pendingDue ? 'due now' : `${blocksToGo.toString()} blocks to go`}
            </span>
          </div>
          <p className="live-note">
            <code>proposeConfig</code> put this change behind {o.configDelayBlocks.toString()} blocks
            (<code>CONFIG_DELAY_BLOCKS</code>). It becomes applicable at block{' '}
            {pending.effectiveBlock.toString()}; the head is {o.blockNumber.toString()}. Applying it
            is <strong>permissionless</strong> — deliberately, so a proposal cannot be stranded by an
            owner who proposed it and walked away.
          </p>

          <dl className="dapp-fields" style={{ marginTop: 10 }}>
            <Field name="Proposed cut" value={`${pipsPct(pending.params.feePips)} (${pending.params.feePips} pips)`} was={`${pipsPct(o.config.feePips)}`} />
            <Field name="To LPs" value={bpsPct(pending.params.lpDonateBps)} was={bpsPct(o.config.lpDonateBps)} />
            <Field name="To beneficiaries" value={bpsPct(pending.params.beneficiaryBps)} was={bpsPct(o.config.beneficiaryBps)} />
            <Field name="To distributor" value={bpsPct(pending.params.distributorBps)} was={bpsPct(o.config.distributorBps)} />
            <Field name="Enabled" value={String(pending.params.enabled)} was={String(o.config.enabled)} />
            <Field
              name="Distributor"
              value={shortHex(pending.params.distributor)}
              was={o.distributor ? shortHex(o.distributor) : 'none'}
            />
          </dl>

          <PermissionlessAction
            label="applyPendingConfig"
            describes="Writes the proposed configuration into the pool once its delay has elapsed. Anyone may send it; it takes the PoolKey, not the PoolId."
            address={o.hook}
            abi={REV_SHARE_HOOK_ABI}
            functionName="applyPendingConfig"
            args={resolved ? [keyTuple(resolved.key)] : []}
            blocked={keyBlocked}
          />
        </section>
      )}

      {/* -------------------------------------------------------- CONFIG */}
      <section className="dapp-card dapp-card--config">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Configuration</h3>
          <span>
            <span className={o.config.enabled ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}>
              {o.config.enabled ? 'enabled' : 'disabled'}
            </span>{' '}
            {o.config.frozen && <span className="dapp-badge dapp-badge--info">frozen forever</span>}{' '}
            {o.paused && <span className="dapp-badge dapp-badge--danger">hook paused</span>}
          </span>
        </div>

        {/* The cut against its ceiling, then how that cut divides. Two charts
            because they answer two questions: how much this pool takes, and who
            gets it. The split MUST equal 10000 bps — the contract rejects
            anything else — so drawing it as one bar makes the absence of slack
            visible rather than asking the reader to add three percentages. */}
        <div className="dapp-kpis">
          {/* Wrapped in the same card the Kpi tiles use, so the gauge is a
              sibling in the grid rather than a bare figure floating in it. */}
          <div className="dapp-card dapp-card--kpi">
          <Gauge
            value={o.config.feePips}
            max={MAX_FEE_PIPS}
            label="This pool's cut of each swap, against the hook's hard cap"
            valueText={pipsPct(o.config.feePips)}
            maxText={pipsPct(MAX_FEE_PIPS)}
            color={o.config.enabled ? 'primary' : 'amber'}
            caption={
              <>
                {o.config.feePips} pips of the unspecified amount, of{' '}
                <code>MAX_FEE_PIPS</code> — a constant the owner cannot raise.
              </>
            }
          />
          </div>
          <Kpi label="TO LPs" value={bpsPct(o.config.lpDonateBps)} sub="donated in-range via CLPoolManager.donate" />
          <Kpi label="TO BENEFICIARIES" value={bpsPct(o.config.beneficiaryBps)} sub="split across the roster by weight" />
          <Kpi label="TO DISTRIBUTOR" value={bpsPct(o.config.distributorBps)} sub="pulled by the epoch distributor" />
        </div>

        <StackedBar
          total={SPLIT_TOTAL_BPS}
          unit="of this pool's cut"
          label="How this pool's cut divides between liquidity providers, the beneficiary roster and the epoch distributor"
          segments={[
            {
              name: 'To LPs',
              amount: o.config.lpDonateBps,
              value: bpsPct(o.config.lpDonateBps),
              color: 'success',
            },
            {
              name: 'To beneficiaries',
              amount: o.config.beneficiaryBps,
              value: bpsPct(o.config.beneficiaryBps),
              color: 'primary',
            },
            {
              name: 'To distributor',
              amount: o.config.distributorBps,
              value: bpsPct(o.config.distributorBps),
              color: 'violet',
            },
          ]}
        />

        <dl className="dapp-fields" style={{ marginTop: 12 }}>
          <Field name="Pool owner" value={<Addr value={o.config.owner} />} />
          {o.pendingOwner && (
            <Field
              name="Ownership offered to"
              value={<Addr value={o.pendingOwner} />}
              note="two-step: the new owner must call acceptPoolOwnership"
            />
          )}
          <Field
            name="Distributor"
            value={
              o.distributor ? (
                <>
                  <Addr value={o.distributor} />{' '}
                  <Link to={withHook(dappPath(`protocol/${o.poolId}/epochs`))}>epochs →</Link>
                </>
              ) : (
                <span className="hx-muted">none — nothing routes to a distributor</span>
              )
            }
          />
          <Field name="Pool manager" value={<Addr value={o.poolManager} />} note="hook.poolManager()" />
        </dl>

        <p className="live-note" style={{ marginTop: 10 }}>
          Owner-only actions appear in their own panel below, and only for this pool&rsquo;s owner.
        </p>
      </section>

      {/* ------------------------------------------------ OWNER ACTIONS
          Renders nothing at all unless the connected wallet owns this pool or
          has been nominated to. */}
      <PoolOwnerActions o={o} onConfirmed={onChanged} />

      {/* --------------------------------------------------- KEY SOURCE */}
      <section className={resolved ? 'dapp-card' : 'dapp-card hx-alert hx-alert--danger'}>
        <h3 className="dapp-card__title">The pool key</h3>
        {resolved ? (
          <>
            <p className="live-note">
              Resolved via <strong>{resolved.via}</strong>
              {resolved.scannedFrom !== undefined && (
                <> — scanning from block {resolved.scannedFrom.toString()}</>
              )}
              . A <code>PoolId</code> is <code>keccak256(abi.encode(key))</code> and has no inverse,
              so every write below needs this. It is shown because the source of a key is part of
              trusting the transaction built from it.
            </p>
            <dl className="dapp-fields" style={{ marginTop: 10 }}>
              <Field name="currency0" value={<Addr value={resolved.key.currency0} />} />
              <Field name="currency1" value={<Addr value={resolved.key.currency1} />} />
              <Field name="hooks" value={<Addr value={resolved.key.hooks} />} />
              <Field name="poolManager" value={<Addr value={resolved.key.poolManager} />} />
              <Field name="fee" value={`${resolved.key.fee} (${pipsPct(resolved.key.fee)} LP fee)`} />
              <Field name="parameters" value={<code>{shortHex(resolved.key.parameters, 12, 8)}</code>} />
            </dl>
          </>
        ) : (
          <p className="live-note">
            <strong>Not resolvable, so no transaction on this screen can be built.</strong> A{' '}
            <code>PoolId</code> is a hash of the <code>PoolKey</code>; the hook indexes by id but
            every write takes the key, and no event on the hook carries it. The two places it is
            recorded both come up empty for this pool: it has no epoch distributor whose{' '}
            <code>poolKey()</code> could be read, and no <code>Initialize</code> log for this id was
            found on <Addr value={o.poolManager} /> from block{' '}
            {o.lifetime.fromBlock.toString()} onward. The buttons below say this rather than
            appearing and failing.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------- ROSTER */}
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Beneficiary roster</h3>
          <span className="dapp-badge dapp-badge--mute">
            total weight {o.totalWeight.toString()}
          </span>
        </div>

        {o.beneficiaries.length === 0 ? (
          <div className="an-empty">
            <p className="an-empty__title">No beneficiaries set</p>
            <p className="live-note">
              <code>getBeneficiaries</code> is empty. Anything accrued for beneficiaries waits in{' '}
              <code>pendingBeneficiary</code> rather than being lost.
            </p>
          </div>
        ) : (
          <div className="dapp-table-wrap">
            <table className="dapp-table">
              <thead>
                <tr>
                  <th scope="col">Recipient</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Share of the beneficiary slice</th>
                </tr>
              </thead>
              <tbody>
                {o.beneficiaries.map((b) => (
                  <tr key={b.recipient}>
                    <th scope="row">
                      <Addr value={b.recipient} />
                    </th>
                    <td className="dapp-table__num">{b.weight.toString()}</td>
                    <td className="dapp-table__num">
                      {o.totalWeight === 0n
                        ? '—'
                        : `${((Number(b.weight) / Number(o.totalWeight)) * 100).toFixed(2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Weight is the one per-pool number on this roster, and a bar is how a
            reader sees a share without dividing. Every bar is a share of the
            same total weight, so the comparison is unit-consistent by
            construction. */}
        {o.beneficiaries.length > 0 && o.totalWeight > 0n && (
          <div style={{ marginTop: 12 }}>
            <BarList
              items={o.beneficiaries.map((b) => ({
                name: shortHex(b.recipient),
                value: b.weight.toString(),
                pct: Number((b.weight * 10_000n) / o.totalWeight) / 100,
                color: 'primary' as const,
              }))}
              valueLabel="weight"
              shareLabel="of the beneficiary slice"
            />
          </div>
        )}

        <p className="live-note" style={{ marginTop: 10 }}>
          Weight is per-pool; a claimable balance is not.{' '}
          <Link to={withHook(dappPath('claim'))}>See a global balance on the claim screen →</Link>
        </p>
        <Methodology label="Why there is no “claimable from this pool” column">
          <p className="live-note">
            <code>claimable</code> on the hook is keyed <code>(recipient, currency)</code> with no
            pool in the key. A beneficiary of two pools has one merged balance and{' '}
            <code>claim(currency, to)</code> pays all of it, so no view function can answer what
            this pool owes them.
          </p>
        </Methodology>
      </section>

      {/* ---------------------------------------------------- UNSETTLED */}
      <section className="dapp-card">
        <div className="dapp-card__head">
          <h3 className="dapp-card__title">Accrued but not yet settled</h3>
          <span className="dapp-badge dapp-badge--mute">
            currencies from {o.currenciesFrom}
          </span>
        </div>

        {o.currencies.length === 0 ? (
          <div className="an-empty">
            <p className="an-empty__title">No currencies to check</p>
            <p className="live-note">
              The pool key did not resolve and this pool has no <code>RevShareTaken</code> logs, so
              there is no currency to query <code>pendingBeneficiary</code> against. Nothing is being
              hidden — there is genuinely nothing to name.
            </p>
          </div>
        ) : (
          <>
            <div className="dapp-table-wrap">
              <table className="dapp-table">
                <thead>
                  <tr>
                    <th scope="col">Currency</th>
                    <th scope="col">Waiting for the roster</th>
                    <th scope="col">Waiting for the distributor</th>
                  </tr>
                </thead>
                <tbody>
                  {o.unsettled.map((u) => (
                    <tr key={u.token.address}>
                      <th scope="row">{u.token.symbol}</th>
                      <td>
                        <Money v={u.beneficiary} token={u.token} />
                      </td>
                      <td>
                        <Money v={u.distributor} token={u.token} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="live-note" style={{ marginTop: 8 }}>
              Left column: <code>pendingBeneficiary(poolId, currency)</code> — accrued on the swap
              path, not yet split across the roster. Right column:{' '}
              <code>pendingDistributorShare(poolId, currency)</code> — waiting for the distributor to
              pull it, which only the distributor itself may do.
            </p>

            {/* Only offered where there is genuinely something to settle.
                `settleBeneficiaries` RETURNS EARLY on a zero pot rather than
                reverting, so a simulation against an empty pot passes — the
                button would look armed and the transaction would spend gas
                doing nothing. Same check the keeper makes before it simulates:
                read `pendingBeneficiary` first, and only then bother. */}
            {o.unsettled
              .filter((u) => u.beneficiary > 0n)
              .map((u) => (
                <PermissionlessAction
                  key={u.token.address}
                  label={`settleBeneficiaries · ${u.token.symbol}`}
                  describes={`Splits the accrued ${u.token.symbol} across the roster by weight and credits each recipient's claimable balance. Anyone may send it; it takes the PoolKey, not the PoolId.`}
                  address={o.hook}
                  abi={REV_SHARE_HOOK_ABI}
                  functionName="settleBeneficiaries"
                  args={resolved ? [keyTuple(resolved.key), u.token.address] : []}
                  blocked={keyBlocked}
                />
              ))}

            {o.unsettled.every((u) => u.beneficiary === 0n) && (
              <>
                <p className="live-note" style={{ marginTop: 10 }}>
                  Nothing is pending for the roster, so <code>settleBeneficiaries</code> is not
                  offered.
                </p>
                <Methodology label="Why it is hidden rather than disabled">
                  <p className="live-note">
                    It is the one call on this surface that does <em>not</em> revert when it is
                    pointless — it returns early. A simulation against an empty pot passes, so the
                    button would look armed while the transaction did nothing.
                  </p>
                </Methodology>
              </>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------- EPOCHS */}
      <section className="dapp-card">
        <h3 className="dapp-card__title">Epoch distributor</h3>
        {o.distributor ? (
          <p className="live-note">
            This pool routes {bpsPct(o.config.distributorBps)} of its cut to{' '}
            <Addr value={o.distributor} />.{' '}
            <Link to={withHook(dappPath(`protocol/${o.poolId}/epochs`))}>
              Open the epoch timeline →
            </Link>
          </p>
        ) : (
          <p className="live-note">
            <code>distributorOf</code> returns <code>address(0)</code> — nothing routes to a
            distributor, so there are no epochs to show.
          </p>
        )}
      </section>
    </>
  )
}

function Field({
  name,
  value,
  was,
  note,
}: {
  name: string
  value: React.ReactNode
  was?: string
  note?: string
}) {
  return (
    <div className="dp-field">
      <div className="dapp-field__head">
        <span className="dapp-microlabel">{name}</span>
      </div>
      <div className="dapp-field__value">
        {value}
        {was !== undefined && <span className="hx-muted"> (now {was})</span>}
      </div>
      {note && <p className="dp-hint">{note}</p>}
    </div>
  )
}

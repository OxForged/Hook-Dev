/* ============================================================================
   D · /app/claim — the holder-facing side.

   Two completely separate money paths reach a person, and conflating them
   would be the most misleading thing this surface could do:

   1. THE HOOK'S OWN BALANCE — `claimable(recipient, currency)`.
      Credited by `settleBeneficiaries` when a pool's roster is paid out.
      The mapping is `recipient => currency => amount`: THERE IS NO POOL IN THE
      KEY. A beneficiary of three pools sees ONE number covering all three, and
      `claim(currency, to)` withdraws the whole thing. No view function can
      decompose it, so this screen labels it global and never attributes it to
      a pool.

   2. AN EPOCH DISTRIBUTOR'S EPOCHS — `claimableAmounts(epochId, account)`.
      Pro-rata by ERC-5805 delegated votes at that epoch's snapshot. Per epoch,
      per account, and paid to `account` — note the SUBMITTER is permissionless,
      so anyone may push somebody else's claim through. That is a feature and
      the screen says so rather than assuming the connected address.

   The merkle distributor has a third path which is NOT BUILDABLE here: its
   `claim` needs `(index, account, amount0, amount1, proof)` and nothing on
   chain publishes the tree. That is stated, not worked around.

   THE SOLVENCY BARS. `backing(currency)` must always be at least
   `totalOwed(currency)`; a hook where it is not cannot pay everyone it owes,
   and that is the single most important thing this screen can report. It was
   reported in a sentence under a table of three 18-decimal integers, which is
   a comparison no reader performs by eye. The three figures are now also drawn
   as bars off the same three reads, so a shortfall is visible without doing
   arithmetic. Nothing new is fetched.

   COPY. Each long explanation here sits behind a <details> now — how the
   currency list is discovered, why a merkle proof cannot be built, why an
   undelegated holder has no share. The facts are unchanged and none was
   dropped; they stopped being the first thing between the reader and their
   balance.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAddress, isAddress, type Address } from 'viem'
import { useAccount, useSwitchChain } from 'wagmi'

import { DEPLOYMENTS } from '../../../lib/chain'
import { BarList } from '../components/charts.tsx'
import type { LabelledBar, SeriesColor } from '../data/types.ts'
import { REV_SHARE_HOOK_ABI, SNAPSHOT_DISTRIBUTOR_ABI } from '../lib/revshareAbi'
import {
  REVSHARE_CHAIN_ID,
  amountWithUnit,
  fmtTimestamp,
  readCurrenciesSeen,
  readDistributor,
  readGlobalClaimable,
  readSnapshotStandings,
  readToken,
  type ClaimableRow,
  type DistributorState,
  type EpochStanding,
  type TokenMeta,
} from '../lib/revshare'
import {
  Addr,
  Empty,
  Money,
  NotDeployed,
  Reading,
  ScreenIntro,
  Unreachable,
} from '../lib/revshareParts'
import { PermissionlessAction } from '../lib/revshareWrite'
import { useChainRead } from '../lib/useChainRead'
import { useHookRef } from '../lib/useHookRef'

const CHAIN = DEPLOYMENTS[REVSHARE_CHAIN_ID]

interface GlobalLoad {
  rows: ClaimableRow[]
  fromBlock: bigint
  /** Currencies the log scan found, before the extra one was added. */
  discovered: number
}

/* -------------------------------------------------------------- solvency ---- */

/**
 * One currency's three figures, drawn.
 *
 * The scale is the LARGEST of the three, never `backing` alone: a hook that
 * owes more than it holds would otherwise need a bar past the end of its own
 * track, and clamping it would hide exactly the condition worth seeing.
 */
function Solvency({ row }: { row: ClaimableRow }) {
  const solvent = row.backing >= row.totalOwed
  const denom = row.backing > row.totalOwed ? row.backing : row.totalOwed

  const bar = (name: string, v: bigint, color: SeriesColor): LabelledBar => ({
    name,
    value: amountWithUnit(v, row.token),
    pct: denom <= 0n ? 0 : Number((v * 10_000n) / denom) / 100,
    color,
  })

  return (
    <div style={{ marginTop: 14 }}>
      <p className="dapp-microlabel dapp-microlabel--tight">
        {row.token.symbol}{' '}
        <span className={solvent ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--danger'}>
          {solvent ? 'FULLY BACKED' : 'SHORTFALL'}
        </span>
      </p>
      <BarList
        items={[
          bar('Hook can pay out', row.backing, solvent ? 'success' : 'amber'),
          bar('Hook owes everyone', row.totalOwed, 'violet'),
          bar('Yours', row.amount, 'primary'),
        ]}
        valueLabel="Amount"
        shareLabel="of the largest figure here"
      />
    </div>
  )
}

export default function Claim() {
  const { ref: hook, malformed } = useHookRef()
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [params] = useSearchParams()

  const [extraToken, setExtraToken] = useState('')
  const [distributorInput, setDistributorInput] = useState(params.get('distributor') ?? '')
  const [accountInput, setAccountInput] = useState('')

  const onChain = chainId === REVSHARE_CHAIN_ID
  const extra = isAddress(extraToken.trim(), { strict: false }) ? getAddress(extraToken.trim()) : null

  /* ---- path 1: the hook's global claimable balance ---------------------- */

  const globalKey = hook && address ? `claimable:${hook.address}:${address}:${extra ?? ''}` : null
  const global = useChainRead<GlobalLoad>(globalKey, async () => {
    if (!hook || !address) throw new Error('unreachable')
    const seen = await readCurrenciesSeen(hook.address)
    const tokens: TokenMeta[] = [...seen.tokens]
    if (extra && !tokens.some((t) => t.address.toLowerCase() === extra.toLowerCase())) {
      tokens.push(await readToken(extra))
    }
    const rows = await readGlobalClaimable(hook.address, address, tokens)
    return { rows, fromBlock: seen.fromBlock, discovered: seen.tokens.length }
  })

  /* ---- path 2: an epoch distributor ------------------------------------- */

  const distributor = isAddress(distributorInput.trim(), { strict: false })
    ? getAddress(distributorInput.trim())
    : null

  const dist = useChainRead<DistributorState>(
    distributor ? `dist:${distributor}` : null,
    async () => {
      if (!distributor) throw new Error('unreachable')
      return readDistributor(distributor)
    },
  )

  const account: Address | null = isAddress(accountInput.trim(), { strict: false })
    ? getAddress(accountInput.trim())
    : (address ?? null)

  const snapshotEpochIds =
    dist.state.k === 'ready' && dist.state.data.kind === 'snapshot'
      ? dist.state.data.epochs.map((e) => e.id)
      : []

  const standings = useChainRead<EpochStanding[]>(
    distributor && account && snapshotEpochIds.length > 0
      ? `standings:${distributor}:${account}:${snapshotEpochIds.length}`
      : null,
    async () => {
      if (!distributor || !account) throw new Error('unreachable')
      return readSnapshotStandings(distributor, account, snapshotEpochIds)
    },
  )

  return (
    <>
      <ScreenIntro title="Claim what is owed to you" hook={hook ?? undefined}>
        <p>
          Two different balances reach a person from a revenue-share pool. They are not
          interchangeable, so they are shown separately, read live from {CHAIN.name}.
        </p>
      </ScreenIntro>

      {!hook && <NotDeployed malformed={malformed} />}

      {hook && (
        <>
          {/* ============================================ PATH 1 ========= */}
          <section className="dapp-card">
            <div className="dapp-card__head">
              <h3 className="dapp-card__title">1 · Your balance on the hook</h3>
              <span className="dapp-badge dapp-badge--warn">global, not per pool</span>
            </div>
            <p className="live-note">
              <code>claimable(recipient, currency)</code> has <strong>no pool in the key</strong>:
              one figure covering every pool you are a beneficiary of, and{' '}
              <code>claim(currency, to)</code> withdraws all of it at once.
            </p>
            <details className="dapp-method">
              <summary>Why there is no per-pool figure</summary>
              <div className="dapp-method__body">
                <p>
                  No view function on the hook can split the balance by pool. A per-pool number
                  would have to be invented, so none is shown.
                </p>
              </div>
            </details>

            {!isConnected && (
              <div className="dp-gate" style={{ marginTop: 12 }}>
                <p className="dp-gate__title">Connect a wallet to see your balance</p>
                <p className="dp-gate__body">The balance is keyed by address. Connecting reads only.</p>
                <LatchConnectButton variant="inline" label="Connect wallet" />
              </div>
            )}

            {isConnected && !onChain && (
              <div className="dp-gate dp-gate--warn" style={{ marginTop: 12 }}>
                <p className="dp-gate__title">Not deployed on this chain</p>
                <p className="dp-gate__body">
                  This RevShareHook is on {CHAIN.name}. The chain your wallet is on has no such
                  contract, so there is nothing there to read.
                </p>
                <button
                  type="button"
                  className="dapp-btn dapp-btn--sm"
                  onClick={() => switchChain({ chainId: REVSHARE_CHAIN_ID })}
                  disabled={switching}
                >
                  {switching ? 'Switching…' : `Switch to ${CHAIN.name}`}
                </button>
              </div>
            )}

            <div className="dp-field" style={{ marginTop: 12 }}>
              <label className="dapp-microlabel" htmlFor="rs-extra-token">
                CHECK A SPECIFIC TOKEN
              </label>
              <input
                id="rs-extra-token"
                className="dp-input dp-input--mono"
                placeholder="0x… ERC-20 address"
                value={extraToken}
                onChange={(e) => setExtraToken(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="dp-hint">
                The list below comes from <code>RevShareTaken</code> logs, bounded by what this RPC
                serves. A token those logs miss can be checked here.
              </p>
            </div>
          </section>

          {global.state.k === 'loading' && <Reading what="your claimable balances" />}
          {global.state.k === 'error' && (
            <Unreachable message={global.state.message} onRetry={global.reload} />
          )}

          {global.state.k === 'ready' && global.state.data.rows.length === 0 && (
            <Empty title="No currency to check">
              <p>
                No <code>RevShareTaken</code> log on this hook since block{' '}
                {global.state.data.fromBlock.toString()} — an empty log stream, not a failed read.
                Paste a token address above to check one directly.
              </p>
            </Empty>
          )}

          {global.state.k === 'ready' && global.state.data.rows.length > 0 && (
            <section className="dapp-card">
              <div className="dapp-table-wrap">
                <table className="dapp-table">
                  <thead>
                    <tr>
                      <th scope="col">Token</th>
                      <th scope="col">Your claimable</th>
                      <th scope="col">Hook can pay out</th>
                      <th scope="col">Hook owes everyone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {global.state.data.rows.map((r) => (
                      <tr key={r.token.address}>
                        <th scope="row">
                          {r.token.symbol} <Addr value={r.token.address} label="↗" />
                        </th>
                        <td>
                          <Money v={r.amount} token={r.token} />
                        </td>
                        <td>
                          <Money v={r.backing} token={r.token} />
                        </td>
                        <td>
                          <Money v={r.totalOwed} token={r.token} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* The invariant, drawn from the same three reads as the table.
                  A shortfall between two 18-decimal integers is not something a
                  reader spots in a table; it is something they spot in a bar. */}
              {global.state.data.rows.map((r) => (
                <Solvency key={`solv-${r.token.address}`} row={r} />
              ))}

              <details className="dapp-method">
                <summary>What these three figures are</summary>
                <div className="dapp-method__body">
                  <p>
                    <code>backing(currency)</code> is what the hook holds plus the vault claims it
                    can redeem. <code>totalOwed(currency)</code> is every recipient&rsquo;s balance
                    combined. The first must always be at least the second; if it is not, that is a
                    solvency problem worth reporting, not a display glitch.
                  </p>
                </div>
              </details>

              {/* Offered only where there is a balance. `claim` reverts
                  NothingToClaim on zero, so an always-rendered button would be
                  a row of red pre-flight failures saying what the table above
                  already says. */}
              {address &&
                global.state.data.rows
                  .filter((r) => r.amount > 0n)
                  .map((r) => (
                    <PermissionlessAction
                      key={`claim-${r.token.address}`}
                      label={`claim · ${r.token.symbol}`}
                      describes={`Withdraws your ENTIRE ${r.token.symbol} balance on this hook — every pool you are a beneficiary of, combined — to ${address}. There is no way to claim only one pool's share.`}
                      address={hook.address}
                      abi={REV_SHARE_HOOK_ABI}
                      functionName="claim"
                      args={[r.token.address, address]}
                    />
                  ))}

              {global.state.data.rows.every((r) => r.amount === 0n) && (
                <p className="live-note" style={{ marginTop: 10 }}>
                  Nothing claimable, so no claim button — <code>claim</code> reverts{' '}
                  <code>NothingToClaim</code> on zero. A balance appears once{' '}
                  <code>settleBeneficiaries</code> has run for a pool you are on the roster of.
                </p>
              )}
            </section>
          )}

          {/* ============================================ PATH 2 ========= */}
          <section className="dapp-card">
            <div className="dapp-card__head">
              <h3 className="dapp-card__title">2 · Epoch claims from a distributor</h3>
              <span className="dapp-badge dapp-badge--info">per epoch, per account</span>
            </div>
            <p className="live-note">
              An epoch distributor pays holders directly, not through the roster. There is no index
              of distributors on chain, so name one — a pool&rsquo;s is on its pool screen under{' '}
              <code>distributorOf</code>.
            </p>

            <div className="dp-field" style={{ marginTop: 12 }}>
              <label className="dapp-microlabel" htmlFor="rs-dist">
                DISTRIBUTOR ADDRESS
              </label>
              <input
                id="rs-dist"
                className="dp-input dp-input--mono"
                placeholder="0x…"
                value={distributorInput}
                onChange={(e) => setDistributorInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              {distributorInput.trim() !== '' && !distributor && (
                <p className="dp-hint dp-hint--err">Not a 20-byte hex address.</p>
              )}
            </div>

            <div className="dp-field" style={{ marginTop: 12 }}>
              <label className="dapp-microlabel" htmlFor="rs-account">
                ACCOUNT TO CLAIM FOR
              </label>
              <input
                id="rs-account"
                className="dp-input dp-input--mono"
                placeholder={address ?? '0x…'}
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <p className="dp-hint">
                Blank uses the connected address{address ? ` (${address})` : ''}.{' '}
                <code>claim(epochId, account)</code> always pays <em>account</em>: the submitter is
                permissionless, so anyone may push somebody else&rsquo;s claim through and the funds
                still go to that account, never to the sender.
              </p>
            </div>
          </section>

          {dist.state.k === 'loading' && <Reading what="the distributor" />}
          {dist.state.k === 'error' && <Unreachable message={dist.state.message} onRetry={dist.reload} />}

          {dist.state.k === 'ready' && dist.state.data.kind === 'unknown' && (
            <Empty title="That address is not a distributor this app recognises">
              <p>
                It answered neither <code>token()</code> nor <code>challengeDelay()</code>, the only
                two selectors that distinguish a snapshot distributor from a merkle one. Nothing was
                decoded — guessing a type would produce numbers that mean nothing.
              </p>
            </Empty>
          )}

          {dist.state.k === 'ready' && dist.state.data.kind === 'merkle' && (
            <section className="dapp-card hx-alert">
              <h3 className="dapp-card__title">A merkle claim cannot be built here</h3>
              <p className="live-note">
                Claim through whatever channel the operator published the tree on. The epoch screen
                shows the root and challenge state, so you can check what you are given against the
                chain.
              </p>
              <details className="dapp-method">
                <summary>Why this app cannot build one</summary>
                <div className="dapp-method__body">
                  <p>
                    <code>claim(epochId, index, account, amount0, amount1, proof)</code> needs a
                    merkle proof, and <strong>nothing on chain publishes the tree</strong> — the
                    contract stores only the root, and no event, URI or registry carries the leaves.
                    A self-service claim UI would have to invent a proof source, so this app ships
                    no merkle <code>claim</code> in its ABI at all.
                  </p>
                </div>
              </details>
            </section>
          )}

          {dist.state.k === 'ready' && dist.state.data.kind === 'snapshot' && (
            <SnapshotClaims
              d={dist.state.data}
              account={account}
              standings={standings.state}
              onRetry={standings.reload}
            />
          )}
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function SnapshotClaims({
  d,
  account,
  standings,
  onRetry,
}: {
  d: Extract<DistributorState, { kind: 'snapshot' }>
  account: Address | null
  standings: ReturnType<typeof useChainRead<EpochStanding[]>>['state']
  onRetry: () => void
}) {
  const { common, epochs } = d

  if (epochs.length === 0) {
    return (
      <Empty title="This distributor has never closed an epoch">
        <p>
          <code>epochCount()</code> is 0. Until <code>closeEpoch</code> runs there is nothing to
          claim — a holder&rsquo;s share is undefined rather than zero.
        </p>
      </Empty>
    )
  }

  return (
    <section className="dapp-card">
      <div className="dapp-card__head">
        <h3 className="dapp-card__title">Epochs on this snapshot distributor</h3>
        <span className="dapp-badge dapp-badge--mute">
          paid in {common.token0.symbol} / {common.token1.symbol}
        </span>
      </div>
      <p className="live-note">
        Shares are pro-rata by <Addr value={d.token.address} /> ({d.token.symbol}){' '}
        <strong>delegated</strong> votes at each epoch&rsquo;s snapshot. Holding the token is not
        enough: an address that never delegated has no votes and no share. That is ERC-5805, not a
        bug in this screen.
      </p>

      {account === null && (
        <div className="dp-gate" style={{ marginTop: 12 }}>
          <p className="dp-gate__title">No account to check</p>
          <p className="dp-gate__body">
            Connect a wallet, or type an address above. Amounts are per account, so there is nothing
            to read without one.
          </p>
          <LatchConnectButton variant="inline" label="Connect wallet" />
        </div>
      )}

      {account !== null && standings.k === 'loading' && (
        <p className="dp-tx__row" style={{ marginTop: 12 }}>
          <span className="dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse" aria-hidden="true" />
          Reading this account&rsquo;s standing in each epoch…
        </p>
      )}
      {account !== null && standings.k === 'error' && (
        <Unreachable message={standings.message} onRetry={onRetry} />
      )}

      {account !== null && standings.k === 'ready' && (
        <>
          <div className="dapp-table-wrap" style={{ marginTop: 12 }}>
            <table className="dapp-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Closed</th>
                  <th scope="col">This account&rsquo;s share</th>
                  <th scope="col">Already claimed</th>
                  <th scope="col">Window</th>
                </tr>
              </thead>
              <tbody>
                {epochs.map((e) => {
                  const s = standings.data.find((x) => x.epochId === e.id)
                  const expired = common.now >= e.expiresAt
                  return (
                    <tr key={e.id.toString()}>
                      <th scope="row">{e.id.toString()}</th>
                      <td>{fmtTimestamp(e.closedAt)}</td>
                      <td>
                        {s ? (
                          <>
                            <Money v={s.amount0} token={common.token0} />
                            <br />
                            <Money v={s.amount1} token={common.token1} />
                          </>
                        ) : (
                          <span className="hx-muted">—</span>
                        )}
                      </td>
                      <td>
                        {s?.claimed ? (
                          <span className="dapp-badge dapp-badge--mute">claimed</span>
                        ) : (
                          <span className="dapp-badge dapp-badge--ok">no</span>
                        )}
                      </td>
                      <td>
                        {e.rolledOver ? (
                          <span className="dapp-badge dapp-badge--mute">rolled over</span>
                        ) : expired ? (
                          <span className="dapp-badge dapp-badge--warn">closed</span>
                        ) : (
                          <span className="dapp-badge dapp-badge--ok">open</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="live-note" style={{ marginTop: 8 }}>
            Share is <code>claimableAmounts(epochId, account)</code> — reported whether or not it
            has been taken. Already claimed is <code>claimed(epochId, account)</code>.
          </p>

          {standings.data
            .filter((s) => (s.amount0 > 0n || s.amount1 > 0n) && !s.claimed)
            .map((s) => (
              <PermissionlessAction
                key={`claim-${s.epochId.toString()}`}
                label={`claim · epoch ${s.epochId.toString()}`}
                describes={`Pays this epoch's share to ${account}. The submitter is permissionless — you may send this for an address that is not yours, and the funds still go to that address.`}
                address={common.address}
                abi={SNAPSHOT_DISTRIBUTOR_ABI}
                functionName="claim"
                args={[s.epochId, account]}
              />
            ))}

          {standings.data.every((s) => s.amount0 === 0n && s.amount1 === 0n) && (
            <div className="an-empty" style={{ marginTop: 12 }}>
              <p className="an-empty__title">Nothing claimable for this account</p>
              <p className="live-note">
                <code>claimableAmounts</code> returns zero for every listed epoch — most often
                because no votes were <em>delegated</em> before those epochs closed.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

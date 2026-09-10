/* ============================================================================
   Portfolio — the connected address's real position in the protocol.

   Five states, each visually distinct, none of them a table of sample rows:

     not connected   what connecting would show, plus the connect button
     wrong network   contracts exist only on Sepolia; offer the switch
     loading         reading, named address, named chain
     error           chain unreachable — say so, offer retry, show no figures
     ready           positions table, or an honest empty state that names what
                     would appear here; wallet balances and listed hooks below

   Every number on this screen is a token amount in that token's own units,
   read from chain a moment ago. There is no USD column because nothing prices
   these testnet tokens, and no "fees over 30 days" because the protocol does
   not record collected fees per address — only the fees a position has earned
   and NOT yet collected can be sourced, so that is the column.

   READ ONLY. Connecting a wallet here signs nothing and sends nothing; the
   address is used only to know whose positions to look up.
   ============================================================================ */

import { LatchConnectButton } from '@latchprotocol/connect'
import { useMemo } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'

import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  explorerAddress,
  formatUnits,
  isDeployed,
  type DeployedChainId,
} from '../../../lib/chain'
import type { LpPosition, Portfolio as PortfolioData, TokenMeta } from '../data/portfolio'
import { MIN_TICK, MAX_TICK } from '../lib/portfolioMath'
import { usePortfolio } from '../lib/usePortfolio'
import { dappPath } from '../paths'

/* ---------------------------------------------------------------- helpers */

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/**
 * Token amount for display: thousands separators, up to six decimals with
 * trailing zeros trimmed, and an explicit "<0.000001" for a real non-zero
 * amount too small to show — never a "0.00" that hides a balance.
 */
function fmtAmount(v: bigint, decimals: number): string {
  if (v === 0n) return '0'
  const s = formatUnits(v, decimals, 6)
  const [whole = '0', frac = ''] = s.split('.')
  const trimmed = frac.replace(/0+$/, '')
  const wholeFmt = BigInt(whole).toLocaleString('en-US')
  if (wholeFmt === '0' && trimmed === '') return '<0.000001'
  return trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt
}

function Amount({ v, token }: { v: bigint; token: TokenMeta }) {
  return (
    <span className="dapp-table__num">
      {fmtAmount(v, token.decimals)} {token.symbol}
    </span>
  )
}

function isFullRange(p: LpPosition): boolean {
  const s = p.tickSpacing
  if (s <= 0) return false
  return p.tickLower === Math.ceil(MIN_TICK / s) * s && p.tickUpper === Math.floor(MAX_TICK / s) * s
}

function nftUrl(chainId: DeployedChainId, tokenId: bigint): string {
  const d = DEPLOYMENTS[chainId]
  return `${d.explorer}/nft/${d.clPositionManager}/${tokenId.toString()}`
}

/** Sum of a field across positions, grouped by token so amounts of different tokens are never added. */
function sumByToken(
  positions: LpPosition[],
  pick: (p: LpPosition) => [TokenMeta, bigint][],
): { token: TokenMeta; total: bigint }[] {
  const acc = new Map<string, { token: TokenMeta; total: bigint }>()
  for (const p of positions) {
    for (const [token, v] of pick(p)) {
      const k = token.address.toLowerCase()
      const cur = acc.get(k)
      if (cur) cur.total += v
      else acc.set(k, { token, total: v })
    }
  }
  return [...acc.values()]
}

/* ------------------------------------------------------------- sub-views */

function Header({ chainName }: { chainName: string }) {
  return (
    <section className="dapp-card" aria-labelledby="pf-h">
      <div className="dapp-card__head">
        <h2 id="pf-h" className="dapp-card__title">
          Your position in the protocol
        </h2>
        <span className="live-badge">
          <span className="live-dot" aria-hidden="true" />
          LIVE
        </span>
      </div>
      <p className="live-note">
        Read from the deployed contracts on {chainName}: liquidity position NFTs from the
        CL position manager, wallet balances of the protocol&rsquo;s tokens, and hooks listed
        under your address in the registry. Amounts are shown in token units — these are
        unpriced testnet tokens, so there is no dollar figure. Read only; connecting signs
        nothing.
      </p>
    </section>
  )
}

function NotConnected() {
  const d = DEPLOYMENTS[SEPOLIA_CHAIN_ID]
  return (
    <section className="dapp-card" aria-labelledby="pf-nc">
      <h3 id="pf-nc" className="dapp-card__title">
        Connect a wallet to see its positions
      </h3>
      <p className="dapp-note">This screen shows, for the connected address:</p>
      <ul className="live-list" style={{ marginTop: 10 }}>
        <li>
          <span>Concentrated-liquidity positions</span>
          <span className="live-fee">ERC-721s minted by the CL position manager</span>
        </li>
        <li>
          <span>Current token amounts and uncollected fees per position</span>
          <span className="live-fee">from the pool&rsquo;s own price and fee-growth state</span>
        </li>
        <li>
          <span>Wallet balances of {d.demoPool.symbol0} and {d.demoPool.symbol1}</span>
          <span className="live-fee">the protocol&rsquo;s test tokens on {d.name}</span>
        </li>
        <li>
          <span>Hooks you have listed in the registry</span>
          <span className="live-fee">matched on submitter address</span>
        </li>
      </ul>
      <p className="dapp-note">
        Nothing is signed. The address is only used to look up what it holds. Contracts are
        deployed on {d.name} and nowhere else yet.
      </p>
      <div style={{ marginTop: 16 }}>
        <LatchConnectButton variant="inline" label="Connect wallet" />
      </div>
    </section>
  )
}

function WrongNetwork({ chainId }: { chainId: number | undefined }) {
  const { switchChain, isPending, error } = useSwitchChain()
  const d = DEPLOYMENTS[SEPOLIA_CHAIN_ID]
  return (
    <section className="dapp-card" aria-labelledby="pf-wn">
      <div className="dapp-card__head">
        <h3 id="pf-wn" className="dapp-card__title">
          Wrong network
        </h3>
        <span className="dapp-badge dapp-badge--warn">NO DEPLOYMENT</span>
      </div>
      <p className="dapp-note dapp-note--warn">
        Your wallet is on chain {chainId ?? '—'}. Latch Protocol contracts exist only on{' '}
        {d.name} (chain {SEPOLIA_CHAIN_ID}), so there is nothing to read here until you
        switch.
      </p>
      <div className="dapp-toolbar" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="dapp-btn dapp-btn--primary dapp-btn--sm"
          data-busy={isPending ? 'true' : undefined}
          disabled={isPending}
          onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
        >
          {isPending ? 'Confirm in wallet…' : `Switch to ${d.name}`}
        </button>
        <LatchConnectButton variant="inline" showChain />
      </div>
      {error ? (
        <p className="dapp-note dapp-note--warn" role="alert">
          {error.message.split('\n')[0]}
        </p>
      ) : null}
    </section>
  )
}

function Kpis({ p }: { p: PortfolioData }) {
  const inRange = p.positions.filter((x) => x.inRange && x.liquidity > 0n).length
  const fees = sumByToken(p.positions, (x) => [
    [x.token0, x.fees0],
    [x.token1, x.fees1],
  ]).filter((f) => f.total > 0n)

  return (
    <div className="dapp-kpis dapp-kpis--portfolio">
      <article className="dapp-card dapp-card--kpi">
        <h3 className="dapp-microlabel">LP POSITIONS</h3>
        <p className="dapp-kpi__value dapp-kpi__value--portfolio">{p.positions.length}</p>
        <p className="live-note">
          {p.positions.length === 0
            ? 'none owned by this address'
            : `${inRange} in range · ${p.positions.length - inRange} out of range or empty`}
        </p>
      </article>

      <article className="dapp-card dapp-card--kpi">
        <h3 className="dapp-microlabel">UNCOLLECTED FEES</h3>
        {fees.length === 0 ? (
          <>
            <p className="dapp-kpi__value dapp-kpi__value--portfolio">0</p>
            <p className="live-note">no fees waiting to be collected</p>
          </>
        ) : (
          <>
            {fees.map((f) => (
              <p key={f.token.address} className="dapp-kpi__value dapp-kpi__value--portfolio">
                {fmtAmount(f.total, f.token.decimals)}{' '}
                <span className="live-sub">{f.token.symbol}</span>
              </p>
            ))}
            <p className="live-note">earned since each position was last touched</p>
          </>
        )}
      </article>

      {p.balances.map((b) => (
        <article key={b.token.address} className="dapp-card dapp-card--kpi">
          <h3 className="dapp-microlabel">WALLET {b.token.symbol.toUpperCase()}</h3>
          <p className="dapp-kpi__value dapp-kpi__value--portfolio">
            {fmtAmount(b.balance, b.token.decimals)}
          </p>
          <p className="live-note">
            <a
              href={explorerAddress(p.chainId, b.token.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="hx-addr"
            >
              {short(b.token.address)}
            </a>
          </p>
        </article>
      ))}

      <article className="dapp-card dapp-card--kpi">
        <h3 className="dapp-microlabel">HOOKS LISTED BY YOU</h3>
        <p className="dapp-kpi__value dapp-kpi__value--portfolio">{p.submittedHooks.length}</p>
        <p className="live-note">
          {p.submittedHooks.length === 0 ? 'none in the registry' : 'in the hook registry'}
        </p>
      </article>
    </div>
  )
}

function PositionsTable({ p }: { p: PortfolioData }) {
  const d = DEPLOYMENTS[p.chainId]
  const cols = ['POSITION', 'HOOK', 'RANGE', 'HOLDINGS', 'UNCOLLECTED FEES'] as const
  return (
    <div className="dapp-table-wrap">
      <table className="dapp-table">
        <caption className="dapp-sr">
          Liquidity positions owned by {p.address} on {d.name}, read at block{' '}
          {p.checkedAtBlock.toString()}
        </caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.positions.map((pos, i) => {
            const empty = pos.liquidity === 0n
            const badge = empty
              ? 'dapp-badge dapp-badge--mute'
              : pos.inRange
                ? 'dapp-badge dapp-badge--ok'
                : 'dapp-badge dapp-badge--warn'
            const badgeText = empty ? 'EMPTY' : pos.inRange ? 'IN RANGE' : 'OUT OF RANGE'
            return (
              <tr key={pos.tokenId.toString()} style={{ animationDelay: `${(i * 0.06).toFixed(2)}s` }}>
                <th scope="row" data-label={cols[0]}>
                  <span className="dapp-pos">
                    <span className="dapp-pos__token" aria-hidden="true" />
                    <span>
                      <span className="dapp-pos__pair">
                        {pos.token0.symbol} / {pos.token1.symbol}{' '}
                        {(pos.lpFeePips / 10_000).toFixed(2)}%
                      </span>
                      <br />
                      <a
                        className="hx-addr live-fee"
                        href={nftUrl(p.chainId, pos.tokenId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        token #{pos.tokenId.toString()}
                      </a>
                    </span>
                  </span>
                </th>
                <td data-label={cols[1]} className="dapp-table__latch">
                  {pos.hasHook ? (
                    <a
                      className="hx-addr"
                      href={explorerAddress(p.chainId, pos.hooks)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {pos.hookName || short(pos.hooks)}
                    </a>
                  ) : (
                    <span className="hx-muted">No hook</span>
                  )}
                </td>
                <td data-label={cols[2]}>
                  <span className={badge}>{badgeText}</span>
                  <br />
                  <span className="live-fee">
                    {isFullRange(pos)
                      ? 'full range'
                      : `ticks ${pos.tickLower} to ${pos.tickUpper}`}{' '}
                    · now {pos.currentTick}
                  </span>
                </td>
                <td data-label={cols[3]}>
                  <Amount v={pos.amount0} token={pos.token0} />
                  <br />
                  <Amount v={pos.amount1} token={pos.token1} />
                </td>
                <td data-label={cols[4]}>
                  <Amount v={pos.fees0} token={pos.token0} />
                  <br />
                  <Amount v={pos.fees1} token={pos.token1} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NoPositions({ p }: { p: PortfolioData }) {
  const d = DEPLOYMENTS[p.chainId]
  return (
    <div className="an-empty" role="status">
      <p className="an-empty__title">No liquidity positions for {short(p.address)} on {d.name}</p>
      <p className="live-note">
        A position here is an ERC-721 minted by the CL position manager at{' '}
        <a href={explorerAddress(p.chainId, d.clPositionManager)} target="_blank" rel="noopener noreferrer">
          {short(d.clPositionManager)}
        </a>{' '}
        when liquidity is added to a pool. This address holds none as of block{' '}
        {p.checkedAtBlock.toLocaleString('en-US')} — checked by scanning every position NFT ever
        transferred to it and confirming current ownership on chain. The one live pool is{' '}
        <a href={dappPath('pool')}>
          {d.demoPool.symbol0} / {d.demoPool.symbol1} {(d.demoPool.lpFee / 10_000).toFixed(2)}%
        </a>
        ; adding liquidity to it would put a row here with its holdings and uncollected fees.
      </p>
      <p className="live-note" style={{ marginTop: 8 }}>
        Not shown: Bin (ERC-1155) positions, and fees already collected — the protocol does not
        keep a per-address record of those, and this screen does not estimate one.
      </p>
    </div>
  )
}

function HooksCard({ p }: { p: PortfolioData }) {
  return (
    <section className="dapp-card" aria-labelledby="pf-hooks">
      <div className="dapp-card__head">
        <h3 id="pf-hooks" className="dapp-card__title">
          Hooks listed by this address
        </h3>
        <a className="dapp-btn dapp-btn--ghost" href={dappPath('explorer')}>
          Marketplace
        </a>
      </div>
      {p.submittedHooks.length === 0 ? (
        <p className="dapp-note">
          None. A hook you list in the LatchHookRegistry — with your address as submitter — will
          appear here with its verification level and on-chain capability class.
        </p>
      ) : (
        <ul className="live-list" style={{ marginTop: 12 }}>
          {p.submittedHooks.map((h) => (
            <li key={h.address}>
              <span>
                <a
                  href={explorerAddress(p.chainId, h.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {h.name || 'Unnamed hook'}
                </a>{' '}
                <span className="live-fee">{short(h.address)}</span>
              </span>
              <span className="live-fee">
                {['Unverified', 'Source verified', 'Audited'][h.verification]} ·{' '}
                {['Passive', 'Restrictive', 'Value-extracting'][h.risk]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ screen */

export default function Portfolio() {
  const { address, chainId, isConnected, status } = useAccount()
  const onDeployedChain = isConnected && chainId !== undefined && isDeployed(chainId)
  const activeChain = onDeployedChain ? (chainId as DeployedChainId) : undefined

  const { state, reload } = usePortfolio(
    onDeployedChain ? address : undefined,
    activeChain,
  )

  const chainName = useMemo(
    () => DEPLOYMENTS[activeChain ?? SEPOLIA_CHAIN_ID].name,
    [activeChain],
  )

  /* wagmi is restoring a previous session from storage. Brief, but rendering
     "not connected" during it flashes the connect CTA at an already-connected
     user on every reload. */
  if (status === 'reconnecting' || status === 'connecting') {
    return (
      <>
        <Header chainName={chainName} />
        <p className="dapp-empty hx-state" role="status">
          Restoring wallet session&hellip;
        </p>
      </>
    )
  }

  if (!isConnected || !address) {
    return (
      <>
        <Header chainName={chainName} />
        <NotConnected />
      </>
    )
  }

  if (!onDeployedChain) {
    return (
      <>
        <Header chainName={chainName} />
        <WrongNetwork chainId={chainId} />
      </>
    )
  }

  return (
    <>
      <Header chainName={chainName} />

      <section className="dapp-card" aria-label="Connected address">
        <div className="dapp-card__bar">
          <span className="dapp-microlabel dapp-microlabel--tight">ADDRESS</span>
          <a
            className="hx-addr"
            href={explorerAddress(activeChain!, address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {address}
          </a>
          {state.k === 'ready' ? (
            <span className="live-fee">
              read at block {state.p.checkedAtBlock.toLocaleString('en-US')}
            </span>
          ) : null}
          <button
            type="button"
            className="dapp-btn dapp-btn--ghost"
            onClick={reload}
            disabled={state.k === 'loading'}
          >
            {state.k === 'loading' ? 'Reading…' : 'Refresh'}
          </button>
        </div>
      </section>

      {state.k === 'loading' && (
        <p className="dapp-empty hx-state" role="status">
          Reading positions for {short(address)} on {chainName}&hellip; Position NFTs are found
          by scanning transfer logs from the deployment block, so this can take a few seconds
          on the public RPC.
        </p>
      )}

      {state.k === 'error' && (
        <section className="dapp-card" role="alert">
          <div className="dapp-card__head">
            <h3 className="dapp-card__title">Could not read {chainName}</h3>
            <span className="dapp-badge dapp-badge--warn">UNREACHABLE</span>
          </div>
          <p className="dapp-note dapp-note--warn">{state.message}</p>
          <p className="dapp-note">
            No figures are shown rather than stale or invented ones. The public Sepolia RPC has a
            single endpoint and no failover; retrying usually works.
          </p>
          <div style={{ marginTop: 14 }}>
            <button type="button" className="dapp-btn dapp-btn--primary dapp-btn--sm" onClick={reload}>
              Retry
            </button>
          </div>
        </section>
      )}

      {state.k === 'ready' && (
        <>
          <Kpis p={state.p} />
          {state.p.positions.length > 0 ? (
            <PositionsTable p={state.p} />
          ) : (
            <NoPositions p={state.p} />
          )}
          <HooksCard p={state.p} />
        </>
      )}
    </>
  )
}

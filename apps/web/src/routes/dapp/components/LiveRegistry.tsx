import { useEffect, useState } from 'react'
import {
  DEPLOYMENTS,
  SEPOLIA_CHAIN_ID,
  explorerAddress,
  readRegisteredHooks,
  type RegisteredHook,
} from '../../../lib/chain'

/**
 * The real hook registry, read from chain.
 *
 * This is a SAFETY surface before it is a discovery surface. A hook holding a
 * returns-delta permission can take a cut of every swap in its pool; one holding
 * beforeSwap can stop trading entirely; one holding beforeRemoveLiquidity can refuse
 * withdrawals, which strands funds as surely as taking them.
 *
 * So capability is shown as plain language, always visible, never behind a
 * disclosure — and it comes from the registry's own on-chain classifiers rather than
 * being re-derived here. A UI that computes risk itself can disagree with the chain,
 * and the user would have no way to know which one lied.
 */

const RISK_LABEL = ['Passive', 'Restrictive', 'Value-extracting'] as const
const VERIFICATION_LABEL = ['Unverified', 'Source verified', 'Audited'] as const
const LISTING_LABEL = ['Active', 'Deprecated', 'Flagged malicious'] as const

type State =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; hooks: RegisteredHook[] }

function Capability({ hook }: { hook: RegisteredHook }) {
  if (!hook.permissionsReadable) {
    return (
      <p className="lr-cap lr-cap--danger">
        Permissions could not be read from this contract. Treat with suspicion.
      </p>
    )
  }
  const claims: string[] = []
  if (hook.takesSwapCut) claims.push('can take a share of every swap')
  if (hook.canBlockSwaps) claims.push('can block or price swaps')
  if (hook.canTrapLiquidity) claims.push('can refuse liquidity withdrawal')
  if (claims.length === 0) claims.push('observes only — cannot move funds or block trading')

  return (
    <ul className={`lr-cap ${hook.takesSwapCut || hook.canTrapLiquidity ? 'lr-cap--danger' : ''}`}>
      {claims.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  )
}

export function LiveRegistry() {
  const [state, setState] = useState<State>({ k: 'loading' })

  useEffect(() => {
    let off = false
    readRegisteredHooks()
      .then((hooks) => !off && setState({ k: 'ready', hooks }))
      .catch((e) =>
        !off && setState({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }),
      )
    return () => {
      off = true
    }
  }, [])

  const d = DEPLOYMENTS[SEPOLIA_CHAIN_ID]

  return (
    <section className="dapp-card lr" aria-labelledby="lr-h">
      <header className="lr-head">
        <h2 id="lr-h" className="lr-title">
          On-chain registry
        </h2>
        <span className="lr-badge">
          <span className="lr-dot" aria-hidden="true" />
          LIVE
        </span>
      </header>

      <p className="lr-note">
        Capabilities are read from each hook&rsquo;s own contract at registration — a submitter
        cannot declare permissions their code does not have.{' '}
        <a href={explorerAddress(SEPOLIA_CHAIN_ID, d.registry)} target="_blank" rel="noopener noreferrer" data-hit>
          Registry contract
        </a>
      </p>

      {state.k === 'loading' && <p className="lr-note" role="status">Reading the registry&hellip;</p>}

      {state.k === 'error' && (
        <p className="lr-note lr-note--err" role="status">
          Could not read the registry: {state.message}. Nothing shown rather than stale listings.
        </p>
      )}

      {state.k === 'ready' && state.hooks.length === 0 && (
        <p className="lr-note">
          No hooks listed yet. The registry is deployed and empty — shown as empty rather than
          padded with examples.
        </p>
      )}

      {state.k === 'ready' && state.hooks.length > 0 && (
        <ul className="lr-list">
          {state.hooks.map((h) => (
            <li key={h.address} className={`lr-item ${h.listing === 2 ? 'lr-item--flagged' : ''}`}>
              <div className="lr-item__head">
                <a
                  href={explorerAddress(SEPOLIA_CHAIN_ID, h.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lr-name"
                  data-hit
                >
                  {h.name || 'Unnamed hook'}
                </a>
                <span className={`lr-chip lr-chip--v${h.verification}`}>
                  {VERIFICATION_LABEL[h.verification]}
                </span>
                <span className={`lr-chip lr-chip--r${h.risk}`}>{RISK_LABEL[h.risk]}</span>
                {h.listing !== 0 && (
                  <span className="lr-chip lr-chip--flag">{LISTING_LABEL[h.listing]}</span>
                )}
              </div>

              {h.description && <p className="lr-desc">{h.description}</p>}

              <Capability hook={h} />

              <p className="lr-meta">
                bitmap <span className="tabular">0x{h.permissions.toString(16).padStart(4, '0')}</span>
                {h.auditURI ? ' · audit report on file' : ' · no audit report'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

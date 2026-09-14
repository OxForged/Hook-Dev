/* ============================================================================
   "No live pools yet" — the one empty state every pool-showcase screen uses.

   Owner decision, 2026-09-14: the protocol's own test-token pool is retired
   and no longer shown, and Latch has no token of its own to put in its place.
   A screen with no real pool to show says exactly that, says how many
   test-token pools were left out (so an absence is never mistaken for a scan
   that missed something), and points at how a pool gets launched. It never
   renders an example pair or a row of zeros.
   ============================================================================ */

import { Link } from 'react-router-dom'

import { GITHUB_URL } from '../../landing/socials'

/** The public launchpad integration guide, in the SDK mirror. Same target as the landing footer's. */
const LAUNCHPAD_GUIDE = `${GITHUB_URL}/latch-sdk/blob/main/prompts/launchpad-integration.md`

export function NoLivePools({
  chainName,
  source,
  hiddenTestPools,
  inCard = true,
}: {
  chainName: string
  /** What was read to reach this answer, e.g. "CLPoolManager Initialize logs since block N". */
  source: React.ReactNode
  /** Pools left out because they trade an address-book test token. `null` when not counted. */
  hiddenTestPools: number | null
  /** Render as its own `.dapp-card`. False when the caller already supplies one. */
  inCard?: boolean
}) {
  const hidden =
    hiddenTestPools !== null && hiddenTestPools > 0
      ? ` ${hiddenTestPools.toLocaleString('en-US')} test-token pool${hiddenTestPools === 1 ? ' is' : 's are'} left out on purpose.`
      : ''
  return (
    <div className={inCard ? 'dapp-card an-empty' : 'an-empty'} role="status">
      <p className="an-empty__title">No live pools yet</p>
      <p className="live-note">
        Nothing to show on {chainName}: read from {source}.{hidden}
      </p>
      <p className="live-note">
        A pool is launched with a kit against the shared core &mdash; see the{' '}
        <a href={LAUNCHPAD_GUIDE} target="_blank" rel="noopener noreferrer">
          launchpad integration guide
        </a>{' '}
        or <Link to="/docs">the docs</Link>.
      </p>
    </div>
  )
}

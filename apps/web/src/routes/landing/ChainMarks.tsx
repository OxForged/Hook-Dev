/* ============================================================================
   Where Latch runs — the chain marks, with "live" and "target" kept apart.

   Owner's request, 2026-09-13: "we need the supported blockchains logo on the
   landing." The honest version of that sentence has two halves, and the page
   says both: contracts are LIVE on the network this build serves, and the
   rest are TARGETS — EIP-1153 confirmed by a live TSTORE probe, nothing
   deployed. `data/chains.ts` says the UI "must show that difference rather
   than imply eleven live networks", so the word "supported" is not used: it
   reads as "deployed" to anyone who has not read this comment.

   WHICH CHAINS. Live is `DEPLOYED_CHAINS` — this build's own active chain
   only, so a mainnet page never lists Sepolia and the testnet page never
   borrows the mainnet's credibility. Targets are the other chains on the
   build's own network (mainnets on the mainnet build, testnets on the testnet
   build), so no mark appears twice.

   NO ADDRESSES. `Sections.tsx`'s unmounted `Chains()` rendered every contract
   address per chain; those live in the docs now (`/docs#contracts`). This
   borrows its tile idea and nothing else.

   MARKS come only from `public/chains/` through `ChainMark` — official files,
   untouched. Several are white-on-transparent (Linea White, X Layer White,
   Plasma, Stable, Arc), and would vanish on the light ground. The asset is
   never altered; instead every mark sits on the same neutral DARK tile in both
   themes (see chainmarks.module.css). A chain with no official mark —
   Robinhood today — keeps ChainMark's typographic monogram.
   ========================================================================== */

import { useState } from 'react'

import { ChainMark } from '../../components/ChainMark.tsx'
import { CHAIN_ROWS, DEPLOYED_CHAINS, type ChainRow } from '../../data/chains.ts'
import { ACTIVE_CHAIN_ID, IS_TESTNET_BUILD } from '../../lib/chain'
import styles from './chainmarks.module.css'
import page from './landing.module.css'
import { cx } from './ui'

const LIVE: readonly ChainRow[] = DEPLOYED_CHAINS

const TARGETS: readonly ChainRow[] = CHAIN_ROWS.filter(
  (c) =>
    c.chainId !== ACTIVE_CHAIN_ID &&
    !c.deployed &&
    c.network === (IS_TESTNET_BUILD ? 'testnet' : 'mainnet'),
)

const names = (rows: readonly ChainRow[]): string =>
  rows.length === 1 ? (rows[0]?.name ?? '') : `${rows.length} networks`

function Mark({
  chain,
  live,
  shown,
  onTap,
}: {
  chain: ChainRow
  live: boolean
  /** True while this tile's name chip is pinned open by a tap. */
  shown: boolean
  onTap: () => void
}) {
  const status = live ? 'contracts live' : 'target, no contracts deployed'
  return (
    <li className={styles['item']}>
      {/* Focusable so the name shown on hover is reachable by keyboard too.
          The accessible name carries the status, so the mark alone is never
          the whole label. The inner mark is decorative to assistive tech.

          A TAP PINS THE NAME. A phone has no hover, and whether a tap focuses
          a tabindex span differs by browser, so the chip is also driven by
          `data-shown`. It changes what is visible, never what is announced. */}
      <span
        className={cx(styles['tile'], live && styles['tileLive'])}
        role="img"
        tabIndex={0}
        aria-label={`${chain.name}: ${status}`}
        data-shown={shown ? '' : undefined}
        onClick={onTap}
      >
        <span className={styles['markBox']} aria-hidden="true">
          <ChainMark brand={chain.brand} size={24} className={styles['mark']} />
        </span>
        <span className={styles['name']} aria-hidden="true">
          {chain.name}
        </span>
      </span>
      {live ? (
        <span className={styles['liveName']} aria-hidden="true">
          {chain.name}
        </span>
      ) : null}
    </li>
  )
}

export function ChainMarks() {
  /** The tile whose name a tap has pinned open; one at a time. */
  const [tapped, setTapped] = useState<string | null>(null)
  const tap = (key: string) => () => setTapped((k) => (k === key ? null : key))

  if (LIVE.length === 0 && TARGETS.length === 0) return null

  return (
    <section className={cx(page['section'], page['reveal'])} aria-labelledby="chains-title">
      <p className={page['eyebrow']}>NETWORKS</p>
      <h2 id="chains-title" className={cx(page['h2'], page['h2Small'])}>
        {LIVE.length === 0
          ? `Built for ${TARGETS.length} chains.`
          : `Live on ${LIVE.length === 1 ? 'one chain' : `${LIVE.length} chains`}, built for ${TARGETS.length} more.`}
      </h2>
      <p className={cx(page['sectionLead'], page['sectionLeadStart'])}>
        {LIVE.length > 0 ? <>Contracts are deployed on {names(LIVE)}. </> : null}
        The others are targets: transient storage confirmed by a live probe, no contracts deployed
        yet.
      </p>

      <div className={styles['rows']}>
        {LIVE.length > 0 ? (
          <div className={styles['group']}>
            <span className={cx(styles['badge'], styles['badgeLive'])} id="chains-live">
              LIVE ON
            </span>
            <ul className={styles['list']} aria-labelledby="chains-live">
              {LIVE.map((c) => (
                <Mark key={c.key} chain={c} live shown={false} onTap={tap(c.key)} />
              ))}
            </ul>
          </div>
        ) : null}

        {TARGETS.length > 0 ? (
          <div className={styles['group']}>
            <span className={styles['badge']} id="chains-targets">
              BUILT FOR
            </span>
            <ul
              className={cx(styles['list'], styles['listTargets'])}
              aria-labelledby="chains-targets"
            >
              {TARGETS.map((c) => (
                <Mark
                  key={c.key}
                  chain={c}
                  live={false}
                  shown={tapped === c.key}
                  onTap={tap(c.key)}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

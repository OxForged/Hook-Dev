/* ============================================================================
   Four things you do not have to build — ported from the approved Option C
   prototype (`latch-design-options/c.html`, the section headed with that
   sentence).

   WHAT THIS SECTION IS FOR. Audiences.tsx argues; this one enumerates. It is
   the inventory a developer scrolls to after they have decided they are
   interested and want to know what is actually already there. The copy is
   the prototype's, unchanged in substance.

   NO ADDRESSES ON THE CARDS, 2026-09-13. Each card used to end in a
   contract-name-and-short-address explorer link. The owner moved every contract
   address off the landing page and into the docs ("contracts need to be on
   docs not on landing"), where the full address book lives with copy buttons
   and a live code check. So the cards keep their copy and the grid ends in one
   quiet link to `/docs#contracts` — one canonical list, not four fragments of
   it here and the whole of it there.

   WHAT STILL READS THE ADDRESS BOOK, AND WHY. The lead sentence says whether
   each contract below is deployed on this build's chain. That is a claim
   about chain state, so it is DERIVED from `DEPLOYMENTS[ACTIVE_CHAIN_ID]`
   (null means not deployed) rather than typed. Only the null-ness is read;
   no address is rendered.

   WHY THERE IS NO PER-CARD "VERIFIED" BADGE. The prototype's sub-line says
   "verified on Sourcify" once, about the set. A badge on each card would read
   as a per-contract check, and nothing in this component performs one. The
   claim stays where the prototype put it: at section level, as a statement
   about the deployment, with the docs one click away for anyone who wants to
   check it.
   ========================================================================== */

import { Link } from 'react-router-dom'

import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../lib/chain.ts'
import { LINKS } from './data'
import page from './landing.module.css'
import styles from './fourthings.module.css'
import { cx } from './ui'

/** One build serves one chain; the deployed/not-deployed lead follows it. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

interface Piece {
  /** Product-voice micro-label, verbatim from the prototype. */
  readonly tag: string
  readonly title: string
  readonly body: string
  /**
   * The Solidity contracts the card is about, and whether the address book
   * records each on this chain. Read for the lead sentence only; never shown.
   */
  readonly contracts: readonly { readonly name: string; readonly deployed: boolean }[]
}

const PIECES: readonly Piece[] = [
  {
    tag: 'Vault',
    title: 'Singleton custody',
    body: 'One contract holds every token. An unregistered pool manager can move nothing against it — which is what makes the fee enforceable rather than requested.',
    contracts: [{ name: 'Vault', deployed: CHAIN.vault !== null }],
  },
  {
    tag: 'Pool managers',
    title: 'CL and Bin',
    body: 'Concentrated liquidity and liquidity book, side by side. There is no factory anywhere in the design.',
    contracts: [
      { name: 'CLPoolManager', deployed: CHAIN.clPoolManager !== null },
      { name: 'BinPoolManager', deployed: CHAIN.binPoolManager !== null },
    ],
  },
  {
    tag: 'LaunchpadKit',
    title: 'One-call launches',
    body: 'Creates the pool, configures the guard, seeds liquidity and lists the Latch — atomically.',
    /* Genuinely `null` on Sepolia today, which is why the lead's "except"
       branch below is a rendered state and not a defensive one. */
    contracts: [{ name: 'LaunchpadKit', deployed: CHAIN.launchpadKit !== null }],
  },
  {
    tag: 'Registry',
    title: 'Latch Marketplace',
    body: 'Every Latch listed with the permission bitmap it declares, checkable before you route a user through it.',
    contracts: [{ name: 'LatchRegistry', deployed: CHAIN.registry !== null }],
  },
]

/**
 * The contracts named above that the address book does NOT record on this
 * chain, by name.
 *
 * The prototype's sub-line opens "Each deployed", which is a claim about chain
 * state written into static copy — the exact thing § "No invented data" rules
 * out. It happens to be true on Robinhood and false on the Sepolia build, so
 * it is derived instead of typed, and the exception is named in the lead now
 * that the cards no longer carry a per-contract line to say it.
 */
const MISSING: readonly string[] = PIECES.flatMap((p) =>
  p.contracts.filter((c) => !c.deployed).map((c) => c.name),
)

const LEAD =
  MISSING.length === 0
    ? `Each deployed on ${CHAIN.name}, verified on Sourcify, and permissionless to use.`
    : `Deployed on ${CHAIN.name}, verified on Sourcify, and permissionless to use — except ${MISSING.join(' and ')}, which ${MISSING.length === 1 ? 'is' : 'are'} not on this chain yet.`

/**
 * The inventory.
 *
 * `.reveal` is a pure CSS animation with no JS gate, so a throttled background
 * tab still paints the section — the failure that hid a whole prototype's
 * content the first time it was previewed.
 */
export function FourThings() {
  return (
    <section
      id="primitives"
      className={cx(page['section'], page['reveal'])}
      aria-labelledby="primitives-title"
    >
      <p className={page['eyebrow']}>ALREADY DEPLOYED</p>
      <h2 id="primitives-title" className={cx(page['h2'], page['h2Small'])}>
        Four things you <span className={page['accent']}>do not have to build</span>.
      </h2>
      <p className={cx(page['sectionLead'], page['sectionLeadStart'])}>{LEAD}</p>

      <div className={styles['grid']}>
        {PIECES.map((p) => (
          <article key={p.tag} className={styles['card']}>
            <div className={styles['top']}>
              {/* Option B's icon chip. The letter is the tag's own first
                  character — nothing new — and hidden from assistive tech
                  because the tag beside it already says the word. */}
              <span className={styles['ic']} aria-hidden="true">
                {p.tag.charAt(0)}
              </span>
              <p className={styles['tag']}>{p.tag}</p>
            </div>
            <h3 className={styles['title']}>{p.title}</h3>
            <p className={styles['body']}>{p.body}</p>
          </article>
        ))}
      </div>

      {/* One link for the grid, not one per card: every card would point at
          the same docs section. */}
      <p className={styles['more']}>
        <Link to={LINKS.contracts} className={styles['moreLink']}>
          Addresses in the docs<span aria-hidden="true"> →</span>
        </Link>
      </p>
    </section>
  )
}

/* ============================================================================
   Four things you do not have to build — ported from the approved Option C
   prototype (`latch-design-options/c.html`, the section headed with that
   sentence).

   WHAT THIS SECTION IS FOR. Audiences.tsx argues; this one enumerates. It is
   the inventory a developer scrolls to after they have decided they are
   interested and want to know what is actually already there. So the copy is
   the prototype's, unchanged in substance, and the only thing added is the
   part a static prototype could not have: each card names a contract, and
   each contract is a link to the deployment on this build's chain.

   EVERY ADDRESS IS DERIVED, NEVER TYPED. `DEPLOYMENTS[ACTIVE_CHAIN_ID]` is the
   one address book, so a redeploy is an edit in the SDK and nothing here
   moves. There is deliberately not a single hex literal in this file — a
   pasted address is a number that looks read-from-chain and is not, which is
   the failure § "No invented data in the UI. Ever." exists to prevent.

   WHY THERE IS NO PER-CARD "VERIFIED" BADGE. The prototype's sub-line says
   "verified on Sourcify" once, about the set. A badge on each card would read
   as a per-contract check, and nothing in this component performs one — there
   is no Sourcify read here and no verification field in the address book. A
   green tick that nothing computes is exactly the kind of authoritative-looking
   fiction the rule forbids, so the claim stays where the prototype put it: at
   section level, as a statement about the deployment, next to links that let a
   reader go and confirm it for themselves in one click.
   ========================================================================== */

import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../lib/chain.ts'
import { explorerAddressUrl } from '../../data/chains.ts'
import page from './landing.module.css'
import styles from './fourthings.module.css'
import { cx } from './ui'

/** One build serves one chain; every address and every link below follows it. */
const CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * A contract a card is about.
 *
 * `address: null` means NOT DEPLOYED on this chain — the address book's own
 * distinction, and never the zero address. The card renders the absence rather
 * than a link, because a link to `0x000…000` reads as "here it is" and lands on
 * an explorer page for a contract that does not exist.
 */
interface ContractRef {
  /** The Solidity contract name. Code voice: this is the ABI, not the product noun. */
  readonly name: string
  readonly address: string | null
}

interface Piece {
  /** Product-voice micro-label, verbatim from the prototype. */
  readonly tag: string
  readonly title: string
  readonly body: string
  /** Usually one. `Pool managers` is a pair, and the card says so. */
  readonly contracts: readonly ContractRef[]
}

const PIECES: readonly Piece[] = [
  {
    tag: 'Vault',
    title: 'Singleton custody',
    body: 'One contract holds every token. An unregistered pool manager can move nothing against it — which is what makes the fee enforceable rather than requested.',
    contracts: [{ name: 'Vault', address: CHAIN.vault }],
  },
  {
    tag: 'Pool managers',
    title: 'CL and Bin',
    body: 'Concentrated liquidity and liquidity book, side by side. There is no factory anywhere in the design.',
    contracts: [
      { name: 'CLPoolManager', address: CHAIN.clPoolManager },
      { name: 'BinPoolManager', address: CHAIN.binPoolManager },
    ],
  },
  {
    tag: 'LaunchpadKit',
    title: 'One-call launches',
    body: 'Creates the pool, configures the guard, seeds liquidity and lists the hook — atomically.',
    /* Genuinely `null` on Sepolia today, which is why the null path below is a
       rendered state and not a defensive branch nobody will ever hit. */
    contracts: [{ name: 'LaunchpadKit', address: CHAIN.launchpadKit }],
  },
  {
    tag: 'Registry',
    title: 'Hook marketplace',
    body: 'Every Latch listed with the permission bitmap it declares, checkable before you route a user through it.',
    contracts: [{ name: 'LatchRegistry', address: CHAIN.registry }],
  },
]

/**
 * Whether every contract named above exists on this chain.
 *
 * The prototype's sub-line opens "Each deployed", which is a claim about chain
 * state written into static copy — the exact thing § "No invented data" rules
 * out. It happens to be true on Robinhood and false on the Sepolia build, so
 * it is derived instead of typed.
 */
const ALL_DEPLOYED = PIECES.every((p) => p.contracts.every((c) => c.address !== null))

const LEAD = ALL_DEPLOYED
  ? `Each deployed on ${CHAIN.name}, verified on Sourcify, and permissionless to use.`
  : `Deployed on ${CHAIN.name}, verified on Sourcify, and permissionless to use — except where a card below says the contract is not on this chain yet.`

/** `0x1234…cdef`. Enough to recognise, short enough not to wrap a card. */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * One contract, as a link if it exists and as a plain statement if it does not.
 *
 * `explorerAddressUrl` returns `null` for a chain we have no verified explorer
 * for, and that is the second no-link path: guessing a URL pattern produces a
 * link that 404s, which a reader reads as "this contract is not real".
 */
function ContractLink({ contract }: { readonly contract: ContractRef }) {
  const { name, address } = contract
  if (address === null) {
    return (
      <span className={cx(styles['ref'], styles['refAbsent'])}>
        {name} · not deployed on {CHAIN.name}
      </span>
    )
  }

  const href = explorerAddressUrl(ACTIVE_CHAIN_ID, address)
  if (href === null) {
    return (
      <span className={styles['ref']}>
        {name} · {shortAddress(address)}
      </span>
    )
  }

  return (
    <a
      className={cx(styles['ref'], styles['refLink'])}
      href={href}
      target="_blank"
      rel="noreferrer"
      /* The visible text is an abbreviation; the accessible name has to be the
         whole sentence, because "Vault · 0x78e8…fB6c" read aloud says nothing
         about where the link goes. */
      aria-label={`${name} at ${address} on the ${CHAIN.name} block explorer`}
    >
      {name} · {shortAddress(address)}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}

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
            <p className={styles['tag']}>{p.tag}</p>
            <h3 className={styles['title']}>{p.title}</h3>
            <p className={styles['body']}>{p.body}</p>
            <div className={styles['refs']}>
              {p.contracts.map((c) => (
                <ContractLink key={c.name} contract={c} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

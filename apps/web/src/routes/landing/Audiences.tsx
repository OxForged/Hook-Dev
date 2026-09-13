/* ============================================================================
   Two ways to build on it — the marketing spine.

   WHY TWO COLUMNS AND NOT ONE LIST. Two different people have to say yes, and
   they are asking different questions. A DEX builder wants to know what they
   do NOT have to build; a launchpad operator wants to know what a launch costs
   them and where their money lands. A merged list answers neither properly,
   because every second line reads as beside the point to whoever is looking.

   EVERY CLAIM NAMES THE THING THAT SETTLES IT. That is the whole voice of this
   page: a developer evaluating infrastructure does not want adjectives, they
   want a symbol they can grep. So the bullets say `Vault.lock` and `initialize`
   and `LaunchpadKit` rather than "permissionless", "simple" and "no admin key"
   standing on their own.

   THE TWO COUNTS ARE DERIVED, NOT TYPED. How many contracts are deployed comes
   from the address book, and how many presets exist comes from the SDK table
   that a parity test checks against the Solidity. Both are the kind of number
   that goes quietly stale in prose — CLAUDE.md's own "nineteen contracts" is
   already wrong — and neither is worth a sentence a human has to remember to
   update.

   Marketing copy is still copy, and § "No invented data in the UI. Ever."
   applies to it exactly as it applies to a chart. Nothing below is
   aspirational: each claim was checked against the source in this repo before
   it was written.
   ========================================================================== */

import { PRESET_PARAMS } from '@latchprotocol/sdk'
import { ACTIVE_CHAIN_ID, DEPLOYMENTS } from '../../lib/chain.ts'
import { LINKS } from './data'
import styles from './landing.module.css'
import { cx } from './ui'

/** Named, never spelled. One build serves one chain; the copy must follow it. */
const ACTIVE_CHAIN = DEPLOYMENTS[ACTIVE_CHAIN_ID]

/**
 * Contracts this chain actually has, counted from the deployment record.
 *
 * A `null` entry means NOT DEPLOYED and is excluded — the same distinction the
 * stats strip makes. The filter tests for an address rather than truthiness so
 * that a future non-address field (a name, a block number, an explorer URL)
 * cannot silently inflate the total.
 */
const DEPLOYED_COUNT = Object.values(ACTIVE_CHAIN).filter(
  (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v),
).length

/**
 * Presets that carry parameters.
 *
 * `Custom` is deliberately not in `PRESET_PARAMS` — asking the kit for its
 * parameters reverts `NoParametersForCustomPreset` — so this counts exactly
 * the ready-made schedules an operator can pick, which is what the copy claims.
 */
const PRESET_COUNT = Object.keys(PRESET_PARAMS).length

interface Claim {
  /** The promise, bolded. Short enough to scan a column by these alone. */
  readonly lead: string
  /** What makes it true — and, where it matters, what it still does not cover. */
  readonly rest: string
}

interface Audience {
  readonly who: string
  readonly title: string
  readonly body: string
  readonly claims: readonly Claim[]
  readonly cta: { readonly label: string; readonly href: string }
}

const AUDIENCES: readonly Audience[] = [
  {
    who: 'For DEX builders',
    title: 'Your exchange, our settlement.',
    body: 'Pools live in a Vault that is already deployed and verified. You bring the interface and the routing, and nothing about your product has to be ours.',
    claims: [
      {
        lead: 'No factory to deploy.',
        rest: 'A pool is one permissionless call to initialize on a pool manager that is already live. There is no per-pair contract anywhere in the design.',
      },
      {
        lead: 'No core to audit.',
        rest: `${DEPLOYED_COUNT} contracts deployed on ${ACTIVE_CHAIN.name} and verified on Sourcify. Read them before you route a single swap through them.`,
      },
      {
        lead: 'No address to mine.',
        rest: 'Permissions come from getHooksRegistrationBitmap() on the hook itself, checked against the pool key at initialization — not from vanity bits you have to grind for.',
      },
      {
        lead: 'Your router, your fee.',
        rest: 'Vault.lock carries no access control, so wrap ours or ship your own and take your cut where your users already are.',
      },
    ],
    cta: { label: 'DEX integration prompt', href: LINKS.promptDex },
  },
  {
    who: 'For launchpad operators',
    title: 'A launch in one transaction.',
    body: 'Pool, opening-fee decay, seeded liquidity and a registry listing, from a single call to a contract you do not have to deploy.',
    claims: [
      {
        lead: `${PRESET_COUNT} presets that admit their limits.`,
        rest: 'Each carries the sentence saying what it does not protect against. The aggressive one requires a per-transaction cap and states outright that sybil splitting defeats it.',
      },
      {
        lead: 'Decay, not prohibition.',
        rest: 'The opening tax is an ordinary LP fee accruing to your liquidity providers. Early extraction is redistributed rather than blocked, so nothing has to guess who is a sniper.',
      },
      {
        lead: 'Your fee wallet, three routes.',
        rest: 'A cut at your own router, a seat on the pool’s revenue-share roster, or the seeded LP position itself. All three are yours, and none of them is fixed in our Solidity.',
      },
      {
        lead: 'No admin key.',
        rest: 'LaunchpadKit is not Ownable and holds nothing between transactions. It cannot pause and cannot upgrade — which also means it cannot recover, and that is the same sentence.',
      },
    ],
    cta: { label: 'Launchpad integration prompt', href: LINKS.promptLaunchpad },
  },
]

/**
 * Two audiences, side by side.
 *
 * `.reveal` is a pure CSS animation and never a JS-gated one, so a throttled
 * background tab still paints the section — the failure that hid a whole
 * prototype's content the first time it was previewed.
 */
export function Audiences() {
  return (
    <section
      id="build"
      className={cx(styles['section'], styles['reveal'])}
      aria-labelledby="build-title"
    >
      <p className={styles['eyebrow']}>INTEGRATE</p>
      <h2 id="build-title" className={cx(styles['h2'], styles['h2Small'])}>
        Two ways to <span className={styles['accent']}>build on it</span>.
      </h2>
      <p className={cx(styles['sectionLead'], styles['sectionLeadStart'])}>
        The same deployment serves both, and neither asks you to give up your product surface.
      </p>

      <div className={styles['audGrid']}>
        {AUDIENCES.map((a) => (
          <article key={a.who} className={styles['audCard']}>
            <p className={styles['audWho']}>{a.who}</p>
            <h3 className={styles['audTitle']}>{a.title}</h3>
            <p className={styles['audBody']}>{a.body}</p>

            <ul className={styles['audList']}>
              {a.claims.map((c) => (
                <li key={c.lead} className={styles['audItem']}>
                  <span className={styles['audTick']} aria-hidden="true" />
                  <span>
                    <b className={styles['audLead']}>{c.lead}</b> {c.rest}
                  </span>
                </li>
              ))}
            </ul>

            <a className={styles['audCta']} href={a.cta.href} target="_blank" rel="noreferrer">
              {a.cta.label}
              <span aria-hidden="true"> →</span>
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}

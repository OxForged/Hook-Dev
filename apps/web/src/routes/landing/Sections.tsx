import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ChainMark } from '../../components/ChainMark.tsx'
import type { ChainRow } from '../../data/chains.ts'
import {
  CHAIN_ROWS,
  MAINNET_CHAINS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_CONTRACTS,
  TESTNET_CHAINS,
  explorerAddressUrl,
} from '../../data/chains.ts'
import {
  FEATURES,
  INTERFACE_FACTS,
  LAYER_STEPS,
  LINKS,
  ROADMAP,
  TEAM,
  USE_CASES,
  SHARE_ROUTES,
  ORACLES,
  MARKET_KINDS,
} from './data'
import { CodePanel } from './CodePanel'
import styles from './landing.module.css'
import { cx } from './ui'

/** A5. Use cases — four cards that lift 4px on hover. */
export function UseCases() {
  return (
    <section
      id="ecosystem"
      className={cx(styles['section'], styles['reveal'], styles['delay2'])}
      aria-labelledby="ecosystem-title"
    >
      <p className={styles['eyebrow']}>USE CASES</p>
      <h2 id="ecosystem-title" className={cx(styles['h2'], styles['h2Large'])}>
        One Infrastructure.
        <br />
        <span className={styles['accent']}>Every Ecosystem.</span>
      </h2>
      <div className={styles['cardGrid4']}>
        {USE_CASES.map((useCase) => (
          <article key={useCase.name} className={styles['useCase']}>
            <div className={styles['iconTile']} aria-hidden="true">
              <div className={styles['iconDiamond']} />
            </div>
            <h3 className={styles['useCaseName']}>{useCase.name}</h3>
            <p className={styles['useCaseBody']}>{useCase.body}</p>
            <p className={styles['useCaseTag']}>{useCase.tag}</p>
            <p
              className={cx(
                styles['useCaseStatus'],
                useCase.status === 'Live on testnet'
                  ? styles['useCaseStatusLive']
                  : styles['useCaseStatusSoon'],
              )}
            >
              {useCase.status}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

/** A6. How it works — three layer cards, then facts beside the code panel. */
export function HowItWorks() {
  return (
    <section
      id="developers"
      className={cx(styles['section'], styles['reveal'], styles['delay3'])}
      aria-labelledby="developers-title"
    >
      <p className={styles['eyebrow']}>HOW IT WORKS</p>
      {/* SCREENS.md § A6 says "Three layers". The three cards are the three
          steps of one integration path — write, encode, initialize — and there
          is no layering between them, so the noun is corrected. */}
      <h2
        id="developers-title"
        className={cx(styles['h2'], styles['h2Large'], styles['h2SpacedLarge'])}
      >
        Three steps, one integration path.
      </h2>

      <div className={styles['stepGrid']}>
        {LAYER_STEPS.map((step) => (
          <article key={step.num} className={styles['stepCard']}>
            <p className={styles['stepNum']}>{step.num}</p>
            <h3 className={styles['stepName']}>{step.name}</h3>
            <p className={styles['stepDesc']}>{step.desc}</p>
          </article>
        ))}
      </div>

      <div className={styles['splitGrid']}>
        <div className={styles['interfaceCard']}>
          <h3 className={styles['interfaceTitle']}>Integrate in one interface</h3>
          {/* Every clause here is checked by the proof harness. The old copy
              claimed a registry enforcing permissions, gas caps and lifecycle
              order; none of those three mechanisms exist. */}
          <p className={styles['interfaceBody']}>
            A Latch extends BaseCLHook and declares the callbacks it wants as a 16-bit bitmap. The
            same value is encoded in the pool key, and the pool manager checks the two agree when
            the pool is initialized — so permissions live in the key, not in the Latch&rsquo;s
            address.
          </p>
          <ul className={styles['factList']}>
            {INTERFACE_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
        <CodePanel />
      </div>
    </section>
  )
}

/** A7. Features grid — 38px icon tile above title and one-line description. */
export function Features() {
  return (
    <section className={styles['section']} aria-label="Protocol features">
      <div className={styles['featureGrid']}>
        {FEATURES.map((feature) => (
          <article key={feature.name}>
            <div className={styles['featureTile']} aria-hidden="true">
              <div className={styles['featureGlyph']} />
            </div>
            <h3 className={styles['featureName']}>{feature.name}</h3>
            <p className={styles['featureDesc']}>{feature.desc}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/** One chain tile: official mark (or monogram), name, chain id, deploy status. */
function ChainTile({ chain }: { chain: ChainRow }) {
  return (
    <li className={cx(styles['chainTile'], chain.deployed && styles['chainTileLive'])}>
      <ChainMark brand={chain.brand} size={40} className={styles['chainMark']} />
      <span className={styles['chainName']}>{chain.name}</span>
      <span className={cx(styles['chainId'], 'tabular')}>{chain.chainId}</span>
      <span className={cx(styles['chainBadge'], chain.deployed && styles['chainBadgeLive'])}>
        {chain.deployed ? 'DEPLOYED' : 'TARGET'}
      </span>
    </li>
  )
}

/**
 * A8. Chains — the eleven chains the SDK carries, each verified by running a
 * TSTORE probe against the live network. The grid is derived from
 * packages/sdk/src/chains/endpoints.ts, so it cannot drift from what the SDK
 * will actually connect to.
 */
export function Chains() {
  return (
    <section className={styles['section']} aria-labelledby="chains-title">
      <p className={styles['eyebrow']}>BUILT FOR EVERY CHAIN</p>
      <h2 id="chains-title" className={cx(styles['h2'], styles['h2Small'])}>
        Chain agnostic by design.
      </h2>
      <p className={styles['chainLede']}>
        {CHAIN_ROWS.length} target chains, every one confirmed to support EIP-1153 by executing a
        transient-storage probe against the live network — not read off a spec sheet. Latch
        contracts are live on Ethereum Sepolia only; the rest are targets, not deployments.
      </p>

      <h3 className={styles['chainGroup']} id="chains-mainnet">
        MAINNET <span className={styles['chainGroupCount']}>{MAINNET_CHAINS.length}</span>
      </h3>
      <ul className={styles['chainGrid']} aria-labelledby="chains-mainnet">
        {MAINNET_CHAINS.map((chain) => (
          <ChainTile key={chain.key} chain={chain} />
        ))}
      </ul>

      <h3 className={styles['chainGroup']} id="chains-testnet">
        TESTNET <span className={styles['chainGroupCount']}>{TESTNET_CHAINS.length}</span>
      </h3>
      <ul className={styles['chainGrid']} aria-labelledby="chains-testnet">
        {TESTNET_CHAINS.map((chain) => (
          <ChainTile key={chain.key} chain={chain} />
        ))}
      </ul>

      <div className={styles['deployPanel']}>
        <div className={styles['deployHead']}>
          <span className={styles['chainBadgeLive']}>DEPLOYED</span>
          <h3 className={styles['deployTitle']}>Live on Ethereum Sepolia</h3>
          <p className={styles['deployNote']}>
            Chain ID 11155111 · verified on Etherscan. No other chain carries Latch contracts yet.
          </p>
        </div>
        <ul className={styles['deployList']}>
          {SEPOLIA_CONTRACTS.map((contract) => {
            const href = explorerAddressUrl(SEPOLIA_CHAIN_ID, contract.address)
            return (
              <li key={contract.name} className={styles['deployRow']}>
                <span className={styles['deployName']}>{contract.name}</span>
                {href ? (
                  <a
                    className={styles['deployAddr']}
                    href={href}
                    rel="noreferrer noopener"
                    data-hit
                    aria-label={`${contract.name} on Sepolia Etherscan: ${contract.address}`}
                  >
                    {contract.address}
                  </a>
                ) : (
                  <span className={styles['deployAddr']}>{contract.address}</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

/** A9. Roadmap — the top rule and dot belong to each item, so wrapping is safe. */
export function Roadmap() {
  return (
    <section className={styles['section']} aria-labelledby="roadmap-title">
      <p className={styles['eyebrow']} id="roadmap-title">
        ROADMAP
      </p>
      <ol className={styles['roadmapGrid']}>
        {ROADMAP.map((item) => (
          <li key={item.when} className={styles['roadmapItem']}>
            <span className={styles['roadmapDot']} aria-hidden="true" />
            <p className={styles['roadmapWhen']}>{item.when}</p>
            <h3 className={styles['roadmapName']}>{item.name}</h3>
            <p className={styles['roadmapDesc']}>{item.desc}</p>
          </li>
        ))}
      </ol>
      <p className={styles['placeholderNote']}>INDICATIVE DATES · SUBJECT TO CHANGE</p>
    </section>
  )
}

/** A10. Team — headshots are striped placeholders until photography exists. */
export function Team() {
  return (
    <section
      id="about"
      className={cx(styles['section'], styles['reveal'])}
      aria-labelledby="team-title"
    >
      <p className={styles['eyebrow']}>TEAM</p>
      <h2 id="team-title" className={cx(styles['h2'], styles['h2Small'], styles['h2Spaced'])}>
        Built by protocol engineers.
      </h2>
      <div className={styles['teamGrid']}>
        {TEAM.map((member, i) => (
          <article key={`${member.role}-${i}`} className={styles['teamCard']}>
            <div className={styles['teamPhoto']}>
              {member.photo ? (
                <img src={member.photo} alt={`${member.name}, ${member.role}`} />
              ) : (
                <span className={styles['teamPhotoNote']}>DROP HEADSHOT</span>
              )}
            </div>
            <div className={styles['teamBody']}>
              <h3 className={styles['teamName']}>{member.name}</h3>
              <p className={styles['teamRole']}>{member.role}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/** A11. CTA panel — radial glow from the top, two buttons. */
export function CtaPanel() {
  return (
    <section id="launch" className={cx(styles['ctaSection'], styles['reveal'])}>
      <div className={styles['ctaPanel']}>
        <div className={styles['ctaGlow']} aria-hidden="true" />
        <h2 className={styles['ctaTitle']}>Ship your first Latch this week.</h2>
        <p className={styles['ctaBody']}>
          Read the integration guide, clone the starter latch, and deploy to testnet in a single
          afternoon.
        </p>
        <div className={styles['ctaActions']}>
          <Link to={LINKS.docs} className={cx(styles['btnPrimary'], styles['btnWide'])}>
            Read the Docs
          </Link>
          <a href={LINKS.github} className={cx(styles['btnSecondary'], styles['btnWide'])}>
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}

/**
 * Revenue share — how a cut of trading volume reaches LPs, beneficiaries or holders.
 *
 * Placed straight after the use cases because "donations and holder share" is one
 * of the four things Latch is sold on, and a visitor evaluating it will want the
 * mechanism, not the slogan. Each card names the actual mechanism so an integrator
 * can tell which one fits before reading a line of Solidity.
 */
export function RevenueShare() {
  return (
    <section
      id="revenue"
      className={cx(styles['section'], styles['reveal'], styles['delay2'])}
      aria-labelledby="revenue-title"
    >
      <p className={styles['eyebrow']}>REVENUE SHARE</p>
      <h2 id="revenue-title" className={cx(styles['h2'], styles['h2Large'])}>
        A Share Of Volume.
        <br />
        <span className={styles['accent']}>Paid Three Ways.</span>
      </h2>
      <p className={styles['sectionLead']}>
        Every route below is pull-based. Holder sets are unbounded and anyone can grow one, so
        iterating them on chain would put a permanent denial of service on the swap path.
      </p>
      <div className={styles['cardGrid']}>
        {SHARE_ROUTES.map((route) => (
          <article key={route.name} className={styles['useCase']}>
            <div className={styles['iconTile']} aria-hidden="true">
              <div className={styles['iconDiamond']} />
            </div>
            <h3 className={styles['useCaseName']}>{route.name}</h3>
            <p className={styles['useCaseTag']}>{route.mechanism}</p>
            <p className={styles['useCaseBody']}>{route.body}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ===========================================================================
   Oracles.

   The landing page had no oracle content at all, which was a real omission: a
   price band is the whole reason a tokenized equity can trade on an AMM without
   printing a price nobody would honour, and there are two shipping
   implementations behind it.

   Each card names its TRUST ASSUMPTION in its own column. That is the honest
   axis of comparison — both work, they differ in who you have to believe — and
   it is the thing a developer choosing between them actually needs.

   The ticker tiles are TYPOGRAPHIC on purpose. Chain marks on this site are
   official assets taken from each network's own brand kit (see
   public/chains/SOURCES.md). No such route exists for AAPL or TSLA: those are
   corporate trademarks, their owners publish no kit for this use, and pulling
   them off a logo aggregator would break both that rule and, more to the point,
   would be using someone's mark to market a protocol they have no relationship
   with. A ticker set in the design system's own mono face says the same thing
   and claims nothing.
   =========================================================================== */

export function Oracles() {
  return (
    <section
      id="oracles"
      className={cx(styles['section'], styles['reveal'], styles['delay2'])}
      aria-labelledby="oracles-title"
    >
      <p className={styles['eyebrow']}>PRICE ORACLES</p>
      <h2 id="oracles-title" className={cx(styles['h2'], styles['h2Large'])}>
        A Reference Price.
        <br />
        <span className={styles['accent']}>And Who You Trust For It.</span>
      </h2>
      <p className={styles['sectionLead']}>
        A price band asks one question on every swap: is this pool printing a price close enough
        to the outside world? Both answers below ship today, and they differ in exactly one way
        that matters &mdash; whose word you are taking.
      </p>

      <div className={styles['cardGrid']}>
        {ORACLES.map((o) => (
          <article key={o.contract} className={styles['useCase']}>
            <div className={styles['iconTile']} aria-hidden="true">
              <div className={styles['iconDiamond']} />
            </div>
            <h3 className={styles['useCaseName']}>{o.name}</h3>
            <p className={styles['useCaseTag']}>{o.kind}</p>
            <p className={styles['oracleTrust']}>
              <span className={styles['oracleTrustLabel']}>Trusts</span>
              <span className={styles['oracleTrustValue']}>{o.trust}</span>
            </p>
            <p className={styles['useCaseBody']}>{o.body}</p>
            <p className={styles['oracleStatus']}>
              <code>{o.contract}</code>
              <span>{o.status}</span>
            </p>
          </article>
        ))}
      </div>

      <div className={styles['marketGrid']}>
        {MARKET_KINDS.map((m) => (
          <div key={m.label} className={styles['marketCard']}>
            <p className={styles['marketLabel']}>{m.label}</p>
            <ul className={styles['tickerRow']}>
              {m.tickers.map((t, i) => (
                <li
                  key={t}
                  className={styles['tickerTile']}
                  /* Stagger index for the entry animation; collapsed by the
                     global prefers-reduced-motion block in tokens.css. */
                  style={{ '--i': i } as CSSProperties}
                >
                  {t}
                </li>
              ))}
            </ul>
            <p className={styles['marketNote']}>{m.note}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

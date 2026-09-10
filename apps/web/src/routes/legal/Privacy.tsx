import { Link } from 'react-router-dom'

import { GITHUB_URL } from '../landing/socials'
import { LegalShell, Section } from './LegalShell'
import styles from './legal.module.css'

/**
 * Privacy Policy — /privacy
 *
 * EVERY FACTUAL CLAIM ON THIS PAGE WAS CHECKED AGAINST THE CODE. Nothing here
 * is template boilerplate, and nothing should be added that has not been
 * verified the same way. What was checked, and where:
 *
 *   No cookies / no analytics / no telemetry
 *     `document.cookie`, `gtag`, `analytics`, `plausible`, `posthog`,
 *     `segment`, `sentry`, `mixpanel` and `fathom` return zero hits across
 *     src/ and index.html. index.html loads no third-party script tag at all;
 *     its only off-host references are the Google Fonts stylesheet and the
 *     preconnects for it.
 *
 *   No first-party backend
 *     The repo has an apps/api, but apps/web never calls it. The only fetches
 *     in the app are the three external hosts named in the table below, plus
 *     JSON-RPC. There is no login, no session, no account record.
 *
 *   Browser storage
 *     No `localStorage` / `sessionStorage` call exists in apps/web's own
 *     source. The writes come from the wallet layer: wagmi's `createConfig`
 *     defaults to `createStorage({ storage: localStorage })` with the key
 *     prefix `wagmi` (@wagmi/core createStorage.js), and RainbowKit keeps
 *     `rk-recent`, `rk-latest-id`, `rk-version` and `rk-transactions`.
 *
 *   Third parties
 *     src/lib/chain.ts        ethereum-sepolia-rpc.publicnode.com
 *     src/lib/prices.ts       api.coingecko.com, finnhub.io  (pool screen only)
 *     index.html              fonts.googleapis.com, fonts.gstatic.com
 *     packages/connect        wallet connectors; WalletConnect only when
 *                             VITE_WALLETCONNECT_PROJECT_ID is set
 *
 *   Scope of the wallet provider
 *     src/main.tsx wraps the WHOLE router in LatchWalletProvider, so the
 *     wallet layer is live on this page too — not only under /app.
 */
export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="LEGAL"
      title="Privacy Policy"
      lastUpdated="2026-09-10"
      otherHref="/terms"
      otherLabel="Read the Terms of Use"
      intro={
        <>
          Latch Protocol has no accounts, no login and no user database. This website sets no
          cookies of its own, runs no analytics and carries no tracking pixel. What it does do is
          make your browser talk to a handful of third parties — an RPC node, a font host, a
          price API, your wallet — and each of those sees your IP address. This page says exactly
          which, exactly when, and exactly what they can see.
        </>
      }
    >
      <Section id="scope" heading="1. What this policy covers">
        <p className={styles['p']}>
          It covers this website: the marketing pages, the documentation, and the app interface
          served under <span className={styles['code']}>/app</span>.
        </p>
        <p className={styles['p']}>It does not, and cannot, cover:</p>
        <ul className={styles['list']}>
          <li>
            <span className={styles['strong']}>The Latch Protocol smart contracts.</span> They are
            deployed on a public blockchain and run whether or not this website exists. Nobody
            operates them as a service, and nothing on chain is private.
          </li>
          <li>
            <span className={styles['strong']}>Third-party hooks.</span> A hook (a &ldquo;Latch&rdquo;)
            is a contract written and deployed by whoever wrote it. We do not control what it
            does with the data it sees.
          </li>
          <li>
            <span className={styles['strong']}>Your wallet</span> and whichever wallet provider,
            node provider or block explorer you use with it. Those have their own policies.
          </li>
        </ul>
      </Section>

      <Section id="not-collected" heading="2. What we do not do">
        <p className={styles['p']}>
          These are statements about the code that builds this site, and they are checkable —
          the source is public.
        </p>
        <ul className={styles['list']}>
          <li>
            <span className={styles['strong']}>No accounts.</span> There is no sign-up, no
            password, no email field, no profile. Nothing asks who you are.
          </li>
          <li>
            <span className={styles['strong']}>No analytics or telemetry.</span> No Google
            Analytics, no Plausible, no PostHog, no Segment, no Sentry, no advertising or
            attribution SDK. The site loads no third-party script tag at all.
          </li>
          <li>
            <span className={styles['strong']}>No cookies set by us.</span> This site never writes
            a cookie, so there is no cookie banner because there is nothing to consent to.
          </li>
          <li>
            <span className={styles['strong']}>No server of ours receives your activity.</span>{' '}
            The site is a static build. It makes no request to any Latch-operated backend,
            because there is not one behind this interface.
          </li>
          <li>
            <span className={styles['strong']}>No selling or sharing of personal data.</span> We
            hold none to sell.
          </li>
        </ul>
      </Section>

      <Section id="storage" heading="3. What is stored in your browser">
        <p className={styles['p']}>
          Nothing in this site&rsquo;s own code writes to browser storage. The wallet layer does,
          and it is loaded on every page — not only inside the app — because the wallet provider
          wraps the whole site so a connection survives navigation.
        </p>
        <p className={styles['p']}>
          When you connect a wallet, the underlying libraries (wagmi and RainbowKit) keep a small
          record in your browser&rsquo;s <span className={styles['code']}>localStorage</span> so
          that a page reload does not disconnect you: the wallet you last chose, the chain you
          selected, and connection state, under keys beginning{' '}
          <span className={styles['code']}>wagmi</span> and{' '}
          <span className={styles['code']}>rk-</span>. If WalletConnect is enabled on this
          deployment, its session data is stored the same way, under keys beginning{' '}
          <span className={styles['code']}>wc@2:</span>. The wallet you choose may add keys of its
          own — the Coinbase Wallet SDK, for instance, keeps its session under{' '}
          <span className={styles['code']}>cbwsdk.store</span>.
        </p>
        <p className={styles['p']}>
          That data stays on your device. It is not transmitted to us — we have nowhere to
          transmit it to — and clearing site data for this domain removes all of it. Disconnecting
          your wallet clears the connection record.
        </p>
      </Section>

      <Section id="third-parties" heading="4. Who your browser actually talks to">
        <p className={styles['p']}>
          Loading a page here causes requests to hosts we do not run. Each one necessarily sees
          your IP address and your user agent, because that is how HTTP works. Each has its own
          privacy policy, which governs what it then does.
        </p>
        <div className={styles['tableWrap']}>
          <table className={styles['table']}>
            <thead>
              <tr>
                <th scope="col">Third party</th>
                <th scope="col">When</th>
                <th scope="col">What it can see</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Google Fonts</th>
                <td>Every page</td>
                <td>
                  IP address, user agent, referring page. The site&rsquo;s typefaces are loaded
                  from <span className={styles['code']}>fonts.googleapis.com</span> and{' '}
                  <span className={styles['code']}>fonts.gstatic.com</span>.
                </td>
              </tr>
              <tr>
                <th scope="row">Public RPC node</th>
                <td>
                  Any page that reads chain data — the landing page and the app both do, on load
                </td>
                <td>
                  IP address, and the contents of every read. Once you connect a wallet and send
                  a transaction through this interface, the node also sees your wallet address
                  and the transaction itself. The endpoint is{' '}
                  <span className={styles['code']}>ethereum-sepolia-rpc.publicnode.com</span>.
                </td>
              </tr>
              <tr>
                <th scope="row">CoinGecko</th>
                <td>The pool screen in the app</td>
                <td>
                  IP address. Reference crypto quotes are fetched from{' '}
                  <span className={styles['code']}>api.coingecko.com</span>. The request carries
                  no wallet address.
                </td>
              </tr>
              <tr>
                <th scope="row">Finnhub</th>
                <td>
                  The pool screen in the app, and only if this deployment has an API key
                  configured
                </td>
                <td>
                  IP address. Reference equity quotes from{' '}
                  <span className={styles['code']}>finnhub.io</span>. Without a key the request is
                  never made and the interface says so.
                </td>
              </tr>
              <tr>
                <th scope="row">Your wallet and its provider</th>
                <td>Only once you choose to connect</td>
                <td>
                  Your wallet address, the site&rsquo;s identity, and whatever the wallet itself
                  transmits. A browser extension wallet may relay through its own infrastructure;
                  WalletConnect additionally routes an encrypted session through its relay
                  network, which sees your IP.
                </td>
              </tr>
              <tr>
                <th scope="row">Whoever hosts these files</th>
                <td>Every page</td>
                <td>
                  Standard web-server request logs — IP address, timestamp, requested path, user
                  agent — kept under that host&rsquo;s own retention policy. We add no analytics
                  layer on top.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles['p']}>
          If you would rather a given party not see your IP address, a VPN, a private RPC
          endpoint of your own, or a browser that blocks the request are all effective, and
          nothing here tries to detect or defeat them.
        </p>
      </Section>

      <Section id="wallet-addresses" heading="5. Wallet addresses, and why they are personal data">
        <p className={styles['p']}>
          A wallet address is pseudonymous, not anonymous. Under the GDPR, the UK GDPR and
          comparable regimes, a pseudonymous identifier is personal data as soon as it can
          reasonably be linked to a person — and addresses are linked to people all the time, by
          exchanges holding identity documents, by analytics firms, and by people who post their
          own address in public.
        </p>
        <p className={styles['p']}>
          We do not perform that linking, and we are not positioned to: there is no account to
          attach an address to, and no server-side record of who connected. When you connect a
          wallet, your address is read into the page in your browser so the interface can show
          your balances and build transactions. It is sent onward only to the RPC node and to the
          chain.
        </p>
      </Section>

      <Section id="on-chain" heading="6. On-chain data cannot be deleted — including by us">
        <p className={styles['p']}>
          This is the part of a dapp privacy policy that is most often written dishonestly, so it
          is stated plainly here.
        </p>
        <p className={styles['p']}>
          A transaction you submit is broadcast to a public blockchain. It is copied by every node
          on that network, indexed by explorers and analytics firms worldwide, and kept
          permanently. It is not ours, it is not held on our systems, and{' '}
          <span className={styles['strong']}>
            no one — not us, not you, not the protocol&rsquo;s governance — can delete, edit,
            recall or rectify it
          </span>
          . Any policy that promises erasure of on-chain data is making a promise it cannot keep.
        </p>
        <p className={styles['p']}>
          Consider that before you transact, particularly if you have linked the address to your
          identity elsewhere. On-chain activity is public by design; that is a property of the
          technology, not a setting we can change for you.
        </p>
      </Section>

      <Section id="rights" heading="7. Your rights">
        <p className={styles['p']}>
          To the extent the GDPR, the UK GDPR, the CCPA/CPRA or a similar law applies to you, you
          have rights of access, correction, deletion, portability and objection over personal
          data a controller holds about you.
        </p>
        <p className={styles['p']}>
          Applied here, the honest answer is that we hold essentially nothing for those rights to
          operate on. There is no profile, no account record, no analytics store and no
          server-side log under our control that is tied to you. Requests about the categories of
          data described above should therefore be directed to the party that actually holds them
          — the hosting provider, the RPC operator, the wallet provider, or the price API — and
          on-chain data is outside every one of their reach as well, for the reason in section 6.
        </p>
        <p className={styles['p']}>
          If you believe we hold personal data about you, ask. See section 10.
        </p>
      </Section>

      <Section id="children" heading="8. Children">
        <p className={styles['p']}>
          This site is not directed to children, and we do not knowingly collect data from anyone
          — which includes children, since we collect no personal data through this interface at
          all.
        </p>
      </Section>

      <Section id="changes" heading="9. Changes to this policy">
        <p className={styles['p']}>
          When this policy changes, the &ldquo;last updated&rdquo; date at the top changes with
          it, and the change is visible in the public commit history of the repository. Material
          changes will be described in the release notes rather than made quietly.
        </p>
      </Section>

      <Section id="contact" heading="10. Contact">
        <p className={styles['p']}>
          Questions, corrections and privacy requests can be raised in the open on the project
          repository:{' '}
          <a
            className={styles['link']}
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {GITHUB_URL.replace('https://', '')}
          </a>
          . A dedicated contact address will be published here before this draft is finalised.
        </p>
        <p className={styles['p']}>
          The risks of using the protocol itself, as opposed to the privacy of this website, are
          covered in the{' '}
          <Link className={styles['link']} to="/terms">
            Terms of Use
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  )
}

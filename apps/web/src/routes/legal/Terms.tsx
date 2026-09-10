import { Link } from 'react-router-dom'

import { GITHUB_URL } from '../landing/socials'
import { LegalShell, Section } from './LegalShell'
import styles from './legal.module.css'

/**
 * Terms of Use — /terms
 *
 * Checked against the repository, not against a template:
 *
 *   Licence            packages/core and packages/periphery are derivative
 *                      works of PancakeSwap Infinity and are GPL-2.0-or-later.
 *                      CLAUDE.md § Licensing calls this non-negotiable. The
 *                      warranty language in § 4 mirrors GPL-2.0 §§ 11-12
 *                      rather than paraphrasing it.
 *   Deployment         src/lib/chain.ts DEPLOYMENTS has exactly one entry:
 *                      Ethereum Sepolia (11155111). Every other target chain
 *                      is undeployed, and the dapp says so on its own surfaces.
 *   No custody         There is no backend and no key handling anywhere in
 *                      apps/web. Signing happens in the user's wallet.
 *   Latch risk         packages/core/src/libraries/Hooks.sol — a Latch runs
 *                      inside the swap path and a revert in a callback reverts
 *                      the whole swap; the docs page states the same.
 *   Registry           LatchHookRegistry at 0x665e…43DE lists Latches. Listing
 *                      is a write to a contract, not a review of the code.
 *   Fee mechanism      ProtocolFeeLibrary.MAX_PROTOCOL_FEE = 4000 pips of
 *                      1_000_000, i.e. a 0.4% ceiling, currently defaulting to
 *                      zero — so § 8 does not promise "no fees ever".
 */
export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="LEGAL"
      title="Terms of Use"
      lastUpdated="2026-09-10"
      otherHref="/privacy"
      otherLabel="Read the Privacy Policy"
      intro={
        <>
          Latch Protocol is open-source software published under the GNU General Public License,
          version 2 or later. It comes with no warranty of any kind. The contracts are
          permissionless and run on public blockchains whether or not this website exists; this
          website is one optional way to talk to them. Using either can cause you to lose all of
          the funds involved, and nobody can reverse that for you.
        </>
      }
    >
      <Section id="what-this-is" heading="1. What Latch Protocol is">
        <p className={styles['p']}>
          Latch Protocol is a set of smart contracts and a platform for Latches. A Latch is a hook
          contract that attaches programmable logic to a pool without forking the protocol
          underneath it.
        </p>
        <p className={styles['p']}>
          The contracts are deployed on public blockchains and are permissionless. Anyone can call
          them directly, from a script, a different frontend, or a wallet, with no permission from
          us and no ability by us to stop them. At the time of writing the protocol is deployed on{' '}
          <span className={styles['strong']}>Ethereum Sepolia, a test network</span>, and nowhere
          else. Test networks carry no monetary value and can be reset or discontinued by their
          operators.
        </p>
      </Section>

      <Section id="not-the-protocol" heading="2. This website is not the protocol">
        <p className={styles['p']}>
          Everything on this site is an interface. It reads public chain data and helps you
          construct transactions that your own wallet signs and submits.
        </p>
        <ul className={styles['list']}>
          <li>
            If this website is taken down, changed, broken or blocked, the contracts keep running.
            Your positions are on chain, not here.
          </li>
          <li>
            We may modify, restrict or discontinue this interface at any time, for any reason,
            without notice. That is a decision about a website; it is not a decision about your
            funds, which we could not make.
          </li>
          <li>
            Nothing shown here can change what has already happened on chain. Figures displayed
            may be stale, cached, mislabelled or simply wrong; the chain is authoritative, this
            page is not.
          </li>
        </ul>
      </Section>

      <Section id="no-custody" heading="3. We never take custody of your funds">
        <p className={styles['p']}>
          There is no account, no deposit and no balance held on our side. You keep your assets in
          your own wallet, and you sign every transaction yourself.
        </p>
        <ul className={styles['list']}>
          <li>
            We never ask for, receive, store or transmit a private key, a seed phrase or a
            keystore file. Anyone who does — including anyone claiming to be Latch support — is
            trying to rob you.
          </li>
          <li>
            We cannot recover a lost key, reverse a transaction, unstick a stuck one, freeze an
            address, or refund a mistake. Not as a policy choice: the ability does not exist.
          </li>
          <li>
            Sending assets to the wrong address, approving a malicious contract, or signing a
            payload you did not read are all irreversible and are your responsibility.
          </li>
        </ul>
      </Section>

      <Section id="no-warranty" heading="4. No warranty">
        <p className={styles['p']}>
          The software is licensed under the GPL, and the GPL&rsquo;s own disclaimer governs. It
          reads, in substance:
        </p>
        <div className={styles['callout']}>
          <p>
            BECAUSE THE PROGRAM IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY FOR THE PROGRAM,
            TO THE EXTENT PERMITTED BY APPLICABLE LAW. THE PROGRAM IS PROVIDED &ldquo;AS IS&rdquo;
            WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED
            TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
            THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM IS WITH YOU. SHOULD
            THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL NECESSARY SERVICING, REPAIR OR
            CORRECTION.
          </p>
          <p>
            IN NO EVENT WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR
            REDISTRIBUTE THE PROGRAM, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY GENERAL,
            SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR INABILITY TO
            USE THE PROGRAM.
          </p>
        </div>
        <p className={styles['p']}>
          The same applies to this website, which is provided as is and with no guarantee of
          availability, accuracy or fitness for any purpose. To the maximum extent permitted by
          law, the contributors and operators are not liable for any loss arising from your use of
          the protocol or this interface. Some jurisdictions do not allow certain exclusions; where
          that is so, the exclusions apply only as far as that jurisdiction permits.
        </p>
      </Section>

      <Section id="latches" heading="5. Latches are third-party code — evaluate them yourself">
        <p className={styles['p']}>
          The point of the platform is that other people write the Latches. Except where a Latch is
          explicitly published by the Latch team, a Latch is code written, deployed and controlled
          by a third party we have no relationship with.
        </p>
        <ul className={styles['list']}>
          <li>
            A Latch runs <span className={styles['strong']}>inside the swap path</span>. It can
            charge fees, alter the price you get, restrict who may trade, or revert your
            transaction outright — a revert in one of its callbacks reverts the whole swap.
          </li>
          <li>
            A Latch can be upgradeable, or have an admin key. Behaviour that is benign today can
            change tomorrow without warning.
          </li>
          <li>
            The on-chain registry lists Latches. A listing is a write to a public contract that
            anyone can make.{' '}
            <span className={styles['strong']}>
              It is not an audit, a review, a recommendation or an endorsement
            </span>
            , and neither is appearance anywhere in this interface.
          </li>
          <li>
            Any &ldquo;audited&rdquo; label, link or badge shown against a Latch is metadata
            supplied by whoever listed it. Read the audit yourself and check that it covers the
            deployed bytecode.
          </li>
        </ul>
        <p className={styles['p']}>
          Read the source before you put funds behind a Latch. If you cannot read it, treat that as
          the answer.
        </p>
      </Section>

      <Section id="risk" heading="6. Smart-contract risk and total loss">
        <p className={styles['p']}>
          Interacting with any decentralised protocol can result in the total, permanent loss of
          everything you commit. The realistic causes include, and are not limited to:
        </p>
        <ul className={styles['list']}>
          <li>Bugs in the protocol contracts, in a Latch, in a router, or in a dependency.</li>
          <li>
            Economic attacks — flash loans, price and oracle manipulation, sandwiching and other
            MEV extraction around your transaction.
          </li>
          <li>
            Impermanent loss and adverse price movement while you provide liquidity, which can
            leave you worse off than simply holding.
          </li>
          <li>
            Compromise or abuse of a privileged key — a Latch admin, a fee controller, a protocol
            owner — including by governance acting against your interest.
          </li>
          <li>
            Failures below the protocol: chain reorganisations, halted or congested networks,
            bridge failures, RPC outages, wallet bugs, and phishing.
          </li>
        </ul>
        <p className={styles['p']}>
          An audit reduces risk; it does not remove it, and an unaudited contract is not merely
          slightly worse. Commit only what you can afford to lose entirely.
        </p>
      </Section>

      <Section id="no-advice" heading="7. Nothing here is advice">
        <p className={styles['p']}>
          Nothing on this website or in the documentation is financial, investment, trading, legal,
          accounting or tax advice, an offer or solicitation to buy or sell anything, or a
          recommendation of any asset, pool or strategy. No fiduciary or advisory relationship is
          created by your use of it.
        </p>
        <p className={styles['p']}>
          Figures shown are labelled where they are placeholders and where they are read live from
          chain. Even live figures should be verified independently before you act on them.
        </p>
      </Section>

      <Section id="compliance" heading="8. Your own legal and tax compliance">
        <p className={styles['p']}>
          Rules for decentralised finance differ by country and change often. You alone are
          responsible for determining whether your use of the protocol and this interface is
          lawful where you live and where you are at the time, and for obtaining your own advice.
        </p>
        <ul className={styles['list']}>
          <li>
            Do not use this interface if doing so would breach a law, regulation or sanctions
            regime that applies to you, or if you are subject to sanctions yourself.
          </li>
          <li>
            You are responsible for reporting and paying any tax arising from your activity. We
            produce no tax statements and hold no records from which any could be produced.
          </li>
          <li>
            If you deploy a Latch, you are responsible for it — its correctness, its licensing, and
            the obligations you take on toward anyone who uses it.
          </li>
        </ul>
        <p className={styles['p']}>
          The protocol contains a protocol-fee mechanism, capped at 0.4% and currently set to
          zero. Any fee that applies to a given pool is set on chain and is visible on chain;
          check it there rather than relying on this page.
        </p>
      </Section>

      <Section id="acceptable-use" heading="9. Acceptable use of this interface">
        <p className={styles['p']}>
          You may read, fork, modify and self-host this software under the GPL. What you may not
          do is use <span className={styles['strong']}>this deployment of the interface</span> to
          attack it or the people using it: no attempts to gain unauthorised access, no
          interference with its availability, no automated abuse of the third-party endpoints it
          depends on, and no use of Latch branding to pass something off as official when it is
          not.
        </p>
      </Section>

      <Section id="licence" heading="10. Licence, and what these terms do not restrict">
        <p className={styles['p']}>
          The Latch Protocol contracts are distributed under the{' '}
          <span className={styles['strong']}>GNU General Public License, version 2 or later</span>.
          Your rights in the software — to run, study, modify and redistribute it — come from that
          licence, not from this page.
        </p>
        <p className={styles['p']}>
          Nothing in these terms limits, overrides or adds conditions to your rights under the
          GPL. Where this page and the licence disagree about the software,{' '}
          <span className={styles['strong']}>the licence wins</span>. These terms govern only your
          use of this hosted website. Latch name and logo usage is covered separately by the{' '}
          <Link className={styles['link']} to="/brand">
            brand kit
          </Link>
          .
        </p>
      </Section>

      <Section id="changes" heading="11. Changes to these terms">
        <p className={styles['p']}>
          These terms may change. The &ldquo;last updated&rdquo; date at the top will change with
          them, and the full history is public in the repository. Continuing to use the interface
          after a change means you accept the revised terms; if you do not, stop using this
          website — the contracts remain reachable without it.
        </p>
      </Section>

      <Section id="contact" heading="12. Contact">
        <p className={styles['p']}>
          Questions and corrections can be raised in the open on the project repository:{' '}
          <a
            className={styles['link']}
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            {GITHUB_URL.replace('https://', '')}
          </a>
          . How this website handles data is described in the{' '}
          <Link className={styles['link']} to="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  )
}

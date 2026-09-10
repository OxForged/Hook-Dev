import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import CodeBlock from './CodeBlock'
import DocsFooter from './DocsFooter'
import DocsHeader from './DocsHeader'
import LeftRail from './LeftRail'
import { FeeChart } from '../../charts/FeeChart'
import { GasChart } from '../../charts/GasChart'
import {
  BITMAP_SHELL,
  CALLBACKS,
  DEPLOY_SHELL,
  ERRORS,
  FACTS,
  FEE_LATCH_SOL,
  INSTALL_SHELL,
  LIFECYCLE,
  REGISTER_SHELL,
  REGISTER_STEPS,
  REGISTRY_ADDRESS_SEPOLIA,
  REGISTRY_REJECTIONS,
  SECTION_IDS,
  SURFACES,
  TOC,
} from './content'
import { useMediaQuery, useScrollSpy } from './hooks'
import './docs.css'

/**
 * Inline CSS custom properties. `CSSProperties` has no index signature, so the
 * assertion is the standard escape hatch for `--d` / `--i`.
 */
const vars = (v: Record<string, string | number>) => v as CSSProperties

/**
 * Latch Protocol developer docs / quickstart.
 *
 * Built to `latch design/SCREENS.md` § B and `latch design/README.md`
 * § "2. Docs / developer quickstart"; visually diffed against
 * `design-references/Latch Docs.dc.html`. The README is authoritative where the
 * two disagree — see docs.css for the specific calls.
 *
 * Every colour, radius, shadow and font comes from src/styles/tokens.css.
 */
export default function DocsPage() {
  const [railOpen, setRailOpen] = useState(false)
  const isDrawer = useMediaQuery('(max-width: 1023.98px)')
  const activeId = useScrollSpy(SECTION_IDS)

  const closeRail = useCallback(() => setRailOpen(false), [])
  const toggleRail = useCallback(() => setRailOpen((v) => !v), [])

  const activeLabel = useMemo(
    () => TOC.find((t) => t.href === `#${activeId}`)?.label ?? 'Quickstart',
    [activeId],
  )

  return (
    <div className="dk">
      <a className="dk-skip" href="#main">
        Skip to content
      </a>

      <DocsHeader activeLabel={activeLabel} railOpen={railOpen} onToggleRail={toggleRail} />

      <div className="dk-shell">
        <LeftRail
          activeId={activeId}
          isDrawer={isDrawer}
          open={railOpen}
          onClose={closeRail}
        />

        <main className="dk-main" id="main">
          {/* ---------------------------------------------------- B3. Intro */}
          <section id="quickstart" className="dk-intro dk-reveal" style={vars({ '--d': '0s' })}>
            <p className="dk-eyebrow">DEVELOPER QUICKSTART</p>
            <h1 className="dk-h1">Ship your first Latch.</h1>
            <p className="dk-lead">
              A Latch is a hook contract attached to a pool. It extends{' '}
              <code className="dk-icode">BaseCLHook</code>,
              declares the callbacks it wants from{' '}
              <code className="dk-icode">getHooksRegistrationBitmap()</code>, and the pool key
              carries that same bitmap in its <code className="dk-icode">parameters</code>. Core
              cross-checks the two when the pool is initialized. Permissions live in the pool key,
              not in the Latch&rsquo;s address, so there is no CREATE2 salt to mine and the same
              Latch works from any address. This page takes you from an empty directory to a Latch
              deployed on Sepolia and listed in the Latch Marketplace.
            </p>
            <dl className="dk-facts">
              {FACTS.map((f) => (
                <div className="dk-facts__cell" key={f.label}>
                  <dt className="dk-facts__label">{f.label}</dt>
                  <dd className="dk-facts__value">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ----------------------------------------------- B4. 1 · Install */}
          <section id="install" className="dk-section dk-reveal" style={vars({ '--d': '0.03s' })}>
            <h2 className="dk-h2">1 · Install</h2>
            <p className="dk-body">
              The generator writes the Latch, an end-to-end test against a real{' '}
              <code className="dk-icode">Vault</code> and{' '}
              <code className="dk-icode">CLPoolManager</code>, and a deploy script. There is no{' '}
              <code className="dk-icode">forge install</code> step: the generated{' '}
              <code className="dk-icode">foundry.toml</code> remaps{' '}
              <code className="dk-icode">infinity-core/</code> and{' '}
              <code className="dk-icode">latch-hooks/</code> onto the packages it found, pinned per
              build profile, so <code className="dk-icode">forge build</code> resolves core with no
              submodule.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={INSTALL_SHELL}
              copyLabel="Copy install commands"
            />
          </section>

          {/* ---------------------------------------- B5. 2 · Write the latch */}
          <section id="write" className="dk-section dk-reveal" style={vars({ '--d': '0.06s' })}>
            <h2 className="dk-h2">2 · Write the latch</h2>
            <p className="dk-body">
              Extend <code className="dk-icode">BaseCLHook</code> and return the callbacks you want
              from <code className="dk-icode">getHooksRegistrationBitmap()</code>, then override
              only those. Every callback is <code className="dk-icode">onlyPoolManager</code>, and
              the ones you leave alone revert with{' '}
              <code className="dk-icode">HookNotImplemented</code> &mdash; so a permission you
              declare but forget to write fails loudly instead of silently.
            </p>
            <CodeBlock
              filename="src/FeeLatch.sol"
              dot="source"
              source={FEE_LATCH_SOL}
              copyLabel="Copy FeeLatch.sol"
            />
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                A fee returned from <code className="dk-icode dk-icode--sm">beforeSwap</code> is
                applied <strong>only on a dynamic-fee pool</strong> &mdash; one whose{' '}
                <code className="dk-icode dk-icode--sm">fee</code> field is exactly{' '}
                <code className="dk-icode dk-icode--sm">0x800000</code> &mdash; and only when you
                set <code className="dk-icode dk-icode--sm">OVERRIDE_FEE_FLAG</code> on it. On a
                static-fee pool core discards it with no revert and no event, so the Latch looks
                like it is working and is not. Reject the wrong pool in{' '}
                <code className="dk-icode dk-icode--sm">beforeInitialize</code> if it matters.
              </p>
            </div>
          </section>

          {/* ---------------------------------- B6. 3 · Encode and deploy */}
          <section id="deploy" className="dk-section dk-reveal" style={vars({ '--d': '0.09s' })}>
            <h2 className="dk-h2">3 · Encode and deploy</h2>
            <p className="dk-body">
              Your Latch&rsquo;s bitmap and the pool key&rsquo;s bitmap must be the same number.{' '}
              <code className="dk-icode">latch bitmap</code> prints both: the{' '}
              <code className="dk-icode">uint16</code> your Latch returns, and the{' '}
              <code className="dk-icode">parameters</code> word that carries it alongside the tick
              spacing.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={BITMAP_SHELL}
              copyLabel="Copy the bitmap command"
            />
            <p className="dk-body dk-body--after">
              Then run the generated tests and the deploy script. Latch is live on Sepolia; the
              script reads <code className="dk-icode">PRIVATE_KEY</code> and{' '}
              <code className="dk-icode">CL_POOL_MANAGER</code> from your environment, and prints
              the <code className="dk-icode">parameters</code> word to use in your{' '}
              <code className="dk-icode">PoolKey</code>.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={DEPLOY_SHELL}
              copyLabel="Copy the deploy commands"
            />
          </section>

          {/* ------------------------------------- 4 · Register the latch */}
          <section id="register" className="dk-section dk-reveal" style={vars({ '--d': '0.1s' })}>
            <h2 className="dk-h2">4 · Register the Latch</h2>
            <p className="dk-body">
              The Latch Marketplace at <Link to="/app/marketplace">/app/marketplace</Link> is a
              view over one contract: the <code className="dk-icode">LatchHookRegistry</code> at{' '}
              <code className="dk-icode dk-icode--addr">{REGISTRY_ADDRESS_SEPOLIA}</code> on
              Sepolia.
              Registration is <strong>permissionless, free beyond gas, and has no allowlist</strong>
              : anyone may list any deployed contract that answers{' '}
              <code className="dk-icode">getHooksRegistrationBitmap()</code>. The permissions
              recorded are read off the Latch itself by the registry &mdash; there is no parameter
              through which a submitter can declare, suggest or influence them &mdash; and the
              name, description and links you supply are stored as descriptive text only. Every
              listing enters as <strong>Unverified &middot; Active</strong>; only a curator moves
              it up the verification ladder, and a steward edit to the metadata drops it straight
              back to Unverified.
            </p>
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                <strong>Registration is irreversible.</strong> The registry has no{' '}
                <code className="dk-icode dk-icode--sm">unregister</code>, and no role can erase a
                record &mdash; by design, so a warning about a harmful Latch can never be deleted
                out from under the people already in its pool. Register the address you mean to
                keep. Afterwards the steward can still call{' '}
                <code className="dk-icode dk-icode--sm">updateMetadata</code> and{' '}
                <code className="dk-icode dk-icode--sm">transferSteward</code>; the listing status
                itself is changed only by a curator or guardian.
              </p>
            </div>
            <p className="dk-body dk-body--after">
              In the app, <Link to="/app/deploy">/app/deploy</Link> walks the same call the
              contract makes, one RPC read per line, and refuses to ask for a signature until an{' '}
              <code className="dk-icode">eth_call</code> of <code className="dk-icode">register</code>{' '}
              has succeeded at the current block.
            </p>
            <ol className="dk-steps">
              {REGISTER_STEPS.map((l, i) => (
                <li
                  className="dk-step dk-stagger dk-stagger--slow"
                  key={l.step}
                  style={vars({ '--i': i })}
                >
                  <span className="dk-step__num">{l.step}</span>
                  <span className="dk-step__name">{l.name}</span>
                  <span className="dk-step__note">{l.note}</span>
                </li>
              ))}
            </ol>
            <p className="dk-body dk-body--after">
              From a script, it is one <code className="dk-icode">cast send</code>. The struct is{' '}
              <code className="dk-icode">HookMetadata</code>; only{' '}
              <code className="dk-icode">name</code> is required, and{' '}
              <code className="dk-icode">chainIds</code> is an informational list of where you say
              the Latch is deployed.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={REGISTER_SHELL}
              copyLabel="Copy the register commands"
            />
            <p className="dk-body dk-body--after">
              <code className="dk-icode">register</code> reverts for exactly these reasons, checked
              in this order. The app decodes each one by name during pre-flight; from a script you
              will see the raw custom error.
            </p>
            <dl className="dk-errors">
              {REGISTRY_REJECTIONS.map((e, i) => (
                <div className="dk-errors__row dk-stagger" key={e.code} style={vars({ '--i': i })}>
                  <dt className="dk-errors__code">{e.code}</dt>
                  <dd className="dk-errors__fix">{e.fix}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ------------------------------------- Verification permalink */}
          <section id="verify" className="dk-section dk-reveal" style={vars({ '--d': '0.11s' })}>
            <h2 className="dk-h2">Verification permalink</h2>
            <p className="dk-body">
              Every address has a public page at{' '}
              <code className="dk-icode">/verify/&lt;address&gt;</code>, built to be linked from
              your own site or README. It needs <strong>no wallet and no account</strong>, carries
              none of the app&rsquo;s chrome, and reads the registry live on every load &mdash;
              the block it was read at is printed at the bottom. A stranger who opens it sees the
              on-chain trust signals for that one address: verification level, capability class
              derived from the bitmap by a <code className="dk-icode">pure</code> function on
              chain, listing status, the bitmap itself and the callbacks it declares, then &mdash;
              clearly marked as submitter-supplied and unverified &mdash; the name, description,
              source and audit links you wrote.
            </p>
            <p className="dk-body">
              It is built to be impossible to misread. An address the registry has never seen
              renders as <strong>NOT REGISTERED</strong> in different components from a listed
              Latch, never as a record full of zeros; an unreachable RPC renders as no verdict at
              all rather than as a clean result; and any warning &mdash; flagged malicious, a
              bitmap the registry can no longer read, a value-extracting capability &mdash; sits
              above everything the submitter wrote. Link it once your listing is in; the same
              page is what the Marketplace&rsquo;s per-Latch view at{' '}
              <code className="dk-icode">/app/marketplace/:address</code> offers as &ldquo;share
              with someone who has no wallet&rdquo;.
            </p>
            <div className="dk-tablewrap">
              <table className="dk-table">
                <colgroup>
                  <col className="dk-table__c1" />
                  <col className="dk-table__c2" />
                  <col className="dk-table__c3" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">ROUTE</th>
                    <th scope="col">WALLET</th>
                    <th scope="col">WHAT IT DOES</th>
                  </tr>
                </thead>
                <tbody>
                  {SURFACES.map((s, i) => (
                    <tr key={s.route} className="dk-stagger" style={vars({ '--i': i })}>
                      <th scope="row" className="dk-table__name">
                        {s.route}
                      </th>
                      <td className="dk-table__bit">{s.wallet}</td>
                      <td className="dk-table__ret">{s.reads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dk-body dk-body--after">
              The wallet layer behind <code className="dk-icode">/app/deploy</code> is{' '}
              <code className="dk-icode">@latchprotocol/connect</code>, an MIT-licensed wrapper
              over RainbowKit and wagmi. The app offers <strong>Ethereum Sepolia only</strong>,
              because it is the only chain with a deployment; nothing on the read surfaces above
              asks you to connect.
            </p>
          </section>

          {/* -------------------------------------------- B7. Callback ref */}
          <section id="interface" className="dk-section dk-reveal" style={vars({ '--d': '0.12s' })}>
            <h2 className="dk-h2">Callback reference</h2>
            <p className="dk-body">
              Ten callbacks and four modifiers, each a bit in the permission bitmap. The four{' '}
              <code className="dk-icode">*ReturnsDelta</code> bits are not callbacks: each
              authorises the delta its base callback returns, and core rejects one declared
              without that callback. Every callback also receives a{' '}
              <code className="dk-icode">sender</code>, which is the Vault locker &mdash; the
              router &mdash; and <strong>not the end user</strong>, so per-wallet logic keyed on it
              is broken by construction.
            </p>
            <div className="dk-tablewrap">
              <table className="dk-table">
                <colgroup>
                  <col className="dk-table__c1" />
                  <col className="dk-table__c2" />
                  <col className="dk-table__c3" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">CALLBACK</th>
                    <th scope="col">BIT</th>
                    <th scope="col">RETURNS</th>
                  </tr>
                </thead>
                <tbody>
                  {CALLBACKS.map((c, i) => (
                    <tr key={c.name} className="dk-stagger" style={vars({ '--i': i })}>
                      <th scope="row" className="dk-table__name">
                        {c.name}
                      </th>
                      <td className="dk-table__bit">{c.bit}</td>
                      <td className="dk-table__ret">{c.returns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ------------------------------------------ B8. Execution order */}
          <section id="lifecycle" className="dk-section dk-reveal" style={vars({ '--d': '0.15s' })}>
            <h2 className="dk-h2">Execution order</h2>
            <p className="dk-body dk-body--wide">
              A pool key names one Latch, and core calls only the callbacks its bitmap declares.
              There is no isolation: a callback that reverts reverts the whole swap, so be
              deliberate about which conditions revert.
            </p>
            <ol className="dk-steps">
              {LIFECYCLE.map((l, i) => (
                <li
                  className="dk-step dk-stagger dk-stagger--slow"
                  key={l.step}
                  style={vars({ '--i': i })}
                >
                  <span className="dk-step__num">{l.step}</span>
                  <span className="dk-step__name">{l.name}</span>
                  <span className="dk-step__note">{l.note}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* -------------------------------------------- B9. Common errors */}
          <section id="errors" className="dk-section dk-reveal" style={vars({ '--d': '0.18s' })}>
            <h2 className="dk-h2">Common errors</h2>
            <dl className="dk-errors">
              {ERRORS.map((e, i) => (
                <div className="dk-errors__row dk-stagger" key={e.code} style={vars({ '--i': i })}>
                  <dt className="dk-errors__code">{e.code}</dt>
                  <dd className="dk-errors__fix">{e.fix}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ------------------------------------------- B9b. Measured facts

              Two charts, both plotting numbers that can be checked rather than
              taken on trust:

                FeeChart  ports `ProtocolFeeLibrary.calculateSwapFee` exactly,
                          truncation included, so the composed rate it shows is
                          the rate core charges.
                GasChart  plots gas measured by `forge test` under each build
                          profile. Reproduce it with:
                            forge test --match-path test/transient/TransientBackendSafety.t.sol
                            FOUNDRY_PROFILE=legacy forge test --match-path ...
                          Both columns were re-verified on 2026-09-10 and every
                          shanghai figure still matches to the gas unit.

              This kit sat orphaned after the invented activity charts were
              removed; it was never invented data, only unmounted. */}
          <section id="costs" className="dk-section dk-reveal" style={vars({ '--d': '0.19s' })}>
            <h2 className="dk-h2">What it costs</h2>
            <p className="dk-body">
              Two numbers a Latch author has to reason about: the fee your pool ends up charging
              once the protocol fee composes with your LP fee, and what the settlement layer costs
              on a chain without EIP-1153. Neither is an estimate &mdash; the first is a port of the
              library core actually calls, the second is measured by the test suite.
            </p>
            <FeeChart />
            <GasChart />
          </section>

          {/* --------------------------------------------- B10. Next panel */}
          <section id="next" className="dk-section dk-reveal" style={vars({ '--d': '0.2s' })}>
            <div className="dk-next">
              <span className="dk-next__glow" aria-hidden="true" />
              <h2 className="dk-next__title">Next: initialize a pool</h2>
              <p className="dk-next__body">
                A pool opts into your Latch by naming it in the pool key. Use the{' '}
                <code className="dk-icode dk-icode--sm">parameters</code> word the deploy script
                printed, verbatim — any other value makes{' '}
                <code className="dk-icode dk-icode--sm">initialize</code> revert with{' '}
                <code className="dk-icode dk-icode--sm">HookConfigValidationError</code>.
              </p>
              <div className="dk-next__actions">
                <Link to="/app" className="dk-btn dk-btn--primary">
                  Open the app →
                </Link>
                <Link to="/app/marketplace" className="dk-btn dk-btn--ghost">
                  Browse the Latch Marketplace
                </Link>
                <a href="#quickstart" className="dk-btn dk-btn--ghost">
                  Back to quickstart
                </a>
              </div>
            </div>
          </section>
        </main>
      </div>

      <DocsFooter />
    </div>
  )
}

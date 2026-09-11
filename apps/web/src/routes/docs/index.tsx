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
  CHAINS,
  CHAINS_TS,
  CHAIN_COUNTS,
  DEPLOY_SHELL,
  ERRORS,
  FACTS,
  FEE_LATCH_SOL,
  INSTALL_SHELL,
  KEEPER_JOBS,
  KEEPER_SHELL,
  LIFECYCLE,
  PYTH_REJECTIONS,
  PYTH_SEPOLIA,
  PYTH_SEPOLIA_STALENESS,
  PYTH_SHELL,
  REGISTER_SHELL,
  REGISTER_STEPS,
  REGISTRY_ADDRESS_SEPOLIA,
  REGISTRY_REJECTIONS,
  REVSHARE_EXERCISE_HOOK_SEPOLIA,
  REVSHARE_READS,
  REVSHARE_READS_SHELL,
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
              view over one contract: the <code className="dk-icode">LatchRegistry</code> at{' '}
              <code className="dk-icode dk-icode--addr">{REGISTRY_ADDRESS_SEPOLIA}</code> on
              Sepolia, redeployed on 2026-09-10 under that name &mdash; it answers{' '}
              <code className="dk-icode">latchCount()</code>, and the retired{' '}
              <code className="dk-icode">LatchHookRegistry</code> before it is no longer read by
              anything.
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
              <code className="dk-icode">LatchMetadata</code>; only{' '}
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

          {/* ------------------------------------------ Revenue share reads

              RevShareHook indexes by PoolId and writes by PoolKey. The three
              views documented here (keyOf, hasKey, totalTaken) close that gap
              and the "what has this pool earned" gap. Everything below is read
              off packages/hooks-revshare/src/RevShareHook.sol; the deployment
              caveat was probed, not assumed — see REVSHARE_READS in content.ts. */}
          <section id="revshare" className="dk-section dk-reveal" style={vars({ '--d': '0.19s' })}>
            <h2 className="dk-h2">Revenue share: the reads an integrator needs</h2>
            <p className="dk-body">
              <code className="dk-icode">RevShareHook</code> indexes everything by{' '}
              <code className="dk-icode">PoolId</code>, and a pool id is{' '}
              <code className="dk-icode">keccak256(abi.encode(key))</code> &mdash; a hash, which
              nothing can invert. Every write on the contract takes the full{' '}
              <code className="dk-icode">PoolKey</code>:{' '}
              <code className="dk-icode">settleBeneficiaries</code>,{' '}
              <code className="dk-icode">proposeConfig</code>,{' '}
              <code className="dk-icode">applyPendingConfig</code>,{' '}
              <code className="dk-icode">setBeneficiaries</code>,{' '}
              <code className="dk-icode">transferPoolOwnership</code>,{' '}
              <code className="dk-icode">pullDistributorShare</code>. So anything that held only
              an id &mdash; a URL, an indexer row, a distributor &mdash; could not build a
              transaction at all, and had to reconstruct the key from the pool manager&rsquo;s{' '}
              <code className="dk-icode">Initialize</code> log. That is the difference between
              &ldquo;you need an indexer&rdquo; and &ldquo;you need one{' '}
              <code className="dk-icode">eth_call</code>&rdquo;, and{' '}
              <code className="dk-icode">keyOf(poolId)</code> is the <code className="dk-icode">eth_call</code>.
              The hook stores the key once, when <code className="dk-icode">configure</code> first
              claims the pool, and only after <code className="dk-icode">_validateKey</code> has
              confirmed it hashes to that id and names this hook &mdash; so what comes back is the
              real key, not a caller&rsquo;s assertion about one.
            </p>
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                <code className="dk-icode dk-icode--sm">keyOf</code> returns a zeroed struct for a
                pool this hook never governed. Ask{' '}
                <code className="dk-icode dk-icode--sm">hasKey(poolId)</code> first, or check{' '}
                <code className="dk-icode dk-icode--sm">key.hooks == hook</code> &mdash; which is
                exactly what <code className="dk-icode dk-icode--sm">hasKey</code> does.
              </p>
            </div>
            <p className="dk-body dk-body--after">
              The second gap is &ldquo;what has this pool earned&rdquo;.{' '}
              <code className="dk-icode">pendingBeneficiary</code> and{' '}
              <code className="dk-icode">pendingDistributor</code> are <strong>balances</strong>:
              the first drops when <code className="dk-icode">settleBeneficiaries</code> splits it
              across the roster, the second goes to zero when the distributor pulls. Neither can
              answer a lifetime question, and until now the only route was summing{' '}
              <code className="dk-icode">RevShareTaken</code> logs &mdash; bounded by however far
              back your RPC serves them, and silently shrinking as logs age out: an approximation
              presented as a total. <code className="dk-icode">totalTaken(poolId, currency)</code>{' '}
              is a cumulative counter incremented in <code className="dk-icode">afterSwap</code>{' '}
              in the same breath as the event, summing all three routes &mdash; the LP donation is
              included because it is revenue the pool took, it simply went straight back to
              liquidity. One <code className="dk-icode">SSTORE</code> per fee-taking swap, per
              currency, for a figure anyone can verify in a single call.
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
                    <th scope="col">FUNCTION</th>
                    <th scope="col">RETURNS</th>
                    <th scope="col">WHAT IT ANSWERS</th>
                  </tr>
                </thead>
                <tbody>
                  {REVSHARE_READS.map((r, i) => (
                    <tr key={r.name} className="dk-stagger" style={vars({ '--i': i })}>
                      <th scope="row" className="dk-table__name">
                        {r.name}
                      </th>
                      <td className="dk-table__bit">{r.returns}</td>
                      <td className="dk-table__ret">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={REVSHARE_READS_SHELL}
              copyLabel="Copy the revenue share read commands"
            />
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                <strong>Deployment status.</strong> These three views are in the package source and
                on any hook deployed from it since. The Sepolia exercise hook at{' '}
                <code className="dk-icode dk-icode--sm dk-icode--addr">
                  {REVSHARE_EXERCISE_HOOK_SEPOLIA}
                </code>{' '}
                predates them: probed on 2026-09-10, it answers{' '}
                <code className="dk-icode dk-icode--sm">pendingBeneficiary</code> and{' '}
                <code className="dk-icode dk-icode--sm">distributorOf</code> but reverts on{' '}
                <code className="dk-icode dk-icode--sm">keyOf</code>,{' '}
                <code className="dk-icode dk-icode--sm">hasKey</code> and{' '}
                <code className="dk-icode dk-icode--sm">totalTaken</code>. Do not point the
                commands above at that address and conclude the functions are missing from the
                contract.
              </p>
            </div>
          </section>

          {/* ------------------------------------------ Price-band oracles

              The Pyth adapter. The design point is the split between a
              state-changing refresh and a view read, forced by IPriceBandOracle
              rule 1; the operational point is that testnet feeds are stale.
              Constants, error names, gas limit and the live staleness figure
              are all sourced in content.ts. */}
          <section id="oracles" className="dk-section dk-reveal" style={vars({ '--d': '0.195s' })}>
            <h2 className="dk-h2">Price-band oracles: the Pyth adapter</h2>
            <p className="dk-body">
              <code className="dk-icode">MarketHoursModule</code>&rsquo;s circuit breaker asks an{' '}
              <code className="dk-icode">IPriceBandOracle</code> for{' '}
              <code className="dk-icode">referencePrice(poolId)</code> from inside{' '}
              <code className="dk-icode">afterSwap</code> &mdash; a{' '}
              <code className="dk-icode">staticcall</code> under a hard{' '}
              <code className="dk-icode">PRICE_ORACLE_GAS_LIMIT</code> of 200,000 &mdash; and treats
              a revert, a zero price or a stale timestamp as a reason to <strong>stop trading</strong>,
              not to skip the check. The interface therefore requires{' '}
              <code className="dk-icode">referencePrice</code> to be{' '}
              <code className="dk-icode">view</code>. Pyth is <strong>pull-based</strong>: a price
              exists on chain only once somebody submits a signed update, and{' '}
              <code className="dk-icode">updatePriceFeeds</code> is{' '}
              <code className="dk-icode">payable</code> and state-changing. The two cannot be one
              call, so <code className="dk-icode">PythPriceBandAdapter</code> splits them.
            </p>
            <p className="dk-body">
              <code className="dk-icode">refresh(poolId)</code> is <strong>permissionless</strong>.
              It reads whatever Pyth currently holds via{' '}
              <code className="dk-icode">getPriceUnsafe</code>, rejects anything questionable,
              converts the human price into the pool&rsquo;s{' '}
              <code className="dk-icode">sqrtPriceX96</code> &mdash; the one square root, paid once
              per refresh instead of once per swap &mdash; and caches the result with Pyth&rsquo;s
              own publish time in a single packed slot (<code className="dk-icode">uint160</code>{' '}
              + <code className="dk-icode">uint64</code>). The caller supplies no price and cannot
              influence the result; the worst a hostile caller can do is pick the moment.{' '}
              <code className="dk-icode">referencePrice</code> is then one{' '}
              <code className="dk-icode">SLOAD</code>, which is what every swap pays for. Posting
              the Pyth update itself is deliberately not the adapter&rsquo;s job: a keeper posts to
              Pyth, then calls <code className="dk-icode">refresh</code>, so the adapter never
              holds a balance and cannot be drained of an update fee.{' '}
              <code className="dk-icode">previewRefresh</code> is the same computation as a{' '}
              <code className="dk-icode">view</code>, reverting with the same error, for deciding
              whether an update is worth its fee.
            </p>
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                <strong>Testnet Pyth feeds are stale by default.</strong> Nobody pays to post
                updates on a testnet, so the on-chain price is whatever the last person left. When
                this page was checked on 2026-09-10, ETH/USD on Sepolia Pyth (
                <code className="dk-icode dk-icode--sm dk-icode--addr">{PYTH_SEPOLIA}</code>) had
                a <code className="dk-icode dk-icode--sm">publishTime</code> of{' '}
                {PYTH_SEPOLIA_STALENESS.publishTime}, {PYTH_SEPOLIA_STALENESS.ageSeconds.toLocaleString('en-US')}{' '}
                seconds &mdash; about {PYTH_SEPOLIA_STALENESS.ageDays} days &mdash; behind the
                clock. With a realistic 300-second{' '}
                <code className="dk-icode dk-icode--sm">maxPublishAge</code> the adapter rejects it
                with <code className="dk-icode dk-icode--sm">PriceTooOld</code>, and that is the
                correct answer: a circuit breaker whose failure mode is &ldquo;let a week-old price
                through&rdquo; is not one. The live exercise asserts that rejection first, and only
                then widens the window to 30 days to prove the conversion on real data. Never ship
                a window like that. To test against fresh data on Sepolia, post an update to Pyth
                yourself, then <code className="dk-icode dk-icode--sm">refresh</code>.
              </p>
            </div>
            <p className="dk-body dk-body--after">
              The adapter is verified against live Pyth on Sepolia by{' '}
              <code className="dk-icode">script/ExercisePythFull.s.sol</code> in{' '}
              <code className="dk-icode">packages/hooks-rwa</code>: 19 checks passed on chain, on
              top of 17 unit tests against a mock. <code className="dk-icode">configureFeed</code>{' '}
              is <code className="dk-icode">onlyOwner</code> (two-step ownership): choosing which
              feed prices an asset, and how wide a confidence interval to accept, is the trust
              decision; executing it is not. The <code className="dk-icode">Feed</code> struct
              is <code className="dk-icode">priceId</code>,{' '}
              <code className="dk-icode">baseIsCurrency0</code>,{' '}
              <code className="dk-icode">baseDecimals</code>,{' '}
              <code className="dk-icode">quoteDecimals</code>,{' '}
              <code className="dk-icode">maxConfBps</code> (1&ndash;9999),{' '}
              <code className="dk-icode">maxPublishAge</code> (seconds, non-zero); decimals above
              36 are rejected. <strong>Get <code className="dk-icode">baseIsCurrency0</code>{' '}
              wrong and the band inverts</strong>: the consumer rejects every swap in one
              direction and permits any swap in the other. Test an adapter against a real
              pool&rsquo;s <code className="dk-icode">getSlot0</code> before it governs anything.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={PYTH_SHELL}
              copyLabel="Copy the Pyth adapter commands"
            />
            <p className="dk-body dk-body--after">
              <code className="dk-icode">refresh</code> and{' '}
              <code className="dk-icode">previewRefresh</code> revert for exactly these reasons,
              in this order. A revert leaves the previous cache in place; if that in turn ages
              past the consumer&rsquo;s window, the pool halts. Both failure directions stop
              trading, and neither lets an unverified price through.
            </p>
            <dl className="dk-errors">
              {PYTH_REJECTIONS.map((e, i) => (
                <div className="dk-errors__row dk-stagger" key={e.code} style={vars({ '--i': i })}>
                  <dt className="dk-errors__code">{e.code}</dt>
                  <dd className="dk-errors__fix">{e.fix}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ------------------------------------------------------ Keeper

              packages/keeper. Four permissionless calls, no privileged role,
              dry run by default. The gas figures are a Sepolia receipt and a
              live estimate, both re-read on 2026-09-10 — see KEEPER_JOBS. */}
          <section id="keeper" className="dk-section dk-reveal" style={vars({ '--d': '0.2s' })}>
            <h2 className="dk-h2">The keeper</h2>
            <p className="dk-body">
              The protocol has four maintenance calls that <strong>somebody</strong> has to make.
              All four are permissionless &mdash; any address may call them &mdash; which is a
              deliberate design property: the system cannot be stalled by an owner who proposed
              something and walked away. <code className="dk-icode">@latchprotocol/keeper</code>{' '}
              is the something. Each tick it reads chain, decides whether a call is due, simulates
              it with <code className="dk-icode">eth_call</code>, and only then sends. Every
              contract-side guard &mdash; <code className="dk-icode">EpochTooSoon</code>,{' '}
              <code className="dk-icode">NothingToDistribute</code>,{' '}
              <code className="dk-icode">AlreadyRolledOver</code>,{' '}
              <code className="dk-icode">ClaimWindowClosed</code> &mdash; is a revert, so
              simulating first turns all of them into free reads, and a revert is logged as
              &ldquo;not due&rdquo;, which is the normal state most of the time. The one exception
              is <code className="dk-icode">settleBeneficiaries</code>, which returns quietly on an
              empty pot instead of reverting; the keeper reads{' '}
              <code className="dk-icode">pendingBeneficiary</code> first and only simulates when
              there is something to settle.
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
                    <th scope="col">CALL</th>
                    <th scope="col">GAS · SEPOLIA</th>
                    <th scope="col">IF NOBODY MAKES IT</th>
                  </tr>
                </thead>
                <tbody>
                  {KEEPER_JOBS.map((j, i) => (
                    <tr key={j.call} className="dk-stagger" style={vars({ '--i': i })}>
                      <th scope="row" className="dk-table__name">
                        {j.call}
                      </th>
                      <td className="dk-table__bit">{j.gas}</td>
                      <td className="dk-table__ret">{j.without}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dk-body dk-body--after">
              The two gas figures are measurements, not estimates from a table:{' '}
              <code className="dk-icode">closeEpoch</code> is the{' '}
              <code className="dk-icode">gasUsed</code> on a Sepolia receipt against the exercise
              distributor, <code className="dk-icode">rollover</code> a live{' '}
              <code className="dk-icode">eth_estimateGas</code> once epoch 0 had expired. The other
              two have not been measured and no number is printed for them.
            </p>
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                <strong>What a stolen keeper key buys an attacker: nothing they could not already do
                from any address.</strong> The keeper holds no privileged role. Its ABI in{' '}
                <code className="dk-icode dk-icode--sm">src/abi.ts</code> is hand-written and
                narrow &mdash; if a function is not in that file the process cannot call it &mdash;
                and every entry is permissionless on chain; there is no owner-only, curator-only or
                guardian-only call, and none should be added. With the key an attacker can close an
                epoch slightly earlier than you would have, or waste your gas. They cannot move
                funds to themselves, change a fee, alter a roster, or touch a listing. Give the
                keeper a dedicated address holding only gas, and never the deployer key.
              </p>
            </div>
            <p className="dk-body dk-body--after">
              <strong>Dry run is the default.</strong> Sending requires <strong>both</strong>{' '}
              <code className="dk-icode">--execute</code> and{' '}
              <code className="dk-icode">KEEPER_PRIVATE_KEY</code> in the environment; either alone
              reports what it would do and sends nothing. Flags:{' '}
              <code className="dk-icode">--config &lt;path&gt;</code>,{' '}
              <code className="dk-icode">--once</code>,{' '}
              <code className="dk-icode">--execute</code>,{' '}
              <code className="dk-icode">--interval &lt;seconds&gt;</code> (default 300, minimum
              15). Targets come from a strictly validated JSON file, so a malformed address stops
              the process at startup rather than surfacing hours later as a transaction sent
              somewhere unintended. It ships as a container: a two-stage image with no build
              tooling in the runtime layer, running as the non-root <code className="dk-icode">node</code>{' '}
              user with all capabilities dropped, no ports published, the config mounted
              read-only, and the key absent unless <code className="dk-icode">.env</code> beside
              the compose file supplies it. The compose project is named{' '}
              <code className="dk-icode">latch</code>; always pass{' '}
              <code className="dk-icode">-p latch</code>, because the host is shared.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={KEEPER_SHELL}
              copyLabel="Copy the keeper commands"
            />
          </section>

          {/* ------------------------------------------------ Target chains

              CHAIN_RPCS in the SDK. The table is a transcription of that file
              (see CHAINS in content.ts); the prose describes the probe and the
              selection rule from the file's own header. */}
          <section id="chains" className="dk-section dk-reveal" style={vars({ '--d': '0.205s' })}>
            <h2 className="dk-h2">Target chains</h2>
            <p className="dk-body">
              <code className="dk-icode">@latchprotocol/sdk</code> carries public RPC endpoints for{' '}
              {CHAIN_COUNTS.chains} chains &mdash; {CHAIN_COUNTS.endpoints} endpoints in all. Every
              one was <strong>probed, not collected from a list</strong>: it answered{' '}
              <code className="dk-icode">eth_chainId</code> with the expected id, served{' '}
              <code className="dk-icode">eth_blockNumber</code> three times, and was timed by the
              median; where the endpoint allowed it, a <code className="dk-icode">TSTORE</code>{' '}
              probe via <code className="dk-icode">eth_call</code> checked EIP-1153 per endpoint.
              Endpoints that 404&rsquo;d, 403&rsquo;d, rate-limited or answered for the wrong chain
              were dropped rather than shipped as dead fallbacks. The selection rule after the
              probe: fastest first, at most two endpoints per operator, the chain&rsquo;s own
              canonical endpoint included where reachable, {CHAIN_COUNTS.target} per chain as the
              target. Chains carrying fewer carry fewer because fewer exist; the list is never
              padded, and no chain is down to a single endpoint.
            </p>
            <p className="dk-body">
              <strong>Robinhood Chain (4663)</strong> is the newest: five endpoints from five
              operators, all of which executed the <code className="dk-icode">TSTORE</code> probe,
              so EIP-1153 is confirmed per endpoint rather than inferred from one. Two candidates
              were rejected &mdash; one returned no usable JSON-RPC at all, and one answers{' '}
              <code className="dk-icode">eth_chainId</code> correctly from a config table while
              rejecting <code className="dk-icode">eth_blockNumber</code> and{' '}
              <code className="dk-icode">eth_call</code>: alive to a chain-id check, dead to a real
              request. A target chain is one the SDK can reach; it is not a deployment. Latch is
              deployed on <strong>Ethereum Sepolia only</strong>.
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
                    <th scope="col">CHAIN</th>
                    <th scope="col">ID</th>
                    <th scope="col">PROBED RPCS</th>
                  </tr>
                </thead>
                <tbody>
                  {CHAINS.map((c, i) => (
                    <tr key={c.chainId} className="dk-stagger" style={vars({ '--i': i })}>
                      <th scope="row" className="dk-table__name">
                        {c.name}
                      </th>
                      <td className="dk-table__bit">{c.chainId}</td>
                      <td className="dk-table__ret">{c.rpcs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dk-callout">
              <span className="dk-callout__dot" aria-hidden="true" />
              <p className="dk-callout__text">
                On a zkEVM (Linea, X Layer) <code className="dk-icode dk-icode--sm">eth_call</code>{' '}
                is executed by the node&rsquo;s EVM, not the prover, so a successful{' '}
                <code className="dk-icode dk-icode--sm">TSTORE</code> in{' '}
                <code className="dk-icode dk-icode--sm">eth_call</code> is strong evidence rather
                than proof that a proven transaction supports it.{' '}
                <code className="dk-icode dk-icode--sm">BackendGuard</code> is the authoritative
                check, because it runs on chain at deploy time. Public endpoints also rot: re-run
                the probe script before relying on this list in production, and on the thin chains
                treat a paid or self-hosted node supplied through{' '}
                <code className="dk-icode dk-icode--sm">LATCH_RPC_&lt;chainId&gt;</code> as a
                requirement rather than an optimisation.
              </p>
            </div>
            <p className="dk-body dk-body--after">
              <code className="dk-icode">latchTransport</code> stacks every verified endpoint
              behind viem&rsquo;s <code className="dk-icode">fallback</code>, private endpoints
              from the environment first. Per-endpoint retries default to zero and the retries
              live on the fallback instead, so a provider that just rate-limited you is skipped
              rather than hammered; ranking is off by default because it costs continuous
              background traffic against exactly the shared gateways whose limits you are trying
              not to exhaust.
            </p>
            <CodeBlock
              filename="transport.ts"
              dot="source"
              source={CHAINS_TS}
              copyLabel="Copy the transport sample"
            />
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
          <section id="costs" className="dk-section dk-reveal" style={vars({ '--d': '0.21s' })}>
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
          <section id="next" className="dk-section dk-reveal" style={vars({ '--d': '0.22s' })}>
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

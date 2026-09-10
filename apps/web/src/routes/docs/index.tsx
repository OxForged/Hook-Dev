import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import CodeBlock from './CodeBlock'
import DocsFooter from './DocsFooter'
import DocsHeader from './DocsHeader'
import LeftRail from './LeftRail'
import {
  BITMAP_SHELL,
  CALLBACKS,
  DEPLOY_SHELL,
  ERRORS,
  FACTS,
  FEE_LATCH_SOL,
  INSTALL_SHELL,
  LIFECYCLE,
  SECTION_IDS,
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
              A Latch is a hook contract. It extends <code className="dk-icode">BaseCLHook</code>,
              declares the callbacks it wants from{' '}
              <code className="dk-icode">getHooksRegistrationBitmap()</code>, and the pool key
              carries that same bitmap in its <code className="dk-icode">parameters</code>. Core
              cross-checks the two when the pool is initialized. Permissions live in the pool key,
              not in the hook&rsquo;s address, so there is no CREATE2 salt to mine and the same
              hook works from any address. This page takes you from an empty directory to a hook
              deployed on Sepolia.
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
              The generator writes the hook, an end-to-end test against a real{' '}
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
                static-fee pool core discards it with no revert and no event, so the hook looks
                like it is working and is not. Reject the wrong pool in{' '}
                <code className="dk-icode dk-icode--sm">beforeInitialize</code> if it matters.
              </p>
            </div>
          </section>

          {/* ---------------------------------- B6. 3 · Encode and deploy */}
          <section id="deploy" className="dk-section dk-reveal" style={vars({ '--d': '0.09s' })}>
            <h2 className="dk-h2">3 · Encode and deploy</h2>
            <p className="dk-body">
              Your hook&rsquo;s bitmap and the pool key&rsquo;s bitmap must be the same number.{' '}
              <code className="dk-icode">latch bitmap</code> prints both: the{' '}
              <code className="dk-icode">uint16</code> your hook returns, and the{' '}
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
              A pool key names one hook, and core calls only the callbacks its bitmap declares.
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

          {/* --------------------------------------------- B10. Next panel */}
          <section id="next" className="dk-section dk-reveal" style={vars({ '--d': '0.2s' })}>
            <div className="dk-next">
              <span className="dk-next__glow" aria-hidden="true" />
              <h2 className="dk-next__title">Next: initialize a pool</h2>
              <p className="dk-next__body">
                A pool opts into your hook by naming it in the pool key. Use the{' '}
                <code className="dk-icode dk-icode--sm">parameters</code> word the deploy script
                printed, verbatim — any other value makes{' '}
                <code className="dk-icode dk-icode--sm">initialize</code> revert with{' '}
                <code className="dk-icode dk-icode--sm">HookConfigValidationError</code>.
              </p>
              <div className="dk-next__actions">
                <Link to="/app" className="dk-btn dk-btn--primary">
                  Open the app →
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

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CodeBlock from './CodeBlock'
import DocsFooter from './DocsFooter'
import DocsHeader from './DocsHeader'
import LeftRail from './LeftRail'
import {
  CALLBACKS,
  ERRORS,
  FACTS,
  FEE_LATCH_SOL,
  INSTALL_SHELL,
  LIFECYCLE,
  REGISTER_SHELL,
  SECTION_IDS,
  TOC,
} from './content'
import { useMediaQuery, useScrollSpy } from './hooks'
import './docs.css'

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
          <section id="quickstart" className="dk-intro dk-reveal" style={{ '--d': '0s' }}>
            <p className="dk-eyebrow">DEVELOPER QUICKSTART</p>
            <h1 className="dk-h1">Ship your first Latch.</h1>
            <p className="dk-lead">
              A Latch is a contract that implements <code className="dk-icode">ILatch</code>,
              declares which callbacks it wants, and registers against the protocol registry.
              Pools then opt in. This page takes you from an empty repo to a registered latch on
              Base Sepolia.
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
          <section id="install" className="dk-section dk-reveal" style={{ '--d': '0.03s' }}>
            <h2 className="dk-h2">1 · Install</h2>
            <p className="dk-body">
              The core interfaces and test helpers ship as one package. Foundry is the supported
              toolchain; Hardhat works with the same artifacts.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={INSTALL_SHELL}
              copyLabel="Copy install commands"
            />
          </section>

          {/* ---------------------------------------- B5. 2 · Write the latch */}
          <section id="write" className="dk-section dk-reveal" style={{ '--d': '0.06s' }}>
            <h2 className="dk-h2">2 · Write the latch</h2>
            <p className="dk-body">
              Implement <code className="dk-icode">permissions()</code> to declare the callbacks
              you want, then implement only those callbacks. Anything you leave out is never
              called, so it costs no gas.
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
                The registry reverts registration if{' '}
                <code className="dk-icode dk-icode--sm">permissions()</code> declares a callback
                the contract does not implement. Keep the bitmap and the implementation in sync.
              </p>
            </div>
          </section>

          {/* -------------------------------- B6. 3 · Simulate and register */}
          <section id="register" className="dk-section dk-reveal" style={{ '--d': '0.09s' }}>
            <h2 className="dk-h2">3 · Simulate and register</h2>
            <p className="dk-body">
              Simulation replays recent mainnet swaps against your latch and reports gas overhead
              and reverts. Registration is a single transaction.
            </p>
            <CodeBlock
              filename="shell"
              dot="shell"
              source={REGISTER_SHELL}
              copyLabel="Copy simulate and register commands"
            />
          </section>

          {/* -------------------------------------------- B7. Callback ref */}
          <section id="interface" className="dk-section dk-reveal" style={{ '--d': '0.12s' }}>
            <h2 className="dk-h2">Callback reference</h2>
            <p className="dk-body">
              Six callbacks, each with a bit in the permission bitmap. Return values marked — are
              ignored.
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
                    <tr key={c.name} className="dk-stagger" style={{ '--i': i }}>
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
          <section id="lifecycle" className="dk-section dk-reveal" style={{ '--d': '0.15s' }}>
            <h2 className="dk-h2">Execution order</h2>
            <p className="dk-body dk-body--wide">
              Latches on one pool run in registration order. A revert isolates to the failing
              latch: it is skipped for that call and flagged in the registry.
            </p>
            <ol className="dk-steps">
              {LIFECYCLE.map((l, i) => (
                <li
                  className="dk-step dk-stagger dk-stagger--slow"
                  key={l.step}
                  style={{ '--i': i }}
                >
                  <span className="dk-step__num">{l.step}</span>
                  <span className="dk-step__name">{l.name}</span>
                  <span className="dk-step__note">{l.note}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* -------------------------------------------- B9. Common errors */}
          <section id="errors" className="dk-section dk-reveal" style={{ '--d': '0.18s' }}>
            <h2 className="dk-h2">Common errors</h2>
            <dl className="dk-errors">
              {ERRORS.map((e, i) => (
                <div className="dk-errors__row dk-stagger" key={e.code} style={{ '--i': i }}>
                  <dt className="dk-errors__code">{e.code}</dt>
                  <dd className="dk-errors__fix">{e.fix}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* --------------------------------------------- B10. Next panel */}
          <section id="next" className="dk-section dk-reveal" style={{ '--d': '0.2s' }}>
            <div className="dk-next">
              <span className="dk-next__glow" aria-hidden="true" />
              <h2 className="dk-next__title">Next: attach it to a pool</h2>
              <p className="dk-next__body">
                Open the app, find your registered latch in the explorer, and attach it to a pool
                you control. Simulation runs again before the pool accepts it.
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

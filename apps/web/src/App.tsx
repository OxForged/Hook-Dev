import { Suspense } from 'react'
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { RouteErrorBoundary, RouteLoading } from './components/RouteBoundary'
import { ROUTES } from './routes/table'

/**
 * Route shell for the Latch Protocol web surfaces.
 *
 * Each surface is built to `latch design/README.md` + `SCREENS.md`. The README
 * is authoritative: where a reference HTML disagrees with it, the README wins.
 *
 *   /        Landing    — design-references/Latch Landing.dc.html
 *   /docs    Docs       — design-references/Latch Docs.dc.html
 *   /app/*   Dapp       — design-references/Latch Dapp.dc.html  (7 screens, one shell)
 *   /brand   Brand kit  — design-references/Latch Brand Kit.dc.html
 *   /privacy Privacy Policy  ┐ drafts, pending legal review; both reuse the
 *   /terms   Terms of Use    ┘ landing chrome (SiteHeader / SiteFooter)
 *   /verify/:hookAddress     — public, wallet-free hook verification permalink.
 *                              Meant to be linked from a hook author's own site,
 *                              so it must stay readable with no wallet and no
 *                              dapp chrome around it.
 *
 * Design tokens live in src/styles/tokens.css, transcribed from the spec.
 * Never hardcode a hex, radius or shadow in a component — add it to the spec
 * first, then to tokens.css, then reference it.
 */

function NotFound() {
  return (
    <main style={{ padding: '80px 40px', maxWidth: 720, margin: '0 auto' }}>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '.22em',
          textTransform: 'uppercase',
          color: 'var(--label-ink)',
          margin: '0 0 12px',
        }}
      >
        404
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.06, margin: '0 0 14px' }}>Page not found</h1>
      <p style={{ color: 'var(--muted-ink-2)', margin: '0 0 24px' }}>
        That route doesn&rsquo;t exist.
      </p>
      <Link to="/" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        &larr; back to Latch
      </Link>
    </main>
  )
}

export default function App() {
  const { pathname } = useLocation()
  return (
    // Every surface is a lazily-loaded chunk (see routes/table.ts). The boundary
    // turns a chunk that fails to download — typically a tab left open across a
    // deploy — into a real error with a reload action instead of a blank page.
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {ROUTES.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          {/* Bare /verify has no address to verify. It used to 404, which is technically
              true and practically useless — somebody who trimmed the address off a shared
              link deserves the marketplace, not a dead end. */}
          <Route path="/verify" element={<Navigate to="/app/marketplace" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  )
}

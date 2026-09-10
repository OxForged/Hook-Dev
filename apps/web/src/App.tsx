import { Routes, Route, Link } from 'react-router-dom'
import Landing from './routes/landing'
import Docs from './routes/docs'
import Dapp from './routes/dapp'
import Brand from './routes/brand'
import Privacy from './routes/legal/Privacy'
import Terms from './routes/legal/Terms'
import Verify from './routes/verify'

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
          color: 'var(--eyebrow-blue)',
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
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/app/*" element={<Dapp />} />
      <Route path="/brand" element={<Brand />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/verify/:hookAddress" element={<Verify />} />
      {/* Bare /verify has no address to verify. Handing it to the page would mean
          inventing an empty state for "no input", so it 404s instead. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

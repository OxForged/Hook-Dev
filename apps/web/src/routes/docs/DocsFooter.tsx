import { Link } from 'react-router-dom'

import { GITHUB_URL } from '../landing/socials'

/**
 * Footer — SCREENS.md § B10. Every link is `white-space: nowrap` per the spec.
 *
 * The GitHub URL is imported, never written out here: this file used to
 * hardcode `github.com/latch-protocol`, which is the wrong org. One constant
 * in `routes/landing/socials.ts` now owns it for every surface.
 */
export default function DocsFooter() {
  return (
    <footer className="dk-footer">
      <div className="dk-footer__brand">
        <img src="/brand/latch-mark-transparent.png" alt="" className="dk-footer__mark" />
        <span className="dk-footer__copy">© 2026 LATCH PROTOCOL</span>
      </div>
      <nav className="dk-footer__links" aria-label="Footer">
        <Link to="/">Home</Link>
        <Link to="/brand">Brand Kit</Link>
        <Link to="/app">App</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
      </nav>
    </footer>
  )
}

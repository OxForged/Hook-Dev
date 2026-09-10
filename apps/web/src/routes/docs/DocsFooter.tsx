import { Link } from 'react-router-dom'

/** Footer — SCREENS.md § B10. Every link is `white-space: nowrap` per the spec. */
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
        <a href="https://github.com/latch-protocol" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  )
}

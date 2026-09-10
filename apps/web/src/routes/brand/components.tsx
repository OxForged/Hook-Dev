import type { CSSProperties, ReactNode } from 'react'
import type { Download } from './assets'

/**
 * Small building blocks for the brand kit page.
 * Nothing here holds state — the page is static by design.
 */

/**
 * A section that reveals itself with the README's standard motion.
 *
 * The animation is pure CSS (README § Interactions: "Implemented as CSS
 * animation so content is never hidden if JS fails"), and `delay` covers the
 * documented 0–0.2s per-section stagger.
 */
export function Section({
  id,
  eyebrow,
  delay = 0,
  hero = false,
  children,
  labelledBy,
}: {
  id?: string
  eyebrow?: string
  delay?: number
  hero?: boolean
  children: ReactNode
  labelledBy?: string
}) {
  const style = { '--bk-delay': `${delay}s` } as CSSProperties
  return (
    <section
      {...(id ? { id } : {})}
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
      className={`bk-section bk-reveal${hero ? ' bk-section--hero' : ''}`}
      style={style}
    >
      {eyebrow ? <p className="bk-eyebrow">{eyebrow}</p> : null}
      {children}
    </section>
  )
}

/**
 * A download button. Always a real `<a download>` pointing at a real file in
 * /brand — never a JS handler, so it works with middle-click, "save link as",
 * keyboard activation and JS disabled.
 */
export function DownloadLink({ label, href, aria }: Download) {
  const filename = href.slice(href.lastIndexOf('/') + 1)
  return (
    <a className="bk-dl" href={href} download={filename} aria-label={aria}>
      {label}
    </a>
  )
}

export function DownloadRow({ downloads }: { downloads: readonly Download[] }) {
  return (
    <div className="bk-dl-row">
      {downloads.map((d) => (
        <DownloadLink key={d.href + d.label} {...d} />
      ))}
    </div>
  )
}

/** The header / footer lockup: mark image plus the typed LATCH · PROTOCOL. */
export function Lockup() {
  return (
    <div className="bk-lockup">
      {/* The typed wordmark beside it already says "Latch Protocol", so the
          image is decorative here — announcing it twice helps nobody. Every
          image that *is* content (the asset previews) carries real alt text. */}
      <img src="/brand/latch-mark-transparent.png" alt="" aria-hidden="true" />
      <span className="bk-lockup-type">
        <span className="bk-latch">LATCH</span>
        <span className="bk-protocol">PROTOCOL</span>
      </span>
    </div>
  )
}

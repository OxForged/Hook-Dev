import { useState, type CSSProperties, type ReactNode } from 'react'
import { BrandLockup } from '../../components/BrandLockup'
import type { Download, Swatch } from './assets'

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

/**
 * The two values a colour token declares, read from the token itself.
 *
 * Every palette token is `light-dark(<light>, <dark>)`. A custom property's
 * computed value is its declared token stream, so reading it back returns that
 * string and the two hexes can be lifted out of it. Printing them this way
 * means the swatch label is whatever tokens.css says today — not a copy of it
 * that someone has to remember to update.
 *
 * Read once, on first render: the stylesheet is already applied by then (the
 * route imports it), and a declaration does not change when the theme does —
 * only which of its two values is in effect.
 *
 * Returns null if the declaration is not in that shape. The caller renders
 * nothing for null rather than a guessed value.
 */
function readTokenValues(token: string): { light: string; dark: string } | null {
  if (typeof document === 'undefined') return null
  const declared = getComputedStyle(document.documentElement).getPropertyValue(token)
  const [light, dark, ...rest] = declared.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  if (light === undefined || rest.length > 0) return null
  if (dark !== undefined && !declared.includes('light-dark(')) return null
  return { light: light.toUpperCase(), dark: (dark ?? light).toUpperCase() }
}

function useTokenValues(token: string): { light: string; dark: string } | null {
  const [values] = useState(() => readTokenValues(token))
  return values
}

/** One palette swatch: painted from its token, labelled with the token's own values. */
export function PaletteSwatch({ swatch }: { swatch: Swatch }) {
  const values = useTokenValues(swatch.token)
  return (
    <li className="bk-card bk-swatch-card">
      <div
        className={`bk-swatch${swatch.needsRule ? ' bk-swatch--ruled' : ''}`}
        style={{ background: `var(${swatch.token})` }}
      />
      <div className="bk-swatch-body">
        <p className="bk-swatch-name">{swatch.name}</p>
        {values ? (
          <dl className="bk-swatch-values">
            <div>
              <dt>Light</dt>
              <dd>{values.light}</dd>
            </div>
            <div>
              <dt>Dark</dt>
              <dd>{values.dark}</dd>
            </div>
          </dl>
        ) : null}
        <p className="bk-swatch-role">
          {swatch.role} · <code>{swatch.token}</code>
        </p>
      </div>
    </li>
  )
}

/** The header / footer lockup: mark image plus the typed LATCH · PROTOCOL. */
export function Lockup() {
  return (
    <div className="bk-lockup">
      {/* The shared lockup (components/BrandLockup): the two shipped marks,
          one per theme, beside the typed wordmark — identical to the landing,
          docs and dapp lockups. The images are decorative there; every image
          that *is* content on this page (the asset previews) has real alt. */}
      <BrandLockup />
    </div>
  )
}

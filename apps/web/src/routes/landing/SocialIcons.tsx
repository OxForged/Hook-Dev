import styles from './landing.module.css'
import type { SocialLink } from './socials'
import { cx } from './ui'

/**
 * One social icon, shared by the header cluster and the footer row.
 *
 * The glyph is `aria-hidden` and the accessible name comes from visually
 * hidden text rather than `aria-label`: `aria-label` on a link is dropped by
 * some translation tooling and is invisible to a sighted user who has images
 * or fonts fail, whereas the hidden span is real text in the document. The
 * link therefore always has a name, even with the SVG stripped.
 *
 * `size="sm"` is the header treatment: a tighter box and a smaller glyph, so
 * the cluster reads as a single quiet object beside the Launch App pill
 * instead of competing with it.
 */
export function SocialIconLink({ social, size = 'md' }: { social: SocialLink; size?: 'sm' | 'md' }) {
  const glyph = size === 'sm' ? 16 : 18
  return (
    <li>
      <a
        href={social.href}
        className={cx(styles['socialLink'], size === 'sm' && styles['socialLinkSm'])}
        target="_blank"
        rel="noreferrer noopener"
      >
        <svg
          viewBox={social.viewBox}
          width={glyph}
          height={glyph}
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <path d={social.path} />
        </svg>
        <span className={styles['srOnly']}>{social.label}</span>
      </a>
    </li>
  )
}

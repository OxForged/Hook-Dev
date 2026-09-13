import { Link, useLocation } from 'react-router-dom'
import { COPYRIGHT, FOOTER_GROUPS } from './data'
import { isCurrentPage, linkKind, resolveHref } from './links'
import styles from './landing.module.css'
import { Lockup } from './Lockup'
import { SocialIconLink } from './SocialIcons'
import { SOCIALS } from './socials'

/**
 * A11 (footer) — the site map, grouped into four columns, with the socials and
 * the copyright on a rule beneath them.
 *
 * Three kinds of href arrive here and each needs different markup: a landing
 * section, an internal route (client-side `<Link>`, so the app does not do a
 * full reload), and an absolute URL that must leave the site in a new tab.
 * Routing an absolute URL through `<Link to>` would resolve it as a relative
 * path — the failure is silent and lands the user on a 404 — so the `http`
 * case is tested for explicitly. ./links.ts explains the section case.
 */
function FooterTextLink({ label, href }: { label: string; href: string }) {
  const { pathname } = useLocation()
  const kind = linkKind(href)

  if (kind === 'external') {
    return (
      <a href={href} className={styles['footerLink']} target="_blank" rel="noreferrer noopener">
        {label}
      </a>
    )
  }

  if (kind === 'section') {
    return (
      <a href={resolveHref(href, pathname)} className={styles['footerLink']}>
        {label}
      </a>
    )
  }

  // The legal pages render this footer, so the link to the page you are
  // already on is the one place `aria-current` genuinely applies here.
  const current = isCurrentPage(href, pathname)
  return (
    <Link
      to={href}
      className={styles['footerLink']}
      aria-current={current ? 'page' : undefined}
    >
      {label}
    </Link>
  )
}

export function SiteFooter() {
  return (
    <footer className={styles['footer']}>
      {/* Option B: the footer is a full-width white band under a hairline, and
          its content sits in the same column as every section above it. The
          band is `.footer`; the column is `.footerInner`. */}
      <div className={styles['footerInner']}>
        <div className={styles['footerTop']}>
          <div className={styles['footerBrand']}>
            <Lockup size="lg" />
          </div>

          {/* One landmark, four labelled lists — not four <nav>s, which would
              hand a screen-reader user four more landmarks to skip past, and not
              headings, which would put "Legal" into the page's heading outline
              beside the real sections. */}
          <nav className={styles['footerGroups']} aria-label="Footer">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.title}>
                <p className={styles['footerGroupTitle']} id={`footer-${group.title}`}>
                  {group.title}
                </p>
                <ul className={styles['footerList']} aria-labelledby={`footer-${group.title}`}>
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <FooterTextLink label={link.label} href={link.href} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={styles['footerBottom']}>
          {/* The licensing line moved here from the hero in the minimal cut.
              It is load-bearing — a tenant needs to know what they must
              open-source — so it moved rather than went. */}
          <p className={styles['footerMeta']}>
            <span className={styles['copyright']}>{COPYRIGHT}</span>
            <span className={styles['footerLicense']}>MIT SDK · GPL-2.0 core · no listing fees</span>
          </p>
          <ul className={styles['socials']} aria-label="Latch Protocol social accounts">
            {SOCIALS.map((social) => (
              <SocialIconLink key={social.id} social={social} />
            ))}
          </ul>
        </div>
      </div>
    </footer>
  )
}

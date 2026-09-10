import { Link } from 'react-router-dom'
import { COPYRIGHT, FOOTER_LINKS } from './data'
import styles from './landing.module.css'
import { Lockup } from './Lockup'

/** A11 (footer). Lockup left; links and the copyright right, copyright nowrap. */
export function SiteFooter() {
  return (
    <footer className={styles['footer']}>
      <Lockup size="lg" />
      <div className={styles['footerLinks']}>
        {FOOTER_LINKS.map((link) =>
          link.href.startsWith('#') ? (
            <a key={link.label} href={link.href} className={styles['footerLink']}>
              {link.label}
            </a>
          ) : (
            <Link key={link.label} to={link.href} className={styles['footerLink']}>
              {link.label}
            </Link>
          ),
        )}
        <span className={styles['copyright']}>{COPYRIGHT}</span>
      </div>
    </footer>
  )
}

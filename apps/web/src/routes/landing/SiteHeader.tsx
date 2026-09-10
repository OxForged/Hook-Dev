import { Link } from 'react-router-dom'
import { LINKS, NAV } from './data'
import styles from './landing.module.css'
import { Lockup } from './Lockup'
import { cx } from './ui'
import { NavIcon } from '../../components/NavIcon'

/** A1. Sticky translucent header — lockup left, nav + Launch App pill right. */
export function SiteHeader() {
  return (
    <header className={styles['header']}>
      <Lockup />
      <nav className={styles['nav']} aria-label="Primary">
        {NAV.map((item) => {
          const className = cx(styles['navLink'], item.active && styles['navLinkActive'])
          return item.href.startsWith('#') ? (
            <a
              key={item.label}
              href={item.href}
              className={className}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.icon && <NavIcon name={item.icon} size={15} />}
              {item.label}
            </a>
          ) : (
            <Link key={item.label} to={item.href} className={className}>
              {item.icon && <NavIcon name={item.icon} size={15} />}
              {item.label}
            </Link>
          )
        })}
        <Link to={LINKS.app} className={styles['launchPill']}>
          Launch App
        </Link>
      </nav>
    </header>
  )
}

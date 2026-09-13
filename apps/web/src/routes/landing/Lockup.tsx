import { Link } from 'react-router-dom'

import { BrandLockup } from '../../components/BrandLockup'
import styles from './landing.module.css'

/**
 * The landing header and footer lockup: the shared `BrandLockup` (one mark,
 * one theme swap, one set of proportions for every surface) inside a link home.
 */
export function Lockup({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <Link to="/" className={styles['lockup']}>
      <BrandLockup size={size === 'lg' ? 'lg' : 'md'} />
    </Link>
  )
}

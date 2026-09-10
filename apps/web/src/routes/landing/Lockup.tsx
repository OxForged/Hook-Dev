import { Link } from 'react-router-dom'
import styles from './landing.module.css'
import { cx } from './ui'

const MARK = '/brand/latch-mark-transparent.png'

/**
 * Mark + typed LATCH / PROTOCOL lockup.
 * README § Typography: `LATCH` 700 / .14em / white, `PROTOCOL` 600 / .3em /
 * Latch Blue beneath at roughly half the size. The mark ships as-is.
 */
export function Lockup({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <Link to="/" className={cx(styles['lockup'], size === 'lg' && styles['lockupLarge'])}>
      <img src={MARK} alt="Latch Protocol" className={styles['lockupMark']} />
      <span className={styles['lockupWords']}>
        <span className={styles['lockupName']}>LATCH</span>
        <span className={styles['lockupSub']}>PROTOCOL</span>
      </span>
    </Link>
  )
}

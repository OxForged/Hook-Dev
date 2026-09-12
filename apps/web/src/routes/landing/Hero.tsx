import { Link } from 'react-router-dom'
import { NavIcon } from '../../components/NavIcon'
import { HERO_NODES, LINKS } from './data'
import styles from './landing.module.css'
import { cx } from './ui'

const MARK = '/brand/latch-mark-transparent.png'

/**
 * A2. Hero — copy left, node graph right, radial glow behind the right column.
 * Satellites float on staggered 6.5s loops; the centre tile on a 7s loop.
 */
export function Hero() {
  return (
    <section id="home" className={styles['hero']}>
      <div className={styles['heroGlow']} aria-hidden="true" />

      <div className={cx(styles['heroCopy'], styles['reveal'])}>
        <p className={styles['eyebrowPill']}>DEVELOPER INFRASTRUCTURE</p>
        <h1 className={styles['h1']}>
          Powerful Latches.
          <br />
          Limitless <span className={styles['accent']}>Possibilities.</span>
        </h1>
        <p className={styles['lead']}>
          Latch Protocol is the programmable logic layer for DEXs, AMMs, launchpads and tokenized
          real-world assets. A Latch is a hook contract you attach to a pool: gate a stock pair on
          compliance and market hours, tax snipers on a decaying curve, or route a share of trading
          volume to holders — without forking a protocol, redeploying it, or mining a contract
          address.
        </p>
        <div className={styles['heroActions']}>
          <Link to={LINKS.app} className={styles['btnPrimary']}>
            Get Started →<span className={styles['sheen']} aria-hidden="true" />
          </Link>
          <Link to={LINKS.docs} className={styles['btnSecondary']}>
            Read Docs
          </Link>
        </div>
      </div>

      {/* The satellite labels name the ecosystems Latch reaches, so the graph
          stays in the accessibility tree; only the ornament is hidden. */}
      <div className={styles['graph']}>
        <div className={styles['graphCore']} aria-hidden="true">
          <div className={styles['graphCoreTile']}>
            <img src={MARK} alt="" className={styles['graphCoreMark']} />
          </div>
        </div>
        {HERO_NODES.map((node, i) => (
          <div
            key={node.label}
            className={styles['graphNode']}
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              animationDelay: `${(i * 0.55).toFixed(2)}s`,
            }}
          >
            <div className={styles['graphNodeTile']}>
              {/* aria-hidden: the label beneath already names the category, so
                  announcing the glyph too would read it twice. */}
              <NavIcon name={node.icon} size={22} />
            </div>
            <div className={styles['graphNodeLabel']}>{node.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

import { useEffect, useState } from 'react'
import {
  ACTIVITY,
  CALL_CATEGORIES,
  DEFAULT_RANGE,
  DEPLOY_CAPTION,
  DEPLOY_COLUMNS,
  GAS_AXIS,
  GAS_COLUMNS,
  RANGES,
  PROTOCOL_HEALTH,
  TVL_BY_NETWORK,
  type RangeKey,
} from './data'
import { buildAreaChart, buildDonut, CHART_H, CHART_W, columnHeights, DONUT } from './chart'
import styles from './landing.module.css'
import { cx, prefersReducedMotion, toneClass } from './ui'

const GRADIENT_ID = 'landing-tvl-fill'

/** Widths animate from zero on first paint (README § Interactions: 1s). */
function useMountedWidths(): boolean {
  const [ready, setReady] = useState(() => prefersReducedMotion())
  useEffect(() => {
    if (ready) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [ready])
  return ready
}

function RangeSwitcher({
  range,
  onChange,
}: {
  range: RangeKey
  onChange: (next: RangeKey) => void
}) {
  return (
    <div className={styles['rangeSwitcher']} role="group" aria-label="Chart range">
      {RANGES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === range}
          className={cx(styles['rangeBtn'], option === range && styles['rangeBtnActive'])}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function AreaCard({ range }: { range: RangeKey }) {
  const series = ACTIVITY[range]
  const chart = buildAreaChart(series.pts)

  return (
    <div className={styles['chartCard']}>
      <div className={styles['chartHead']}>
        <div className={styles['chartHeadline']}>{series.headline}</div>
        <div className={styles['chartDelta']}>{series.delta}</div>
        <div className={styles['chartCaption']}>VALUE ROUTED THROUGH LATCHES</div>
      </div>

      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className={styles['areaChart']}
        role="img"
        aria-label={`Illustrative value routed through latches over ${range}, rising to ${series.headline}`}
      >
        <defs>
          {/* README § Design tokens: chart area fill, Latch Blue 42% -> 0%. */}
          <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--latch-blue)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--latch-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {chart.gridY.map((y) => (
          <line key={y} x1={0} x2={CHART_W} y1={y} y2={y} className={styles['gridLine']} />
        ))}
        {/* Remounting on range change replays the draw-on and the dot stagger. */}
        <g key={range}>
          <path d={chart.area} fill={`url(#${GRADIENT_ID})`} />
          <path d={chart.line} className={styles['areaLine']} />
          {chart.dots.map((dot, i) => (
            <circle
              key={`${dot.x}-${dot.y}`}
              cx={dot.x.toFixed(1)}
              cy={dot.y.toFixed(1)}
              r={3}
              className={styles['areaDot']}
              style={{ animationDelay: `${(0.25 + i * 0.09).toFixed(2)}s` }}
            />
          ))}
        </g>
      </svg>

      <div className={styles['axisRow']}>
        {series.labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

function CategoryBars() {
  const ready = useMountedWidths()
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>HOOK CALLS BY CATEGORY</h3>
      <div className={styles['barList']}>
        {CALL_CATEGORIES.map((bar) => (
          <div key={bar.name} className={toneClass(bar.tone)}>
            <div className={styles['barHead']}>
              <span>{bar.name}</span>
              <span className={styles['barValue']}>{bar.value}</span>
            </div>
            <div className={styles['barTrack']}>
              <div className={styles['barFill']} style={{ width: ready ? `${bar.pct}%` : 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GasHistogram() {
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>GAS OVERHEAD PER CALL (µ, GAS)</h3>
      <div className={cx(styles['columns'], styles['gasColumns'])} aria-hidden="true">
        {GAS_COLUMNS.map((value, i) => (
          <div
            key={`${i}-${value}`}
            className={cx(styles['gasColumn'], value > 80 && styles['gasColumnPeak'])}
            style={{ height: `${value}%`, animationDelay: `${(i * 0.045).toFixed(3)}s` }}
          />
        ))}
      </div>
      <p className={styles['captionRow']}>
        {GAS_AXIS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </p>
      <span className={styles['srOnly']}>
        Gas overhead per hook call is spread between {GAS_AXIS[0]} and {GAS_AXIS[2]}, clustered
        around a {GAS_AXIS[1]}.
      </span>
    </div>
  )
}

function NetworkDonut() {
  const segments = buildDonut(TVL_BY_NETWORK.map((n) => n.pct))
  return (
    <div className={styles['donutCard']}>
      <svg viewBox={`0 0 ${DONUT.size} ${DONUT.size}`} className={styles['donut']} aria-hidden="true">
        <circle cx={DONUT.cx} cy={DONUT.cy} r={DONUT.r} className={styles['donutTrack']} />
        {TVL_BY_NETWORK.map((net, i) => {
          const seg = segments[i]
          if (!seg) return null
          return (
            <circle
              key={net.name}
              cx={DONUT.cx}
              cy={DONUT.cy}
              r={DONUT.r}
              className={cx(styles['donutSeg'], toneClass(net.tone))}
              strokeDasharray={seg.dash}
              strokeDashoffset={seg.offset}
              transform={`rotate(-90 ${DONUT.cx} ${DONUT.cy})`}
            />
          )
        })}
      </svg>
      <div className={styles['donutBody']}>
        <h3 className={styles['microLabel']}>TVL BY NETWORK</h3>
        <div className={styles['legend']}>
          {TVL_BY_NETWORK.map((net) => (
            <div key={net.name} className={cx(styles['legendRow'], toneClass(net.tone))}>
              <span className={styles['swatch']} aria-hidden="true" />
              <span>{net.name}</span>
              <span className={styles['legendPct']}>{net.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DeployHistogram() {
  const heights = columnHeights(DEPLOY_COLUMNS)
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>LATCHES DEPLOYED · WEEKLY</h3>
      <div className={cx(styles['columns'], styles['deployColumns'])} aria-hidden="true">
        {heights.map((height, i) => (
          <div
            key={`${i}-${height}`}
            className={styles['deployColumn']}
            style={{ height: `${height}%`, animationDelay: `${(i * 0.035).toFixed(3)}s` }}
          />
        ))}
      </div>
      <p className={styles['deployCaption']}>{DEPLOY_CAPTION}</p>
    </div>
  )
}

/** SCREENS.md § A4 titles this "REGISTRY HEALTH"; there is no registry contract. */
function ProtocolHealth() {
  return (
    <div className={styles['card']}>
      <h3 className={styles['microLabel']}>PROTOCOL HEALTH</h3>
      <div className={styles['healthList']}>
        {PROTOCOL_HEALTH.map((row) => (
          <div key={row.name} className={cx(styles['healthRow'], toneClass(row.tone))}>
            <span className={styles['statusDot']} aria-hidden="true" />
            <span className={styles['healthName']}>{row.name}</span>
            <span className={styles['healthValue']}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A4. Protocol activity. Every figure here is illustrative — see data.ts. */
export function Activity() {
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE)

  return (
    <section
      id="activity"
      className={cx(styles['section'], styles['reveal'], styles['delay1'])}
      aria-labelledby="activity-title"
    >
      <div className={styles['sectionHead']}>
        <div>
          <p className={styles['eyebrow']}>PROTOCOL ACTIVITY</p>
          <h2 id="activity-title" className={styles['h2']}>
            Measured at the hook layer.
          </h2>
        </div>
        <RangeSwitcher range={range} onChange={setRange} />
      </div>

      <p className={styles['placeholderNote']}>
        ILLUSTRATIVE FIGURES · LATCH IS LIVE ON SEPOLIA TESTNET ONLY
      </p>

      <div className={styles['activityGrid']}>
        <AreaCard range={range} />
        <div className={styles['sideColumn']}>
          <CategoryBars />
          <GasHistogram />
        </div>
      </div>

      <div className={styles['activityRow']}>
        <NetworkDonut />
        <DeployHistogram />
        <ProtocolHealth />
      </div>
    </section>
  )
}

/* ============================================================================
   Where one token's fees went — a single 100% stacked bar, read from logs.

   NOT A TIME SERIES, AND NOTHING ON IT SUGGESTS ONE. The x-axis is SHARE of
   the fees charged in this token, 0-100%. The bar grows once from the left on
   first view; that is decoration over a complete reading, not a trend.

   ONE TOKEN PER BAR. Nothing prices these tokens, so there is no rate at which
   an LTT1 fee and an LTT2 fee could share an axis. Percentages are shares of
   this token's OWN total, so both ends of every comparison are in one unit.

   Segments with a zero value are not drawn — a zero-width rect is not a
   reading — but they ARE listed in the legend with their real "0", because a
   protocol that took nothing is a fact the reader asked for.
   ========================================================================== */

import { useId, useState, type CSSProperties } from 'react'

import { formatTokenAmount, type TokenActivity } from '../../lib/protocolActivity'
import { useFirstView, useMeasuredWidth } from './chartMotion'
import styles from './livestrip.module.css'
import { cx } from './ui'

const PT = 4
const BH = 34
const AXIS_GAP = 18
const H = PT + BH + AXIS_GAP + 8
const PX = 1
const TIP_W = 212
const MIN_HIT = 20
const TICKS = [0, 0.25, 0.5, 0.75, 1] as const

interface Segment {
  key: 'lp' | 'creators' | 'holders' | 'protocol'
  label: string
  value: bigint
  /** Where the figure comes from, in the tooltip and the legend. */
  detail: string
  /** Rendered in place of the amount when the source does not exist on this chain. */
  unconfigured: string | null
  fill: string | undefined
  swatch: string | undefined
}

const pctOf = (v: bigint, total: bigint): number =>
  total === 0n ? 0 : Number((v * 1_000_000n) / total) / 10_000

const pctText = (p: number): string =>
  p === 0 ? '0%' : p < 0.1 ? '<0.1%' : `${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%`

export function FeeSplit({
  token,
  symbol,
  cutConfigured,
  chainName,
}: {
  token: TokenActivity
  /** Already includes " base units" when decimals could not be read. */
  symbol: string
  /** False when this chain has no Latch RevShareHook to read a cut from. */
  cutConfigured: boolean
  chainName: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const active = hover ?? focus ?? pinned

  /* useId yields characters (colons, guillemets) that break inside `url(#…)`
     in some engines; keep only what an SVG fragment reference accepts. */
  const clipId = `fee-split-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { ref: plotRef, hidden } = useFirstView<HTMLDivElement>()
  const { ref: scrollerRef, width } = useMeasuredWidth<HTMLDivElement>(720)

  const fmt = (v: bigint): string => formatTokenAmount(v, token.decimals)
  const noCut = cutConfigured ? null : 'no Latch RevShareHook on this chain'

  const segments: Segment[] = [
    {
      key: 'lp',
      label: 'Liquidity providers',
      value: token.lpSwapFee + token.cutLp,
      detail: `LP swap fee ${fmt(token.lpSwapFee)} + cut donated ${fmt(token.cutLp)} ${symbol}`,
      unconfigured: null,
      fill: styles['segLp'],
      swatch: styles['swLp'],
    },
    {
      key: 'creators',
      label: 'Creators',
      value: token.cutCreators,
      detail: 'the pool’s beneficiary roster',
      unconfigured: noCut,
      fill: styles['segCreators'],
      swatch: styles['swCreators'],
    },
    {
      key: 'holders',
      label: 'Holders',
      value: token.cutHolders,
      detail: 'the pool’s epoch distributor',
      unconfigured: noCut,
      fill: styles['segHolders'],
      swatch: styles['swHolders'],
    },
    {
      key: 'protocol',
      label: 'Protocol',
      value: token.protocolSwapFee,
      detail: `protocol fee · ${fmt(token.protocolAccrued)} ${symbol} accrued, uncollected`,
      unconfigured: null,
      fill: styles['segProtocol'],
      swatch: styles['swProtocol'],
    },
  ]

  const total = segments.reduce((s, x) => s + x.value, 0n)

  if (total === 0n) {
    return (
      <div className={cx(styles['stateCard'], styles['splitState'])} data-state="empty">
        <p className={styles['stateText']}>
          No fee has been charged in {symbol} on {chainName}, so there is nothing to split.
        </p>
      </div>
    )
  }

  const W = Math.max(width, 240)
  const iw = W - PX * 2
  let cursor = 0
  const drawn = segments.map((s, i) => {
    const share = Number(s.value) / Number(total)
    const x = PX + cursor * iw
    const w = share * iw
    cursor += share
    return { ...s, i, x, w, pct: pctOf(s.value, total) }
  })
  const visible = drawn.filter((s) => s.value > 0n)

  const clear = (): void => {
    setHover(null)
    setFocus(null)
    setPinned(null)
  }

  const activeSeg = active === null ? undefined : drawn[active]
  const tipLeft =
    activeSeg === undefined
      ? 0
      : Math.min(Math.max(activeSeg.x + activeSeg.w / 2 - TIP_W / 2, 0), Math.max(0, W - TIP_W))

  return (
    <div className={styles['split']}>
      <div className={styles['splitHead']}>
        <h3 className={styles['splitTitle']}>Where the {symbol} fees went</h3>
        <span className={styles['splitTotal']}>
          {fmt(total)} {symbol} charged
        </span>
      </div>

      <div className={styles['scroller']} ref={scrollerRef}>
        <div
          className={styles['plot']}
          style={{ width: W, height: H }}
          ref={plotRef}
          data-active={active === null ? undefined : ''}
          onMouseLeave={() => setHover(null)}
        >
          <svg className={styles['svg']} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            <defs>
              <clipPath id={clipId}>
                <rect x={PX} y={PT} width={iw} height={BH} rx={6} />
              </clipPath>
            </defs>

            <rect className={styles['track']} x={PX} y={PT} width={iw} height={BH} rx={6} />

            <g
              clipPath={`url(#${clipId})`}
              className={cx(styles['bar'], hidden && styles['barHidden'])}
            >
              {visible.map((s) => (
                <rect
                  key={s.key}
                  className={cx(styles['seg'], s.fill, active === s.i && styles['segOn'])}
                  x={s.x}
                  y={PT}
                  width={s.w}
                  height={BH}
                />
              ))}
            </g>

            {TICKS.map((t) => {
              const x = PX + t * iw
              return (
                <g key={t}>
                  <line className={styles['tick']} x1={x} x2={x} y1={PT + BH + 2} y2={PT + BH + 6} />
                  <text
                    className={styles['axis']}
                    x={x}
                    y={PT + BH + AXIS_GAP}
                    textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}
                  >
                    {Math.round(t * 100)}%
                  </text>
                </g>
              )
            })}
          </svg>

          <div className={styles['hits']} role="group" aria-label={`Share of fees charged in ${symbol}`}>
            {visible.map((s) => {
              const w = Math.max(s.w, MIN_HIT)
              const left = Math.min(Math.max(s.x + s.w / 2 - w / 2, 0), W - w)
              return (
                <button
                  key={s.key}
                  type="button"
                  className={styles['hit']}
                  style={{ left, width: w, top: PT, height: BH } as CSSProperties}
                  aria-label={`${s.label}: ${fmt(s.value)} ${symbol}, ${pctText(s.pct)} of the fees charged in ${symbol}. ${s.detail}.`}
                  onMouseEnter={() => setHover(s.i)}
                  onFocus={() => setFocus(s.i)}
                  onBlur={() => setFocus(null)}
                  onClick={() => setPinned((p) => (p === s.i ? null : s.i))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') clear()
                  }}
                />
              )
            })}
          </div>

          {activeSeg ? (
            <div
              aria-hidden="true"
              className={styles['tip']}
              style={{ left: tipLeft, top: PT + BH + 8, width: TIP_W }}
            >
              <b className={styles['tipHead']}>{activeSeg.label}</b>
              <span className={styles['tipRow']}>
                <span className={styles['tipMut']}>Amount</span> {fmt(activeSeg.value)} {symbol}
              </span>
              <span className={styles['tipRow']}>
                <span className={styles['tipMut']}>Share</span> {pctText(activeSeg.pct)}
              </span>
              <span className={styles['tipFoot']}>{activeSeg.detail}</span>
            </div>
          ) : null}
        </div>
      </div>

      <ul className={styles['legend']}>
        {drawn.map((s) => (
          <li key={s.key} className={styles['legendItem']} data-zero={s.value === 0n ? '' : undefined}>
            <i className={cx(styles['swatch'], s.swatch)} aria-hidden="true" />
            <span className={styles['legendLabel']}>{s.label}</span>
            <span className={styles['legendValue']}>
              {s.unconfigured !== null && s.value === 0n
                ? `— ${s.unconfigured}`
                : `${fmt(s.value)} ${symbol} · ${pctText(s.pct)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

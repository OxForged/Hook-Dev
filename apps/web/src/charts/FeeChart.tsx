import './viz.css'
import {
  FEE_MAX,
  FEE_ROWS,
  PROTOCOL_FEE_PIPS,
  fmt,
  formatIncrease,
  increasePhrase,
  pipsToPct,
} from './data'
import type { FeeTierComputed } from './data'
import { Figure } from './chart-kit'
import { hBarPath, ticksFor, useMeasuredWidth } from './chart-utils'
import { useChartTip } from './useChartTip'
import type { DatumTipProps } from './useChartTip'

const S1 = 'var(--s1)'
const S2 = 'var(--s2)'

const BAR_H = 18
/** Surface gap that separates the two stacked segments. */
const SEG_GAP = 2
/** Room at the right for the total that rides the bar's tip. */
const RIGHT_PAD = 62

function FeeBand({
  row,
  width,
  plotW,
  ticks,
  tipProps,
}: {
  row: FeeTierComputed
  width: number
  plotW: number
  ticks: readonly number[]
  tipProps: DatumTipProps
}) {
  const x = (v: number) => (v / FEE_MAX) * plotW
  const lpW = Math.max(x(row.lp), 1.5)
  const protoW = Math.max(x(row.total) - lpW - SEG_GAP, 1.5)
  const label = `${row.tier} tier: LP fee ${fmt.format(row.lp)} pips plus protocol fee ${fmt.format(
    row.protocol,
  )} pips, total ${fmt.format(row.total)} pips paid by the swapper — ${increasePhrase(
    row.ratio,
  )} alone.`

  return (
    <div className="viz-band" tabIndex={0} role="img" aria-label={label} {...tipProps}>
      <div className="viz-band-head">
        <span className="viz-band-name">{row.tier}</span>
        <span className="viz-band-delta">{increasePhrase(row.ratio)}</span>
      </div>
      <svg width={width} height={BAR_H} role="presentation" focusable="false">
        {ticks.map((t) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={0}
            y2={BAR_H}
            stroke="var(--viz-grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}
        {/* LP fee sits at the baseline: square both ends, it is an interior segment. */}
        <rect x={0} y={0} width={lpW} height={BAR_H} fill={S1} />
        {/* Protocol fee carries the data end: 4px rounded. */}
        <path d={hBarPath(lpW + SEG_GAP, 0, protoW, BAR_H)} fill={S2} />
        <text x={x(row.total) + 7} y={BAR_H / 2} className="viz-val" dominantBaseline="middle">
          {fmt.format(row.total)}
        </text>
      </svg>
    </div>
  )
}

export function FeeChart() {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const tip = useChartTip()

  const plotW = Math.max(80, width - RIGHT_PAD)
  const ticks = ticksFor(10000, 2500, plotW)
  const x = (v: number) => (v / FEE_MAX) * plotW

  const chart = (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <>
          {FEE_ROWS.map((row) => (
            <FeeBand
              key={row.tier}
              row={row}
              width={width}
              plotW={plotW}
              ticks={ticks}
              tipProps={tip.datumProps(row.tier, {
                title: `${row.tier} · ${fmt.format(row.total)} pips total`,
                rows: [
                  { label: 'LP fee', value: `${fmt.format(row.lp)} pips`, color: S1 },
                  { label: 'Protocol fee', value: `${fmt.format(row.protocol)} pips`, color: S2 },
                ],
              })}
            />
          ))}
          <svg width={width} height={20} className="viz-axis" role="presentation" focusable="false">
            <line
              x1={0}
              x2={x(FEE_MAX)}
              y1={0.5}
              y2={0.5}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            {ticks.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={14}
                className="viz-tick"
                textAnchor={i === 0 ? 'start' : 'middle'}
              >
                {fmt.format(t)}
              </text>
            ))}
          </svg>
          <p className="viz-axis-title">Pips of swap input · 10,000 pips = 1.00%</p>
          {tip.element}
        </>
      )}
    </div>
  )

  const table = (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">
          What a swapper pays per pool tier, split into LP fee and protocol fee, at a 1,000 pip
          protocol fee.
        </caption>
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">LP fee</th>
            <th scope="col">Protocol fee</th>
            <th scope="col">Swapper pays</th>
            <th scope="col">Increase</th>
          </tr>
        </thead>
        <tbody>
          {FEE_ROWS.map((row) => (
            <tr key={row.tier}>
              <th scope="row">{row.tier}</th>
              <td className="num">
                {fmt.format(row.lp)} <span className="unit">({pipsToPct(row.lp)})</span>
              </td>
              <td className="num">
                {fmt.format(row.protocol)} <span className="unit">({pipsToPct(row.protocol)})</span>
              </td>
              <td className="num">
                {fmt.format(row.total)} <span className="unit">({pipsToPct(row.total)})</span>
              </td>
              <td className="num">{formatIncrease(row.ratio)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <Figure
      title="What the swapper pays, by pool tier"
      subtitle={`At a flat ${fmt.format(PROTOCOL_FEE_PIPS)} pip (${pipsToPct(
        PROTOCOL_FEE_PIPS,
      )}) protocol fee. The protocol block is almost the same width in every row — that is the point.`}
      legend={[
        { label: 'LP fee (set by the tier)', color: S1 },
        { label: 'Protocol fee (flat)', color: S2 },
      ]}
      caption={
        <>
          Computed with the contract&rsquo;s own formula,{' '}
          <code>total = protocolFee + lpFee - (protocolFee × lpFee / 1,000,000)</code>, ported from{' '}
          <code>ProtocolFeeLibrary.calculateSwapFee</code>. The protocol fee is taken from swap
          input first and the LP fee applies to the remainder, so it is additive to what a swapper
          pays and does not reduce LP earnings. The truncating cross-term is why the protocol block
          reads 997 and 990 pips on the two widest tiers rather than a flat 1,000.
        </>
      }
      chart={chart}
      table={table}
    />
  )
}

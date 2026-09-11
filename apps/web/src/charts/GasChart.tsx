import './viz.css'
import { GAS_MAX, GAS_ROWS, fmt, gasDeltaPct } from './data'
import type { GasRow } from './data'
import { Figure } from './chart-kit'
import { hBarPath, ticksFor, useMeasuredWidth } from './chart-utils'
import { useChartTip } from './useChartTip'
import type { DatumTipProps } from './useChartTip'

const S1 = 'var(--series-1)'
const S2 = 'var(--series-2)'

const BAR_H = 13
const BAR_GAP = 4
const BAND_H = BAR_H * 2 + BAR_GAP
/** Room at the right for the value label that rides each bar's tip. */
const RIGHT_PAD = 62

function deltaLabel(row: GasRow): string {
  return `+${gasDeltaPct(row).toFixed(1)}%`
}

function GasBand({
  row,
  width,
  plotW,
  ticks,
  tipProps,
}: {
  row: GasRow
  width: number
  plotW: number
  ticks: readonly number[]
  tipProps: DatumTipProps
}) {
  const x = (v: number) => (v / GAS_MAX) * plotW
  const label = `${row.test}: ${fmt.format(row.cancun)} gas on Cancun, ${fmt.format(
    row.shanghai,
  )} gas on Shanghai, ${deltaLabel(row)} more.`

  return (
    <div className="viz-band" tabIndex={0} role="img" aria-label={label} {...tipProps}>
      <div className="viz-band-head">
        <span className="viz-band-name">{row.test}</span>
        <span className="viz-band-delta">{deltaLabel(row)}</span>
      </div>
      <svg width={width} height={BAND_H} role="presentation" focusable="false">
        {ticks.map((t) => (
          <line
            key={t}
            x1={x(t)}
            x2={x(t)}
            y1={0}
            y2={BAND_H}
            stroke="var(--viz-grid)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        ))}
        <path d={hBarPath(0, 0, Math.max(x(row.cancun), 2), BAR_H)} fill={S1} />
        <path d={hBarPath(0, BAR_H + BAR_GAP, Math.max(x(row.shanghai), 2), BAR_H)} fill={S2} />
        <text x={x(row.cancun) + 7} y={BAR_H / 2} className="viz-val" dominantBaseline="middle">
          {fmt.format(row.cancun)}
        </text>
        <text
          x={x(row.shanghai) + 7}
          y={BAR_H + BAR_GAP + BAR_H / 2}
          className="viz-val"
          dominantBaseline="middle"
        >
          {fmt.format(row.shanghai)}
        </text>
      </svg>
    </div>
  )
}

export function GasChart() {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const tip = useChartTip()

  const plotW = Math.max(80, width - RIGHT_PAD)
  const ticks = ticksFor(GAS_MAX, 50000, plotW)
  const x = (v: number) => (v / GAS_MAX) * plotW

  const chart = (
    <div className="viz-plot" ref={ref}>
      {width > 0 && (
        <>
          {GAS_ROWS.map((row) => (
            <GasBand
              key={row.test}
              row={row}
              width={width}
              plotW={plotW}
              ticks={ticks}
              tipProps={tip.datumProps(row.test, {
                title: row.test,
                rows: [
                  { label: 'Cancun (EIP-1153)', value: `${fmt.format(row.cancun)} gas`, color: S1 },
                  { label: 'Shanghai (storage)', value: `${fmt.format(row.shanghai)} gas`, color: S2 },
                ],
              })}
            />
          ))}
          <svg width={width} height={20} className="viz-axis" role="presentation" focusable="false">
            <line
              x1={0}
              x2={plotW}
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
          <p className="viz-axis-title">Gas used</p>
          {tip.element}
        </>
      )}
    </div>
  )

  const table = (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">
          Gas per test under each settlement backend, with the percentage penalty of the
          storage-backed build.
        </caption>
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Cancun</th>
            <th scope="col">Shanghai</th>
            <th scope="col">Delta</th>
          </tr>
        </thead>
        <tbody>
          {GAS_ROWS.map((row) => (
            <tr key={row.test}>
              <th scope="row" className="num brk">
                {row.test}
              </th>
              <td className="num">{fmt.format(row.cancun)}</td>
              <td className="num">{fmt.format(row.shanghai)}</td>
              <td className="num">{deltaLabel(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <Figure
      title="Cost of running without transient storage"
      subtitle="Gas for the same six settlement tests, compiled against each backend. Sorted by penalty."
      legend={[
        { label: 'Cancun (EIP-1153 transient storage)', color: S1 },
        { label: 'Shanghai (persistent storage)', color: S2 },
      ]}
      caption={
        <>
          Measured with <code>forge test</code> over one suite run under each build profile. These
          are <strong>test-path measurements, not swap benchmarks</strong> — a real swap touches
          more delta slots than these tests do, so the production delta is not yet measured and is
          not claimed here.
        </>
      }
      chart={chart}
      table={table}
    />
  )
}

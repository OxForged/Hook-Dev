/* 30D / 90D / 1Y switcher — mono pills, active pill on Active Nav / Sky Ink. */

import type { Range } from '../data/types.ts'

const RANGES: Range[] = ['30D', '90D', '1Y']

export function RangeSwitcher({
  value,
  onChange,
  label,
}: {
  value: Range
  onChange: (range: Range) => void
  label: string
}) {
  return (
    <div className="dapp-switcher" role="group" aria-label={label}>
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={r === value ? 'dapp-pill is-active' : 'dapp-pill'}
          aria-pressed={r === value}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

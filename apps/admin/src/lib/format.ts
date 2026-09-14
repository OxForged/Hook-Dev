export const shortAddr = (a: string | null | undefined): string => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? '—'))
export const shortHash = (h: string | null | undefined): string => (h && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : (h ?? '—'))

/** ISO -> "2026-09-14 18:40:43 UTC". Operators coordinate across time zones; UTC always. */
export function utc(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3_600)
  const m = Math.floor((s % 3_600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const s = (now.getTime() - new Date(iso).getTime()) / 1000
  return s < 0 ? `in ${duration(-s)}` : `${duration(s)} ago`
}

/** Digits with thin grouping, exact (string in, string out; never parsed to a float). */
export function group(n: string | number | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—'
  const s = String(n)
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(s)
  if (!m) return s
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}`
}

/** A token amount: units with symbol, or the raw integer labelled as raw when decimals are unknown. */
export function amount(units: string | null | undefined, symbol: string | null | undefined, raw?: string | null): string {
  if (units !== null && units !== undefined) return `${group(units)} ${symbol ?? '(symbol unread)'}`
  if (raw) return `${group(raw)} raw units (decimals unread)`
  return '—'
}

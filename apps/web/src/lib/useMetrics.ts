import { useEffect, useState } from 'react'
import { readProtocolMetrics, type ProtocolMetrics } from './chain'

export type MetricsState =
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; m: ProtocolMetrics }

/**
 * Live protocol metrics, shared by the landing page and the dapp.
 *
 * Deliberately has no mock fallback. If the chain is unreachable the caller shows
 * an error, not a placeholder — a number that silently degrades from real to
 * invented is indistinguishable to the reader, which is exactly when it matters.
 */
export function useProtocolMetrics(): MetricsState {
  const [s, setS] = useState<MetricsState>({ k: 'loading' })
  useEffect(() => {
    let off = false
    readProtocolMetrics()
      .then((m) => !off && setS({ k: 'ready', m }))
      .catch((e) => !off && setS({ k: 'error', message: e instanceof Error ? e.message : 'unreachable' }))
    return () => { off = true }
  }, [])
  return s
}

/** Compact token amount: 1295.8542 -> "1,295.85". No currency symbol; these are unpriced testnet tokens. */
export function fmtToken(v: bigint, decimals: number, places = 2): string {
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const frac = ((v % base) * 10n ** BigInt(places)) / base
  return `${whole.toLocaleString('en-US')}.${frac.toString().padStart(places, '0')}`
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, ApiError, type ApiFailure } from './api.ts'

export type Loadable<T> = { kind: 'loading' } | { kind: 'ok'; data: T; loadedAt: Date } | ApiFailure

/** GET a /v1/admin path; re-runs when the path changes. `path === null` stays idle. */
export function useApi<T>(path: string | null): { state: Loadable<T>; reload: () => void } {
  const [state, setState] = useState<Loadable<T>>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const seq = useRef(0)
  useEffect(() => {
    if (path === null) return
    const mine = ++seq.current
    setState({ kind: 'loading' })
    apiGet<T>(path)
      .then((data) => mine === seq.current && setState({ kind: 'ok', data, loadedAt: new Date() }))
      .catch((e: unknown) => {
        if (mine !== seq.current) return
        setState(e instanceof ApiError ? e.failure : { kind: 'error', message: String(e), status: null })
      })
  }, [path, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { state, reload }
}

/** A clock that ticks every `ms`, for countdowns. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

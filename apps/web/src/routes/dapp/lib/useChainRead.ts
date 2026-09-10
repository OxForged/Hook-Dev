/* ============================================================================
   One async read, in the four states a screen has to tell apart.

   Same shape and the same rule as `lib/useMetrics.ts` and `usePortfolio.ts`:
   there is NO mock fallback. An unreachable chain settles as `error` and the
   screen says the chain is unreachable — it never substitutes a figure.

   `key` is the identity of the request. A result is tagged with the key it
   answered and is only rendered against that same key, so a response for a
   previous pool id or a previous address can never be shown under the current
   one. `key === null` means "nothing to read yet", which is `idle` — a
   distinct state from `loading`, because "no wallet connected" and "reading"
   are different things to a reader.
   ============================================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ReadState<T> =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'error'; message: string }
  | { k: 'ready'; data: T }

type Settled<T> = Extract<ReadState<T>, { k: 'error' } | { k: 'ready' }>

export function useChainRead<T>(
  key: string | null,
  load: () => Promise<T>,
): { state: ReadState<T>; reload: () => void } {
  const [nonce, setNonce] = useState(0)
  const [settled, setSettled] = useState<{ key: string; s: Settled<T> } | null>(null)

  /* The loader closes over props and so changes identity every render; keeping
     it in a ref means the fetch effect re-runs when the KEY changes and not
     when React re-renders. The key is the request's identity, not the closure.

     Synced in its own effect rather than during render — a ref written while
     rendering is a torn read under concurrent rendering. Effects in one commit
     run in declaration order, so this one is always current by the time the
     fetch below reads it. */
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  const full = key === null ? null : `${key}#${nonce}`

  useEffect(() => {
    if (full === null) return
    let off = false
    loadRef
      .current()
      .then((data) => {
        if (!off) setSettled({ key: full, s: { k: 'ready', data } })
      })
      .catch((e: unknown) => {
        if (!off) {
          setSettled({
            key: full,
            s: { k: 'error', message: e instanceof Error ? e.message : String(e) },
          })
        }
      })
    return () => {
      off = true
    }
  }, [full])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const state: ReadState<T> =
    full === null ? { k: 'idle' } : settled && settled.key === full ? settled.s : { k: 'loading' }

  return { state, reload }
}

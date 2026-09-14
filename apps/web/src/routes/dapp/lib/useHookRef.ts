/* ============================================================================
   Which RevShareHook(s) the revenue-share screens are pointed at.

     ?hook=0x…            an operator pointing the screens at one hook. Always
                          labelled in the UI as coming from the URL, because the
                          reader should know a stranger's link chose it.
     VITE_REVSHARE_HOOK   a build-time default, also exactly one hook.
     neither              EVERY RevShareHook in the SDK address book for this
                          chain — current and retired. A retired hook still
                          hosts pools (LTT1/LTT2 lives on 0x23CE… for as long as
                          that pool exists), and its pools, balances and
                          proposals are as live as the current hook's.

   A ONE-POOL SCREEN DOES NOT USE THE LIST. A pool's hook is part of its id, so
   /app/protocol/:poolId reads the hook out of the pool's own key
   (`resolvePoolHook`) unless a hook was pinned explicitly. Reading a pool id
   against the "current" hook is what made LTT1/LTT2 look unconfigured.

   `withHook` keeps an explicit `?hook=` on every in-app link, so following one
   does not silently switch which contract is read.
   ============================================================================ */

import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { hookParamIsMalformed, resolveHooks, type HookRef } from './revshare'

export interface HookContext {
  /** The explicitly pinned hook (`?hook=` or the build variable), or null. */
  ref: HookRef | null
  /** Every hook to read: the pinned one, or the whole address book. */
  refs: HookRef[]
  /** True when `?hook=` was supplied but is not a 20-byte address. */
  malformed: boolean
  /** Append `?hook=` to an in-app path when the address came from the URL. */
  withHook: (path: string) => string
}

export function useHookRef(): HookContext {
  const [params] = useSearchParams()
  const raw = params.get('hook')

  return useMemo(() => {
    const refs = resolveHooks(raw)
    const first = refs[0]
    const pinned = first && (first.source === 'url' || first.source === 'build') ? first : null
    const suffix = pinned && pinned.source === 'url' ? `?hook=${pinned.address}` : ''
    return {
      ref: pinned,
      refs,
      malformed: hookParamIsMalformed(raw),
      withHook: (path: string) => `${path}${suffix}`,
    }
  }, [raw])
}

/* ============================================================================
   Which RevShareHook the revenue-share screens are pointed at.

   `DEPLOYMENTS` in lib/chain.ts carries no RevShareHook, because none is
   deployed on Sepolia. That absence is configuration, not an error, and it is
   resolved here so all four screens agree:

     ?hook=0x…            an operator pointing the screens at their own
                          deployment. Always labelled in the UI as coming from
                          the URL, because the reader should know a stranger's
                          link chose the contract being read.
     VITE_REVSHARE_HOOK   a build-time default.
     neither              null — the screens render "not deployed on this
                          chain", which is the honest state today.

   `withHook` keeps the parameter on every in-app link, so following one from
   /app/protocol to a pool does not silently switch which contract is read.
   ============================================================================ */

import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { hookParamIsMalformed, resolveHook, type HookRef } from './revshare'

export interface HookContext {
  ref: HookRef | null
  /** True when `?hook=` was supplied but is not a 20-byte address. */
  malformed: boolean
  /** Append `?hook=` to an in-app path when the address came from the URL. */
  withHook: (path: string) => string
}

export function useHookRef(): HookContext {
  const [params] = useSearchParams()
  const raw = params.get('hook')

  return useMemo(() => {
    const ref = resolveHook(raw)
    const suffix = ref && ref.source === 'url' ? `?hook=${ref.address}` : ''
    return {
      ref,
      malformed: hookParamIsMalformed(raw),
      withHook: (path: string) => `${path}${suffix}`,
    }
  }, [raw])
}

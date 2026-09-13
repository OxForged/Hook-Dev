/* ============================================================================
   Route-level code splitting.

   Every top-level surface (landing, docs, dapp, brand, legal, verify) is its
   own chunk, so a visitor to `/` does not download wagmi, RainbowKit and the
   seven dapp screens before the first paint.

   Why not bare `React.lazy`: a lazy component ALWAYS suspends on its first
   render, even when its module has already been fetched, because React only
   learns the promise resolved in a later microtask. On the initial page load
   that means a Suspense fallback is committed and then swapped for the real
   page — a visible layout jump — and React additionally throttles that reveal
   by up to ~300ms after a fallback commits. `main.tsx` therefore calls
   `preload()` for the route the URL points at BEFORE the first render, and
   the component below renders the loaded module directly when it can, falling
   back to the lazy path (and so to Suspense) only when it cannot.

   Client-side navigations do not need any of this: react-router v7 wraps
   history updates in `startTransition`, so React keeps the current page on
   screen while the next route's chunk downloads instead of flashing a
   fallback.
   ============================================================================ */

import { lazy, useState, type ComponentType } from 'react'

type RouteModule = { readonly default: ComponentType }

export type LazyRoute = ComponentType & {
  /** Fetch the route's chunk without rendering it. Idempotent. */
  readonly preload: () => Promise<RouteModule>
}

export function lazyRoute(load: () => Promise<RouteModule>): LazyRoute {
  let loaded: ComponentType | undefined
  let pending: Promise<RouteModule> | undefined

  const preload = (): Promise<RouteModule> => {
    pending ??= load().then(
      (mod) => {
        loaded = mod.default
        return mod
      },
      (error: unknown) => {
        // Forget the failure so a later preload() may try again. React.lazy
        // keeps its own copy of the rejection, which is why recovery from a
        // failed chunk is a full reload (see RouteErrorBoundary).
        pending = undefined
        throw error
      },
    )
    return pending
  }

  const Lazy = lazy(preload)

  function LazyRouteComponent() {
    // Decided once per mount. Switching between the two element types on a
    // later render would remount the whole route and drop its state.
    const [Ready] = useState(() => loaded)
    return Ready ? <Ready /> : <Lazy />
  }

  return Object.assign(LazyRouteComponent, { preload })
}

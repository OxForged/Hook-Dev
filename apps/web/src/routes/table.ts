/* ============================================================================
   The lazily-loaded surfaces, and the one table that maps URLs onto them.

   App.tsx renders its <Route>s from ROUTES and main.tsx preloads from the same
   list, so the path a route is rendered at and the path its chunk is preloaded
   for cannot drift apart.

   Each `import()` below is a chunk boundary. Do not import any of these route
   modules statically from anywhere else in the entry graph — one static import
   silently folds that whole surface (and for the dapp, the entire wallet stack)
   back into the bundle every visitor downloads.
   ============================================================================ */

import { matchPath } from 'react-router-dom'

import { lazyRoute, type LazyRoute } from '../lib/lazyRoute.tsx'

/**
 * The router's basename. `import.meta.env.BASE_URL` is exactly the `base`
 * vite.config.ts computed (e.g. `/Hook-Dev/` on a GitHub Pages project site),
 * always with a trailing slash; react-router wants none, and '' at the root.
 */
export const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '')

export const Landing = lazyRoute(() => import('./landing/index.tsx'))
export const Docs = lazyRoute(() => import('./docs/index.tsx'))
export const Dapp = lazyRoute(() => import('./dapp/DappRoute.tsx'))
export const Brand = lazyRoute(() => import('./brand/index.tsx'))
export const Privacy = lazyRoute(() => import('./legal/Privacy.tsx'))
export const Terms = lazyRoute(() => import('./legal/Terms.tsx'))
export const Verify = lazyRoute(() => import('./verify/index.tsx'))

type RouteEntry = {
  readonly path: string
  readonly Component: LazyRoute
  /**
   * Hold the first paint until this route's chunk has arrived, so the page
   * renders once instead of fallback-then-page. True for the light public
   * surfaces. False for the dapp: its chunk carries the whole wallet stack,
   * and a visible loading state beats a long blank screen.
   */
  readonly holdFirstPaint: boolean
}

export const ROUTES: readonly RouteEntry[] = [
  { path: '/', Component: Landing, holdFirstPaint: true },
  { path: '/docs', Component: Docs, holdFirstPaint: true },
  { path: '/app/*', Component: Dapp, holdFirstPaint: false },
  { path: '/brand', Component: Brand, holdFirstPaint: true },
  { path: '/privacy', Component: Privacy, holdFirstPaint: true },
  { path: '/terms', Component: Terms, holdFirstPaint: true },
  { path: '/verify/:hookAddress', Component: Verify, holdFirstPaint: true },
]

/**
 * Start fetching the chunk for the route `pathname` resolves to, and return a
 * promise that settles when first paint may proceed. Never rejects: a chunk
 * that fails to load is reported by RouteErrorBoundary when React renders it,
 * not by blocking the page forever.
 */
export function preloadInitialRoute(pathname: string): Promise<void> {
  const inApp =
    ROUTER_BASENAME === ''
      ? pathname
      : pathname === ROUTER_BASENAME || pathname.startsWith(`${ROUTER_BASENAME}/`)
        ? pathname.slice(ROUTER_BASENAME.length) || '/'
        : null
  if (inApp === null) return Promise.resolve()

  const entry = ROUTES.find((r) => matchPath({ path: r.path, end: true }, inApp) !== null)
  if (entry === undefined) return Promise.resolve()

  const loading = entry.Component.preload().then(
    () => undefined,
    () => undefined,
  )
  return entry.holdFirstPaint ? loading : Promise.resolve()
}

/* The dapp is mounted at /app/* by src/App.tsx (owned by the route shell).
   Every in-app link is built from this constant so the mount point moves in
   one edit. */

export const DAPP_BASE = '/app'

export const dappPath = (segment = ''): string =>
  segment === '' ? DAPP_BASE : `${DAPP_BASE}/${segment}`

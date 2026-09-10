/* ============================================================================
   Environment access.

   The WalletConnect project id is a public, per-application identifier — it is
   not a signing key and it ends up in the browser bundle no matter what. It is
   still read from the environment rather than hardcoded, for two reasons that
   matter more than secrecy:

     1. Repo policy (CLAUDE.md § Secrets) is that credentials of any kind come
        from the environment, never from a committed literal. A committed id is
        also a committed *identity*: anyone forking this repo would silently
        report their traffic against Latch's WalletConnect quota, and a quota
        exhausted by a fork takes down connections for real users.
     2. It lets an integrator drop this package into their own app with their
        own id, which is the whole point of shipping a wrapper.

   Nothing in this module ever logs a value.
   ============================================================================ */

/**
 * Read a build-time variable without depending on `vite/client` types.
 *
 * `import.meta.env` is a Vite-ism. This package is bundler-agnostic, so the
 * access is guarded and structurally typed rather than declared — under a
 * bundler that does not define `import.meta.env` this returns `undefined`
 * instead of throwing at module scope.
 */
export function readBuildEnv(key: string): string | undefined {
  const meta = import.meta as unknown as { env?: Record<string, unknown> }
  const value = meta.env?.[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** The env var this package reads for the WalletConnect project id. */
export const WALLETCONNECT_PROJECT_ID_ENV = 'VITE_WALLETCONNECT_PROJECT_ID'

/**
 * WalletConnect project id from the environment, or `undefined`.
 *
 * `undefined` is a supported state, not an error: `createLatchConfig` degrades
 * to browser-extension and Coinbase connectors only. That keeps local
 * development and CI working without provisioning a cloud project, and it fails
 * loudly in the UI (no "WalletConnect" row) rather than quietly at connect time.
 */
export function walletConnectProjectId(): string | undefined {
  return readBuildEnv(WALLETCONNECT_PROJECT_ID_ENV)
}

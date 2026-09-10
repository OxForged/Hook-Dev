/* ============================================================================
   The one component an app mounts.

   Nesting order is not stylistic — it is required:

     WagmiProvider  ->  QueryClientProvider  ->  RainbowKitProvider

   wagmi v2 runs every read through TanStack Query, so a `useReadContract` under
   a WagmiProvider with no QueryClient above it throws at render. RainbowKit
   consumes both, so it goes innermost.
   ============================================================================ */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, type AvatarComponent, type Theme } from '@rainbow-me/rainbowkit'
import { useMemo, type ReactNode } from 'react'
import type { Chain } from 'viem'
import { WagmiProvider, type Config } from 'wagmi'

import { LATCH_DEFAULT_CHAIN } from '../chains/index.js'
import { createLatchConfig } from '../config/createLatchConfig.js'
import { latchTheme } from '../theme/latchTheme.js'

export interface LatchWalletProviderProps {
  readonly children: ReactNode

  /**
   * A wagmi config from `createLatchConfig`.
   *
   * Strongly preferred over letting this component build one: a config created
   * inside a component is memoised per mount, and a remount (React StrictMode
   * double-invoke, a route-level key change, an HMR boundary) rebuilds every
   * connector and drops the live session.
   */
  readonly config?: Config

  /** Share the app's existing QueryClient. One is created if omitted. */
  readonly queryClient?: QueryClient

  /** Defaults to the Latch theme. */
  readonly theme?: Theme | null

  /**
   * Chain the connect modal targets for a fresh connection. Defaults to
   * Ethereum Sepolia — the only chain Latch contracts are deployed on.
   */
  readonly initialChain?: Chain | number

  readonly appName?: string
  /** Rendered in the modal's "what is a wallet" panel. */
  readonly learnMoreUrl?: string
  readonly modalSize?: 'compact' | 'wide'
  /** Custom account avatar. Defaults to RainbowKit's gradient avatar. */
  readonly avatar?: AvatarComponent

  /** Show wagmi's pending-transaction indicator on the connected pill. */
  readonly showRecentTransactions?: boolean
}

/**
 * Default QueryClient tuning.
 *
 * `retry: 2` rather than TanStack's default of 3, and a 12s stale time: several
 * Latch chains are served by exactly one rate-limited public RPC, and an
 * aggressive retry storm against those is how a page ends up 429'd for the whole
 * session. `refetchOnWindowFocus: false` for the same reason — an alt-tab should
 * not re-run every on-chain read.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 12_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export function LatchWalletProvider({
  children,
  config,
  queryClient,
  theme,
  initialChain = LATCH_DEFAULT_CHAIN,
  appName = 'Latch Protocol',
  learnMoreUrl,
  modalSize = 'compact',
  avatar,
  showRecentTransactions = false,
}: LatchWalletProviderProps) {
  // Both fall back to a lazily-created singleton for the convenience case. The
  // empty dep arrays are intentional: rebuilding either at runtime is the bug
  // this memo exists to prevent, so a changed `config` prop is honoured directly
  // below instead.
  const fallbackConfig = useMemo(() => createLatchConfig({ appName }), [appName])
  const fallbackQueryClient = useMemo(makeQueryClient, [])

  const resolvedTheme = useMemo(() => (theme === undefined ? latchTheme() : theme), [theme])

  const appInfo = useMemo(
    () => (learnMoreUrl === undefined ? { appName } : { appName, learnMoreUrl }),
    [appName, learnMoreUrl],
  )

  return (
    <WagmiProvider config={config ?? fallbackConfig}>
      <QueryClientProvider client={queryClient ?? fallbackQueryClient}>
        <RainbowKitProvider
          theme={resolvedTheme}
          appInfo={appInfo}
          initialChain={initialChain}
          modalSize={modalSize}
          showRecentTransactions={showRecentTransactions}
          {...(avatar === undefined ? {} : { avatar })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

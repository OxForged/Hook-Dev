/* ============================================================================
   wagmi config for Latch.

   Built with `connectorsForWallets` + `createConfig` rather than RainbowKit's
   `getDefaultConfig`, for one reason: `getDefaultConfig` requires a
   WalletConnect `projectId: string` and wires WalletConnect-backed wallets
   unconditionally. Without a real id those rows render, the user clicks one,
   and WalletConnect fails at relay time with a console error. Composing the
   wallet list ourselves lets a missing id remove those rows up front, so the
   modal only ever offers connectors that can actually complete.

   This is exactly the kind of thing the wrapper exists to own. See README
   § "Why a wrapper and not a fork".
   ============================================================================ */

import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { fallback, http, type Chain, type Transport } from 'viem'
import { createConfig, type Config, type CreateConnectorFn } from 'wagmi'

import { LATCH_CHAINS } from '../chains/index.js'
import { walletConnectProjectId } from './env.js'

export interface CreateLatchConfigOptions {
  /**
   * Chains to expose. Defaults to every Latch target chain.
   *
   * Narrow this in an app that only ever writes to the deployed chain — a
   * switcher listing ten networks with no contracts on them is a worse default
   * than a switcher listing one that works.
   */
  readonly chains?: readonly [Chain, ...Chain[]]

  /**
   * WalletConnect project id. Defaults to `VITE_WALLETCONNECT_PROJECT_ID`.
   * When absent, WalletConnect-backed wallets are omitted entirely.
   */
  readonly projectId?: string | undefined

  /** Shown in wallet approval prompts and the connect modal heading. */
  readonly appName?: string

  /** Absolute URL to an app icon, surfaced by WalletConnect-compatible wallets. */
  readonly appIcon?: string

  readonly appDescription?: string
  readonly appUrl?: string

  /**
   * Per-chain transports. Defaults to a viem `fallback` over every public RPC
   * the SDK verified for that chain.
   */
  readonly transports?: Record<number, Transport>

  /** Set true when rendering on a server. Defaults to false. */
  readonly ssr?: boolean
}

/**
 * A `fallback` transport over a chain's verified public RPCs.
 *
 * `rank: false` keeps the SDK's measured fastest-first order rather than letting
 * viem re-rank by live latency: re-ranking issues background probe traffic to
 * every endpoint, and several Latch chains have exactly one endpoint that is
 * also rate-limited. Six of the eleven chains have no second endpoint at all,
 * so for those this is a single `http` in a trench coat — see
 * `SINGLE_ENDPOINT_CHAIN_IDS`.
 */
function defaultTransport(chain: Chain): Transport {
  const urls = chain.rpcUrls.default.http
  const transports = urls.map((url) => http(url, { timeout: 12_000, retryCount: 2 }))
  return transports.length > 1 ? fallback(transports, { rank: false }) : (transports[0] ?? http())
}

function defaultTransports(chains: readonly Chain[]): Record<number, Transport> {
  const out: Record<number, Transport> = {}
  for (const chain of chains) out[chain.id] = defaultTransport(chain)
  return out
}

/**
 * Wallet rows for the connect modal.
 *
 * With a project id: the full recommended set. Without: only connectors that
 * work over an injected provider or Coinbase's own SDK. `safeWallet` is in both
 * lists because it only ever activates inside a Safe app iframe.
 */
function latchConnectors(
  projectId: string | undefined,
  appName: string,
  appIcon: string | undefined,
  appDescription: string | undefined,
  appUrl: string | undefined,
): CreateConnectorFn[] {
  const groups = projectId
    ? [
        {
          groupName: 'Recommended',
          wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet],
        },
        {
          groupName: 'More',
          wallets: [walletConnectWallet, safeWallet],
        },
      ]
    : [
        {
          groupName: 'Browser wallets',
          wallets: [injectedWallet, coinbaseWallet, safeWallet],
        },
      ]

  return connectorsForWallets(groups, {
    appName,
    // `connectorsForWallets` types this as required. Passing '' is safe only
    // because the no-id branch above contains no WalletConnect-backed wallet.
    projectId: projectId ?? '',
    ...(appIcon === undefined ? {} : { appIcon }),
    ...(appDescription === undefined ? {} : { appDescription }),
    ...(appUrl === undefined ? {} : { appUrl }),
  })
}

/**
 * Create the wagmi config the Latch dapp runs on.
 *
 * Call this ONCE per application and keep the result module-scoped. A config
 * rebuilt on render tears down and re-creates every connector, which drops an
 * in-flight connection and re-prompts the user.
 */
export function createLatchConfig(options: CreateLatchConfigOptions = {}): Config {
  const chains = options.chains ?? LATCH_CHAINS
  const projectId = options.projectId ?? walletConnectProjectId()
  const appName = options.appName ?? 'Latch Protocol'

  return createConfig({
    chains,
    connectors: latchConnectors(
      projectId,
      appName,
      options.appIcon,
      options.appDescription,
      options.appUrl,
    ),
    transports: options.transports ?? defaultTransports(chains),
    ssr: options.ssr ?? false,
  })
}

/** True when a WalletConnect project id was found; drives the UI hint. */
export function hasWalletConnect(projectId?: string): boolean {
  return Boolean(projectId ?? walletConnectProjectId())
}

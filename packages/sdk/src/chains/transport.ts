import { fallback, http, type FallbackTransport, type HttpTransportConfig } from 'viem'
import { chainById, resolveEndpoints, SINGLE_ENDPOINT_CHAINS, type ChainKey, CHAIN_RPCS } from './endpoints.js'

/**
 * Auto-failover RPC transport for Latch Protocol chains.
 *
 * Public endpoints rate-limit, lag and disappear — several candidates were already
 * dead or 403ing when this list was probed. A single hardcoded URL is therefore a
 * liveness bug waiting to happen, especially across nine chains.
 *
 * `latchTransport` stacks every verified endpoint (private ones first, from env)
 * behind viem's `fallback`, which retries the next transport when one errors.
 * `rank: true` keeps re-measuring latency at runtime and reorders accordingly, so a
 * provider that degrades stops being asked first — the probe-time ordering here is
 * only the starting point.
 */

export interface LatchTransportOptions {
  /** Environment carrying `LATCH_RPC_<chainId>` overrides. Injected for testability. */
  env?: Record<string, string | undefined>
  /** Re-rank endpoints by live latency and stability. Default true. */
  rank?: boolean
  /** Per-endpoint retry count before falling through. Default 2. */
  retryCount?: number
  /** Per-request timeout in ms. Default 10_000. */
  timeout?: number
  /** Extra viem http() config applied to every endpoint. */
  httpConfig?: HttpTransportConfig
}

export class UnknownChainError extends Error {
  constructor(public readonly chainId: number) {
    super(
      `No RPC endpoints known for chain ${chainId}. Add it to CHAIN_RPCS after probing it, ` +
        `or pass one via LATCH_RPC_${chainId}.`,
    )
    this.name = 'UnknownChainError'
  }
}

/**
 * Build a failover transport for a chain id.
 *
 * @throws UnknownChainError when the chain is neither known nor supplied via env.
 * Failing loudly beats silently falling back to a default chain — a transport that
 * quietly points at the wrong network is how testnet calls end up on mainnet.
 */
export function latchTransport(
  chainId: number,
  opts: LatchTransportOptions = {},
): FallbackTransport {
  const { env = {}, rank = true, retryCount = 2, timeout = 10_000, httpConfig } = opts

  const urls = resolveEndpoints(chainId, env)
  if (urls.length === 0) throw new UnknownChainError(chainId)

  return fallback(
    urls.map((url) => http(url, { retryCount, timeout, ...httpConfig })),
    { rank },
  )
}

/** Same, by chain key, for call sites that know the chain at author time. */
export function latchTransportFor(
  key: ChainKey,
  opts: LatchTransportOptions = {},
): FallbackTransport {
  return latchTransport(CHAIN_RPCS[key].chainId, opts)
}

export interface RedundancyReport {
  readonly chainId: number
  readonly name: string
  readonly endpointCount: number
  /** True when only one endpoint is known, so failover is impossible. */
  readonly singlePointOfFailure: boolean
}

/**
 * Which chains cannot fail over.
 *
 * Call this at startup and surface the result rather than discovering it during an
 * incident. Plasma, Stable and Arc are young enough that few public providers exist;
 * on those, a dedicated node is a requirement rather than an optimisation.
 */
export function redundancyReport(env: Record<string, string | undefined> = {}): RedundancyReport[] {
  return Object.entries(CHAIN_RPCS).map(([key, cfg]) => {
    const count = resolveEndpoints(cfg.chainId, env).length
    return {
      chainId: cfg.chainId,
      name: cfg.name,
      endpointCount: count,
      singlePointOfFailure: count < 2 && SINGLE_ENDPOINT_CHAINS.includes(key as ChainKey),
    }
  })
}

/**
 * Assert a chain's build backend matches its EIP-1153 support.
 *
 * Mirrors `script/BackendGuard.sol` on the TypeScript side: deploying the transient
 * build to a chain without EIP-1153 produces contracts that revert on every lock.
 */
export function assertBackendMatchesChain(chainId: number, builtWithEip1153: boolean): void {
  const cfg = chainById(chainId)
  if (!cfg) throw new UnknownChainError(chainId)
  if (cfg.supportsEip1153 !== builtWithEip1153) {
    throw new Error(
      `Backend mismatch for ${cfg.name} (${chainId}): chain supportsEip1153=${cfg.supportsEip1153} ` +
        `but this build was compiled with eip1153=${builtWithEip1153}.`,
    )
  }
}

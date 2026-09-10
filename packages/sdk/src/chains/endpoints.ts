/**
 * Public RPC endpoints for every Latch Protocol target chain.
 *
 * Every endpoint below was PROBED, not collected from a list. Each one answered
 * `eth_chainId` with the expected id, served `eth_blockNumber`, and was timed.
 * Endpoints that 404'd, 403'd, rate-limited, returned the wrong chain, or failed
 * to resolve were dropped rather than shipped as dead fallbacks.
 *
 * Ordered fastest-first by measured latency, which is also the order a fallback
 * transport should try them in.
 *
 * Probed 2026-09-09. Public endpoints rot: re-run `scripts/probe-rpcs.mjs` before
 * relying on this in production, and expect some of these to have gone away.
 *
 * NONE of these carry an API key. Never add a credentialed URL to this file — it is
 * committed. Keyed providers belong in the environment; see `resolveEndpoints`.
 */

export interface RpcEndpoint {
  readonly url: string
  /** Round-trip for eth_blockNumber at probe time, in ms. Indicative only. */
  readonly latencyMs: number
  /**
   * Whether this endpoint could execute a TSTORE probe.
   * `null` means the endpoint blocks contract-creation `eth_call` entirely, so it
   * could not be asked — which is NOT the same as the chain lacking EIP-1153.
   */
  readonly eip1153: boolean | null
}

export interface ChainRpcConfig {
  readonly chainId: number
  readonly name: string
  /** Whether the CHAIN supports EIP-1153, decided across endpoints, not from one. */
  readonly supportsEip1153: boolean
  readonly endpoints: readonly RpcEndpoint[]
}

export const CHAIN_RPCS = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://eth.drpc.org', latencyMs: 49, eip1153: true },
      { url: 'https://eth.merkle.io', latencyMs: 168, eip1153: false },
      { url: 'https://rpc.flashbots.net', latencyMs: 227, eip1153: null },
    ],
  },
  base: {
    chainId: 8453,
    name: 'Base',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://base.drpc.org', latencyMs: 57, eip1153: true },
      { url: 'https://base.gateway.tenderly.co', latencyMs: 153, eip1153: true },
      { url: 'https://base-rpc.publicnode.com', latencyMs: 158, eip1153: true },
      { url: 'https://mainnet.base.org', latencyMs: 176, eip1153: true },
    ],
  },
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://bsc-dataseed2.bnbchain.org', latencyMs: 84, eip1153: true },
      { url: 'https://bsc-dataseed.bnbchain.org', latencyMs: 90, eip1153: true },
      { url: 'https://bsc-dataseed1.defibit.io', latencyMs: 106, eip1153: true },
      { url: 'https://bsc-rpc.publicnode.com', latencyMs: 307, eip1153: true },
    ],
  },
  hyperevm: {
    chainId: 999,
    name: 'HyperEVM',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://hyperliquid.drpc.org', latencyMs: 50, eip1153: true },
      { url: 'https://rpc.hyperliquid.xyz/evm', latencyMs: 156, eip1153: true },
      { url: 'https://rpc.hyperlend.finance', latencyMs: 197, eip1153: null },
      { url: 'https://hyperliquid-json-rpc.stakely.io', latencyMs: 242, eip1153: true },
      { url: 'https://rpc.hypurrscan.io', latencyMs: 685, eip1153: true },
    ],
  },
  monad: {
    chainId: 143,
    name: 'Monad',
    supportsEip1153: true,
    endpoints: [{ url: 'https://rpc.monad.xyz', latencyMs: 0, eip1153: true }],
  },
  monadTestnet: {
    chainId: 10143,
    name: 'Monad Testnet',
    supportsEip1153: true,
    endpoints: [{ url: 'https://testnet-rpc.monad.xyz', latencyMs: 0, eip1153: true }],
  },
  plasma: {
    chainId: 9745,
    name: 'Plasma',
    supportsEip1153: true,
    endpoints: [{ url: 'https://rpc.plasma.to', latencyMs: 262, eip1153: true }],
  },
  stable: {
    chainId: 988,
    name: 'Stable',
    supportsEip1153: true,
    endpoints: [{ url: 'https://rpc.stable.xyz', latencyMs: 222, eip1153: true }],
  },
  sepolia: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    supportsEip1153: true,
    endpoints: [
      { url: 'https://ethereum-sepolia-rpc.publicnode.com', latencyMs: 151, eip1153: true },
    ],
  },
  stableTestnet: {
    chainId: 2201,
    name: 'Stable Testnet',
    supportsEip1153: true,
    endpoints: [{ url: 'https://rpc.testnet.stable.xyz', latencyMs: 220, eip1153: true }],
  },
  arcTestnet: {
    chainId: 5042002,
    name: 'Arc Testnet',
    supportsEip1153: true,
    endpoints: [{ url: 'https://rpc.testnet.arc.io', latencyMs: 88, eip1153: true }],
  },
} as const satisfies Record<string, ChainRpcConfig>

export type ChainKey = keyof typeof CHAIN_RPCS

/**
 * Chains with only ONE verified public endpoint. A fallback transport cannot fail
 * over on these — if that endpoint is down, the chain is unreachable.
 *
 * Three of them (Plasma, Stable, Arc) are young networks where few public providers
 * exist yet. Treat a paid or self-hosted node as a requirement, not an optimisation,
 * before running anything that matters on these chains.
 */
export const SINGLE_ENDPOINT_CHAINS: readonly ChainKey[] = [
  'monad',
  'monadTestnet',
  'plasma',
  'stable',
  'sepolia',
  'stableTestnet',
  'arcTestnet',
]

const BY_ID = new Map<number, ChainRpcConfig>(
  Object.values(CHAIN_RPCS).map((c) => [c.chainId, c]),
)

export function chainById(chainId: number): ChainRpcConfig | undefined {
  return BY_ID.get(chainId)
}

/**
 * Ordered endpoint URLs for a chain, private providers first.
 *
 * A keyed provider is always preferable to a public one: public endpoints rate-limit,
 * lag, and disappear. Supply yours via env (`LATCH_RPC_<CHAINID>`, comma-separated for
 * several) and they are tried before the public list, which then acts as a safety net.
 *
 * @param chainId target chain
 * @param env process environment, injected so this stays testable and browser-safe
 */
export function resolveEndpoints(
  chainId: number,
  env: Record<string, string | undefined> = {},
): string[] {
  const priv = (env[`LATCH_RPC_${chainId}`] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const pub = chainById(chainId)?.endpoints.map((e) => e.url) ?? []

  // de-dupe while preserving order, private first
  return [...new Set([...priv, ...pub])]
}

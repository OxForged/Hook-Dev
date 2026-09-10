/* eslint-disable */
/* ============================================================================
   GENERATED FILE — DO NOT EDIT BY HAND.

   Emitted by apps/web/scripts/sync-chains.mjs from
   packages/sdk/src/chains/endpoints.ts (`CHAIN_RPCS`), the canonical list of
   Latch Protocol target chains. Every chain below was verified empirically by
   executing a TSTORE probe against the live network — not read from a spec.

   Regenerate with `npm run sync-chains`; `predev` and `prebuild` do it for you.

   NOTE: presence here means "EIP-1153 verified target", NOT "Latch is live".
   Deployment status lives in src/data/chains.ts, which is hand-maintained
   against on-chain reality.
   ============================================================================ */

export type ChainNetwork = 'mainnet' | 'testnet'

export interface SdkChain {
  /** Key in the SDK's `CHAIN_RPCS` map. */
  readonly key: ChainKey
  readonly chainId: number
  readonly name: string
  /** Derived from the chain's own name in the SDK. */
  readonly network: ChainNetwork
  /** Decided across endpoints by live probe, not per endpoint. */
  readonly supportsEip1153: boolean
  /** Verified public RPCs known to the SDK. */
  readonly endpointCount: number
  /** Only one endpoint — a fallback transport cannot fail over. */
  readonly singlePointOfFailure: boolean
  readonly fastestEndpoint: string
}

export const CHAIN_KEYS = [
  'ethereum',
  'base',
  'bsc',
  'hyperevm',
  'monad',
  'monadTestnet',
  'plasma',
  'stable',
  'sepolia',
  'stableTestnet',
  'arcTestnet',
] as const

export type ChainKey = (typeof CHAIN_KEYS)[number]

export const SDK_CHAINS: readonly SdkChain[] = [
  {
    key: 'ethereum',
    chainId: 1,
    name: 'Ethereum',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 3,
    singlePointOfFailure: false,
    fastestEndpoint: 'https://eth.drpc.org',
  },
  {
    key: 'base',
    chainId: 8453,
    name: 'Base',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 4,
    singlePointOfFailure: false,
    fastestEndpoint: 'https://base.drpc.org',
  },
  {
    key: 'bsc',
    chainId: 56,
    name: 'BNB Smart Chain',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 4,
    singlePointOfFailure: false,
    fastestEndpoint: 'https://bsc-dataseed2.bnbchain.org',
  },
  {
    key: 'hyperevm',
    chainId: 999,
    name: 'HyperEVM',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 5,
    singlePointOfFailure: false,
    fastestEndpoint: 'https://hyperliquid.drpc.org',
  },
  {
    key: 'monad',
    chainId: 143,
    name: 'Monad',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://rpc.monad.xyz',
  },
  {
    key: 'monadTestnet',
    chainId: 10143,
    name: 'Monad Testnet',
    network: 'testnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://testnet-rpc.monad.xyz',
  },
  {
    key: 'plasma',
    chainId: 9745,
    name: 'Plasma',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://rpc.plasma.to',
  },
  {
    key: 'stable',
    chainId: 988,
    name: 'Stable',
    network: 'mainnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://rpc.stable.xyz',
  },
  {
    key: 'sepolia',
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    network: 'testnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  {
    key: 'stableTestnet',
    chainId: 2201,
    name: 'Stable Testnet',
    network: 'testnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://rpc.testnet.stable.xyz',
  },
  {
    key: 'arcTestnet',
    chainId: 5042002,
    name: 'Arc Testnet',
    network: 'testnet',
    supportsEip1153: true,
    endpointCount: 1,
    singlePointOfFailure: true,
    fastestEndpoint: 'https://rpc.testnet.arc.io',
  },
]

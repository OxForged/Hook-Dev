/* ============================================================================
   Chain definitions for Latch Protocol target chains that wagmi does not ship.

   wagmi/chains already carries Ethereum (1), Base (8453), BNB Smart Chain (56)
   and Ethereum Sepolia (11155111). Those are re-exported from `./index.ts`
   unchanged — redefining a chain wagmi already curates is how a wrong RPC or a
   stale explorer URL gets shipped.

   The seven below are defined here.

   ---------------------------------------------------------------------------
   PROVENANCE — read this before changing a number.
   ---------------------------------------------------------------------------

   `id` and every `rpcUrls.default.http` entry are copied verbatim from
   `packages/sdk/src/chains/endpoints.ts` (`CHAIN_RPCS`), the repo's single
   source of truth. Every endpoint there was probed live on 2026-09-09: it
   answered `eth_chainId` with the expected id and served `eth_blockNumber`.
   Endpoints are listed fastest-first, which is also the order a fallback
   transport should try them in. Nothing here was invented, and nothing here
   carries an API key — keyed providers belong in the environment.

   `name` is copied from the same file.

   `nativeCurrency` and `blockExplorers` are NOT in that file, and are not
   anywhere else in this repository either. They are handled as follows:

     * `blockExplorers` is OMITTED for all seven chains. viem makes the field
       optional, and the repo has a verified explorer for exactly one network
       (Sepolia -> sepolia.etherscan.io, see apps/web/src/lib/chain.ts). A
       guessed explorer host is worse than no explorer link: it sends users to
       a page that may not exist, or worse, to a lookalike. When an explorer is
       verified for one of these chains, add it here and to
       `apps/web/src/data/chains.ts`'s `explorerAddressUrl` in the same change.

     * `nativeCurrency` CANNOT be omitted — viem's `Chain` type requires it,
       and wallets read it when a chain is added via
       `wallet_addEthereumChain`. The symbols below come from each network's
       own public documentation, NOT from anything in this repo, so they are
       listed in `UNVERIFIED_NATIVE_CURRENCY` at the bottom of this file and
       must be confirmed against the live chain before this package is pointed
       at a mainnet holding real funds. Consequence of a wrong value: the
       wallet shows the wrong ticker on the gas line. It does not affect
       calldata, value encoding or settlement.

     * `decimals: 18` is a protocol fact, not a guess. An EVM account balance
       is denominated in wei regardless of what the gas token is branded as,
       so 18 is correct even on the chains that use a stablecoin for gas.
   ============================================================================ */

import { defineChain } from 'viem'

/* ------------------------------------------------------------------ mainnet */

/** HyperEVM — the EVM execution layer of Hyperliquid. Five probed endpoints. */
export const hyperEvm = /*#__PURE__*/ defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'Hype', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://hyperliquid.drpc.org',
        'https://rpc.hyperliquid.xyz/evm',
        'https://rpc.hyperlend.finance',
        'https://hyperliquid-json-rpc.stakely.io',
        'https://rpc.hypurrscan.io',
      ],
    },
  },
  testnet: false,
})

/**
 * Monad mainnet.
 *
 * ONE verified public endpoint. There is no failover: if rpc.monad.xyz is down,
 * the chain is unreachable from this config. Treat a paid or self-hosted node as
 * a requirement here, not an optimisation.
 */
export const monad = /*#__PURE__*/ defineChain({
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } },
  testnet: false,
})

/** Plasma — stablecoin-settlement L1. One verified public endpoint. */
export const plasma = /*#__PURE__*/ defineChain({
  id: 9745,
  name: 'Plasma',
  nativeCurrency: { name: 'Plasma', symbol: 'XPL', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.plasma.to'] } },
  testnet: false,
})

/** Stable — stablecoin-gas L1. One verified public endpoint. */
export const stable = /*#__PURE__*/ defineChain({
  id: 988,
  name: 'Stable',
  nativeCurrency: { name: 'Tether USD', symbol: 'USDT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.stable.xyz'] } },
  testnet: false,
})

/* ------------------------------------------------------------------ testnet */

export const monadTestnet = /*#__PURE__*/ defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  testnet: true,
})

export const stableTestnet = /*#__PURE__*/ defineChain({
  id: 2201,
  name: 'Stable Testnet',
  nativeCurrency: { name: 'Tether USD', symbol: 'USDT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.stable.xyz'] } },
  testnet: true,
})

/**
 * Arc Testnet.
 *
 * Arc MAINNET (5042) is deliberately absent from this package, exactly as it is
 * absent from `apps/web/src/data/chains.ts`: it could not be probed, so it is
 * not claimed as a supported target. Do not add it from memory.
 */
export const arcTestnet = /*#__PURE__*/ defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  testnet: true,
})

/* ------------------------------------------------------------- audit surface */

/**
 * Chain ids whose `nativeCurrency.symbol`/`name` are documentation-sourced
 * rather than repo-sourced, and whose `blockExplorers` are absent because no
 * explorer has been verified for them.
 *
 * This is exported rather than left as a comment so a deploy check can assert on
 * it: a mainnet release should either verify these or refuse to ship.
 */
export const UNVERIFIED_CHAIN_METADATA: readonly number[] = [
  hyperEvm.id,
  monad.id,
  plasma.id,
  stable.id,
  monadTestnet.id,
  stableTestnet.id,
  arcTestnet.id,
]

/**
 * Chains reachable through exactly ONE public RPC. A fallback transport cannot
 * fail over on these. Mirrors `SINGLE_ENDPOINT_CHAINS` in the SDK, restricted to
 * the chains defined in this file.
 */
export const SINGLE_ENDPOINT_CHAIN_IDS: readonly number[] = [
  monad.id,
  monadTestnet.id,
  plasma.id,
  stable.id,
  stableTestnet.id,
  arcTestnet.id,
]

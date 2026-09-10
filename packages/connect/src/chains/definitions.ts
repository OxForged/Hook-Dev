/* ============================================================================
   Chain definitions for Latch Protocol target chains.

   ---------------------------------------------------------------------------
   WHAT CHANGED, AND WHY THERE ARE NO HAND-WRITTEN CHAINS LEFT
   ---------------------------------------------------------------------------

   This file used to `defineChain` seven networks from memory, because wagmi did
   not ship them. As of wagmi 2.19.5 it ships ALL of them — HyperEVM, Monad,
   Monad Testnet, Plasma, Stable, Stable Testnet and Arc Testnet — plus the three
   added in this change (Linea, Ink, X Layer). Every `nativeCurrency` and
   `blockExplorers` value below therefore now comes from wagmi's curated registry
   instead of from this repository's memory, which is a strict improvement: the
   old hand-written entries had Stable's gas token as "Tether USD" / USDT, and
   both wagmi and ethereum-lists say it is USDT0.

   That is the reason the old rule ("redefining a chain wagmi already curates is
   how a wrong RPC or a stale explorer URL gets shipped") is now applied to every
   chain rather than to four of them.

   ---------------------------------------------------------------------------
   THE ONE FIELD WE STILL OWN: rpcUrls
   ---------------------------------------------------------------------------

   wagmi curates a chain's IDENTITY. It does not curate its REACHABILITY: its
   entries carry one to three RPC URLs, chosen for correctness rather than for
   redundancy, and several of them are the single endpoint most likely to be
   rate-limited precisely because everyone uses it.

   So `withLatchRpcs` keeps every curated field and replaces only
   `rpcUrls.default.http` with `LATCH_PUBLIC_RPCS` — the list in
   `packages/sdk/src/chains/endpoints.ts`, where every URL was probed live on
   2026-09-10: it answered `eth_chainId` with the expected id and served
   `eth_blockNumber` three times, ordered fastest-first by the median of those.
   Endpoints that 404'd, 403'd, rate-limited or returned the wrong chain were
   dropped rather than kept as dead fallbacks.

   Nothing here carries an API key. Keyed providers belong in the environment.

   ---------------------------------------------------------------------------
   NOT HERE: Arc mainnet (5042)
   ---------------------------------------------------------------------------

   wagmi ships it, which makes it tempting. It has NO public RPC: Circle's own
   mainnet hosts answer 401/403 and thirdweb's `5042.rpc.thirdweb.com` answers
   `eth_chainId` from a config table while failing every `eth_blockNumber`. A
   chain in this list that cannot be reached is a network the switcher offers and
   the dapp cannot use. Arc TESTNET (5042002) is fully supported. See the header
   of `packages/sdk/src/chains/endpoints.ts`.
   ============================================================================ */

import { defineChain, type Chain } from 'viem'
import {
  arcTestnet as wagmiArcTestnet,
  base as wagmiBase,
  bsc as wagmiBsc,
  hyperEvm as wagmiHyperEvm,
  ink as wagmiInk,
  linea as wagmiLinea,
  mainnet as wagmiMainnet,
  monad as wagmiMonad,
  monadTestnet as wagmiMonadTestnet,
  plasma as wagmiPlasma,
  robinhood as wagmiRobinhood,
  sepolia as wagmiSepolia,
  stable as wagmiStable,
  stableTestnet as wagmiStableTestnet,
  xLayer as wagmiXLayer,
} from 'wagmi/chains'

/* ------------------------------------------------------------ probed RPC list */

/**
 * Verified public RPCs per chain id, fastest-first.
 *
 * Copied verbatim from `CHAIN_RPCS` in `packages/sdk/src/chains/endpoints.ts`,
 * which is the repo's single source of truth and carries the probe methodology,
 * the per-endpoint EIP-1153 result and the record of what was tried and failed.
 * This package cannot import it — connect is published standalone and must not
 * take a dependency on the SDK — so the two are kept in step by hand. Change the
 * SDK first, then mirror it here.
 *
 * Counts below five are real: no fifth public endpoint exists for those chains.
 * The list is never padded with endpoints that failed the probe, because a
 * fallback transport spends a retry on every dead entry before reaching a live one.
 */
export const LATCH_PUBLIC_RPCS: Readonly<Record<number, readonly string[]>> = {
  // Robinhood Chain — 5, five separate operators, all TSTORE-verified.
  // Excluded: `robinhood.drpc.org` (answers eth_chainId from a config table, rejects
  // eth_blockNumber and eth_call) and `lb.routeme.sh` (no usable response).
  4663: [
    'https://rpc.nodeflare.app/robinhood/public',
    'https://robinhood.rpc.blxrbdn.com',
    'https://rpc-robinhood.blockmachine.io',
    'https://rpc.ordofi.network',
    'https://rpc.mainnet.chain.robinhood.com',
  ],
  // Ethereum — 5
  1: [
    'https://eth.drpc.org',
    'https://1.rpc.thirdweb.com',
    'https://eth.rpc.blxrbdn.com',
    'https://rpc.flashbots.net',
    'https://gateway.tenderly.co/public/mainnet',
  ],
  // BNB Smart Chain — 5
  56: [
    'https://56.rpc.thirdweb.com',
    'https://bsc-dataseed1.ninicoin.io',
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-rpc.publicnode.com',
  ],
  // Monad — 5
  143: [
    'https://rpc.monad.xyz',
    'https://143.rpc.thirdweb.com',
    'https://rpc2.monad.xyz',
    'https://monad.gateway.tenderly.co',
    'https://api.zan.top/monad-mainnet',
  ],
  // X Layer — 4. Its canonical `rpc.xlayer.tech` could not be reached from the
  // probing machine (TLS handshake refused, a local network filter), so it is
  // unverified rather than dead and is not shipped. OKX's own `xlayerrpc.okx.com`
  // does answer, so the operator is still represented.
  196: [
    'https://xlayer.drpc.org',
    'https://xlayerrpc.okx.com',
    'https://196.rpc.thirdweb.com',
    'https://api.zan.top/xlayer-mainnet',
  ],
  // Stable — 4
  988: [
    'https://stable.drpc.org',
    'https://stable.gateway.tenderly.co',
    'https://rpc.stable.xyz',
    'https://988.rpc.thirdweb.com',
  ],
  // HyperEVM — 5
  999: [
    'https://rpc.purroofgroup.com',
    'https://hyperliquid.drpc.org',
    'https://999.rpc.thirdweb.com',
    'https://rpc.hyperliquid.xyz/evm',
    'https://rpc.hypurrscan.io',
  ],
  // Stable Testnet — 3
  2201: [
    'https://stable-testnet.gateway.tenderly.co',
    'https://rpc.testnet.stable.xyz',
    'https://2201.rpc.thirdweb.com',
  ],
  // Base — 5
  8453: [
    'https://8453.rpc.thirdweb.com',
    'https://base.drpc.org',
    'https://base.gateway.tenderly.co',
    'https://base-mainnet.public.blastapi.io',
    'https://mainnet.base.org',
  ],
  // Plasma — 3
  9745: [
    'https://rpc.plasma.to',
    'https://plasma.gateway.tenderly.co',
    'https://9745.rpc.thirdweb.com',
  ],
  // Monad Testnet — 5
  10143: [
    'https://10143.rpc.thirdweb.com',
    'https://monad-testnet.drpc.org',
    'https://testnet-rpc.monad.xyz',
    'https://monad-testnet.gateway.tenderly.co',
    'https://api.zan.top/monad-testnet',
  ],
  // Ink — 5
  57073: [
    'https://ink.drpc.org',
    'https://rpc-qnd.inkonchain.com',
    'https://ink.gateway.tenderly.co',
    'https://rpc-gel.inkonchain.com',
    'https://57073.rpc.thirdweb.com',
  ],
  // Linea — 5
  59144: [
    'https://linea.drpc.org',
    'https://59144.rpc.thirdweb.com',
    'https://linea-rpc.publicnode.com',
    'https://rpc.linea.build',
    'https://1rpc.io/linea',
  ],
  // Ethereum Sepolia — 5
  11155111: [
    'https://11155111.rpc.thirdweb.com',
    'https://gateway.tenderly.co/public/sepolia',
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://1rpc.io/sepolia',
    'https://0xrpc.io/sep',
  ],
  // Arc Testnet — 5. Nine hostnames answer, but they front only five operators
  // (Circle, dRPC, QuickNode, Blockdaemon, thirdweb), each published on both
  // *.arc.io and *.arc.network. One hostname per operator is listed, because two
  // names in front of one node is not failover — it is one outage counted twice.
  5042002: [
    'https://rpc.drpc.testnet.arc.io',
    'https://rpc.quicknode.testnet.arc.io',
    'https://5042002.rpc.thirdweb.com',
    'https://rpc.testnet.arc.io',
    'https://rpc.blockdaemon.testnet.arc.io',
  ],
}

/**
 * A wagmi chain with its RPC list replaced by the probed one.
 *
 * Every other curated field — name, nativeCurrency, blockExplorers, contracts,
 * testnet — is passed through untouched. `rpcUrls.default.http` is the only thing
 * this package claims to know better, and it knows it because it measured it.
 *
 * Throws rather than silently falling back when a chain has no probed list: an
 * unprobed chain reaching this function means the two lists have drifted, and a
 * quiet fallback to wagmi's single URL would hide exactly the rate-limit
 * fragility this table exists to remove.
 */
function withLatchRpcs<const T extends Chain>(chain: T) {
  const http = LATCH_PUBLIC_RPCS[chain.id]
  if (!http || http.length === 0) {
    throw new Error(
      `No probed RPC list for chain ${chain.id} (${chain.name}). Probe it with ` +
        `packages/sdk/scripts/probe-rpcs.mjs and add it to LATCH_PUBLIC_RPCS.`,
    )
  }
  return defineChain({
    ...chain,
    rpcUrls: { ...chain.rpcUrls, default: { ...chain.rpcUrls.default, http } },
  })
}

/* ------------------------------------------------------------------ mainnet */

export const mainnet = /*#__PURE__*/ withLatchRpcs(wagmiMainnet)
export const base = /*#__PURE__*/ withLatchRpcs(wagmiBase)
export const bsc = /*#__PURE__*/ withLatchRpcs(wagmiBsc)

/** Linea — Consensys zkEVM L2. ETH for gas, lineascan.build for the explorer. */
export const linea = /*#__PURE__*/ withLatchRpcs(wagmiLinea)

/** Ink — Kraken's OP-Stack L2. ETH for gas. */
export const ink = /*#__PURE__*/ withLatchRpcs(wagmiInk)

/** X Layer — OKX's Polygon-CDK zkEVM. OKB for gas. Four probed endpoints, not five. */
export const xLayer = /*#__PURE__*/ withLatchRpcs(wagmiXLayer)

/** HyperEVM — the EVM execution layer of Hyperliquid. */
export const hyperEvm = /*#__PURE__*/ withLatchRpcs(wagmiHyperEvm)

export const monad = /*#__PURE__*/ withLatchRpcs(wagmiMonad)

/** Plasma — stablecoin-settlement L1. Three probed endpoints; no fourth is public. */
export const plasma = /*#__PURE__*/ withLatchRpcs(wagmiPlasma)

/** Stable — stablecoin-gas L1. Gas token is USDT0, per wagmi and ethereum-lists. */
export const stable = /*#__PURE__*/ withLatchRpcs(wagmiStable)

/**
 * Robinhood Chain — Robinhood's own L2. ETH for gas, Blockscout explorer.
 *
 * Five probed endpoints across five operators, each TSTORE-verified, so this has real
 * failover rather than a single point of failure. EIP-1153 confirmed, making it a
 * default-profile (cancun) deploy target — which `packages/core/script/BackendGuard.sol`
 * will assert again at deploy time.
 */
export const robinhood = /*#__PURE__*/ withLatchRpcs(wagmiRobinhood)

/* ------------------------------------------------------------------ testnet */

export const sepolia = /*#__PURE__*/ withLatchRpcs(wagmiSepolia)

/* --------------------------------------------------------------------------
   The three below are DEFINED and probed, but NOT offered: they are absent from
   `LATCH_CHAINS` and collected in `LATCH_UNLISTED_CHAINS` instead. Latch has no
   contracts on any of them and no plan to deploy to a testnet other than
   Sepolia. Kept because the endpoint probing was real work and because removing
   a published export would break integrators for no gain. See the header of
   `./index.ts`.
   -------------------------------------------------------------------------- */

export const monadTestnet = /*#__PURE__*/ withLatchRpcs(wagmiMonadTestnet)
export const stableTestnet = /*#__PURE__*/ withLatchRpcs(wagmiStableTestnet)

/**
 * Arc Testnet — Circle's USDC-gas L1, testnet.
 *
 * Arc MAINNET (5042) is deliberately absent even though wagmi ships it: it has no
 * public RPC. See the header of this file.
 */
export const arcTestnet = /*#__PURE__*/ withLatchRpcs(wagmiArcTestnet)

/* ------------------------------------------------------------- audit surface */

/**
 * Chain ids whose `nativeCurrency` or `blockExplorers` are unverified.
 *
 * EMPTY as of this change. Every chain in the list now takes both fields from
 * wagmi's curated registry rather than from this repository, and each explorer
 * was additionally checked to serve an EIP-3091 `/address/<addr>` page:
 * lineascan.build, explorer.inkonchain.com, oklink.com/xlayer, hyperevmscan.io,
 * monadscan.com, testnet.monadexplorer.com, plasmascan.to, testnet.arcscan.app,
 * etherscan.io, basescan.org, bscscan.com and sepolia.etherscan.io all answered.
 *
 * ONE exception is recorded rather than hidden: `stablescan.xyz` and
 * `testnet.stablescan.xyz` (Stable, 988 / 2201) did not resolve from the machine
 * this was checked on. wagmi carries them and ethereum-lists agrees, so they are
 * not listed as unverified metadata, but nobody here has seen either render.
 *
 * Exported rather than left as a comment so a deploy check can assert on it.
 */
export const UNVERIFIED_CHAIN_METADATA: readonly number[] = []

/**
 * Chains reachable through exactly ONE public RPC, where a fallback transport
 * cannot fail over. Mirrors `SINGLE_ENDPOINT_CHAINS` in the SDK.
 *
 * EMPTY as of the 2026-09-10 probe: every chain now has at least three
 * independent public endpoints. It was six chains long before that. Kept as an
 * exported empty list rather than deleted, because it is the assertion a deploy
 * check should make and it will stop being empty the moment a chain is added
 * ahead of its provider ecosystem.
 */
export const SINGLE_ENDPOINT_CHAIN_IDS: readonly number[] = []

/**
 * Chains carrying fewer than five public endpoints.
 *
 * They still fail over, but with less headroom, and they will degrade first on a
 * rate-limited day. Not a probe failure — no fifth public endpoint was found.
 *
 * SCOPE: every chain this file DEFINES, which is a superset of `LATCH_CHAINS`.
 * Stable Testnet (2201) is still listed here even though it is no longer offered
 * (see the header of `./index.ts`), because this table mirrors the SDK's
 * `THIN_ENDPOINT_CHAINS` one-for-one and the measurement is still true. A check
 * that only cares about offered chains should intersect it with `LATCH_CHAINS`.
 */
export const THIN_ENDPOINT_CHAIN_IDS: readonly number[] = [
  xLayer.id,
  plasma.id,
  stable.id,
  stableTestnet.id,
]

// SPDX-License-Identifier: MIT
/**
 * The live Sepolia deployment the fork harness runs against.
 *
 * These are real, Etherscan-verified addresses. The harness never writes to
 * Sepolia - anvil serves their state locally - but every read below is of code
 * and storage that actually exists on chain, which is the whole point: the
 * calldata this package builds is executed against the deployed singleton, not
 * against a mock that agrees with the encoder by construction.
 */

import type { Address, Hex } from "viem";
import { createCLPoolKey, poolKeyToId, type PoolKey } from "@latchprotocol/sdk";

/** Sepolia chain id. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Latch core, live on Sepolia. */
export const LATCH_SEPOLIA = {
  vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
  clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
  binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
  protocolFeeController: "0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9",
} as const satisfies Record<string, Address>;

/** Canonical Permit2, deployed at the same address on every chain. */
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/** Canonical Sepolia WETH9. Only the router/position-manager constructors want it. */
export const WETH9_SEPOLIA: Address = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

/** The two MockERC20s behind the live pool. Both expose a public `mint`. */
export const LT_USD: Address = "0x5c00ea81EedcED610c5174b9D20F83Ca245e269C";
export const LT_ETH: Address = "0xbEf6E0f94Fe1a96390Eb25D32759aad85fD1f067";

/** Static LP fee of the live pool, in pips. */
export const POOL_LP_FEE_PIPS = 3_000;
/** Tick spacing of the live pool. */
export const POOL_TICK_SPACING = 60;
/**
 * Protocol fee the live pool was initialised with, in pips, per direction.
 * The packed `slot0.protocolFee` is `1000 | (1000 << 12) = 4_097_000`.
 */
export const POOL_PROTOCOL_FEE_PIPS = 1_000;

/**
 * Composed swap fee the pool charges, in pips.
 *
 * `ProtocolFeeLibrary.calculateSwapFee`: the protocol fee is taken first and the
 * LP fee applies to what is left, so the two do not simply add.
 * `1000 + 3000 - (1000 * 3000 / 1e6) = 3997`, which is the value the live swap
 * on this pool emitted.
 */
export const POOL_SWAP_FEE_PIPS =
  POOL_PROTOCOL_FEE_PIPS +
  POOL_LP_FEE_PIPS -
  Math.floor((POOL_PROTOCOL_FEE_PIPS * POOL_LP_FEE_PIPS) / 1_000_000);

/** The live pool's key, reconstructed from its six fields. */
export const LIVE_POOL_KEY: PoolKey = createCLPoolKey({
  currency0: LT_USD,
  currency1: LT_ETH,
  hooks: "0x0000000000000000000000000000000000000000",
  poolManager: LATCH_SEPOLIA.clPoolManager,
  fee: POOL_LP_FEE_PIPS,
  tickSpacing: POOL_TICK_SPACING,
});

/**
 * Pool id published for the live pool.
 *
 * {@link LIVE_POOL_KEY} must hash to exactly this; the harness asserts it before
 * doing anything else, so a mis-specified key fails loudly instead of quietly
 * addressing a pool that does not exist.
 */
export const LIVE_POOL_ID: Hex =
  "0x1373a1db3e21b471647422e89bd87e4e97c0a5d0d2af24194226a40a5a402b38";

/** Recomputed id of {@link LIVE_POOL_KEY}. */
export const DERIVED_POOL_ID: Hex = poolKeyToId(LIVE_POOL_KEY);

/** Minimal view surface of `CLPoolManager` the harness reads. */
export const CL_POOL_MANAGER_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
      // uint16, not uint24: the event carries the single-direction protocol fee,
      // not the packed both-directions word that slot0 stores.
      { name: "protocolFee", type: "uint16", indexed: false },
    ],
  },
] as const;

/** `Vault.reservesOfApp(app, currency)` - where protocol + LP funds sit. */
export const VAULT_ABI = [
  {
    type: "function",
    name: "reservesOfApp",
    stateMutability: "view",
    inputs: [
      { name: "app", type: "address" },
      { name: "currency", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** `ProtocolFees.protocolFeesAccrued(currency)` on the pool manager. */
export const PROTOCOL_FEES_ABI = [
  {
    type: "function",
    name: "protocolFeesAccrued",
    stateMutability: "view",
    inputs: [{ name: "currency", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** The public `mint` both MockERC20s expose. */
export const MOCK_ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

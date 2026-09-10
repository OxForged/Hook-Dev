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

/**
 * Latch periphery and router, live on Sepolia and wired to the core above.
 *
 * `universalRouter` is the owner-accepted deployment, not the CREATE3 proxy
 * child. Its `vault()`, `clPoolManager()` and `binPoolManager()` are asserted
 * against {@link LATCH_SEPOLIA} at harness start-up, because a router pointed at
 * a *different* singleton is exactly the failure this suite exists to catch -
 * PancakeSwap has its own `UniversalRouter` on Sepolia at `0x19Dbcfc8…` whose
 * vault is `0x4670F769…`, and calldata sent there would fail in a way that looks
 * like an encoding bug.
 */
export const LATCH_PERIPHERY_SEPOLIA = {
  universalRouter: "0xB647CEbd5b8d6bE38C198634828187F482f4874B",
  clPositionManager: "0xb3505d48A84651c104a02D41B2b9D8CB84dFEC33",
  binPositionManager: "0x965b1D98BB0cd4E0125D78AD17ea4d2D1d62AE6f",
  clQuoter: "0x4471e61fE697204908CA97CdF4810EeAf406e9C1",
  binQuoter: "0x3544C594f12F7c89aa1D8C596d793b661206Ab17",
  clPositionDescriptor: "0xFe386132bE4A3D85267488A1C64061ba691cfc7a",
} as const satisfies Record<string, Address>;

/**
 * Permit2 - **PancakeSwap's fork, not the canonical deployment.**
 *
 * The router's and position managers' Permit2 address is an immutable baked in
 * at construction. Latch's deployment uses the PCS fork, so approving the
 * canonical `0x000000000022D473…` would leave the real spender with no
 * allowance and the settle step would revert with a transfer failure that says
 * nothing about which contract was short. The harness asserts the deployed
 * `permit2()` equals this before approving anything.
 */
export const PERMIT2: Address = "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768";

/** The canonical Permit2, named only so the harness can say "not this one". */
export const CANONICAL_PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

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

/**
 * Recovers the LP fee from an emitted `(swapFee, protocolFee)` pair.
 *
 * The inverse of `ProtocolFeeLibrary.calculateSwapFee`. Inverting it is the only
 * way to check that the fee a swap *actually charged* decomposes into the two
 * the pool is configured with, rather than into some other pair that happens to
 * compose to the same total.
 */
export function lpFeeFromSwapFee(swapFeePips: number, protocolFeePips: number): number {
  const numerator = (swapFeePips - protocolFeePips) * 1_000_000;
  const denominator = 1_000_000 - protocolFeePips;
  return Math.round(numerator / denominator);
}

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

// SPDX-License-Identifier: MIT
/**
 * Command, action and sentinel constants for the LatchProtocol call path.
 *
 * These mirror the on-chain libraries and must be kept in step with them:
 *
 * - commands: `packages/router/src/libraries/Commands.sol`
 * - actions:  `packages/periphery/src/libraries/Actions.sol`
 * - sentinels:`packages/periphery/src/libraries/ActionConstants.sol`
 *
 * They are transcribed rather than imported because the Solidity is GPL-2.0 and
 * this package is MIT. Constants carry no copyright; the encoding logic here is
 * written against the ABI, not derived from the sources.
 */

import type { Address } from "viem";

/** Universal-router command ids. */
export const COMMANDS = {
  SWEEP: 0x04,
  TRANSFER: 0x05,
  /** Pays a bps portion of the router's balance of a token to a recipient. */
  PAY_PORTION: 0x06,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  /** Runs an encoded periphery action plan inside one vault lock. */
  INFI_SWAP: 0x10,
} as const;

/** Periphery action ids. */
export const ACTIONS = {
  CL_INCREASE_LIQUIDITY: 0x00,
  CL_DECREASE_LIQUIDITY: 0x01,
  CL_MINT_POSITION: 0x02,
  CL_BURN_POSITION: 0x03,
  CL_SWAP_EXACT_IN_SINGLE: 0x06,
  CL_SWAP_EXACT_IN: 0x07,
  CL_SWAP_EXACT_OUT_SINGLE: 0x08,
  CL_SWAP_EXACT_OUT: 0x09,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  /** Takes a bps portion of the open credit straight to a recipient. */
  TAKE_PORTION: 0x10,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  CLEAR_OR_TAKE: 0x13,
  SWEEP: 0x14,
  BIN_ADD_LIQUIDITY: 0x19,
  BIN_REMOVE_LIQUIDITY: 0x1a,
  BIN_SWAP_EXACT_IN_SINGLE: 0x1c,
  BIN_SWAP_EXACT_IN: 0x1d,
  BIN_SWAP_EXACT_OUT_SINGLE: 0x1e,
  BIN_SWAP_EXACT_OUT: 0x1f,
} as const;

/** Recipient sentinel: the account that called the router. */
export const MSG_SENDER: Address = "0x0000000000000000000000000000000000000001";

/** Recipient sentinel: the router contract itself. */
export const ADDRESS_THIS: Address = "0x0000000000000000000000000000000000000002";

/** Amount sentinel: use the whole open delta for this currency. */
export const OPEN_DELTA = 0n;

/** Amount sentinel: use the contract's entire balance. */
export const CONTRACT_BALANCE = 1n << 255n;

/** Address used by the router's payment helpers to mean native value. */
export const NATIVE_SENTINEL: Address = "0x0000000000000000000000000000000000000000";

/** Scale used by liquidity-book distribution weights. */
export const BIN_DISTRIBUTION_SCALE = 10n ** 18n;

/** Minimal ABI for `UniversalRouter.execute`. */
export const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Minimal ABI for the position managers' batched entry point. */
export const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Minimal ERC-20 surface the widgets need. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Permit2's allowance surface, used for the second half of the approval flow. */
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/** Largest value Permit2 will store as an allowance amount. */
export const MAX_UINT160 = (1n << 160n) - 1n;

/** Largest value Permit2 will store as an expiration. */
export const MAX_UINT48 = (1n << 48n) - 1n;

/** Largest ERC-20 allowance. */
export const MAX_UINT256 = (1n << 256n) - 1n;

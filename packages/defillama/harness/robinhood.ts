/**
 * The live mainnet: Robinhood Chain (4663).
 *
 * Unlike Sepolia, this chain IS in the adapters' config tables - DefiLlama slugs
 * it "robinhood" - so nothing here is injected into the adapter. This file only
 * carries what the local harness needs to run the submitted files against the
 * real chain: an RPC that tolerates a log scan, the node's range cap, and the
 * facts the live test asserts.
 *
 * RPC choice. Five public endpoints answer for 4663 (packages/sdk/src/chains/
 * endpoints.ts). `rpc-robinhood.blockmachine.io` is the one that serves
 * `eth_getLogs` over a real range; it caps at 10 000 blocks per request
 * (inclusive - `to = from + 9999`) and meters a per-minute quota, which
 * `harness/rpc.ts` waits out rather than treating as an empty result.
 *
 * Everything below was read from the chain on 2026-09-12 through that endpoint:
 *
 *   eth_getCode, binary-searched by block:
 *     Vault           first has code at 60122218  (2026-09-11T08:39:44Z)
 *     CLPoolManager   first has code at 60124455  (2026-09-11T08:43:31Z)
 *     BinPoolManager  first has code at 60124601  (2026-09-11T08:43:46Z)
 *   CLPoolManager.protocolFeeController()   -> address(0) at ~10:50 UTC,
 *                                              0x2a03…154c at ~11:05 UTC
 *   BinPoolManager.protocolFeeController()  -> same, same
 *   LatchProtocolFeeController.defaultFee() -> (true, 1000, 1000), feesDisabled false
 *   Vault.isAppRegistered(CL) / (Bin)       -> true / true
 *
 * The controller wiring changed WHILE this file was being written: governance
 * executed it between two reads a quarter of an hour apart. That is the lesson
 * the live test now encodes - governance state is read and sanity-checked, never
 * asserted to a value, because the adapter does not depend on it. Both swaps
 * that exist predate the wiring and carry protocolFee 0.
 */

import { chainConfig } from "../dimension-adapters/dexs/latch.js";

export const ROBINHOOD_CHAIN_KEY = "robinhood";

export const ROBINHOOD_RPC =
  process.env["LATCH_RPC_4663"] ?? "https://rpc-robinhood.blockmachine.io";

/** blockmachine rejects eth_getLogs ranges wider than this (inclusive). */
export const ROBINHOOD_MAX_BLOCK_RANGE = 10_000;

/** The adapter's own row - the harness reads it, never redefines it. */
export const ROBINHOOD = chainConfig[ROBINHOOD_CHAIN_KEY]!;

export const ROBINHOOD_CHAIN_ID = 4663;

/** LatchProtocolFeeController; wired to both pool managers on 2026-09-12. See header. */
export const ROBINHOOD_PROTOCOL_FEE_CONTROLLER = "0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c";

/** Measured with eth_getCode; see header. */
export const ROBINHOOD_DEPLOY_BLOCKS = {
  vault: 60_122_218,
  clPoolManager: 60_124_455,
  binPoolManager: 60_124_601,
} as const;

export const ROBINHOOD_TOKENS = {
  WETH: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18 },
  USDG: { address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6 },
  LTT1: { address: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", decimals: 18 },
  LTT2: { address: "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4", decimals: 18 },
} as const;

/** The two RevShareHook deployments. The LTT1/LTT2 pool is bound to the retired one. */
export const ROBINHOOD_REVSHARE_HOOKS = {
  retired: "0x23CE34E8199927DD270dddd8579c947542bDE446",
  current: "0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2",
} as const;

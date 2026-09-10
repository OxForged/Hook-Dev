/**
 * The one live Latch deployment: Ethereum Sepolia (11155111).
 *
 * DefiLlama does not index testnets - `helpers/chains.ts` has no `sepolia` member -
 * so this deliberately lives in the harness and NOT in the adapter's `chainConfig`.
 * Its only job is to give the adapter something real to run against before any
 * mainnet exists.
 *
 * Every value below was read off-chain on 2026-09-09 via
 * https://ethereum-sepolia-rpc.publicnode.com:
 *
 *   eth_getCode              non-empty for all four addresses
 *   vault.isAppRegistered(clPoolManager)   -> true   (selector 0x8403be91)
 *   vault.isAppRegistered(binPoolManager)  -> true
 *   feeController.defaultFee()             -> (isSet=true, zeroForOne=1000, oneForZero=1000)
 *   feeController.feesDisabled()           -> false
 *   first Vault log at block 11672508, ts 1789013352 (2026-09-10T04:09:12Z)
 *
 * The pool managers deploy a few blocks later (CL 11672513, Bin 11672517); the
 * Vault block is used as the scan floor so nothing can be missed.
 */

import { chainConfig, type LatchChainConfig } from "../dimension-adapters/dexs/latch.js";

export const SEPOLIA_CHAIN_KEY = "sepolia";

export const SEPOLIA_RPC =
  process.env["LATCH_RPC_11155111"] ?? "https://ethereum-sepolia-rpc.publicnode.com";

/** publicnode rejects eth_getLogs ranges wider than this. */
export const SEPOLIA_MAX_BLOCK_RANGE = 50_000;

export const SEPOLIA: LatchChainConfig & { chainId: number; protocolFeeController: string } = {
  chainId: 11155111,
  vault: "0xCe3d133eb486b448A53437A5073619FbE424d01B",
  clPoolManager: "0xb7C8a11E0B359616eD06256783aF57114841F738",
  binPoolManager: "0xdBA93F91BA5B8535AE2b38be6a3A6CdcfDE6f6f3",
  protocolFeeController: "0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9",
  fromBlock: 11672508,
  start: "2026-09-10",
};

/** Unix timestamp of `SEPOLIA.fromBlock`. */
export const SEPOLIA_START_TIMESTAMP = 1789013352;

/**
 * Register Sepolia into the adapter's chain table for the duration of a local run.
 *
 * This is the only place a testnet is ever injected, and it is never called from
 * the adapter itself, so a submitted `dexs/latch.ts` cannot pick it up.
 */
export function withSepolia(): string {
  chainConfig[SEPOLIA_CHAIN_KEY] = SEPOLIA;
  return SEPOLIA_CHAIN_KEY;
}

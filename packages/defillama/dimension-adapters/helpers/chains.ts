/**
 * LOCAL HARNESS STUB - do not submit this file upstream.
 *
 * The seven members below were copied from the real
 *   https://github.com/DefiLlama/dimension-adapters/blob/master/helpers/chains.ts
 * on 2026-09-09 and are the exact slugs upstream uses. Note there is deliberately
 * NO `SEPOLIA`: DefiLlama does not index testnets, and adding one here would let
 * a testnet leak into a submitted adapter.
 */
export enum CHAIN {
  ETHEREUM = "ethereum",
  BASE = "base",
  BSC = "bsc",
  /** HyperEVM (chain id 999). DefiLlama's slug is "hyperliquid". */
  HYPERLIQUID = "hyperliquid",
  MONAD = "monad",
  PLASMA = "plasma",
  STABLE = "stable",
}

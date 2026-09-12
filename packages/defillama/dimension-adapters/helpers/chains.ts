/**
 * LOCAL HARNESS STUB - do not submit this file upstream.
 *
 * The members below were copied from the real
 *   https://github.com/DefiLlama/dimension-adapters/blob/master/helpers/chains.ts
 * (seven on 2026-09-09, `ROBINHOOD` on 2026-09-12, upstream line 398) and are the
 * exact slugs upstream uses. Note there is deliberately NO `SEPOLIA`: DefiLlama
 * does not index testnets, and adding one here would let a testnet leak into a
 * submitted adapter.
 *
 * A member here is a claim that upstream has the slug. Never add one from memory:
 * an adapter keyed on a slug upstream lacks cannot list no matter how correct it
 * is. Each of these was read from the upstream file on the date given.
 */
export enum CHAIN {
  /**
   * Robinhood Chain (chain id 4663). Upstream slug is "robinhood" - also present
   * in DefiLlama-Adapters/projects/helper/chains.json and in the published
   * @defillama/sdk build/providers.json (seven RPCs), and listed on
   * api.llama.fi/v2/chains as "Robinhood Chain". All three checked 2026-09-12.
   */
  ROBINHOOD = "robinhood",
  ETHEREUM = "ethereum",
  BASE = "base",
  BSC = "bsc",
  /** HyperEVM (chain id 999). DefiLlama's slug is "hyperliquid". */
  HYPERLIQUID = "hyperliquid",
  MONAD = "monad",
  PLASMA = "plasma",
  STABLE = "stable",
}

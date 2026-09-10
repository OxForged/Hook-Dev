/**
 * Latch Protocol - deployment registry (TVL adapter).
 *
 * Adding a chain is ONE entry here plus the matching entry in the dimension
 * adapter. The two repositories cannot import from each other, so this file is a
 * hand-maintained mirror of `chainConfig` in
 *   packages/defillama/dimension-adapters/dexs/latch.ts
 * and `packages/defillama/test/config-parity.test.ts` fails if they disagree on
 * any address, block or start date.
 *
 * `fromBlock` is the block of the first pool-manager deployment on that chain -
 * the floor for the Initialize scan. `start` is the first date that returns data,
 * as a 'YYYY-MM-DD' string (DefiLlama-Adapters migrated off unix timestamps).
 *
 * NOTHING IS DEPLOYED ON MAINNET YET (2026-09). Every row is a placeholder with
 * empty addresses; `enabledChains()` filters them out, so the adapter exports no
 * chains rather than reporting a $0 TVL for a chain that has no contracts.
 * The one live deployment is on Sepolia, which DefiLlama does not index - it lives
 * in the local harness (packages/defillama/harness/sepolia.ts), not here.
 */

const DEPLOYMENTS = {
  ethereum: {
    chainId: 1,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  base: {
    chainId: 8453,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  bsc: {
    chainId: 56,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  // HyperEVM, chain id 999. DefiLlama's slug for it is "hyperliquid".
  hyperliquid: {
    chainId: 999,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  monad: {
    chainId: 143,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  plasma: {
    chainId: 9745,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
  stable: {
    chainId: 988,
    vault: "",
    clPoolManager: "",
    binPoolManager: "",
    protocolFeeController: "",
    fromBlock: 0,
    start: "",
  },
};

/** A chain counts as live once it has a Vault, a pool manager and a start date. */
const isConfigured = (chain) => {
  const d = DEPLOYMENTS[chain];
  return Boolean(
    d && d.vault && (d.clPoolManager || d.binPoolManager) && d.start,
  );
};

/** Chains the adapter exports. Empty until a mainnet deployment is filled in. */
const enabledChains = () => Object.keys(DEPLOYMENTS).filter(isConfigured);

/** Both pool managers for a chain, skipping any that is not deployed. */
const poolManagers = (chain) =>
  [DEPLOYMENTS[chain].clPoolManager, DEPLOYMENTS[chain].binPoolManager].filter(Boolean);

module.exports = { DEPLOYMENTS, isConfigured, enabledChains, poolManagers };

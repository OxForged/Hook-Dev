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
 * `blacklistedTokens` are tokens the adapter must never report a balance for.
 * The name is upstream's own `sumTokens2` parameter. Today it holds Latch's
 * throwaway test tokens - see the Robinhood row for why that is the honest choice.
 *
 * ONE MAINNET IS LIVE: Robinhood Chain (4663), deployed 2026-09-11. DefiLlama's
 * slug for it is "robinhood" (projects/helper/chains.json, checked 2026-09-12).
 * Every other row is still a placeholder with empty addresses; `enabledChains()`
 * filters those out, so the adapter exports exactly the chains that have
 * contracts and never a $0 TVL for one that does not. Sepolia is deliberately
 * absent - DefiLlama does not index testnets - and lives only in the local
 * harness (packages/defillama/harness/sepolia.ts).
 */

/**
 * Latch's own test tokens on Robinhood: "Latch Test Token One/Two", 18 decimals,
 * minted by the deployer for the first end-to-end exercise of the protocol. They
 * are the two currencies of the only pool with any history (LTT1/LTT2 0.30%).
 *
 * Nothing prices them and nothing should. coins.llama.fi returns no entry for
 * either (checked 2026-09-12), so upstream would already drop them - but a token
 * that is merely unpriced can acquire a price later (a dust pool against WETH is
 * enough for a DEX-derived feed), and at that moment a test balance would start
 * reading as TVL. Excluding them by address makes "these have no value" a
 * decision in the adapter rather than an accident of the price server.
 *
 * This is NOT where to put a token that is real but thinly traded. It is for
 * tokens that have no economic meaning by construction.
 */
const LATCH_TEST_TOKENS = {
  robinhood: [
    "0x2A21c0826848f2D597B7C87A4B931dE1407958A6", // LTT1
    "0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4", // LTT2
  ],
};

const DEPLOYMENTS = {
  // Robinhood Chain, chain id 4663. All addresses Sourcify-verified. The two
  // pool managers landed at blocks 60124455 (CL) and 60124601 (Bin) on
  // 2026-09-11, ~21 minutes after the Vault (60122218); `fromBlock` is the CL
  // block, the earliest an Initialize can exist. The timelocks landed earlier
  // still, at 60111836 - that is the `deployedAtBlock` the dapp scans from, and
  // is an equally valid (just wider) floor.
  robinhood: {
    chainId: 4663,
    vault: "0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c",
    clPoolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
    binPoolManager: "0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979",
    // `protocolFeeController()` on both pool managers. Read address(0) at
    // 2026-09-12 ~10:50 UTC and this address at ~11:05 UTC - governance wired it
    // in between, after both swaps that exist so far (which carry protocolFee 0).
    // Recorded for completeness; the TVL adapter does not read it.
    protocolFeeController: "0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c",
    fromBlock: 60124455,
    start: "2026-09-11",
    blacklistedTokens: LATCH_TEST_TOKENS.robinhood,
  },
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

/** Chains the adapter exports: every row with real contracts, and only those. */
const enabledChains = () => Object.keys(DEPLOYMENTS).filter(isConfigured);

/** Both pool managers for a chain, skipping any that is not deployed. */
const poolManagers = (chain) =>
  [DEPLOYMENTS[chain].clPoolManager, DEPLOYMENTS[chain].binPoolManager].filter(Boolean);

/** Tokens never to report for a chain, lower-cased. Empty for most chains. */
const blacklistedTokens = (chain) =>
  (DEPLOYMENTS[chain].blacklistedTokens || []).map((t) => t.toLowerCase());

module.exports = {
  DEPLOYMENTS,
  LATCH_TEST_TOKENS,
  isConfigured,
  enabledChains,
  poolManagers,
  blacklistedTokens,
};

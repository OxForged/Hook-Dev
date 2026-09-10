const { sumTokens2 } = require("../helper/unwrapLPs");
const { getLogs2 } = require("../helper/cache/getLogs");
const { nullAddress } = require("../helper/tokenMapping");
const { sliceIntoChunks } = require("../helper/utils");
const { DEPLOYMENTS, enabledChains, poolManagers } = require("./config");

/**
 * Latch Protocol - TVL.
 *
 * Latch is a Uniswap-v4-style singleton AMM forked from PancakeSwap Infinity. The
 * shape that matters here: a single `Vault` custodies EVERY token in the protocol.
 * The two pool managers - `CLPoolManager` (concentrated liquidity) and
 * `BinPoolManager` (liquidity book) - register with the Vault as "apps" and never
 * hold funds; the Vault tracks per-app balances internally in `reservesOfApp`, but
 * the ERC20 balance lives on the Vault.
 *
 * So TVL is the Vault's token balances. There is nothing to enumerate and sum over
 * per-pool contracts the way a v2-style DEX would, and reading balances off the
 * pool managers would return zero.
 *
 * What still has to be enumerated is the TOKEN UNIVERSE - which tokens to ask the
 * Vault about. That comes from the `Initialize` logs of both pool managers, which
 * carry `currency0`/`currency1` for every pool ever created. Native currency is the
 * zero address in a pool key, and `sumTokens2` routes `nullAddress` to
 * `eth_getBalance` on the owner, so it needs no special handling.
 *
 * Hooks: Latch hooks can take their own delta and custody tokens, exactly as in
 * Uniswap v4. Any pool with a non-null `hooks` address therefore also gets its pair
 * summed against that hook, mirroring `projects/uniswap-v4`.
 *
 * ---------------------------------------------------------------------------
 * TOPIC0 COLLISION
 * ---------------------------------------------------------------------------
 * The Vault, both pool managers and the shared `ProtocolFees` base declare 34
 * events but only 22 distinct signatures - `ProtocolFeeUpdated`, `Paused`,
 * `Unpaused`, `ProtocolFeeControllerUpdated`, `DynamicLPFeeUpdated` and
 * `OwnershipTransferred` are byte-identical across contracts and collide on topic0.
 * The two `Initialize` events do not collide today (CL carries sqrtPriceX96+tick,
 * Bin carries activeId) but nothing guarantees that. Each `getLogs2` call below is
 * therefore scoped to ONE pool manager address and decoded with that manager's own
 * abi. Never query these by topic alone.
 *
 * ---------------------------------------------------------------------------
 * NOT DEPLOYED ON MAINNET
 * ---------------------------------------------------------------------------
 * As of 2026-09 Latch exists only on Sepolia, which DefiLlama does not index.
 * `enabledChains()` returns an empty list until a mainnet row in `config.js` is
 * filled in, so this file currently exports nothing. That is deliberate: an
 * adapter that exported a chain with no deployment would report $0 TVL as a fact.
 */

const CL_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint160 sqrtPriceX96, int24 tick)";
const BIN_INITIALIZE_EVENT =
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint24 activeId)";

const initializeEventFor = (chain, manager) =>
  manager.toLowerCase() === String(DEPLOYMENTS[chain].binPoolManager).toLowerCase()
    ? BIN_INITIALIZE_EVENT
    : CL_INITIALIZE_EVENT;

async function tvl(api) {
  const chain = api.chain;
  const { vault, fromBlock } = DEPLOYMENTS[chain];

  const tokenSet = new Set();
  const ownerTokens = [];

  for (const manager of poolManagers(chain)) {
    const logs = await getLogs2({
      api,
      target: manager,
      fromBlock,
      eventAbi: initializeEventFor(chain, manager),
    });

    for (const log of logs) {
      const token0 = String(log.currency0).toLowerCase();
      const token1 = String(log.currency1).toLowerCase();
      tokenSet.add(token0);
      tokenSet.add(token1);
      // A hook may hold its own balances (hook deltas / hook-owned liquidity).
      if (String(log.hooks).toLowerCase() !== nullAddress) {
        ownerTokens.push([[token0, token1], log.hooks]);
      }
    }
  }

  // Everything else sits on the Vault. Chunked so a chain with many pools does not
  // build one multicall with tens of thousands of entries.
  for (const tokens of sliceIntoChunks(Array.from(tokenSet), 1000)) {
    ownerTokens.push([tokens, vault]);
  }

  return sumTokens2({ api, ownerTokens, permitFailure: true });
}

module.exports = {
  methodology:
    "Latch is a singleton AMM: one Vault custodies every token for the whole protocol, and pool managers hold nothing. TVL is the Vault's balance of every token that has appeared as currency0 or currency1 in an Initialize event from CLPoolManager or BinPoolManager, plus any balance held by a pool's hook contract. Native currency appears as the zero address in a pool key and is read as the Vault's native balance.",
};

for (const chain of enabledChains()) {
  module.exports[chain] = {
    tvl,
    start: DEPLOYMENTS[chain].start,
  };
}

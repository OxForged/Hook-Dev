/**
 * Run the Latch dimension adapter against the live Sepolia deployment.
 *
 *   npm run run:sepolia            # whole history, deployment block -> head
 *   npm run run:sepolia -- 5000    # last 5000 blocks only
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * It proves the adapter runs end to end against a real node: the event signatures
 * match the deployed bytecode, the log queries are accepted, and the arithmetic
 * reproduces the on-chain amounts.
 *
 * It cannot tell you whether the numbers mean anything. The only activity on this
 * deployment is a handful of swaps from what is plainly a setup script, on tokens
 * (ltUSD, ltETH) that nobody prices. Amounts printed below are raw token units
 * straight off the chain - the harness has no price feed and deliberately does not
 * pretend to one. Nothing here is a production metric, and there is no mainnet
 * deployment to compare against.
 */

import { createRequire } from "node:module";
import adapter from "../dimension-adapters/dexs/latch.js";
import { Balances } from "../harness/balances.js";
import { runFetch } from "../harness/runFetch.js";
import { Rpc } from "../harness/rpc.js";
import {
  SEPOLIA,
  SEPOLIA_MAX_BLOCK_RANGE,
  SEPOLIA_RPC,
  withSepolia,
} from "../harness/sepolia.js";

const lookback = process.argv[2] ? Number(process.argv[2]) : undefined;

const chain = withSepolia();
const rpc = new Rpc({ url: SEPOLIA_RPC, maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE });
const head = await rpc.blockNumber();
const fromBlock = lookback ? Math.max(SEPOLIA.fromBlock, head - lookback) : SEPOLIA.fromBlock;

console.log(`chain          ${chain} (${SEPOLIA.chainId})`);
console.log(`rpc            ${SEPOLIA_RPC}`);
console.log(`vault          ${SEPOLIA.vault}`);
console.log(`clPoolManager  ${SEPOLIA.clPoolManager}`);
console.log(`binPoolManager ${SEPOLIA.binPoolManager}`);
console.log(`blocks         ${fromBlock} -> ${head} (${head - fromBlock + 1} blocks)`);
console.log("");

const result = await runFetch(adapter.fetch!, {
  chain,
  rpcUrl: SEPOLIA_RPC,
  fromBlock,
  toBlock: head,
  maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE,
});

let anyNonZero = false;
for (const [metric, value] of Object.entries(result)) {
  if (!(value instanceof Balances)) {
    console.log(`${metric.padEnd(24)} ${String(value)}`);
    continue;
  }
  const entries = value.list().filter((e) => e.amount !== 0n);
  if (entries.length === 0) {
    console.log(`${metric.padEnd(24)} (empty)`);
    continue;
  }
  anyNonZero = true;
  console.log(`${metric}`);
  for (const e of entries)
    console.log(`  ${e.token}  ${e.amount}${e.label ? `  [${e.label}]` : ""}`);
}

console.log("");
console.log(
  anyNonZero
    ? "Amounts above are raw on-chain token units from a testnet, NOT priced and NOT production metrics."
    : "All dimensions empty - no swaps in this window. That is a real measurement, not a failure.",
);

// ---------------------------------------------------------------------------
// TVL, from the CommonJS adapter file that would actually be submitted.
// ---------------------------------------------------------------------------
console.log("");
console.log("TVL (Vault balances, whole deployment history)");

const require_ = createRequire(import.meta.url);
const tvlConfig = require_("../DefiLlama-Adapters/projects/latch/config.js");
const { makeApi } = require_("../DefiLlama-Adapters/_harness/chainApi.js");

tvlConfig.DEPLOYMENTS[chain] = {
  chainId: SEPOLIA.chainId,
  vault: SEPOLIA.vault,
  clPoolManager: SEPOLIA.clPoolManager,
  binPoolManager: SEPOLIA.binPoolManager,
  protocolFeeController: SEPOLIA.protocolFeeController,
  fromBlock: SEPOLIA.fromBlock,
  start: SEPOLIA.start,
};

const tvlAdapter = require_("../DefiLlama-Adapters/projects/latch/index.js");
const api = makeApi({
  chain,
  rpcUrl: SEPOLIA_RPC,
  maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE,
});
await tvlAdapter[chain].tvl(api);

const tvl = api.getBalances();
if (Object.keys(tvl).length === 0) console.log("  (no tokens discovered)");
for (const [token, amount] of Object.entries(tvl))
  console.log(`  ${token}  ${amount}  (held by the Vault)`);
console.log("  Unpriced raw token units. Testnet tokens; no USD value exists for them.");

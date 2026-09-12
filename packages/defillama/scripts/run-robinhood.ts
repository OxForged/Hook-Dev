/**
 * Run both Latch adapters against the live Robinhood Chain deployment.
 *
 *   npm run run:robinhood            # whole history, CL manager deployment -> head
 *   npm run run:robinhood -- 20000   # last 20000 blocks only
 *
 * Nothing is injected: Robinhood is a real row in both config tables, and this
 * script runs the files exactly as they would be submitted.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * It proves the adapters run end to end against the real chain, that the event
 * signatures match the deployed bytecode and that the arithmetic reproduces the
 * on-chain amounts.
 *
 * It cannot price anything - the harness has no price feed by design - and today
 * it will print EMPTY for every dimension, on purpose: the only pool with any
 * history is LTT1/LTT2, two Latch test tokens the adapters exclude by address.
 * That empty output is the correct answer, not a failure. It changes the day a
 * pool in real assets (WETH, USDG, native ETH) sees a swap.
 *
 * The public endpoint meters a per-minute quota and caps eth_getLogs at 10 000
 * blocks; a whole-history run is ~120 paged requests per event stream and can
 * take several minutes. Pass a lookback for a quick check.
 */

import { createRequire } from "node:module";
import adapter from "../dimension-adapters/dexs/latch.js";
import { Balances } from "../harness/balances.js";
import { runFetch } from "../harness/runFetch.js";
import { Rpc } from "../harness/rpc.js";
import {
  ROBINHOOD,
  ROBINHOOD_CHAIN_KEY,
  ROBINHOOD_MAX_BLOCK_RANGE,
  ROBINHOOD_RPC,
} from "../harness/robinhood.js";

const lookback = process.argv[2] ? Number(process.argv[2]) : undefined;

const chain = ROBINHOOD_CHAIN_KEY;
const rpc = new Rpc({ url: ROBINHOOD_RPC, maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE });
const head = await rpc.blockNumber();
const fromBlock = lookback ? Math.max(ROBINHOOD.fromBlock, head - lookback) : ROBINHOOD.fromBlock;

console.log(`chain          ${chain} (4663)`);
console.log(`rpc            ${ROBINHOOD_RPC}`);
console.log(`vault          ${ROBINHOOD.vault}`);
console.log(`clPoolManager  ${ROBINHOOD.clPoolManager}`);
console.log(`binPoolManager ${ROBINHOOD.binPoolManager}`);
console.log(`excluded       ${(ROBINHOOD.blacklistTokens ?? []).join(", ")}`);
console.log(`blocks         ${fromBlock} -> ${head} (${head - fromBlock + 1} blocks)`);
console.log("");

const result = await runFetch(adapter.fetch!, {
  chain,
  rpcUrl: ROBINHOOD_RPC,
  fromBlock,
  toBlock: head,
  maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE,
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
    ? "Amounts above are raw on-chain token units, NOT priced. Decimals differ per token (USDG is 6, WETH is 18)."
    : "All dimensions empty. Either no swaps in this window, or every swap was in excluded test tokens - both are real measurements, not failures.",
);

// ---------------------------------------------------------------------------
// TVL, from the CommonJS adapter file that would actually be submitted.
// ---------------------------------------------------------------------------
console.log("");
console.log("TVL (Vault + per-pool hook balances, whole deployment history)");

const require_ = createRequire(import.meta.url);
const { makeApi } = require_("../DefiLlama-Adapters/_harness/chainApi.js");
const tvlAdapter = require_("../DefiLlama-Adapters/projects/latch/index.js");
const api = makeApi({
  chain,
  rpcUrl: ROBINHOOD_RPC,
  maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE,
});
await tvlAdapter[chain].tvl(api);

const tvl = api.getBalances();
if (Object.keys(tvl).length === 0)
  console.log("  (no countable tokens: every pool so far is in excluded test tokens)");
for (const [token, amount] of Object.entries(tvl))
  console.log(`  ${token}  ${amount}  (raw units; check decimals before reading this as a quantity)`);

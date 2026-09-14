// SPDX-License-Identifier: MIT
// Read-only: find current AccessControl role holders on the Robinhood stock-token access registry
// (0xe10b…1b00, which is also the beacon) from RoleGranted/RoleRevoked logs, via the GUARDED local
// fork (anvil forwards historical eth_getLogs to its fork source). Writes results/stock-roles.json,
// which the `stock` phase uses to pick a pauser - and then PROVES by simulating pause().
//
// Usage: node scripts/find-stock-roles.mjs [--from 59000000] [--step 250000]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, getAddress } from "viem";
import { connect } from "../src/chain.mjs";
import { ADDR } from "../src/addresses.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? Number(argv[argv.indexOf(`--${n}`) + 1]) : d);
const chain = await connect(process.env.FORK_RPC ?? "http://127.0.0.1:8547");
const forkBlock = Number(chain.identity.forkBlock);
const from0 = opt("from", 59_000_000);
const step = opt("step", 250_000);
const GRANTED = keccak256(toHex("RoleGranted(bytes32,address,address)"));
const REVOKED = keccak256(toHex("RoleRevoked(bytes32,address,address)"));
const holders = new Map();
let events = 0;
for (let from = from0; from <= forkBlock; from += step) {
  const to = Math.min(from + step - 1, forkBlock);
  let logs = null;
  for (let attempt = 0; attempt < 6 && !logs; attempt++) {
    try {
      logs = await chain.rpc("eth_getLogs", [{ address: ADDR.stockBeacon, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [[GRANTED, REVOKED]] }]);
    } catch (e) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  if (!logs) {
    console.log(`range ${from}-${to}: FAILED`);
    continue;
  }
  events += logs.length;
  for (const l of logs) {
    const key = `${l.topics[1]}:${l.topics[2]}`;
    if (l.topics[0] === GRANTED) holders.set(key, { role: l.topics[1], account: getAddress(`0x${l.topics[2].slice(26)}`), grantedAtL2Block: Number(BigInt(l.blockNumber)) });
    else holders.delete(key);
  }
  console.log(`range ${from}-${to}: ${logs.length} role events (total ${events})`);
}
const out = { registry: ADDR.stockBeacon, scannedFrom: from0, scannedTo: forkBlock, events, holders: [...holders.values()] };
fs.mkdirSync(path.resolve(here, "..", "results"), { recursive: true });
fs.writeFileSync(path.resolve(here, "..", "results", "stock-roles.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.holders, null, 2));

// SPDX-License-Identifier: MIT
/**
 * Exercise the read tools against a live chain.
 *
 * Not a test - it talks to a public RPC, so it is allowed to fail for reasons
 * that have nothing to do with this package. Its job is to prove the tools
 * answer real contracts, and to show what they actually say.
 *
 * Read-only throughout. It reads no key and constructs the default toolset,
 * which contains nothing that can send a transaction.
 *
 *   node scripts/live-check.mjs [chainId]
 */

import { createLatchTools } from "../dist/index.js";

const chainId = Number(process.argv[2] ?? 11155111);
const latch = createLatchTools({ chainId });

console.log(`toolset: ${latch.names.join(", ")}`);
console.log(`read-only: ${latch.isReadOnly}\n`);

async function show(label, name, input) {
  const started = Date.now();
  const result = await latch.call(name, input);
  const ms = Date.now() - started;
  console.log(`=== ${label}  (${name}, ${ms}ms) ===`);
  console.log(JSON.stringify(result, null, 2));
  console.log();
}

// A real contract that is emphatically not a Latch: the Vault itself.
const VAULT = "0xCe3d133eb486b448A53437A5073619FbE424d01B";
// No code at all on Sepolia.
const NO_CODE = "0x000000000000000000000000000000000000dEaD";

await show("protocol status", "protocol_status", {});
await show("lookup: contract, not listed", "latch_lookup", { address: VAULT });
await show("lookup: no code at this address", "latch_lookup", { address: NO_CODE });
await show("list: everything", "latch_list", { limit: 10 });
await show("risk: unlisted contract", "latch_assess_risk", { address: VAULT });
await show("permissions: fee hook bitmap", "latch_explain_permissions", { bitmap: "0x0440" });

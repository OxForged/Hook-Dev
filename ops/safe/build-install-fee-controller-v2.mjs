#!/usr/bin/env node
/**
 * Emits the Safe batch that installs LatchProtocolFeeControllerV2 on both pool managers.
 *
 *     node ops/safe/build-install-fee-controller-v2.mjs 0x<deployed V2 address>
 *
 * WHY A GENERATOR AND NOT A CHECKED-IN JSON WITH A PLACEHOLDER. The one input this batch needs
 * does not exist until the deploy transaction lands, and a committed file containing
 * `0x0000…0000` or `0xDEADBEEF` in the argument slot is a file somebody can import into the Safe
 * UI and sign. `setProtocolFeeController(address(0))` is a VALID call: it succeeds, and every
 * pool created afterwards gets a zero protocol fee, silently, until somebody notices the revenue
 * stopped. Refusing to write the file without a real address removes that possibility.
 *
 * WHAT THE BATCH DOES. Two calls, one per pool-manager owner wrapper:
 *
 *     CLPoolManagerOwner.setProtocolFeeController(V2)
 *     BinPoolManagerOwner.setProtocolFeeController(V2)
 *
 * and nothing else. The split ratio is already 25% from V2's constructor, so no third
 * transaction is needed to start charging — and deliberately so: a batch that both installs a
 * contract and configures it is a batch where a signer has to verify two different things at
 * once.
 *
 * ORDERING DOES NOT MATTER, which is worth knowing before signing. Fees accrued while V1 was
 * installed are NOT stranded: `collectProtocolFees` checks the caller at COLLECTION time, so
 * once V2 is the controller it can sweep everything banked under V1.
 *
 * AFTER THIS LANDS, verify by reading back — a `setProtocolFeeController` that reverted looks
 * identical to one that worked on a block explorer's transaction list:
 *
 *     cast call <CL manager>  'protocolFeeController()(address)' --rpc-url $ROBINHOOD_RPC
 *     cast call <BIN manager> 'protocolFeeController()(address)' --rpc-url $ROBINHOOD_RPC
 *
 * Both must return the V2 address. Then `feeForLpFee(3000)` on V2 must be 999.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `setProtocolFeeController(address)` — checked with `cast sig`. */
const SELECTOR = "0x2d771389";

const SAFE = "0x715a6176946aDbD22c1B2021d321Fb3767ca3432";
const CL_POOL_MANAGER_OWNER = "0x5D7111d6c624e9a08aE63d342E4baE5878989a67";
const BIN_POOL_MANAGER_OWNER = "0x98920e33313257Ffd942f94379A7ced216462665";
const V1 = "0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c";

const arg = process.argv[2];
if (!arg || !/^0x[0-9a-fA-F]{40}$/.test(arg)) {
  console.error("Usage: node ops/safe/build-install-fee-controller-v2.mjs 0x<V2 address>");
  console.error("Refusing to emit a batch without the real deployed address — see the header.");
  process.exit(1);
}
if (/^0x0+$/.test(arg)) {
  console.error("That is the zero address. setProtocolFeeController(0) succeeds and silently");
  console.error("zeroes the protocol fee on every pool created afterwards. Refusing.");
  process.exit(1);
}
if (arg.toLowerCase() === V1.toLowerCase()) {
  console.error("That is V1 — the controller that cannot collect. Refusing.");
  process.exit(1);
}

/** ABI-encode one address argument: 12 zero bytes then the 20 address bytes. */
const encode = (address) => SELECTOR + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const data = encode(arg);

const batch = {
  version: "1.0",
  chainId: "4663",
  createdAt: Date.now(),
  meta: {
    name: "Latch — install protocol fee controller V2 (collectable, 25% split)",
    description:
      "Points both pool managers at LatchProtocolFeeControllerV2 (" +
      arg +
      "), replacing V1 (" +
      V1 +
      "). V1 prices pools correctly and CANNOT WITHDRAW: ProtocolFees.collectProtocolFees admits " +
      "only the installed controller, and V1 has no function that calls it — confirmed against " +
      "its live bytecode, which is byte-for-byte identical to its source. Every pip charged " +
      "under V1 accrues where nobody can reach it. Nothing is lost: the caller check runs at " +
      "collection time, so V2 can sweep balances banked under V1. V2 also replaces V1's flat " +
      "pip fee with a 25% share of the total swap fee (Pancake Infinity ships 33%), which is " +
      "999 pips on a 0.30% pool — 0.0999%, all-in cost 0.3997% — and scales proportionately to " +
      "every tier instead of falling through to a flat default. Owner is this Safe, set in V2's " +
      "constructor and never transferred. Verify after executing: protocolFeeController() on " +
      "both managers must return " +
      arg +
      ", and feeForLpFee(3000) on V2 must return 999.",
    txBuilderVersion: "1.16.5",
    createdFromSafeAddress: SAFE,
    checksum: "",
  },
  transactions: [
    {
      to: CL_POOL_MANAGER_OWNER,
      value: "0",
      data,
      contractMethod: null,
      contractInputsValues: null,
      _comment: `CLPoolManagerOwner.setProtocolFeeController(${arg})`,
    },
    {
      to: BIN_POOL_MANAGER_OWNER,
      value: "0",
      data,
      contractMethod: null,
      contractInputsValues: null,
      _comment: `BinPoolManagerOwner.setProtocolFeeController(${arg})`,
    },
  ],
};

const out = join(HERE, "robinhood-install-fee-controller-v2.json");
writeFileSync(out, JSON.stringify(batch, null, 2) + "\n");

console.log(`wrote ${out}`);
console.log(`  2 transactions, both calling setProtocolFeeController(${arg})`);
console.log("");
console.log("Check it before importing:");
console.log("  python ops/safe/decode-batch.py ops/safe/robinhood-install-fee-controller-v2.json");

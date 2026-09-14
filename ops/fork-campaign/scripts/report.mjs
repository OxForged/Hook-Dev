// SPDX-License-Identifier: MIT
// Print a compact coverage table and every unexpected result from results/results.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(fs.readFileSync(path.resolve(here, "..", "results", "results.json"), "utf8"));
const s = r.summary;
console.log(`calls=${s.totalCalls} unexpected=${s.unexpected} hazardsReproduced=${s.hazardsReproduced.join(",")}`);
console.log(`bytecode verified: ${r.codeVerification.filter((c) => c.match).length}/${r.codeVerification.length}`);
console.log("\ncontract | write fns | >=3 authorized successes | unauthorized revert confirmed | gas range (successes)");
for (const c of s.coverage) {
  const unauth = c.functions.filter((f) => f.unauthorizedRevertsConfirmed > 0).length;
  const gmin = Math.min(...c.functions.filter((f) => f.gasMin !== null).map((f) => f.gasMin));
  const gmax = Math.max(...c.functions.filter((f) => f.gasMax !== null).map((f) => f.gasMax));
  console.log(`${c.contract} | ${c.writeFunctions} | ${c.threeOfThree} | ${unauth} | ${isFinite(gmin) ? `${gmin}-${gmax}` : "-"}`);
  for (const f of c.functions.filter((x) => !x.threeOfThree)) {
    console.log(`    ${f.fn}: success=${f.authorizedSuccess} expectedRevert=${f.expectedReverts} unauth=${f.unauthorizedRevertsConfirmed} hazard=${f.hazardCalls}${f.notExercised.length ? ` | ${f.notExercised.filter(Boolean).join("; ").slice(0, 140)}` : ""}`);
  }
}
console.log("\nUNEXPECTED:");
for (const u of r.unexpected) console.log(JSON.stringify(u).slice(0, 400));
console.log("\nHAZARDS:");
for (const h of r.hazards) console.log(`${h.reproduced ? "REPRODUCED " : "not        "} ${h.id}: ${h.title}`);

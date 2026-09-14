// SPDX-License-Identifier: MIT
// Merge results/phases/*.json into results/results.json and compute the coverage summary.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summarize } from "./summary.mjs";
import { PHASE_ORDER } from "./phase-order.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "..", "results", "phases");
const outFile = path.resolve(here, "..", "results", "results.json");

export function merge() {
  const merged = { schema: "latch-fork-campaign/v1", generatedAt: new Date().toISOString(), phases: [], codeVerification: [], calls: [], scenarios: [], hazards: [], unexpected: [], notExercised: [], notes: [] };
  for (const phase of PHASE_ORDER) {
    const f = path.join(dir, `${phase}.json`);
    if (!fs.existsSync(f)) continue;
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    merged.phases.push(r.meta);
    for (const k of ["codeVerification", "calls", "scenarios", "hazards", "unexpected", "notExercised", "notes"]) merged[k].push(...(r[k] ?? []).map((x) => ({ phase, ...x })));
    if (r.meta?.clock) merged.clock = r.meta.clock;
    if (r.headline) merged.headline = r.headline;
    if (r.views) merged.views = r.views;
    if (r.extra) merged.extra = { ...(merged.extra ?? {}), [phase]: r.extra };
  }
  merged.summary = summarize(merged);
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
  console.log(`merged ${merged.phases.length} phases -> ${outFile}: calls=${merged.calls.length} unexpected=${merged.unexpected.length}`);
  return merged;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) merge();

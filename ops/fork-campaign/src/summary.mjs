// SPDX-License-Identifier: MIT
// Coverage roll-up: per contract, per function - authorized successes, expected reverts,
// unauthorized reverts confirmed, gas range - checked against the artifact's full write surface.
import { artifact, writeFunctions, sigOf } from "./abis.mjs";
import { DEPLOYED } from "./addresses.mjs";

export function summarize(results) {
  const byContract = {};
  for (const c of results.calls) {
    if (!c.contract) continue;
    const k = (byContract[c.contract] ??= {});
    const f = (k[c.fn] ??= { authorizedSuccess: 0, expectedReverts: 0, unauthorizedRevertsConfirmed: 0, hazardCalls: 0, unexpected: 0, gasMin: null, gasMax: null, txs: 0 });
    f.txs++;
    if (!c.pass) f.unexpected++;
    if (c.role === "unauthorized" && c.pass && c.status === "revert") f.unauthorizedRevertsConfirmed++;
    else if (c.role === "hazard") f.hazardCalls++;
    else if (c.status === "success" && c.pass) f.authorizedSuccess++;
    else if (c.status === "revert" && c.pass) f.expectedReverts++;
    if (c.status === "success") {
      f.gasMin = f.gasMin === null ? c.gasUsed : Math.min(f.gasMin, c.gasUsed);
      f.gasMax = f.gasMax === null ? c.gasUsed : Math.max(f.gasMax, c.gasUsed);
    }
  }
  const coverage = [];
  for (const [name, , art] of DEPLOYED) {
    const fns = writeFunctions(artifact(art).abi);
    const names = new Set(fns.map((x) => x.name));
    const rows = [];
    for (const fnName of names) {
      const got = Object.entries(byContract[name] ?? {}).filter(([k]) => k === fnName || k.startsWith(`${fnName}(`));
      const agg = got.reduce(
        (a, [, v]) => ({
          authorizedSuccess: a.authorizedSuccess + v.authorizedSuccess,
          expectedReverts: a.expectedReverts + v.expectedReverts,
          unauthorizedRevertsConfirmed: a.unauthorizedRevertsConfirmed + v.unauthorizedRevertsConfirmed,
          hazardCalls: a.hazardCalls + v.hazardCalls,
          unexpected: a.unexpected + v.unexpected,
          gasMin: v.gasMin === null ? a.gasMin : a.gasMin === null ? v.gasMin : Math.min(a.gasMin, v.gasMin),
          gasMax: v.gasMax === null ? a.gasMax : a.gasMax === null ? v.gasMax : Math.max(a.gasMax, v.gasMax),
        }),
        { authorizedSuccess: 0, expectedReverts: 0, unauthorizedRevertsConfirmed: 0, hazardCalls: 0, unexpected: 0, gasMin: null, gasMax: null },
      );
      const ne = results.notExercised.filter((n) => n.contract === name && n.fn === fnName).map((n) => n.why);
      rows.push({ fn: fnName, overloads: fns.filter((x) => x.name === fnName).map(sigOf), ...agg, threeOfThree: agg.authorizedSuccess >= 3, notExercised: ne });
    }
    coverage.push({ contract: name, writeFunctions: rows.length, threeOfThree: rows.filter((r) => r.threeOfThree).length, functions: rows });
  }
  return {
    totalCalls: results.calls.length,
    unexpected: results.unexpected.length,
    hazardsReproduced: results.hazards.filter((h) => h.reproduced).map((h) => h.id),
    coverage,
    extraContracts: Object.keys(byContract).filter((k) => !DEPLOYED.some(([n]) => n === k)),
  };
}

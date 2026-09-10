import { analyze } from "./dist/index.js";
const r = analyze("test/fixtures/src/bad/PerWalletCap.sol", { build: false });
console.log("hooks", r.hooks.map(h=>h.name), "findings", r.findings.map(f=>f.rule));
const r2 = analyze("test/fixtures/src/bad/OracleGatedSwap.sol", { build: false });
console.log("hooks", r2.hooks.map(h=>h.name), "findings", r2.findings.map(f=>f.rule));
console.log("warnings", r.warnings, r2.warnings);

// SPDX-License-Identifier: MIT
// Snapshot the Foundry artifacts the campaign needs into ./artifacts.
//
// Why a snapshot and not a live path: other work recompiles packages/* while
// this campaign runs, and a recompiled artifact whose source moved on no longer
// matches the deployed bytecode. The snapshot is taken once, then every run
// re-proves it against on-chain code (src/verify.mjs) before a contract is used.
//
// Usage:
//   node scripts/extract-artifacts.mjs <manifest.json>
// manifest: [{ "name": "Vault", "from": "<abs or repo-relative artifact path>", "source": "<provenance note>" }]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const outDir = path.resolve(here, "..", "artifacts");
fs.mkdirSync(outDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const m of manifest) {
  const src = path.isAbsolute(m.from) ? m.from : path.join(repo, m.from);
  const a = JSON.parse(fs.readFileSync(src, "utf8"));
  const slim = {
    contractName: m.name,
    source: m.source,
    compiler: a.metadata?.compiler?.version ?? null,
    settings: a.metadata?.settings
      ? { evmVersion: a.metadata.settings.evmVersion, optimizer: a.metadata.settings.optimizer, viaIR: a.metadata.settings.viaIR ?? null }
      : null,
    abi: a.abi,
    bytecode: a.bytecode?.object ?? null,
    deployedBytecode: a.deployedBytecode.object,
    immutableReferences: a.deployedBytecode.immutableReferences ?? {},
  };
  fs.writeFileSync(path.join(outDir, `${m.name}.json`), JSON.stringify(slim));
  console.log(`${m.name.padEnd(30)} <- ${m.from}`);
}

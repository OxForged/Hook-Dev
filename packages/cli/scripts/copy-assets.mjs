// Copies the Foundry assets that ship with the CLI (the devnet script and its
// config) into dist/ so a published/installed package is self-contained.
//
// Build artefacts from local `forge build` runs inside assets/ are skipped.
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const from = join(pkgRoot, "assets");
const to = join(pkgRoot, "dist", "assets");

const IGNORED = new Set(["foundry-out", "foundry-out-legacy", "cache", "broadcast", "deployments", "node_modules"]);

if (!existsSync(from)) {
  console.error(`copy-assets: nothing at ${from}`);
  process.exit(1);
}

await rm(to, { recursive: true, force: true });
await cp(from, to, {
  recursive: true,
  filter: (src) => !src.split(sep).some((segment) => IGNORED.has(segment)),
});

console.log(`copy-assets: assets -> dist${sep}assets`);

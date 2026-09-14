// SPDX-License-Identifier: MIT
// Orchestrator. Resumable per phase: each phase writes results/phases/<phase>.json as it finishes,
// and `node src/merge.mjs` rolls them into results/results.json.
//
//   node src/run.mjs                         # every phase, one anvil session
//   node src/run.mjs --only vault,managers   # just these (setup is reused from its snapshot if present)
//   node src/run.mjs --fresh-setup           # rebuild fixtures even if a setup snapshot exists
//
// Isolation: after `setup`, the harness takes an evm_snapshot and saves it with the fixture state to
// results/phases/setup.state.json. EVERY later phase starts by reverting to that snapshot, so phases
// are independent, order-free and re-runnable after a crash. Transactions from a finished phase are
// therefore rolled back on the fork afterwards; their hashes, receipts and decoded outcomes are what
// the phase file records.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./chain.mjs";
import { createRecorder } from "./recorder.mjs";
import { PHASE_ORDER } from "./phase-order.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

export const PHASES = PHASE_ORDER;
const PRE_SETUP = new Set(["verify", "clock", "setup"]);
const PHASE_DIR = path.resolve(here, "..", "results", "phases");
const STATE_FILE = path.join(PHASE_DIR, "setup.state.json");

function persistSnapshot(id) {
  if (!fs.existsSync(STATE_FILE)) return;
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...saved, snapshot: id }, null, 2));
}

const big = (_, v) => (typeof v === "bigint" ? { $big: v.toString() } : v);
const unbig = (_, v) => (v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v);

async function main() {
  const rpcUrl = opt("rpc", process.env.FORK_RPC ?? "http://127.0.0.1:8547");
  const only = opt("only", null)?.split(",");
  const chain = await connect(rpcUrl); // THE GUARD: throws unless loopback + anvil + fork + 4663
  await chain.prime();
  fs.mkdirSync(PHASE_DIR, { recursive: true });
  console.log(`fork of ${chain.identity.forkUrl} @ ${chain.identity.forkBlock}, chain ${chain.identity.chainId}`);

  const selected = PHASES.filter((p) => !only || only.includes(p));
  const needsSetup = selected.some((p) => !PRE_SETUP.has(p));
  let setupSnapshot = null;
  let setupState = null;

  if (needsSetup && !selected.includes("setup") && !flag("fresh-setup") && fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"), unbig);
    try {
      await chain.revert(saved.snapshot);
      setupSnapshot = await chain.snapshot();
      setupState = saved.state;
      fs.writeFileSync(STATE_FILE, JSON.stringify({ ...saved, snapshot: setupSnapshot }, big, 2));
      console.log(`reusing setup snapshot (fixtures from ${saved.createdAt})`);
    } catch (e) {
      console.log(`setup snapshot unusable (${e.message}); rebuilding`);
    }
  }
  if (needsSetup && !setupState && !selected.includes("setup")) selected.splice(selected.findIndex((p) => !PRE_SETUP.has(p)), 0, "setup");

  for (const phase of selected) {
    const out = path.join(PHASE_DIR, `${phase}.json`);
    const rec = createRecorder(chain, out);
    const head = await chain.head();
    rec.results.meta = {
      phase,
      rpc: rpcUrl,
      forkUrl: chain.identity.forkUrl,
      forkBlock: chain.identity.forkBlock,
      chainId: chain.identity.chainId,
      clientVersion: await chain.rpc("web3_clientVersion"),
      headAtStart: { number: head.number.toString(), timestamp: head.timestamp.toString() },
      broadcastToRealNetwork: false,
      devAccountCodeClearedOnFork: chain.devAccountCodeCleared ?? [],
    };
    if (!PRE_SETUP.has(phase)) {
      await chain.revert(setupSnapshot);
      await chain.neutralizeDevAccounts();
      setupSnapshot = await chain.snapshot();
      persistSnapshot(setupSnapshot);
    }
    const ctx = { chain, rec, state: setupState ? structuredClone(setupState) : {} };
    const mod = await import(`./phases/${phase}.mjs`);
    const t0 = Date.now();
    try {
      await mod.run(ctx);
    } catch (e) {
      console.error(`phase ${phase} threw:`, e);
      rec.results.unexpected.push({ kind: "phase-crash", phase, error: String(e?.stack ?? e).slice(0, 3000) });
    }
    rec.results.meta.seconds = Math.round((Date.now() - t0) / 1000);
    rec.flush();
    console.log(`phase ${phase}: calls=${rec.results.calls.length} unexpected=${rec.results.unexpected.length} (${rec.results.meta.seconds}s)`);
    if (phase === "setup") {
      setupState = ctx.state;
      setupSnapshot = await chain.snapshot();
      fs.writeFileSync(STATE_FILE, JSON.stringify({ createdAt: new Date().toISOString(), forkBlock: chain.identity.forkBlock, snapshot: setupSnapshot, state: setupState }, big, 2));
    }
  }
  if (setupSnapshot) {
    await chain.revert(setupSnapshot);
    persistSnapshot(await chain.snapshot());
  }
  const { merge } = await import("./merge.mjs");
  merge();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

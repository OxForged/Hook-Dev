// SPDX-License-Identifier: MIT
// LatchTimelock custody (0x3aE3, 48 h) and policy (0x1Da3, 6 h).
//
// HEADLINE: the three acceptOwnership() operations ALREADY QUEUED on the custody timelock
// (queued at L2 block 61,325,176, ready at unix 1789411243, predecessor 0) are executed by a random
// EOA after warping past the ready time. Then owner()/pendingOwner() are re-read on all three, and
// registerApp is shown to need schedule -> 48 h -> execute.
import { encodeFunctionData, getAddress, keccak256, toHex } from "viem";
import { ADDR, QUEUED_ACCEPTS } from "../addresses.mjs";
import { ABI, ACTORS, ZERO, ZERO32 } from "../lib.mjs";
import { ERC20_ABI } from "../abis.mjs";

const ACCEPT = "0x79ba5097";
const RANDOM_EOA = getAddress("0x5eE0000000000000000000000000000000c0FFee");
const salt = (s) => keccak256(toHex(`latch-fork-campaign:${s}`));

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { safe, canceller, timelockCustody: custody, timelockPolicy: policy } = ADDR;
  const { mallory, alice, bob, carol } = ACTORS;
  const TL = ABI.LatchTimelock;
  const TLP = ABI.LatchTimelock_policy;
  const OWN = ABI.Vault; // owner()/pendingOwner()/registerApp
  const tlName = (tl) => (tl === custody ? "LatchTimelock_custody" : "LatchTimelock_policy");
  const tlAbi = (tl) => (tl === custody ? TL : TLP);
  const opId = (tl, target, value, data, pred, s) => chain.read(tl, tlAbi(tl), "hashOperation", [target, value, data, pred, s]);
  const schedule = (tl, target, data, s, delay, o = {}) =>
    rec.send({ from: o.from ?? safe, to: tl, abi: tlAbi(tl), fn: "schedule", args: [target, o.value ?? 0n, data, o.pred ?? ZERO32, s, delay], contract: tlName(tl), ...o });
  const execute = (tl, target, data, s, o = {}) =>
    rec.send({ from: o.from ?? RANDOM_EOA, to: tl, abi: tlAbi(tl), fn: "execute", args: [target, o.value ?? 0n, data, o.pred ?? ZERO32, s], value: o.value ?? 0n, contract: tlName(tl), ...o });
  const now = async () => (await chain.head()).timestamp;

  /* ------------------------------------------------------------------ */
  rec.scenario("HEADLINE custody acceptOwnership x3 (already queued)", "Execute the three queued acceptOwnership ops on 0x3aE3 after their ready time; prove the custody tier is then in force");
  const root = await chain.snapshot();

  const ids = [];
  for (const op of QUEUED_ACCEPTS.ops) {
    const id = await opId(custody, op.target, 0n, ACCEPT, ZERO32, op.salt);
    ids.push(id);
    rec.assert(`${op.name}: queued op ${id} exists with ready timestamp 1789411243`, await chain.read(custody, TL, "getTimestamp", [id]), QUEUED_ACCEPTS.readyAt);
    rec.assert(`${op.name}: operation state is Waiting (1) at fork time`, await chain.read(custody, TL, "getOperationState", [id]), 1);
    rec.assert(`${op.name}: owner() is the Safe before execution`, await chain.read(op.target, OWN, "owner"), safe);
    rec.assert(`${op.name}: pendingOwner() is the custody timelock before execution`, await chain.read(op.target, OWN, "pendingOwner"), custody);
  }

  // Before ready: execution must revert.
  await execute(custody, QUEUED_ACCEPTS.ops[0].target, ACCEPT, QUEUED_ACCEPTS.ops[0].salt, { role: "authorized", expect: "revert", expectError: "TimelockUnexpectedOperationState", note: "before readyAt: not executable yet" });

  // Today (pre-execution) the Safe can register an app with no delay: show it, then roll back.
  const preSnap = await chain.snapshot();
  await rec.send({ from: safe, to: ADDR.vault, abi: OWN, fn: "registerApp", args: [state.actor], contract: "Vault", note: "PRE-accept: Safe registers an app directly, no delay (current mainnet state)" });
  rec.assert("PRE-accept: registerApp by the Safe took effect immediately", await chain.read(ADDR.vault, OWN, "isAppRegistered", [state.actor]), true);
  await chain.revert(preSnap);

  // Warp past readyAt. Timestamp-based: mining blocks alone must NOT make it ready.
  await chain.mine(5000);
  rec.assert("mining 5,000 blocks without time does not make the op ready", await chain.read(custody, TL, "isOperationReady", [ids[0]]), false);
  await chain.setNextTimestamp(QUEUED_ACCEPTS.readyAt + 1n);
  for (let i = 0; i < 3; i++) rec.assert(`${QUEUED_ACCEPTS.ops[i].name}: ready after warp`, await chain.read(custody, TL, "isOperationReady", [ids[i]]), true);

  const execTxs = [];
  for (const op of QUEUED_ACCEPTS.ops) {
    const r = await execute(custody, op.target, ACCEPT, op.salt, { from: RANDOM_EOA, note: `HEADLINE: permissionless execute of queued acceptOwnership on ${op.name}` });
    execTxs.push({ target: op.name, txHash: r.txHash, status: r.status, gasUsed: r.gasUsed, events: r.events });
  }
  const after = {};
  for (let i = 0; i < 3; i++) {
    const op = QUEUED_ACCEPTS.ops[i];
    const owner = await chain.read(op.target, OWN, "owner");
    const pending = await chain.read(op.target, OWN, "pendingOwner");
    after[op.name] = { owner, pendingOwner: pending };
    rec.assert(`${op.name}: owner() == custody timelock after execute`, owner, custody);
    rec.assert(`${op.name}: pendingOwner() == 0 after execute`, pending, ZERO);
    rec.assert(`${op.name}: operation Done (3)`, await chain.read(custody, TL, "getOperationState", [ids[i]]), 3);
  }
  rec.assert("CLPoolManager.owner() is still the CLPoolManagerOwner wrapper", await chain.read(ADDR.clPoolManager, ABI.CLPoolManager, "owner"), ADDR.clPoolManagerOwner);
  rec.assert("BinPoolManager.owner() is still the BinPoolManagerOwner wrapper", await chain.read(ADDR.binPoolManager, ABI.BinPoolManager, "owner"), ADDR.binPoolManagerOwner);

  // Replay must fail (op already Done).
  await execute(custody, QUEUED_ACCEPTS.ops[0].target, ACCEPT, QUEUED_ACCEPTS.ops[0].salt, { role: "authorized", expect: "revert", expectError: "TimelockUnexpectedOperationState", note: "replay of a Done op" });

  // The Safe has lost direct authority.
  await rec.send({ from: safe, to: ADDR.vault, abi: OWN, fn: "registerApp", args: [state.actor], contract: "Vault", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "POST-accept: Safe can no longer registerApp directly" });
  await rec.send({ from: safe, to: ADDR.clPoolManagerOwner, abi: ABI.CLPoolManagerOwner, fn: "unpausePoolManager", contract: "CLPoolManagerOwner", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "POST-accept: Safe lost the wrapper" });
  await rec.send({ from: safe, to: ADDR.binPoolManagerOwner, abi: ABI.BinPoolManagerOwner, fn: "setMaxBinStep", args: [120], contract: "BinPoolManagerOwner", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "POST-accept: Safe lost the wrapper" });

  // Pausing after the handover: pausePoolManager is onlyPausableRoleOrOwner, and no pausable role is granted.
  for (const w of [ADDR.clPoolManagerOwner, ADDR.binPoolManagerOwner]) {
    const wn = w === ADDR.clPoolManagerOwner ? "CLPoolManagerOwner" : "BinPoolManagerOwner";
    rec.assert(`${wn}.hasPausableRole(ops key) is false on chain`, await chain.read(w, ABI[wn], "hasPausableRole", [ADDR.opsKey]), false);
    await rec.send({ from: safe, to: w, abi: ABI[wn], fn: "pausePoolManager", contract: wn, role: "unauthorized", expect: "revert", expectError: "NoPausableRole", note: "POST-accept: the Safe can no longer pause without the 48 h queue" });
    await rec.send({ from: ADDR.opsKey, to: w, abi: ABI[wn], fn: "pausePoolManager", contract: wn, role: "unauthorized", expect: "revert", expectError: "NoPausableRole", note: "POST-accept: the ops key holds no pausable role either" });
  }
  rec.note("After the accept batch executes, NOBODY can pause either pool manager without a 48 h queued operation: hasPausableRole is false for the ops key and the Safe is no longer owner. CLAUDE.md's table assigns the pausable role to Ops; grant it (itself a 48 h op) or queue it in the same session.");

  // registerApp via the 48 h queue.
  const regData = encodeFunctionData({ abi: OWN, functionName: "registerApp", args: [state.actor] });
  const regSalt = salt("registerApp-after-accept");
  await schedule(custody, ADDR.vault, regData, regSalt, 172799n, { expect: "revert", expectError: "TimelockInsufficientDelay", note: "47:59:59 is below the 48 h floor" });
  await schedule(custody, ADDR.vault, regData, regSalt, 172800n, { from: mallory, role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount", note: "only the Safe proposes" });
  const sch = await schedule(custody, ADDR.vault, regData, regSalt, 172800n, { note: "Safe queues registerApp with the 48 h delay" });
  await execute(custody, ADDR.vault, regData, regSalt, { expect: "revert", expectError: "TimelockUnexpectedOperationState", note: "same block: not ready" });
  await chain.setNextTimestamp((await now()) + 172800n - 10n);
  await execute(custody, ADDR.vault, regData, regSalt, { expect: "revert", expectError: "TimelockUnexpectedOperationState", note: "10 s before the 48 h elapse: not ready" });
  rec.assert("registerApp not yet applied at 48h-10s", await chain.read(ADDR.vault, OWN, "isAppRegistered", [state.actor]), false);
  await chain.warp(20);
  const ex = await execute(custody, ADDR.vault, regData, regSalt, { note: "after 48 h anyone executes registerApp" });
  rec.assert("registerApp applied after schedule -> 48 h -> execute", await chain.read(ADDR.vault, OWN, "isAppRegistered", [state.actor]), true);

  rec.results.headline = {
    title: "Custody timelock acceptOwnership x3 executed on the fork",
    forkBlock: chain.identity.forkBlock,
    queuedOperations: QUEUED_ACCEPTS.ops.map((o, i) => ({ ...o, operationId: ids[i] })),
    executedBy: RANDOM_EOA,
    execTxs,
    ownersAfter: after,
    registerAppFromSafeAfter: "reverts OwnableUnauthorizedAccount(Safe)",
    registerAppViaQueue: { scheduleTx: sch.txHash, executeTx: ex.txHash, delaySeconds: 172800 },
  };
  state.postAcceptSnapshotNote = "reverted";
  await chain.revert(root);

  /* ------------------------------------------------------------------ */
  rec.scenario("timelock schedule/execute/cancel x3 on both tiers", "Harmless target: a throwaway token mint to the timelock");
  const tokenMint = (to, amt) => encodeFunctionData({ abi: ABI["helpers/CampaignToken"], functionName: "mint", args: [to, amt] });
  for (const tl of [custody, policy]) {
    const delay = await chain.read(tl, tlAbi(tl), "getMinDelay");
    const base = await chain.snapshot();
    for (let i = 1; i <= 3; i++) {
      const target = [state.tokens.TKA, state.tokens.TKB, state.tokens.TKC][i - 1];
      const data = tokenMint(tl, BigInt(i) * 10n ** 18n);
      await schedule(tl, target, data, salt(`sched-${tl}-${i}`), delay + BigInt(i - 1) * 3600n, { note: `schedule #${i}` });
    }
    await chain.warp(delay + 3n * 3600n);
    for (let i = 1; i <= 3; i++) {
      const target = [state.tokens.TKA, state.tokens.TKB, state.tokens.TKC][i - 1];
      await execute(tl, target, tokenMint(tl, BigInt(i) * 10n ** 18n), salt(`sched-${tl}-${i}`), { from: [alice, bob, RANDOM_EOA][i - 1], note: `execute #${i} by a different EOA` });
      rec.assert(`${tlName(tl)} executed mint #${i}`, await chain.read(target, ERC20_ABI, "balanceOf", [tl]), BigInt(i) * 10n ** 18n);
    }
    // batches
    for (let i = 1; i <= 3; i++) {
      const targets = [state.tokens.TKD, state.tokens.TKE].slice(0, i === 1 ? 1 : 2);
      const datas = targets.map((_, j) => tokenMint(bob, BigInt(i * 10 + j)));
      await rec.send({ from: safe, to: tl, abi: tlAbi(tl), fn: "scheduleBatch", args: [targets, targets.map(() => 0n), datas, ZERO32, salt(`batch-${tl}-${i}`), delay], contract: tlName(tl), note: `scheduleBatch #${i} (${targets.length} calls)` });
    }
    await rec.send({ from: mallory, to: tl, abi: tlAbi(tl), fn: "scheduleBatch", args: [[state.tokens.TKD], [0n], [tokenMint(mallory, 1n)], ZERO32, salt("mal"), delay], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
    await chain.warp(delay + 1n);
    for (let i = 1; i <= 3; i++) {
      const targets = [state.tokens.TKD, state.tokens.TKE].slice(0, i === 1 ? 1 : 2);
      const datas = targets.map((_, j) => tokenMint(bob, BigInt(i * 10 + j)));
      await rec.send({ from: carol, to: tl, abi: tlAbi(tl), fn: "executeBatch", args: [targets, targets.map(() => 0n), datas, ZERO32, salt(`batch-${tl}-${i}`)], contract: tlName(tl), note: `executeBatch #${i}` });
    }
    // cancel x3: custody by the canceller (and once by the Safe, also a canceller), policy by the Safe
    const cancellers = tl === custody ? [canceller, canceller, safe] : [safe, safe, safe];
    for (let i = 1; i <= 3; i++) {
      const data = tokenMint(carol, BigInt(i));
      const s = salt(`cancel-${tl}-${i}`);
      await schedule(tl, state.tokens.TKF, data, s, delay, { note: `schedule for cancel #${i}` });
      const id = await opId(tl, state.tokens.TKF, 0n, data, ZERO32, s);
      if (i === 1) await rec.send({ from: mallory, to: tl, abi: tlAbi(tl), fn: "cancel", args: [id], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
      await rec.send({ from: cancellers[i - 1], to: tl, abi: tlAbi(tl), fn: "cancel", args: [id], contract: tlName(tl), note: `cancel #${i} by ${cancellers[i - 1] === canceller ? "the dedicated canceller" : "the Safe"}` });
      rec.assert(`${tlName(tl)} cancel #${i}: operation Unset`, await chain.read(tl, tlAbi(tl), "getOperationState", [id]), 0);
    }
    if (tl === policy) {
      const data = tokenMint(carol, 99n);
      const s = salt("policy-canceller-check");
      await schedule(tl, state.tokens.TKF, data, s, delay);
      const id = await opId(tl, state.tokens.TKF, 0n, data, ZERO32, s);
      await rec.send({ from: canceller, to: tl, abi: TLP, fn: "cancel", args: [id], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount", note: "policy timelock: the dedicated canceller holds NO CANCELLER_ROLE (CLAUDE.md)" });
    }
    // roles: grant/revoke via self-administered queue; renounce by the holder
    const CANCEL_ROLE = await chain.read(tl, tlAbi(tl), "CANCELLER_ROLE");
    await rec.send({ from: safe, to: tl, abi: tlAbi(tl), fn: "grantRole", args: [CANCEL_ROLE, alice], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount", note: "roles are self-administered: even the Safe cannot grant directly" });
    await rec.send({ from: safe, to: tl, abi: tlAbi(tl), fn: "revokeRole", args: [CANCEL_ROLE, safe], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlUnauthorizedAccount" });
    await rec.send({ from: mallory, to: tl, abi: tlAbi(tl), fn: "renounceRole", args: [CANCEL_ROLE, safe], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "AccessControlBadConfirmation" });
    const who = [alice, bob, carol];
    const grant = (a) => encodeFunctionData({ abi: tlAbi(tl), functionName: "grantRole", args: [CANCEL_ROLE, a] });
    const revoke = (a) => encodeFunctionData({ abi: tlAbi(tl), functionName: "revokeRole", args: [CANCEL_ROLE, a] });
    for (const a of who) await schedule(tl, tl, grant(a), salt(`grant-${tl}-${a}`), delay, { note: `queue grantRole(CANCELLER, ${a})` });
    for (const a of who) await schedule(tl, tl, revoke(a), salt(`revoke-${tl}-${a}`), delay, { note: `queue revokeRole(CANCELLER, ${a})` });
    await chain.warp(delay + 1n);
    for (const a of who) {
      await execute(tl, tl, grant(a), salt(`grant-${tl}-${a}`), { note: "executes grantRole (msg.sender == timelock)" });
      rec.assert(`${tlName(tl)} grantRole took effect for ${a}`, await chain.read(tl, tlAbi(tl), "hasRole", [CANCEL_ROLE, a]), true);
    }
    // renounce x3 would remove the role before revoke can run; use renounce for alice/bob/carol on a snapshot
    const rs = await chain.snapshot();
    for (const a of who) {
      await rec.send({ from: a, to: tl, abi: tlAbi(tl), fn: "renounceRole", args: [CANCEL_ROLE, a], contract: tlName(tl), note: "holder renounces its own role" });
      rec.assert(`${tlName(tl)} renounceRole by ${a}`, await chain.read(tl, tlAbi(tl), "hasRole", [CANCEL_ROLE, a]), false);
    }
    await chain.revert(rs);
    for (const a of who) {
      await execute(tl, tl, revoke(a), salt(`revoke-${tl}-${a}`), { note: "executes revokeRole" });
      rec.assert(`${tlName(tl)} revokeRole took effect for ${a}`, await chain.read(tl, tlAbi(tl), "hasRole", [CANCEL_ROLE, a]), false);
    }
    // ERC-721/1155 receiver hooks: pure acknowledgements, callable by anyone
    for (let i = 1; i <= 3; i++) {
      await rec.send({ from: [alice, bob, carol][i - 1], to: tl, abi: tlAbi(tl), fn: "onERC721Received", args: [alice, bob, BigInt(i), toHex(`d${i}`)], contract: tlName(tl), note: "returns the selector; no state" });
      await rec.send({ from: [alice, bob, carol][i - 1], to: tl, abi: tlAbi(tl), fn: "onERC1155Received", args: [alice, bob, BigInt(i), BigInt(i * 5), "0x"], contract: tlName(tl) });
      await rec.send({ from: [alice, bob, carol][i - 1], to: tl, abi: tlAbi(tl), fn: "onERC1155BatchReceived", args: [alice, bob, [BigInt(i)], [BigInt(i)], "0x"], contract: tlName(tl) });
    }
    rec.notExercised(tlName(tl), "onERC721Received", "no access control exists to test an unauthorized caller against (by design; the hooks only return their selector)");
    rec.notExercised(tlName(tl), "onERC1155Received", "no access control by design");
    rec.notExercised(tlName(tl), "onERC1155BatchReceived", "no access control by design");

    // updateDelay: direct call is refused; via the queue, three valid values
    await rec.send({ from: safe, to: tl, abi: tlAbi(tl), fn: "updateDelay", args: [0n], contract: tlName(tl), role: "unauthorized", expect: "revert", expectError: "TimelockUnauthorizedCaller" });
    const floor = tl === custody ? 172800n : 21600n;
    const us = await chain.snapshot();
    for (const [i, v] of [floor, floor + 3600n, floor * 2n].entries()) {
      const data = encodeFunctionData({ abi: tlAbi(tl), functionName: "updateDelay", args: [v] });
      const cur = await chain.read(tl, tlAbi(tl), "getMinDelay");
      await schedule(tl, tl, data, salt(`ud-${tl}-${i}`), cur, { note: `queue updateDelay(${v})` });
      await chain.warp(cur + 1n);
      await execute(tl, tl, data, salt(`ud-${tl}-${i}`), { note: `updateDelay(${v}) executes` });
      rec.assert(`${tlName(tl)} getMinDelay == ${v}`, await chain.read(tl, tlAbi(tl), "getMinDelay"), v);
    }
    await chain.revert(us);
    await chain.revert(base);
  }

  /* ------------------------------------------------------------------ */
  rec.scenario("HAZARD §2 updateDelay(0)", "Queue updateDelay(0) on each tier; then try a same-block registerApp-class operation");
  for (const tl of [custody, policy]) {
    const s0 = await chain.snapshot();
    const delay = await chain.read(tl, tlAbi(tl), "getMinDelay");
    const data = encodeFunctionData({ abi: tlAbi(tl), functionName: "updateDelay", args: [0n] });
    await schedule(tl, tl, data, salt(`zero-${tl}`), delay, { role: "hazard", note: "HAZARD §2: queue updateDelay(0)" });
    await chain.warp(delay + 1n);
    const r = await execute(tl, tl, data, salt(`zero-${tl}`), { role: "hazard", expect: tl === custody ? "revert" : "success", expectError: tl === custody ? "DelayBelowTierFloor" : undefined, note: "HAZARD §2: execute updateDelay(0)" });
    const md = await chain.read(tl, tlAbi(tl), "getMinDelay");
    if (tl === policy) {
      // with delay 0 an op executes in the block it is queued
      const d2 = tokenMint(mallory, 1n);
      await schedule(tl, state.tokens.TKA, d2, salt("zero-follow"), 0n, { role: "hazard", note: "HAZARD §2: schedule with delay 0" });
      const e2 = await execute(tl, state.tokens.TKA, d2, salt("zero-follow"), { role: "hazard", note: "HAZARD §2: executes with no elapsed time" });
      rec.hazard("§2-policy", "LatchTimelock policy 0x1Da3: updateDelay(0) executes and the tier stops existing; only the Safe can cancel", { updateDelayTx: r.txHash, getMinDelayAfter: md, zeroDelayExecuteTx: e2.txHash, cancellers: "Safe only (canceller EOA has no CANCELLER_ROLE)" }, r.status === "success" && md === 0n && e2.status === "success");
    } else {
      rec.hazard("§2-custody", "LatchTimelock custody 0x3aE3: updateDelay(0) — CLAUDE.md §2 says nothing prevents it; the deployed code refuses it", { executeTx: r.txHash, error: r.error, getMinDelayAfter: md }, r.status === "success");
      rec.assert("custody getMinDelay unchanged at 48 h after the refused updateDelay(0)", md, 172800n);
    }
    await chain.revert(s0);
  }
}

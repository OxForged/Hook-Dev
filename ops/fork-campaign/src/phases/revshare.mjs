// SPDX-License-Identifier: MIT
// RevShareHook 0x23CE (retired, hosts LTT1/LTT2) and 0xfC00 (current). Every write function x3 on each.
//
// Block-based timing: both hooks measure the config delay in block.number. On this fork block.number is
// the L2 number and advances 1 per mined block (see phase `clock`). Maturity is therefore reached by
// MINING the exact number of blocks (anvil_mine), and a 13 h timestamp warp is shown NOT to mature a
// proposal. 0x23CE's 3,600-block delay is mined for real. 0xfC00's 432,000-block delay is mined for
// real too unless FORK_CAMPAIGN_FAST=1. Its 2,592,000-block TTL is NOT mined (~90 min of local
// mining): expiry is exercised by rewriting the pending proposal's stored (effectiveBlock, expiryBlock)
// with anvil_setStorageAt - documented per call, and the stored values are asserted to equal the
// ConfigProposed event before the rewrite.
import { encodeAbiParameters, keccak256, decodeEventLog, pad, numberToHex } from "viem";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, clKey, poolId, Q96, A, P, plan, MAX128, ZERO, hookCallbackCalls, swapInPlan, swapOutPlan, balanceOf } from "../lib.mjs";

const FAST = process.env.FORK_CAMPAIGN_FAST === "1";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, erin, mallory } = ACTORS;
  const { safe, opsKey, clPoolManager: CLM, clPositionManager: POSM, universalRouter: UR } = ADDR;
  const CL = ABI.CLPoolManager, CPM = ABI.CLPositionManager, R = ABI.UniversalRouter;
  const dl = async () => (await chain.head()).timestamp + 3600n;
  const evmBlock = async () => (await chain.evmClock()).number;

  const mineChunked = async (n, label) => {
    let left = BigInt(n);
    const t0 = Date.now();
    while (left > 0n) {
      const step = left > 50_000n ? 50_000n : left;
      await chain.mine(step);
      left -= step;
      console.log(`   mined ${BigInt(n) - left}/${n} blocks for ${label} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  };

  for (const [H, NAME] of [[ADDR.revShareHookRetired, "RevShareHook_23CE"], [ADDR.revShareHookCurrent, "RevShareHook_fC00"]]) {
    const RS = ABI[NAME];
    const current = NAME === "RevShareHook_fC00";
    const S = (o) => rec.send({ to: H, abi: RS, contract: NAME, ...o });
    const hookRoot = await chain.snapshot();
    rec.scenario(`${NAME} configure-and-trade`, "Claim 3 pools, rosters, initialize, add liquidity, trade, settle/claim/pull/redeem");
    const bitmap = await chain.read(H, RS, "getHooksRegistrationBitmap");
    const { TKA, TKB, TKC, TKD, TKE, TKF } = state.tokens;
    const keys = [
      clKey(TKA, TKB, { fee: 3000, tickSpacing: 60, hooks: H, bitmap }),
      clKey(TKC, TKD, { fee: 500, tickSpacing: 10, hooks: H, bitmap }),
      clKey(TKE, TKF, { fee: 10000, tickSpacing: 200, hooks: H, bitmap }),
    ];
    const ids = keys.map(poolId);
    const owners = [alice, bob, carol];
    const cp = (fee, lp, ben, dist, distributor = ZERO, enabled = true) => ({ feePips: fee, lpDonateBps: lp, beneficiaryBps: ben, distributorBps: dist, distributor, enabled });

    // unconfigured pool cannot be initialized
    const unconfigured = clKey(TKA, TKB, { fee: 2500, tickSpacing: 50, hooks: H, bitmap });
    await rec.send({ from: mallory, to: CLM, abi: CL, fn: "initialize", args: [unconfigured, Q96], contract: NAME, sig: "beforeInitialize", role: "unauthorized", expect: "revert", expectError: "PoolNotConfigured", note: "beforeInitialize refuses an unclaimed pool" });

    // claim (first configure) x3, lp-only so 0xfC00 accepts it before a roster exists
    for (let i = 0; i < 3; i++) {
      await S({ from: owners[i], fn: "configure", args: [keys[i], cp([3000, 5000, 1000][i], 10000, 0, 0)], note: "first claim" });
      rec.assert(`${NAME} pool ${i + 1} owner == ${owners[i]}`, await chain.read(H, RS, "poolOwner", [ids[i]]), owners[i]);
    }
    await S({ from: mallory, fn: "configure", args: [keys[0], cp(100000, 0, 10000, 0)], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    await S({ from: alice, fn: "configure", args: [keys[0], cp(100001, 10000, 0, 0)], role: "unauthorized", expect: "revert", expectError: "FeeTooHigh", note: "above MAX_FEE_PIPS 10%" });
    if (current) await S({ from: alice, fn: "configure", args: [keys[0], cp(3000, 2000, 8000, 0)], role: "unauthorized", expect: "revert", expectError: "BeneficiariesRequired", note: "0xfC00: beneficiary share needs a roster first" });

    // rosters x3
    const rosters = [[{ recipient: alice, weight: 1n }, { recipient: erin, weight: 3n }], [{ recipient: carol, weight: 1n }, { recipient: dave, weight: 1n }], [{ recipient: bob, weight: 10n ** 18n }]];
    for (let i = 0; i < 3; i++) await S({ from: owners[i], fn: "setBeneficiaries", args: [keys[i], rosters[i]] });
    await S({ from: mallory, fn: "setBeneficiaries", args: [keys[0], [{ recipient: mallory, weight: 1n }]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    await S({ from: alice, fn: "setBeneficiaries", args: [keys[0], [{ recipient: ZERO, weight: 1n }]], role: "unauthorized", expect: "revert", expectError: "InvalidBeneficiaries" });
    // reconfigure before initialization: final splits
    await S({ from: alice, fn: "configure", args: [keys[0], cp(3000, 2000, 8000, 0)], note: "reconfigure pre-init: 20% LP / 80% roster" });
    await S({ from: bob, fn: "configure", args: [keys[1], cp(5000, 0, 5000, 5000, dave)], note: "reconfigure pre-init: 50% roster / 50% distributor dave" });

    for (let i = 0; i < 3; i++) {
      await rec.send({ from: owners[i], to: CLM, abi: CL, fn: "initialize", args: [keys[i], Q96], contract: "CLPoolManager", role: "setup", note: `${NAME} pool ${i + 1}` });
      await rec.send({ from: alice, to: POSM, abi: CPM, fn: "modifyLiquidities", args: [plan([[A.CL_MINT_POSITION, P.clMint(keys[i], -12000, 12000, 10n ** 24n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(keys[i].currency0, keys[i].currency1)]]), await dl()], contract: "CLPositionManager", role: "setup" });
    }
    await S({ from: alice, fn: "configure", args: [keys[0], cp(3000, 2000, 8000, 0)], role: "unauthorized", expect: "revert", expectError: "PoolAlreadyConfigured", note: "configure is closed once initialized (raises go through proposeConfig)" });

    const swap = (who, k, z, amt, note) => rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(k, z, amt)], 0n], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "setup", note, gas: 3_000_000n }).then(async (r) => r);
    const dlSwap = async (who, k, z, amt, note) => rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(k, z, amt)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "setup", note });
    for (const [k, z] of [[keys[0], true], [keys[0], false], [keys[1], true], [keys[1], false], [keys[2], true]]) await dlSwap(dave, k, z, 10n ** 21n, `${NAME} trade`);
    void swap;
    const pb = async (i, c) => chain.read(H, RS, "pendingBeneficiary", [ids[i], c]);
    const sGov = await chain.snapshot(); // governance scenario runs from here, pools still enabled
    rec.assert(`${NAME} pool1 pendingBeneficiary(currency1) > 0 after a 0->1 swap`, (await pb(0, keys[0].currency1)) > 0n, true);
    rec.assert(`${NAME} pool2 pendingDistributor(currency0) > 0 after a 1->0 swap`, (await chain.read(H, RS, "pendingDistributor", [ids[1], keys[1].currency0])) > 0n, true);

    // settleBeneficiaries x3 (permissionless)
    for (const [i, c, who] of [[0, keys[0].currency1, erin], [0, keys[0].currency0, mallory], [1, keys[1].currency1, bob]]) {
      const before = await pb(i, c);
      await S({ from: who, fn: "settleBeneficiaries", args: [keys[i], c], note: "permissionless" });
      rec.assert(`${NAME} settle pool ${i + 1}: pending reduced to dust`, (await pb(i, c)) < BigInt(rosters[i].length) + 1n && before > 0n, true);
    }
    rec.notExercised(NAME, "settleBeneficiaries", "permissionless by design; no unauthorized caller exists (it pays only the stored roster)");
    // claim x3
    const claimable = (who, c) => chain.read(H, RS, "claimable", [who, c]);
    for (const [who, c, to] of [[erin, keys[0].currency1, erin], [alice, keys[0].currency0, carol], [dave, keys[1].currency1, dave]]) {
      const amt = await claimable(who, c);
      const b0 = await balanceOf(chain, c, to);
      await S({ from: who, fn: "claim", args: [c, to], note: `claim ${amt}` });
      rec.assert(`${NAME} claim: ${to} received exactly the claimable ${amt}`, (await balanceOf(chain, c, to)) - b0, amt);
    }
    await S({ from: mallory, fn: "claim", args: [keys[0].currency1, mallory], role: "unauthorized", expect: "revert", expectError: "NothingToClaim" });
    await S({ from: carol, fn: "claim", args: [keys[1].currency1, ZERO], role: "unauthorized", expect: "revert", expectError: "InvalidRecipient" });
    // pullDistributorShare x3
    for (const c of [keys[1].currency0, keys[1].currency1, keys[1].currency0]) {
      const pend = await chain.read(H, RS, "pendingDistributor", [ids[1], c]);
      const b0 = await balanceOf(chain, c, dave);
      await S({ from: dave, fn: "pullDistributorShare", args: [keys[1], c], note: pend === 0n ? "nothing pending: returns 0 without reverting" : `pull ${pend}` });
      rec.assert(`${NAME} distributor received ${pend}`, (await balanceOf(chain, c, dave)) - b0, pend);
    }
    await S({ from: mallory, fn: "pullDistributorShare", args: [keys[1], keys[1].currency0], role: "unauthorized", expect: "revert", expectError: "NotDistributor" });
    // redeem x3 (converts the hook's ERC-6909 claims into tokens; pays nobody)
    for (const c of [keys[0].currency1, keys[1].currency1, keys[2].currency1]) {
      const claims = await chain.read(ADDR.vault, ABI.Vault, "balanceOf", [H, c]);
      const backing = await chain.read(H, RS, "backing", [c]);
      await S({ from: mallory, fn: "redeem", args: [c], note: `permissionless; vault claims ${claims}` });
      rec.assert(`${NAME} redeem: vault claims -> 0 and backing unchanged`, [await chain.read(ADDR.vault, ABI.Vault, "balanceOf", [H, c]), await chain.read(H, RS, "backing", [c])], [0n, backing], (a, b) => a[0] === b[0] && a[1] === b[1]);
    }
    rec.notExercised(NAME, "redeem", "permissionless by design; converts the hook's own claims and pays nobody");
    await S({ from: mallory, fn: "lockAcquired", args: ["0x"], role: "unauthorized", expect: "revert", expectError: "UnexpectedLockCallback" });
    rec.notExercised(NAME, "lockAcquired", "vault-only, armed-only callback; exercised by every redeem/claim above");
    for (const [fn, args] of hookCallbackCalls(keys[0], dave)) await S({ from: mallory, fn, args, role: "unauthorized", expect: "revert", expectError: "NotPoolManager", note: "only the pool manager may call hook callbacks" });
    for (const [fn] of hookCallbackCalls(keys[0], dave)) rec.notExercised(NAME, fn, ["beforeInitialize", "afterSwap"].includes(fn) ? "pool-manager-only callback: exercised by every initialize/swap above, directly only as the unauthorized call" : "not registered in this hook's bitmap (BEFORE_INITIALIZE|AFTER_SWAP|AFTER_SWAP_RETURNS_DELTA): the manager never calls it");

    /* --------------------------- config lifecycle --------------------------- */
    rec.scenario(`MUST ${NAME} propose-wait-apply-expiry`, "proposeConfig -> wait (blocks, not time) -> applyPendingConfig -> expiry behaviour");
    const delay = BigInt(await chain.read(H, RS, "CONFIG_DELAY_BLOCKS"));
    const ttl = current ? BigInt(await chain.read(H, RS, "CONFIG_PROPOSAL_TTL_BLOCKS")) : null;
    const proposals = [cp(10000, 2000, 8000, 0), cp(20000, 0, 5000, 5000, dave), cp(100000, 10000, 0, 0)];
    const proposeTxs = [];
    for (let i = 0; i < 3; i++) {
      const r = await S({ from: owners[i], fn: "proposeConfig", args: [keys[i], proposals[i]], note: `raise to ${proposals[i].feePips} pips` });
      const ev = r.receipt.logs.map((l) => { try { return decodeEventLog({ abi: RS, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "ConfigProposed");
      proposeTxs.push({ block: BigInt(r.block), effectiveBlock: BigInt(ev.args.effectiveBlock), expiryBlock: ev.args.expiryBlock !== undefined ? BigInt(ev.args.expiryBlock) : null });
      rec.assert(`${NAME} proposal ${i + 1}: effectiveBlock == block.number + CONFIG_DELAY_BLOCKS (${delay})`, BigInt(ev.args.effectiveBlock), (await evmBlock()) + delay);
      if (current) rec.assert(`${NAME} proposal ${i + 1}: expiryBlock == effectiveBlock + TTL (${ttl})`, BigInt(ev.args.expiryBlock), BigInt(ev.args.effectiveBlock) + ttl);
    }
    await S({ from: mallory, fn: "proposeConfig", args: [keys[0], proposals[2]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    await S({ from: erin, fn: "applyPendingConfig", args: [keys[0]], role: "authorized", expect: "revert", expectError: "PendingConfigNotDue", note: "same block" });
    await chain.warp(13n * 3600n);
    await S({ from: erin, fn: "applyPendingConfig", args: [keys[0]], role: "authorized", expect: "revert", expectError: "PendingConfigNotDue", note: "after a 13 h TIMESTAMP warp: still not due - the delay is counted in blocks" });
    const realSecondsPerContractBlock = 12.1;
    const reportDelay = { delayBlocks: delay.toString(), realDurationAt12_1s: `${((Number(delay) * realSecondsPerContractBlock) / 3600).toFixed(1)} h`, declaredBlockTimeCentis: current ? await chain.read(H, RS, "blockTimeCentis") : "n/a (constant)" };
    if (!current || !FAST) {
      // anvil mines each tx in head+1, so head = effective-2 makes the next tx execute AT effective-1
      const toMine = proposeTxs[0].effectiveBlock - (await evmBlock()) - 2n;
      if (toMine > 0n) await mineChunked(toMine, `${NAME} delay`);
      await S({ from: erin, fn: "applyPendingConfig", args: [keys[0]], expect: "revert", expectError: "PendingConfigNotDue", note: "executes at block.number == effectiveBlock - 1" });
    } else {
      rec.note(`${NAME}: FORK_CAMPAIGN_FAST=1 - the ${delay}-block delay was reached by rewriting stored effectiveBlock instead of mining`);
    }
    const pendingSlot = async (id, effective) => {
      for (let s = 0n; s < 40n; s++) {
        const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, s]));
        const w = BigInt(await chain.storageAt(H, slot));
        if (w !== 0n && (w & ((1n << 48n) - 1n)) === effective) return slot;
      }
      throw new Error("pending slot not found");
    };
    const rewritePending = async (i, newEffective, newExpiry) => {
      const slot = await pendingSlot(ids[i], proposeTxs[i].effectiveBlock);
      let w = BigInt(await chain.storageAt(H, slot));
      if (current) rec.assert(`${NAME} stored expiryBlock for proposal ${i + 1} equals the ConfigProposed event before rewrite`, (w >> 48n) & ((1n << 48n) - 1n), proposeTxs[i].expiryBlock);
      w = (w & ~((1n << 48n) - 1n)) | newEffective;
      if (current) w = (w & ~(((1n << 48n) - 1n) << 48n)) | (newExpiry << 48n);
      await chain.rpc("anvil_setStorageAt", [H, slot, pad(numberToHex(w), { size: 32 })]);
      proposeTxs[i].effectiveBlock = newEffective;
      if (current) proposeTxs[i].expiryBlock = newExpiry;
    };
    if (current && FAST) {
      const now = await evmBlock();
      await rewritePending(0, now + 1n, now + 1n + ttl);
    }
      const f0 = (await chain.read(H, RS, "getConfig", [ids[0]])).feePips;
    await S({ from: erin, fn: "applyPendingConfig", args: [keys[0]], note: "matured: anyone may apply (permissionless)" });
    rec.assert(`${NAME} applied: fee ${f0} -> ${proposals[0].feePips}`, (await chain.read(H, RS, "getConfig", [ids[0]])).feePips, proposals[0].feePips);
    await S({ from: mallory, fn: "applyPendingConfig", args: [keys[0]], expect: "revert", expectError: "NoPendingConfig", note: "applied proposal is consumed" });
    // bring proposals 2 and 3 to maturity by the same route
    const now2 = await evmBlock();
    if (proposeTxs[1].effectiveBlock > now2 + 1n) {
      if (current && FAST) await rewritePending(1, now2, now2 + ttl);
      else await chain.mine(proposeTxs[1].effectiveBlock - now2 - 1n);
    }
    await S({ from: mallory, fn: "applyPendingConfig", args: [keys[1]], note: current ? "within [effective, expiry]" : "matured" });

    // expiry
    if (current) {
      const now3 = await evmBlock();
      await rewritePending(2, now3 - ttl - 10n, now3 - 10n);
      await S({ from: erin, fn: "applyPendingConfig", args: [keys[2]], role: "authorized", expect: "revert", expectError: "PendingConfigExpired", note: `simulated: effective/expiry rewritten to ${ttl + 10n} and 10 blocks in the past (TTL ${ttl} blocks ≈ ${((Number(ttl) * realSecondsPerContractBlock) / 86400).toFixed(0)} real days)` });
      await rewritePending(2, now3 - ttl, now3 + 5n);
      await S({ from: erin, fn: "applyPendingConfig", args: [keys[2]], note: `simulated: 5 blocks before expiry - still applicable` });
      rec.hazard("§3b-fC00-TTL", "0xfC00 proposal TTL is 2,592,000 contract blocks ≈ 363 days on Robinhood's ~12.1 s contract clock (intended 3 days)", { ttlBlocks: ttl, delayBlocks: delay, ...reportDelay }, ttl === 2_592_000n);
      rec.hazard("§3b-fC00-delay", "0xfC00 CONFIG_DELAY_BLOCKS 432,000 ≈ 60 days real (intended 12 h)", reportDelay, delay === 432_000n);
    } else {
      await S({ from: carol, fn: "proposeConfig", args: [keys[2], proposals[2]], role: "setup" });
      const eff = await chain.read(H, RS, "getPendingConfig", [ids[2]]);
      await mineChunked(BigInt(eff.effectiveBlock) - (await evmBlock()) + 20_000n, "0x23CE no-expiry");
      await S({ from: mallory, fn: "applyPendingConfig", args: [keys[2]], note: "matured 20,000 blocks (≈67 h real) ago and still applies: no expiry" });
      await S({ from: carol, fn: "proposeConfig", args: [keys[2], cp(90000, 10000, 0, 0)], role: "setup" });
      const effX = BigInt((await chain.read(H, RS, "getPendingConfig", [ids[2]])).effectiveBlock);
      proposeTxs[2].effectiveBlock = effX;
      await rewritePending(2, 1n, 0n);
      await S({ from: mallory, fn: "applyPendingConfig", args: [keys[2]], note: "simulated: effectiveBlock rewritten to 1 (a proposal of any age) - still applies" });
      rec.hazard("§5-no-expiry-23CE", "0x23CE: a matured proposal never expires", { minedPastMaturity: 20000, alsoAppliedAtEffectiveBlock1: true }, true);
    }

    rec.scenario(`${NAME} cancel-reduce-disable-§5`, "cancelPendingConfig / reduceFee / disable x3, and whether disable clears an armed proposal");
    for (let i = 0; i < 3; i++) {
      await S({ from: owners[i], fn: "proposeConfig", args: [keys[i], cp(99000, 10000, 0, 0)], role: "setup" });
      await S({ from: owners[i], fn: "cancelPendingConfig", args: [keys[i]] });
      rec.assert(`${NAME} cancel ${i + 1}: pending cleared`, BigInt((await chain.read(H, RS, "getPendingConfig", [ids[i]])).effectiveBlock), 0n);
    }
    await S({ from: alice, fn: "cancelPendingConfig", args: [keys[0]], role: "unauthorized", expect: "revert", expectError: "NoPendingConfig" });
    await S({ from: alice, fn: "proposeConfig", args: [keys[0], cp(99000, 10000, 0, 0)], role: "setup" });
    await S({ from: mallory, fn: "cancelPendingConfig", args: [keys[0]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    for (let i = 0; i < 3; i++) {
      const cur = (await chain.read(H, RS, "getConfig", [ids[i]])).feePips;
      await S({ from: owners[i], fn: "reduceFee", args: [keys[i], Math.floor(cur / 2)], note: `${cur} -> ${Math.floor(cur / 2)}, immediate` });
    }
    await S({ from: bob, fn: "reduceFee", args: [keys[1], 99999], role: "unauthorized", expect: "revert", expectError: "FeeNotReduced" });
    await S({ from: mallory, fn: "reduceFee", args: [keys[1], 0], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    rec.assert(`${NAME}: reduceFee ${current ? "CLEARED" : "left"} alice's pending proposal`, BigInt((await chain.read(H, RS, "getPendingConfig", [ids[0]])).effectiveBlock) === 0n, current);
    // §5: an armed proposal survives disable on 0x23CE
    const s5 = await chain.snapshot();
    await S({ from: bob, fn: "proposeConfig", args: [keys[1], cp(100000, 0, 5000, 5000, dave)], role: "hazard", note: "§5: arm a 10% proposal" });
    if (!current) await mineChunked(delay, "§5 maturity");
    await S({ from: bob, fn: "disable", args: [keys[1]], role: "hazard", note: "§5: owner disables (indexers read 'revenue share off')" });
    const pend = await chain.read(H, RS, "getPendingConfig", [ids[1]]);
    const armed = BigInt(pend.effectiveBlock) !== 0n;
    let applied = null;
    if (armed) {
      applied = await S({ from: mallory, fn: "applyPendingConfig", args: [keys[1]], role: "hazard", note: "§5: a stranger re-arms the 10% cut after disable" });
      const cfg = await chain.read(H, RS, "getConfig", [ids[1]]);
      const out0 = await balanceOf(chain, keys[1].currency1, dave);
      const sw = await dlSwap(dave, keys[1], true, 10n ** 20n, "§5: trade after the stranger applied, amountOutMinimum = 0");
      rec.hazard("§5-23CE", "0x23CE: disable does not clear a matured proposal; anyone applies it and the next trade pays the 10% cut", { disableLeftPending: true, applyTx: applied.txHash, configAfter: cfg, swapTx: sw.txHash, traderReceived: (await balanceOf(chain, keys[1].currency1, dave)) - out0 }, cfg.enabled === true && cfg.feePips === 100000);
    } else {
      await S({ from: mallory, fn: "applyPendingConfig", args: [keys[1]], expect: "revert", expectError: "NoPendingConfig", note: "0xfC00: disable cleared the proposal" });
      rec.hazard("§5-fC00", "0xfC00: disable clears an armed proposal (fix confirmed)", { pendingAfterDisable: pend }, false);
    }
    await chain.revert(s5);
    for (let i = 0; i < 3; i++) {
      await S({ from: owners[i], fn: "disable", args: [keys[i]] });
      rec.assert(`${NAME} disable ${i + 1}: enabled == false`, (await chain.read(H, RS, "getConfig", [ids[i]])).enabled, false);
    }
    await S({ from: mallory, fn: "disable", args: [keys[0]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });

    rec.scenario(`${NAME} pool-ownership`, "transferPoolOwnership / acceptPoolOwnership x3");
    const newOwners = [dave, erin, alice];
    for (let i = 0; i < 3; i++) await S({ from: owners[i], fn: "transferPoolOwnership", args: [keys[i], newOwners[i]] });
    await S({ from: mallory, fn: "acceptPoolOwnership", args: [keys[0]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    await S({ from: mallory, fn: "transferPoolOwnership", args: [keys[0], mallory], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    for (let i = 0; i < 3; i++) {
      await S({ from: newOwners[i], fn: "acceptPoolOwnership", args: [keys[i]] });
      rec.assert(`${NAME} pool ${i + 1} owner -> ${newOwners[i]}`, await chain.read(H, RS, "poolOwner", [ids[i]]), newOwners[i]);
    }

    rec.scenario(`MUST ${NAME} freezeConfig-and-§3`, "freezeConfig x3; the empty-roster ordering hazard");
    const s3 = await chain.snapshot();
    // re-enable pool 1 with a beneficiary share, then try to empty its roster
    await S({ from: dave, fn: "proposeConfig", args: [keys[0], cp(3000, 2000, 8000, 0)], role: "setup" });
    if (!current) await mineChunked(delay, `${NAME} re-enable`);
    else { const n = await evmBlock(); { const pc = await chain.read(H, RS, "getPendingConfig", [ids[0]]); proposeTxs[0].effectiveBlock = BigInt(pc.effectiveBlock); proposeTxs[0].expiryBlock = BigInt(pc.expiryBlock); } await rewritePending(0, n, n + ttl); rec.note("0xfC00 re-enable: maturity simulated by rewriting the stored proposal (the real 432,000-block delay was already mined once above)"); }
    await S({ from: erin, fn: "applyPendingConfig", args: [keys[0]], role: "setup" });
    const emptied = await S({ from: dave, fn: "setBeneficiaries", args: [keys[0], []], role: "hazard", expect: current ? "revert" : "success", expectError: current ? "BeneficiariesRequired" : undefined, note: "§3: empty the roster while beneficiaryBps = 8000" });
    const frozen = await S({ from: dave, fn: "freezeConfig", args: [keys[0]], role: "hazard", note: current ? "roster intact, freeze allowed" : "§3: freeze with an empty roster" });
    const potBefore = await pb(0, keys[0].currency1);
    await dlSwap(bob, keys[0], true, 10n ** 21n, "§3: trade after freeze");
    const potAfter = await pb(0, keys[0].currency1);
    await S({ from: mallory, fn: "settleBeneficiaries", args: [keys[0], keys[0].currency1], role: "hazard", note: current ? "roster present: distributes" : "§3: returns early - pot stays" });
    const potSettled = await pb(0, keys[0].currency1);
    const repair = await S({ from: dave, fn: "setBeneficiaries", args: [keys[0], [{ recipient: dave, weight: 1n }]], role: "hazard", expect: "revert", expectError: "ConfigFrozen", note: "repair is impossible after freeze" });
    if (!current) rec.hazard("§3-23CE", "0x23CE: empty roster + freeze -> every later beneficiary cut accrues to nobody, forever", { emptyRosterTx: emptied.txHash, freezeTx: frozen.txHash, potBeforeTrade: potBefore, potAfterTrade: potAfter, potAfterSettle: potSettled, repairError: repair.error }, emptied.status === "success" && potAfter > potBefore && potSettled === potAfter);
    else rec.hazard("§3-fC00", "0xfC00: the empty-roster state cannot be reached (fix confirmed)", { emptyRosterError: emptied.error }, false);
    await S({ from: dave, fn: "proposeConfig", args: [keys[0], cp(3000, 10000, 0, 0)], role: "unauthorized", expect: "revert", expectError: "ConfigFrozen", note: "frozen: proposeConfig closed" });
    await S({ from: erin, fn: "freezeConfig", args: [keys[1]] });
    await S({ from: alice, fn: "freezeConfig", args: [keys[2]] });
    await S({ from: mallory, fn: "freezeConfig", args: [keys[1]], role: "unauthorized", expect: "revert", expectError: "NotPoolOwner" });
    await chain.revert(s3);

    if (!current) {
      rec.scenario("MUST §3 on the LIVE LTT1/LTT2 pool (0x23CE, owner 0x304b)", "The ops key empties the roster and freezes; a trade then accrues to nobody");
      const s4 = await chain.snapshot();
      const kArr = await chain.read(CLM, CL, "poolIdToPoolKey", [ADDR.demoPoolId]);
      const lkey = { currency0: kArr[0], currency1: kArr[1], hooks: kArr[2], poolManager: kArr[3], fee: kArr[4], parameters: kArr[5] };
      const e1 = await S({ from: opsKey, fn: "setBeneficiaries", args: [lkey, []], role: "hazard", note: "§3 live pool: empty roster" });
      const e2 = await S({ from: opsKey, fn: "freezeConfig", args: [lkey], role: "hazard", note: "§3 live pool: freeze" });
      rec.assert("LTT pool frozen with beneficiaryBps 8000 and totalWeight 0", [(await chain.read(H, RS, "getConfig", [ADDR.demoPoolId])).frozen, await chain.read(H, RS, "totalWeight", [ADDR.demoPoolId])], [true, 0n], (a, b) => a[0] === b[0] && a[1] === b[1]);
      for (const t of [lkey.currency0]) {
        await rec.send({ from: opsKey, to: t, abi: ABI["helpers/CampaignToken"], fn: "transfer", args: [bob, 10n ** 21n], role: "setup", contract: "LTT" });
        await rec.send({ from: bob, to: t, abi: ABI["helpers/CampaignToken"], fn: "approve", args: [ADDR.permit2, 2n ** 256n - 1n], role: "setup", contract: "LTT" });
        await rec.send({ from: bob, to: ADDR.permit2, abi: (await import("../abis.mjs")).EXTERNAL_ABI, fn: "approve", args: [t, UR, 2n ** 160n - 1n, 2 ** 48 - 1], role: "setup", contract: "Permit2" });
      }
      const lp0 = await chain.read(H, RS, "pendingBeneficiary", [ADDR.demoPoolId, lkey.currency1]);
      const tr = await dlSwap(bob, lkey, true, 10n ** 19n, "§3 live pool: trade after freeze");
      const lp1 = await chain.read(H, RS, "pendingBeneficiary", [ADDR.demoPoolId, lkey.currency1]);
      await S({ from: mallory, fn: "settleBeneficiaries", args: [lkey, lkey.currency1], role: "hazard", note: "returns early" });
      const lp2 = await chain.read(H, RS, "pendingBeneficiary", [ADDR.demoPoolId, lkey.currency1]);
      const fix = await S({ from: opsKey, fn: "setBeneficiaries", args: [lkey, [{ recipient: safe, weight: 1n }]], role: "hazard", expect: "revert", expectError: "ConfigFrozen" });
      rec.hazard("§3-LIVE-LTT", "Live LTT1/LTT2 pool: a stolen shared-VPS key empties the roster and freezes in two txs; the pot is then stranded forever", { setBeneficiariesTx: e1.txHash, freezeTx: e2.txHash, tradeTx: tr.txHash, potBefore: lp0, potAfterTrade: lp1, potAfterSettle: lp2, repair: fix.error }, e1.status === "success" && e2.status === "success" && lp1 > lp0 && lp2 === lp1);
      await chain.revert(s4);
    }

    await chain.revert(sGov);
    rec.scenario(`${NAME} global governance`, "setPaused / setGuardian / Ownable2Step x3");
    const guardian = await chain.read(H, RS, "guardian");
    rec.assert(`${NAME} guardian is the ops key`, guardian, opsKey);
    await S({ from: guardian, fn: "setPaused", args: [true], note: "guardian may pause" });
    await S({ from: guardian, fn: "setPaused", args: [false], role: "unauthorized", expect: "revert", expectError: "NotGuardianOrOwner", note: "guardian may never unpause" });
    const pausedPot0 = await pb(1, keys[1].currency1);
    await dlSwap(dave, keys[1], true, 10n ** 20n, "trade while the hook is paused: no cut");
    rec.assert(`${NAME} paused: no cut taken`, await pb(1, keys[1].currency1), pausedPot0);
    await S({ from: safe, fn: "setPaused", args: [false], note: "owner unpauses" });
    await S({ from: safe, fn: "setPaused", args: [true], note: "owner pauses" });
    await S({ from: safe, fn: "setPaused", args: [false], role: "setup" });
    await S({ from: mallory, fn: "setPaused", args: [true], role: "unauthorized", expect: "revert", expectError: "NotGuardianOrOwner" });
    for (const g of [carol, ZERO, opsKey]) await S({ from: safe, fn: "setGuardian", args: [g] });
    await S({ from: mallory, fn: "setGuardian", args: [mallory], role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    for (const nominee of [alice, bob, ADDR.timelockCustody]) {
      const s = await chain.snapshot();
      await S({ from: safe, fn: "transferOwnership", args: [nominee] });
      if (nominee === alice) await S({ from: mallory, fn: "acceptOwnership", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      await S({ from: nominee, fn: "acceptOwnership" });
      await chain.revert(s);
    }
    await S({ from: mallory, fn: "transferOwnership", args: [mallory], role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await chain.revert(hookRoot);
  }
}

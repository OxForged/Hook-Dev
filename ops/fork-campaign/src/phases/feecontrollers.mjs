// SPDX-License-Identifier: MIT
// LatchProtocolFeeControllerV2 0x9c2c (installed on both managers) and the two upstream
// ProtocolFeeController instances (deployed, owned by the Safe, NOT installed).
// MUST-TEST: collect and sweep.
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, clKey, binKey, poolId, Q96, BIN_ID_ONE, ZERO, swapInPlan, balanceOf, A, P, plan, maxUint256, DYNAMIC_FEE_FLAG } from "../lib.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, erin, mallory } = ACTORS;
  const { safe, opsKey, feeControllerV2: V2, clPoolManager: CLM, binPoolManager: BINM, universalRouter: UR, clProtocolFeeController: CPFC, binProtocolFeeController: BPFC } = ADDR;
  const F = ABI.LatchProtocolFeeControllerV2, U = ABI.ProtocolFeeController, CL = ABI.CLPoolManager, BIN = ABI.BinPoolManager, R = ABI.UniversalRouter;
  const dl = async () => (await chain.head()).timestamp + 3600n;
  const base = state.baseCL.key, bbase = state.baseBin.key;
  const trade = async (who, k, z, amt) => rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(k, z, amt)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "setup", note: "fee-generating trade" });
  const binTrade = async (who, z, amt) => rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [plan([[A.BIN_SWAP_EXACT_IN_SINGLE, P.binSwapExactInSingle(bbase, z, amt, 0n)], [A.SETTLE_ALL, P.currencyAmount(z ? bbase.currency0 : bbase.currency1, maxUint256)], [A.TAKE_ALL, P.currencyAmount(z ? bbase.currency1 : bbase.currency0, 0n)]])], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "setup", note: "fee-generating bin trade" });

  rec.scenario("MUST fee-controller collect-and-sweep", "V2 pricing stamped at initialize, fees accrue on real trades, collect (owner) and sweep (permissionless -> treasury)");
  const [, , pfBase] = await chain.read(CLM, CL, "getSlot0", [state.baseCL.id]);
  rec.assert("base CL pool (created on the fork after V2 install) protocolFee == 999|999<<12 for the 0.30% tier", pfBase, 999 | (999 << 12));
  rec.assert("V2 feeForLpFee(3000) == 999", await chain.read(V2, F, "feeForLpFee", [3000]), 999);
  for (let i = 0; i < 4; i++) await trade(dave, base, i % 2 === 0, 10n ** 22n);
  for (let i = 0; i < 2; i++) await binTrade(dave, i % 2 === 0, 10n ** 21n);
  const acc0 = await chain.read(CLM, CL, "protocolFeesAccrued", [base.currency0]);
  const acc1 = await chain.read(CLM, CL, "protocolFeesAccrued", [base.currency1]);
  rec.assert("CL protocolFeesAccrued > 0 on both currencies after 4 trades", acc0 > 0n && acc1 > 0n, true);
  rec.assert("V2.accrued() mirrors the manager", await chain.read(V2, F, "accrued", [CLM, base.currency0]), acc0);
  const collectRows = [];
  for (const [cur, amt, to] of [[base.currency0, acc0 / 3n, carol], [base.currency0, 0n, erin], [base.currency1, acc1 / 2n, safe]]) {
    const b0 = await balanceOf(chain, cur, to);
    const exp = amt === 0n ? await chain.read(CLM, CL, "protocolFeesAccrued", [cur]) : amt;
    const r = await rec.send({ from: safe, to: V2, abi: F, fn: "collect", args: [CLM, cur, amt, to], contract: "LatchProtocolFeeControllerV2", note: amt === 0n ? "amount 0 = everything accrued" : "partial" });
    rec.assert(`collect -> ${to} received ${exp}`, (await balanceOf(chain, cur, to)) - b0, exp);
    collectRows.push({ tx: r.txHash, currency: cur, amount: exp.toString(), to });
  }
  await rec.send({ from: mallory, to: V2, abi: F, fn: "collect", args: [CLM, base.currency1, 1n, mallory], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  await rec.send({ from: opsKey, to: V2, abi: F, fn: "collect", args: [CLM, base.currency1, 1n, opsKey], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "the guardian cannot collect" });
  await rec.send({ from: safe, to: V2, abi: F, fn: "collect", args: [CLM, base.currency1, 1n, ZERO], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "ZeroRecipient", note: "input validation" });
  // sweep x3 (permissionless, pays the stored treasury = Safe)
  await trade(dave, base, true, 10n ** 22n);
  const sweepRows = [];
  for (const [pm, cur, who] of [[CLM, base.currency0, mallory], [CLM, base.currency1, erin], [BINM, bbase.currency0, bob]]) {
    const pending = await chain.read(V2, F, "accrued", [pm, cur]);
    const b0 = await balanceOf(chain, cur, safe);
    const r = await rec.send({ from: who, to: V2, abi: F, fn: "sweep", args: [pm, cur], contract: "LatchProtocolFeeControllerV2", note: `permissionless sweep by ${who}` });
    rec.assert(`sweep ${pm === CLM ? "CL" : "Bin"} ${cur}: treasury (Safe) +${pending}, caller gets nothing`, (await balanceOf(chain, cur, safe)) - b0, pending);
    sweepRows.push({ tx: r.txHash, poolManager: pm, currency: cur, amount: pending.toString(), caller: who });
  }
  await rec.send({ from: mallory, to: V2, abi: F, fn: "sweep", args: [CLM, base.currency0], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "NothingToCollect", note: "nothing left" });
  rec.notExercised("LatchProtocolFeeControllerV2", "sweep", "permissionless by design (pays only the stored treasury); the negative case is NothingToCollect");
  rec.results.extra = { collect: collectRows, sweep: sweepRows };

  rec.scenario("V2 policy setters", "setPoolProtocolFee / syncPoolToPolicy / split / pool / tier / dynamic / disable / guardian / treasury / ownership");
  const ltt = await chain.read(CLM, CL, "poolIdToPoolKey", [ADDR.demoPoolId]);
  const lttKey = { currency0: ltt[0], currency1: ltt[1], hooks: ltt[2], poolManager: ltt[3], fee: ltt[4], parameters: ltt[5] };
  const newCl = clKey(state.tokens.TKC, state.tokens.TKF, { fee: 500, tickSpacing: 10 });
  await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [newCl, Q96], contract: "CLPoolManager", role: "setup" });
  for (const [pm, k, fee] of [[CLM, base, 100 | (200 << 12)], [CLM, newCl, 4000], [BINM, bbase, 0]]) {
    await rec.send({ from: safe, to: V2, abi: F, fn: "setPoolProtocolFee", args: [pm, k, fee], contract: "LatchProtocolFeeControllerV2" });
    rec.assert(`setPoolProtocolFee -> slot0.protocolFee == ${fee}`, (await chain.read(pm, pm === CLM ? CL : BIN, "getSlot0", [poolId(k)]))[pm === CLM ? 2 : 1], fee);
  }
  await rec.send({ from: safe, to: V2, abi: F, fn: "setPoolProtocolFee", args: [CLM, base, 4001], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "ProtocolFeeTooLarge", note: "0.4% cap in core" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setPoolProtocolFee", args: [CLM, base, 1], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  rec.assert("LTT1/LTT2 protocolFee is 0 before syncPoolToPolicy (stamped at initialize, before V2)", (await chain.read(CLM, CL, "getSlot0", [ADDR.demoPoolId]))[2], 0);
  for (const [pm, k] of [[CLM, lttKey], [CLM, base], [BINM, bbase]]) await rec.send({ from: safe, to: V2, abi: F, fn: "syncPoolToPolicy", args: [pm, k], contract: "LatchProtocolFeeControllerV2" });
  rec.assert("LTT1/LTT2 protocolFee == 999|999<<12 after syncPoolToPolicy", (await chain.read(CLM, CL, "getSlot0", [ADDR.demoPoolId]))[2], 999 | (999 << 12));
  await rec.send({ from: mallory, to: V2, abi: F, fn: "syncPoolToPolicy", args: [CLM, lttKey], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const r of [0n, 333_333n, 1_000_000n]) {
    await rec.send({ from: safe, to: V2, abi: F, fn: "setProtocolFeeSplitRatio", args: [r], contract: "LatchProtocolFeeControllerV2" });
    rec.assert(`split ${r}: feeForLpFee(3000)`, await chain.read(V2, F, "feeForLpFee", [3000]), r === 0n ? 0 : r === 1_000_000n ? 4000 : Number(await chain.read(V2, F, "feeForLpFee", [3000])));
  }
  await rec.send({ from: safe, to: V2, abi: F, fn: "setProtocolFeeSplitRatio", args: [1_000_001n], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "InvalidSplitRatio" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setProtocolFeeSplitRatio", args: [1n], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const [id, set, a, b] of [[state.baseCL.id, true, 10, 20], [poolId(newCl), true, 4000, 0], [state.baseCL.id, false, 0, 0]]) await rec.send({ from: safe, to: V2, abi: F, fn: "setPoolFee", args: [id, set, a, b], contract: "LatchProtocolFeeControllerV2" });
  await rec.send({ from: safe, to: V2, abi: F, fn: "setPoolFee", args: [state.baseCL.id, true, 4001, 0], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "FeeExceedsMaximum" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setPoolFee", args: [state.baseCL.id, true, 1, 1], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const [tier, set, a, b] of [[500, true, 100, 100], [10000, true, 4000, 4000], [500, false, 0, 0]]) await rec.send({ from: safe, to: V2, abi: F, fn: "setTierFee", args: [tier, set, a, b], contract: "LatchProtocolFeeControllerV2" });
  rec.assert("protocolFeeForPool(0.05% pool) after tier unset follows the split", await chain.read(V2, F, "protocolFeeForPool", [newCl]) >= 0, true);
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setTierFee", args: [500, true, 1, 1], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const [set, a, b] of [[true, 0, 0], [false, 0, 0], [true, 999, 999]]) await rec.send({ from: safe, to: V2, abi: F, fn: "setDynamicFee", args: [set, a, b], contract: "LatchProtocolFeeControllerV2" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setDynamicFee", args: [true, 1, 1], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const d of [true, false, true]) await rec.send({ from: safe, to: V2, abi: F, fn: "setFeesDisabled", args: [d], contract: "LatchProtocolFeeControllerV2" });
  const disabledPool = clKey(state.tokens.TKD, state.tokens.TKF, { fee: 3000, tickSpacing: 60 });
  await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [disabledPool, Q96], contract: "CLPoolManager", role: "setup" });
  rec.assert("a pool initialized while feesDisabled is stamped protocolFee 0", (await chain.read(CLM, CL, "getSlot0", [poolId(disabledPool)]))[2], 0);
  await rec.send({ from: safe, to: V2, abi: F, fn: "setFeesDisabled", args: [false], contract: "LatchProtocolFeeControllerV2", role: "setup" });
  await rec.send({ from: opsKey, to: V2, abi: F, fn: "setFeesDisabled", args: [false], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount", note: "guardian cannot re-enable" });
  for (const who of [opsKey, safe, opsKey]) {
    await rec.send({ from: who, to: V2, abi: F, fn: "emergencyDisableFees", contract: "LatchProtocolFeeControllerV2", note: who === opsKey ? "guardian (disable-only)" : "owner" });
    rec.assert("feesDisabled == true", await chain.read(V2, F, "feesDisabled"), true);
    await rec.send({ from: safe, to: V2, abi: F, fn: "setFeesDisabled", args: [false], contract: "LatchProtocolFeeControllerV2", role: "setup" });
  }
  await rec.send({ from: mallory, to: V2, abi: F, fn: "emergencyDisableFees", contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "NotGuardianOrOwner" });
  for (const g of [carol, ZERO, opsKey]) await rec.send({ from: safe, to: V2, abi: F, fn: "setGuardian", args: [g], contract: "LatchProtocolFeeControllerV2" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setGuardian", args: [mallory], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const t of [carol, dave, safe]) await rec.send({ from: safe, to: V2, abi: F, fn: "setTreasury", args: [t], contract: "LatchProtocolFeeControllerV2" });
  await rec.send({ from: safe, to: V2, abi: F, fn: "setTreasury", args: [ZERO], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "ZeroRecipient" });
  await rec.send({ from: mallory, to: V2, abi: F, fn: "setTreasury", args: [mallory], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  for (const nominee of [alice, bob, ADDR.timelockCustody]) {
    const s = await chain.snapshot();
    await rec.send({ from: safe, to: V2, abi: F, fn: "transferOwnership", args: [nominee], contract: "LatchProtocolFeeControllerV2" });
    if (nominee === alice) await rec.send({ from: mallory, to: V2, abi: F, fn: "acceptOwnership", contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: nominee, to: V2, abi: F, fn: "acceptOwnership", contract: "LatchProtocolFeeControllerV2" });
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: V2, abi: F, fn: "transferOwnership", args: [mallory], contract: "LatchProtocolFeeControllerV2", role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });

  for (const [PFC, NAME, pm, pmAbi, wrapper, k, otherK] of [[CPFC, "CLProtocolFeeController", CLM, CL, ADDR.clPoolManagerOwner, base, bbase], [BPFC, "BinProtocolFeeController", BINM, BIN, ADDR.binPoolManagerOwner, bbase, base]]) {
    rec.scenario(`upstream ${NAME}`, "Owner setters x3; setProtocolFee/collectProtocolFee x3 after the Safe installs it on its manager (fork snapshot)");
    for (const r of [0n, 500_000n, 1_000_000n]) await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFeeSplitRatio", args: [r], contract: NAME });
    await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFeeSplitRatio", args: [1_000_001n], contract: NAME, role: "unauthorized", expect: "revert", expectError: "InvalidProtocolFeeSplitRatio" });
    await rec.send({ from: mallory, to: PFC, abi: U, fn: "setProtocolFeeSplitRatio", args: [1n], contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    for (const v of [0, 4000, 300]) await rec.send({ from: safe, to: PFC, abi: U, fn: "setDefaultProtocolFeeForDynamicFeePool", args: [v], contract: NAME });
    await rec.send({ from: safe, to: PFC, abi: U, fn: "setDefaultProtocolFeeForDynamicFeePool", args: [4001], contract: NAME, role: "unauthorized", expect: "revert", expectError: "InvalidDefaultProtocolFeeForDynamicFeePool" });
    await rec.send({ from: mallory, to: PFC, abi: U, fn: "setDefaultProtocolFeeForDynamicFeePool", args: [1], contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFee", args: [k, 100], contract: NAME, role: "unauthorized", expect: "revert", expectError: "InvalidCaller", note: "not installed on the manager: the manager refuses it" });
    const s = await chain.snapshot();
    await rec.send({ from: safe, to: wrapper, abi: ABI[NAME === "CLProtocolFeeController" ? "CLPoolManagerOwner" : "BinPoolManagerOwner"], fn: "setProtocolFeeController", args: [PFC], contract: NAME === "CLProtocolFeeController" ? "CLPoolManagerOwner" : "BinPoolManagerOwner", role: "setup", note: "fork only: install the upstream controller" });
    for (const fee of [4000 | (4000 << 12), 1234, 0]) await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFee", args: [k, fee], contract: NAME });
    await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFee", args: [otherK, 1], contract: NAME, role: "unauthorized", expect: "revert", expectError: "InvalidPoolManager" });
    await rec.send({ from: mallory, to: PFC, abi: U, fn: "setProtocolFee", args: [k, 1], contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await rec.send({ from: safe, to: PFC, abi: U, fn: "setProtocolFee", args: [k, 4000 | (4000 << 12)], contract: NAME, role: "setup" });
    if (pm === CLM) for (let i = 0; i < 2; i++) await trade(dave, k, i === 0, 10n ** 22n);
    else for (let i = 0; i < 2; i++) await binTrade(dave, i === 0, 10n ** 21n);
    for (const [cur, to] of [[k.currency0, carol], [k.currency1, dave], [k.currency0, erin]]) {
      const acc = await chain.read(pm, pmAbi, "protocolFeesAccrued", [cur]);
      const b0 = await balanceOf(chain, cur, to);
      await rec.send({ from: safe, to: PFC, abi: U, fn: "collectProtocolFee", args: [to, cur, 0n], contract: NAME, note: `accrued ${acc}; caller check runs at collection time` });
      rec.assert(`${NAME} collectProtocolFee -> ${to} +${acc}`, (await balanceOf(chain, cur, to)) - b0, acc);
    }
    await rec.send({ from: mallory, to: PFC, abi: U, fn: "collectProtocolFee", args: [mallory, k.currency0, 0n], contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
    await chain.revert(s);
    for (const nominee of [alice, bob, ADDR.timelockPolicy]) {
      const s2 = await chain.snapshot();
      await rec.send({ from: safe, to: PFC, abi: U, fn: "transferOwnership", args: [nominee], contract: NAME });
      if (nominee === alice) await rec.send({ from: mallory, to: PFC, abi: U, fn: "acceptOwnership", contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
      await rec.send({ from: nominee, to: PFC, abi: U, fn: "acceptOwnership", contract: NAME });
      await chain.revert(s2);
    }
    await rec.send({ from: mallory, to: PFC, abi: U, fn: "transferOwnership", args: [mallory], contract: NAME, role: "unauthorized", expect: "revert", expectError: "OwnableUnauthorizedAccount" });
  }
}

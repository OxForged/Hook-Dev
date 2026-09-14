// SPDX-License-Identifier: MIT
// CLPoolManager / BinPoolManager, and their CLPoolManagerOwner / BinPoolManagerOwner wrappers.
import { encodeFunctionData } from "viem";
import { artifact } from "../abis.mjs";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, actorCall, clKey, binKey, poolId, Q96, BIN_ID_ONE, DYNAMIC_FEE_FLAG, ZERO, ZERO32 } from "../lib.mjs";

const MIN_SQRT = 4295128740n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, mallory } = ACTORS;
  const { safe, clPoolManager: CLM, binPoolManager: BINM, clPoolManagerOwner: CLO, binPoolManagerOwner: BINO } = ADDR;
  const CL = ABI.CLPoolManager, BIN = ABI.BinPoolManager, ACT = ABI["helpers/VaultActor"], TK = ABI["helpers/CampaignToken"];
  const { TKA, TKB, TKC, TKD, TKE } = state.tokens;
  const actor = state.actor;
  for (const t of [TKA, TKB, TKC, TKD, TKE]) await rec.send({ from: alice, to: t, abi: TK, fn: "mint", args: [actor, 10n ** 28n], role: "setup", contract: "CampaignToken" });
  await chain.fund(actor, 10n ** 21n);
  const settleAll = (curs) => actorCall(actor, ACT, "settleAll", [curs]);
  const runLock = (label, contract, calls, o = {}) => rec.send({ from: o.from ?? alice, to: actor, abi: ACT, fn: "run", args: [calls], contract, sig: label, note: o.note, expect: o.expect, expectError: o.expectError, role: o.role });

  /* ------------------------------ CL ------------------------------ */
  rec.scenario("cl-manager", "initialize / modifyLiquidity / swap / donate x3 via VaultActor; owner-, controller- and hook-gated functions by impersonating the gate");
  const clKeys = [
    clKey(TKC, TKD, { fee: 500, tickSpacing: 10 }),
    clKey(TKC, TKD, { fee: 10000, tickSpacing: 200 }),
    clKey(TKA, TKC, { fee: 3000, tickSpacing: 60 }),
  ];
  const prices = [Q96, (Q96 * 3n) / 2n, (Q96 * 2n) / 3n];
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, carol][i], to: CLM, abi: CL, fn: "initialize", args: [clKeys[i], prices[i]], contract: "CLPoolManager" });
  for (let i = 0; i < 3; i++) rec.assert(`CL pool ${i + 1} initialized at the requested price`, (await chain.read(CLM, CL, "getSlot0", [poolId(clKeys[i])]))[0], prices[i]);
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "initialize", args: [clKeys[0], Q96], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "PoolAlreadyInitialized", note: "permissionless function: the guard tested is double-initialization" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "initialize", args: [{ ...clKeys[0], fee: DYNAMIC_FEE_FLAG }, Q96], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "HookConfigValidationError", note: "dynamic fee without a hook" });

  const ranges = [[-600, 600], [-12000, 12000], [-12000, 2400]]; // each range contains its pool's initial tick
  const liqs = [10n ** 21n, 10n ** 22n, 5n * 10n ** 20n];
  for (let i = 0; i < 3; i++) {
    const k = clKeys[i];
    await runLock("modifyLiquidity", "CLPoolManager", [
      actorCall(CLM, CL, "modifyLiquidity", [k, { tickLower: ranges[i][0], tickUpper: ranges[i][1], liquidityDelta: liqs[i], salt: ZERO32 }, "0x"]),
      settleAll([k.currency0, k.currency1]),
    ], { note: `add ${liqs[i]} liquidity [${ranges[i]}]` });
    rec.assert(`CL pool ${i + 1} liquidity == ${liqs[i]}`, await chain.read(CLM, CL, "getLiquidity", [poolId(k)]), liqs[i]);
  }
  const swaps = [[true, -(10n ** 18n)], [false, -(10n ** 17n)], [true, 10n ** 16n]];
  for (let i = 0; i < 3; i++) {
    const k = clKeys[i];
    const [z, amt] = swaps[i];
    const s0 = (await chain.read(CLM, CL, "getSlot0", [poolId(k)]))[0];
    await runLock("swap", "CLPoolManager", [actorCall(CLM, CL, "swap", [k, { zeroForOne: z, amountSpecified: amt, sqrtPriceLimitX96: z ? MIN_SQRT : MAX_SQRT }, "0x"]), settleAll([k.currency0, k.currency1])], { note: `${z ? "0->1" : "1->0"} ${amt < 0n ? "exact in" : "exact out"} ${amt}` });
    const s1 = (await chain.read(CLM, CL, "getSlot0", [poolId(k)]))[0];
    rec.assert(`CL swap ${i + 1} moved price in the ${z ? "down" : "up"} direction`, z ? s1 < s0 : s1 > s0, true);
  }
  for (let i = 0; i < 3; i++) {
    const k = clKeys[i];
    const [f0] = await chain.read(CLM, CL, "getFeeGrowthGlobals", [poolId(k)]);
    await runLock("donate", "CLPoolManager", [actorCall(CLM, CL, "donate", [k, BigInt(i + 1) * 10n ** 18n, BigInt(i) * 10n ** 17n, "0x"]), settleAll([k.currency0, k.currency1])]);
    rec.assert(`CL donate ${i + 1} raised feeGrowthGlobal0`, (await chain.read(CLM, CL, "getFeeGrowthGlobals", [poolId(k)]))[0] > f0, true);
  }
  await runLock("swap", "CLPoolManager", [actorCall(CLM, CL, "swap", [clKeys[0], { zeroForOne: true, amountSpecified: 0n, sqrtPriceLimitX96: MIN_SQRT }, "0x"])], { role: "unauthorized", expect: "revert", expectError: "SwapAmountCannotBeZero", note: "invalid input" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "swap", args: [clKeys[0], { zeroForOne: true, amountSpecified: -1n, sqrtPriceLimitX96: MIN_SQRT }, "0x"], contract: "CLPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "modifyLiquidity", args: [clKeys[0], { tickLower: -600, tickUpper: 600, liquidityDelta: 1n, salt: ZERO32 }, "0x"], contract: "CLPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "donate", args: [clKeys[0], 1n, 1n, "0x"], contract: "CLPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });

  // setProtocolFee x3 by the INSTALLED controller (impersonated) and collectProtocolFees x3
  const V2 = ADDR.feeControllerV2;
  for (let i = 0; i < 3; i++) {
    const fee = [1000 | (2000 << 12), 0, 4000 | (4000 << 12)][i];
    await rec.send({ from: V2, to: CLM, abi: CL, fn: "setProtocolFee", args: [clKeys[i], fee], contract: "CLPoolManager", note: "caller is the installed protocolFeeController (impersonated contract)" });
    rec.assert(`CL pool ${i + 1} protocolFee == ${fee}`, (await chain.read(CLM, CL, "getSlot0", [poolId(clKeys[i])]))[2], fee);
  }
  await rec.send({ from: V2, to: CLM, abi: CL, fn: "setProtocolFee", args: [clKeys[0], 4001], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "ProtocolFeeTooLarge", note: "cap 0.4% enforced even for the controller" });
  await rec.send({ from: safe, to: CLM, abi: CL, fn: "setProtocolFee", args: [clKeys[0], 1], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "InvalidCaller" });
  // generate fees on pool 3 (4000/4000) then collect
  for (let i = 0; i < 3; i++) await runLock("swap", "CLPoolManager", [actorCall(CLM, CL, "swap", [clKeys[2], { zeroForOne: i % 2 === 0, amountSpecified: -(10n ** 19n), sqrtPriceLimitX96: i % 2 === 0 ? MIN_SQRT : MAX_SQRT }, "0x"]), settleAll([clKeys[2].currency0, clKeys[2].currency1])], { note: "fee-generating swap on a 0.4%/0.4% protocol-fee pool" });
  const acc = await chain.read(CLM, CL, "protocolFeesAccrued", [clKeys[2].currency0]);
  rec.assert("protocolFeesAccrued(currency0) > 0 after swaps", acc > 0n, true);
  for (let i = 0; i < 3; i++) await rec.send({ from: V2, to: CLM, abi: CL, fn: "collectProtocolFees", args: [[alice, bob, carol][i], clKeys[2].currency0, i === 2 ? 0n : acc / 4n], contract: "CLPoolManager", note: i === 2 ? "amount 0 = collect all" : "partial" });
  rec.assert("protocolFeesAccrued(currency0) == 0 after collecting all", await chain.read(CLM, CL, "protocolFeesAccrued", [clKeys[2].currency0]), 0n);
  await rec.send({ from: safe, to: CLM, abi: CL, fn: "collectProtocolFees", args: [safe, clKeys[2].currency1, 0n], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "InvalidCaller" });

  // updateDynamicLPFee x3 by the pool's hook (a bitmap-0 hook contract, impersonated)
  const bh = artifact("helpers/BitmapHook");
  const hook = await rec.deploy({ from: alice, abi: bh.abi, bytecode: bh.bytecode, args: [0], contract: "BitmapHook" });
  const dynKey = clKey(TKD, TKE, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: hook, bitmap: 0 });
  await rec.send({ from: alice, to: CLM, abi: CL, fn: "initialize", args: [dynKey, Q96], contract: "CLPoolManager", role: "setup", note: "dynamic-fee pool with a no-callback hook" });
  for (const f of [100, 3000, 250000]) {
    await rec.send({ from: hook, to: CLM, abi: CL, fn: "updateDynamicLPFee", args: [dynKey, f], contract: "CLPoolManager", note: "msg.sender == key.hooks" });
    rec.assert(`dynamic lpFee == ${f}`, (await chain.read(CLM, CL, "getSlot0", [poolId(dynKey)]))[3], f);
  }
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "updateDynamicLPFee", args: [dynKey, 1], contract: "CLPoolManager", role: "unauthorized", expect: "revert", expectError: "UnauthorizedDynamicLPFeeUpdate" });
  await rec.send({ from: hook, to: CLM, abi: CL, fn: "updateDynamicLPFee", args: [dynKey, 1_000_001], contract: "CLPoolManager", role: "unauthorized", expect: "revert", note: "fee above 100%" });

  // pause / unpause / transferOwnership on the manager by its owner (the wrapper, impersonated)
  for (let i = 0; i < 3; i++) {
    await rec.send({ from: CLO, to: CLM, abi: CL, fn: "pause", contract: "CLPoolManager", note: "caller is the owner wrapper (impersonated)" });
    if (i === 0) {
      await runLock("swap", "CLPoolManager", [actorCall(CLM, CL, "swap", [clKeys[0], { zeroForOne: true, amountSpecified: -1000n, sqrtPriceLimitX96: MIN_SQRT }, "0x"]), settleAll([clKeys[0].currency0, clKeys[0].currency1])], { role: "unauthorized", expect: "revert", expectError: "EnforcedPause", note: "swap while paused" });
      await runLock("donate", "CLPoolManager", [actorCall(CLM, CL, "donate", [clKeys[0], 1n, 0n, "0x"]), settleAll([clKeys[0].currency0, clKeys[0].currency1])], { role: "unauthorized", expect: "revert", expectError: "EnforcedPause", note: "donate while paused" });
      await runLock("modifyLiquidity", "CLPoolManager", [actorCall(CLM, CL, "modifyLiquidity", [clKeys[0], { tickLower: -600, tickUpper: 600, liquidityDelta: -(10n ** 20n), salt: ZERO32 }, "0x"]), settleAll([clKeys[0].currency0, clKeys[0].currency1])], { note: "LPs CAN withdraw while paused (modifyLiquidity is not pause-gated)" });
    }
    await rec.send({ from: CLO, to: CLM, abi: CL, fn: "unpause", contract: "CLPoolManager" });
  }
  await rec.send({ from: safe, to: CLM, abi: CL, fn: "pause", contract: "CLPoolManager", role: "unauthorized", expect: "revert", note: "the Safe owns the wrapper, not the manager" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "unpause", contract: "CLPoolManager", role: "unauthorized", expect: "revert" });
  for (const nominee of [alice, bob, CLO]) {
    const s = await chain.snapshot();
    await rec.send({ from: CLO, to: CLM, abi: CL, fn: "transferOwnership", args: [nominee], contract: "CLPoolManager", note: "single-step transfer on the manager itself" });
    rec.assert(`CLPoolManager.owner == ${nominee}`, await chain.read(CLM, CL, "owner"), nominee);
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "transferOwnership", args: [mallory], contract: "CLPoolManager", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "setProtocolFeeController", args: [mallory], contract: "CLPoolManager", role: "unauthorized", expect: "revert" });

  /* ------------------------------ Bin ------------------------------ */
  rec.scenario("bin-manager", "initialize / mint / burn / swap / donate x3 via VaultActor; gated functions by impersonating the gate");
  const binKeys = [binKey(TKC, TKD, { fee: 500, binStep: 1 }), binKey(TKC, TKD, { fee: 3000, binStep: 25 }), binKey(TKA, TKE, { fee: 10000, binStep: 100 })];
  const actives = [BIN_ID_ONE, BIN_ID_ONE + 10, BIN_ID_ONE - 5];
  for (let i = 0; i < 3; i++) await rec.send({ from: [alice, bob, carol][i], to: BINM, abi: BIN, fn: "initialize", args: [binKeys[i], actives[i]], contract: "BinPoolManager" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "initialize", args: [binKey(TKB, TKE, { binStep: 101 }), BIN_ID_ONE], contract: "BinPoolManager", role: "unauthorized", expect: "revert", expectError: "BinStepTooLarge", note: "permissionless; guard is maxBinStep" });
  const cfg = (distX, distY, id) => `0x${((BigInt(distX) << 88n) | (BigInt(distY) << 24n) | BigInt(id)).toString(16).padStart(64, "0")}`;
  const amtIn = (a0, a1) => `0x${((BigInt.asUintN(128, a1) << 128n) | BigInt.asUintN(128, a0)).toString(16).padStart(64, "0")}`;
  const E18 = 10n ** 18n;
  const salts = [ZERO32, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`];
  for (let i = 0; i < 3; i++) {
    const k = binKeys[i], a = actives[i];
    const configs = [cfg(0, E18 / 2n, a - 1), cfg(E18 / 2n, E18 / 2n, a), cfg(E18 / 2n, 0, a + 1)];
    await runLock("mint", "BinPoolManager", [actorCall(BINM, BIN, "mint", [k, { liquidityConfigs: configs, amountIn: amtIn(10n ** 22n, 10n ** 22n), salt: salts[i] }, "0x"]), settleAll([k.currency0, k.currency1])], { note: `3 bins around ${a}, salt ${i}` });
    rec.assert(`Bin pool ${i + 1} active bin has reserves`, (await chain.read(BINM, BIN, "getBin", [poolId(k), a]))[0] > 0n, true);
  }
  const bswaps = [[true, -(10n ** 18n)], [false, -(10n ** 18n)], [true, 10n ** 17n]];
  for (let i = 0; i < 3; i++) {
    const k = binKeys[i];
    await runLock("swap", "BinPoolManager", [actorCall(BINM, BIN, "swap", [k, bswaps[i][0], bswaps[i][1], "0x"]), settleAll([k.currency0, k.currency1])], { note: `swapForY=${bswaps[i][0]} amount ${bswaps[i][1]}` });
  }
  for (let i = 0; i < 3; i++) {
    const k = binKeys[i];
    await runLock("donate", "BinPoolManager", [actorCall(BINM, BIN, "donate", [k, BigInt(i + 1) * 10n ** 17n, 10n ** 17n, "0x"]), settleAll([k.currency0, k.currency1])]);
  }
  for (let i = 0; i < 3; i++) {
    const k = binKeys[i], a = actives[i];
    const shares = (await chain.read(BINM, BIN, "getPosition", [poolId(k), actor, a + 1, salts[i]])).share;
    const burnAmt = shares / BigInt(i + 2);
    await runLock("burn", "BinPoolManager", [actorCall(BINM, BIN, "burn", [k, { ids: [BigInt(a + 1)], amountsToBurn: [burnAmt], salt: salts[i] }, "0x"]), settleAll([k.currency0, k.currency1])], { note: `burn 1/${i + 2} of bin ${a + 1} shares` });
    rec.assert(`Bin burn ${i + 1} reduced shares`, (await chain.read(BINM, BIN, "getPosition", [poolId(k), actor, a + 1, salts[i]])).share, shares - burnAmt);
  }
  await runLock("burn", "BinPoolManager", [actorCall(BINM, BIN, "burn", [binKeys[0], { ids: [BigInt(actives[0])], amountsToBurn: [10n ** 70n], salt: salts[0] }, "0x"])], { role: "unauthorized", expect: "revert", note: "burning more shares than owned" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "swap", args: [binKeys[0], true, -1n, "0x"], contract: "BinPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "mint", args: [binKeys[0], { liquidityConfigs: [cfg(E18, E18, actives[0])], amountIn: amtIn(1n, 1n), salt: ZERO32 }, "0x"], contract: "BinPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "donate", args: [binKeys[0], 1n, 1n, "0x"], contract: "BinPoolManager", role: "unauthorized", expect: "revert", note: "outside a vault lock" });

  for (let i = 0; i < 3; i++) await rec.send({ from: V2, to: BINM, abi: BIN, fn: "setProtocolFee", args: [binKeys[i], [500 | (500 << 12), 4000, 0][i]], contract: "BinPoolManager", note: "installed controller (impersonated)" });
  await rec.send({ from: safe, to: BINM, abi: BIN, fn: "setProtocolFee", args: [binKeys[0], 1], contract: "BinPoolManager", role: "unauthorized", expect: "revert", expectError: "InvalidCaller" });
  for (let i = 0; i < 2; i++) await runLock("swap", "BinPoolManager", [actorCall(BINM, BIN, "swap", [binKeys[0], i === 0, -(10n ** 19n), "0x"]), settleAll([binKeys[0].currency0, binKeys[0].currency1])], { note: "fee-generating" });
  const bacc0 = await chain.read(BINM, BIN, "protocolFeesAccrued", [binKeys[0].currency0]);
  const bacc1 = await chain.read(BINM, BIN, "protocolFeesAccrued", [binKeys[0].currency1]);
  rec.assert("Bin protocolFeesAccrued > 0 on both currencies", bacc0 > 0n && bacc1 > 0n, true);
  await rec.send({ from: V2, to: BINM, abi: BIN, fn: "collectProtocolFees", args: [alice, binKeys[0].currency0, bacc0 / 2n], contract: "BinPoolManager" });
  await rec.send({ from: V2, to: BINM, abi: BIN, fn: "collectProtocolFees", args: [bob, binKeys[0].currency0, 0n], contract: "BinPoolManager" });
  await rec.send({ from: V2, to: BINM, abi: BIN, fn: "collectProtocolFees", args: [carol, binKeys[0].currency1, 0n], contract: "BinPoolManager" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "collectProtocolFees", args: [mallory, binKeys[0].currency1, 0n], contract: "BinPoolManager", role: "unauthorized", expect: "revert", expectError: "InvalidCaller" });

  const bdynKey = binKey(TKD, TKE, { fee: DYNAMIC_FEE_FLAG, binStep: 10, hooks: hook, bitmap: 0 });
  await rec.send({ from: alice, to: BINM, abi: BIN, fn: "initialize", args: [bdynKey, BIN_ID_ONE], contract: "BinPoolManager", role: "setup" });
  for (const f of [1, 5000, 100000]) await rec.send({ from: hook, to: BINM, abi: BIN, fn: "updateDynamicLPFee", args: [bdynKey, f], contract: "BinPoolManager", note: "msg.sender == key.hooks" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "updateDynamicLPFee", args: [bdynKey, 1], contract: "BinPoolManager", role: "unauthorized", expect: "revert", expectError: "UnauthorizedDynamicLPFeeUpdate" });

  for (let i = 0; i < 3; i++) {
    await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "pause", contract: "BinPoolManager", note: "owner wrapper (impersonated)" });
    if (i === 0) {
      await runLock("mint", "BinPoolManager", [actorCall(BINM, BIN, "mint", [binKeys[0], { liquidityConfigs: [cfg(E18, E18, actives[0])], amountIn: amtIn(10n ** 18n, 10n ** 18n), salt: ZERO32 }, "0x"]), settleAll([binKeys[0].currency0, binKeys[0].currency1])], { role: "unauthorized", expect: "revert", expectError: "EnforcedPause", note: "mint while paused" });
      const sh = (await chain.read(BINM, BIN, "getPosition", [poolId(binKeys[0]), actor, actives[0], ZERO32])).share;
      await runLock("burn", "BinPoolManager", [actorCall(BINM, BIN, "burn", [binKeys[0], { ids: [BigInt(actives[0])], amountsToBurn: [sh / 10n], salt: ZERO32 }, "0x"]), settleAll([binKeys[0].currency0, binKeys[0].currency1])], { note: "LPs CAN burn while paused" });
    }
    await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "unpause", contract: "BinPoolManager" });
  }
  for (const v of [50, 250, 100]) await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "setMaxBinStep", args: [v], contract: "BinPoolManager" });
  await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "setMaxBinStep", args: [1], contract: "BinPoolManager", role: "unauthorized", expect: "revert", expectError: "MaxBinStepTooSmall", note: "input validation" });
  for (const v of [1n, 10n ** 6n, 2n ** 128n]) await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "setMinBinSharesForDonate", args: [v], contract: "BinPoolManager", note: v === 1n ? "the manager itself accepts 1; only the wrapper enforces >= 1e3" : undefined });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "setMaxBinStep", args: [50], contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "setMinBinSharesForDonate", args: [1n], contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "pause", contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "unpause", contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  for (const nominee of [alice, bob, BINO]) {
    const s = await chain.snapshot();
    await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "transferOwnership", args: [nominee], contract: "BinPoolManager" });
    await chain.revert(s);
  }
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "transferOwnership", args: [mallory], contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  await rec.send({ from: mallory, to: BINM, abi: BIN, fn: "setProtocolFeeController", args: [mallory], contract: "BinPoolManager", role: "unauthorized", expect: "revert" });
  for (const ctl of [ADDR.binProtocolFeeController, ZERO, V2]) await rec.send({ from: BINO, to: BINM, abi: BIN, fn: "setProtocolFeeController", args: [ctl], contract: "BinPoolManager" });
  for (const ctl of [ADDR.clProtocolFeeController, ZERO, V2]) await rec.send({ from: CLO, to: CLM, abi: CL, fn: "setProtocolFeeController", args: [ctl], contract: "CLPoolManager" });

  /* ---------------------------- wrappers ---------------------------- */
  for (const [W, WN, M, MABI] of [[CLO, "CLPoolManagerOwner", CLM, CL], [BINO, "BinPoolManagerOwner", BINM, BIN]]) {
    rec.scenario(`${WN}-wrapper`, "Current owner is the Safe (pre-handover). Every onlyOwner / pausable-role / two-step function x3");
    const WA = ABI[WN];
    for (const a of [alice, bob, carol]) await rec.send({ from: safe, to: W, abi: WA, fn: "grantPausableRole", args: [a], contract: WN });
    await rec.send({ from: mallory, to: W, abi: WA, fn: "grantPausableRole", args: [mallory], contract: WN, role: "unauthorized", expect: "revert" });
    for (const p of [safe, alice, bob]) {
      await rec.send({ from: p, to: W, abi: WA, fn: "pausePoolManager", contract: WN, note: p === safe ? "owner" : "pausable-role holder" });
      rec.assert(`${WN}: manager paused by ${p}`, await chain.read(M, MABI, "paused"), true);
      if (p === alice) await rec.send({ from: alice, to: W, abi: WA, fn: "unpausePoolManager", contract: WN, role: "unauthorized", expect: "revert", note: "a pausable-role holder can pause but never unpause" });
      await rec.send({ from: safe, to: W, abi: WA, fn: "unpausePoolManager", contract: WN });
      rec.assert(`${WN}: manager unpaused`, await chain.read(M, MABI, "paused"), false);
    }
    await rec.send({ from: mallory, to: W, abi: WA, fn: "pausePoolManager", contract: WN, role: "unauthorized", expect: "revert", expectError: "NoPausableRole" });
    for (const a of [alice, bob, carol]) await rec.send({ from: safe, to: W, abi: WA, fn: "revokePausableRole", args: [a], contract: WN });
    rec.assert(`${WN}: hasPausableRole(alice) false after revoke`, await chain.read(W, WA, "hasPausableRole", [alice]), false);
    await rec.send({ from: alice, to: W, abi: WA, fn: "pausePoolManager", contract: WN, role: "unauthorized", expect: "revert", expectError: "NoPausableRole", note: "revoked holder" });
    await rec.send({ from: mallory, to: W, abi: WA, fn: "revokePausableRole", args: [alice], contract: WN, role: "unauthorized", expect: "revert" });
    const pfc = WN === "CLPoolManagerOwner" ? ADDR.clProtocolFeeController : ADDR.binProtocolFeeController;
    for (const ctl of [pfc, ZERO, V2]) {
      await rec.send({ from: safe, to: W, abi: WA, fn: "setProtocolFeeController", args: [ctl], contract: WN });
      rec.assert(`${WN}: manager.protocolFeeController == ${ctl}`, await chain.read(M, MABI, "protocolFeeController"), ctl);
    }
    await rec.send({ from: mallory, to: W, abi: WA, fn: "setProtocolFeeController", args: [mallory], contract: WN, role: "unauthorized", expect: "revert" });
    await rec.send({ from: mallory, to: W, abi: WA, fn: "unpausePoolManager", contract: WN, role: "unauthorized", expect: "revert" });
    if (WN === "BinPoolManagerOwner") {
      for (const v of [60, 200, 100]) {
        await rec.send({ from: safe, to: W, abi: WA, fn: "setMaxBinStep", args: [v], contract: WN });
        rec.assert(`maxBinStep == ${v}`, await chain.read(M, MABI, "maxBinStep"), v);
      }
      for (const v of [1000n, 10n ** 9n, 2n ** 128n]) await rec.send({ from: safe, to: W, abi: WA, fn: "setMinBinSharesForDonate", args: [v], contract: WN });
      await rec.send({ from: safe, to: W, abi: WA, fn: "setMinBinSharesForDonate", args: [999n], contract: WN, role: "unauthorized", expect: "revert", expectError: "MinShareTooSmall", note: "input validation" });
      await rec.send({ from: mallory, to: W, abi: WA, fn: "setMaxBinStep", args: [60], contract: WN, role: "unauthorized", expect: "revert" });
      await rec.send({ from: mallory, to: W, abi: WA, fn: "setMinBinSharesForDonate", args: [1000n], contract: WN, role: "unauthorized", expect: "revert" });
    }
    for (const nominee of [alice, bob, ADDR.timelockCustody]) {
      const s = await chain.snapshot();
      await rec.send({ from: safe, to: W, abi: WA, fn: "transferOwnership", args: [nominee], contract: WN });
      if (nominee === alice) await rec.send({ from: mallory, to: W, abi: WA, fn: "acceptOwnership", contract: WN, role: "unauthorized", expect: "revert" });
      await rec.send({ from: nominee, to: W, abi: WA, fn: "acceptOwnership", contract: WN });
      rec.assert(`${WN}.owner == ${nominee}`, await chain.read(W, WA, "owner"), nominee);
      await chain.revert(s);
    }
    await rec.send({ from: mallory, to: W, abi: WA, fn: "transferOwnership", args: [mallory], contract: WN, role: "unauthorized", expect: "revert" });
    for (const nominee of [alice, bob, carol]) {
      const s = await chain.snapshot();
      await rec.send({ from: safe, to: W, abi: WA, fn: "transferPoolManagerOwnership", args: [nominee], contract: WN });
      if (nominee === alice) await rec.send({ from: mallory, to: W, abi: WA, fn: "acceptPoolManagerOwnership", contract: WN, role: "unauthorized", expect: "revert", expectError: "NotPendingPoolManagerOwner" });
      await rec.send({ from: nominee, to: W, abi: WA, fn: "acceptPoolManagerOwnership", contract: WN });
      rec.assert(`${WN}: manager.owner == ${nominee} after acceptPoolManagerOwnership`, await chain.read(M, MABI, "owner"), nominee);
      await chain.revert(s);
    }
    await rec.send({ from: mallory, to: W, abi: WA, fn: "transferPoolManagerOwnership", args: [mallory], contract: WN, role: "unauthorized", expect: "revert" });
  }
}

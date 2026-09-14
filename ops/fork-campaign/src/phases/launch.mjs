// SPDX-License-Identifier: MIT
// LaunchpadKit 0x2a4C + LaunchGuardHook 0x8b4F.
// MUST-TEST: a launch per preset, confirming the live decay spans the mis-sized window (~120x, §3b).
import { decodeEventLog } from "viem";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, clKey, poolId, Q96, ZERO, deployToken, hookCallbackCalls, swapInPlan, swapOutPlan, balanceOf, maxUint256, maxUint160, maxUint48, DYNAMIC_FEE_FLAG } from "../lib.mjs";
import { EXTERNAL_ABI } from "../abis.mjs";

const PRESET = { Custom: 0, FairLaunch: 1, AntiSniperAggressive: 2, Stealth: 3, NoTax: 4 };
const PRESET_PARAMS = {
  FairLaunch: { initial: 100_000, final: 3_000, windowSeconds: 300 },
  AntiSniperAggressive: { initial: 500_000, final: 10_000, windowSeconds: 1800 },
  Stealth: { initial: 500_000, final: 3_000, windowSeconds: 120 },
  NoTax: { initial: 3_000, final: 3_000, windowSeconds: 1 },
};
const REAL_SECONDS_PER_CONTRACT_BLOCK = 12.1; // SDK contractBlockTimeCentis 1200, measured 12.11

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, mallory } = ACTORS;
  const { launchpadKit: KIT, launchGuardHook: LGH, clPoolManager: CLM, universalRouter: UR, registry: REG } = ADDR;
  const K = ABI.LaunchpadKit, G = ABI.LaunchGuardHook, CL = ABI.CLPoolManager, R = ABI.UniversalRouter;
  const quote = state.tokens.TKA;
  const blockTimeCentis = await chain.read(KIT, K, "blockTimeCentis");
  const evmBlock = async () => (await chain.evmClock()).number;
  const dl = async () => (await chain.head()).timestamp + 3600n;
  const meta = (name) => ({ name, description: "fork campaign", sourceURI: "https://example.invalid/src", auditURI: "", chainIds: [4663n] });
  const params = (o) => ({
    launchToken: o.token, quoteToken: o.quote ?? quote, tickSpacing: o.tickSpacing ?? 60, sqrtPriceX96: Q96, preset: o.preset,
    initialFeeBips: o.initial ?? 0, finalFeeBips: o.final ?? 0, decayBlocks: o.decayBlocks ?? 0, enabled: o.enabled ?? true,
    startDelaySeconds: o.startDelaySeconds ?? 0, maxBuyPerTx: o.maxBuyPerTx ?? 0n, launchOperator: o.operator ?? ZERO,
    seed: { tickLower: -6000, tickUpper: 6000, launchTokenAmount: o.seedAmount ?? 10n ** 24n, quoteTokenAmount: o.seedAmount ?? 10n ** 24n, positionRecipient: ZERO, deadline: 0n },
    listing: { register: o.register ?? false, steward: o.steward ?? ZERO, metadata: meta(o.listName ?? "LaunchGuardHook") },
  });
  const launchToken = async (sym, owner = alice) => {
    const t = await deployToken(rec, owner, `Launch ${sym}`, sym, 18);
    await rec.send({ from: owner, to: t, abi: ABI["helpers/CampaignToken"], fn: "mint", args: [owner, 10n ** 27n], role: "setup", contract: "CampaignToken" });
    await rec.send({ from: owner, to: t, abi: ABI["helpers/CampaignToken"], fn: "approve", args: [KIT, maxUint256], role: "setup", contract: "CampaignToken" });
    for (const trader of [bob, carol, dave]) {
      await rec.send({ from: owner, to: t, abi: ABI["helpers/CampaignToken"], fn: "mint", args: [trader, 10n ** 24n], role: "setup", contract: "CampaignToken" });
      await rec.send({ from: trader, to: t, abi: ABI["helpers/CampaignToken"], fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "CampaignToken" });
      await rec.send({ from: trader, to: ADDR.permit2, abi: EXTERNAL_ABI, fn: "approve", args: [t, UR, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
    }
    return t;
  };
  const created = (r) => r.receipt.logs.map((l) => { try { return decodeEventLog({ abi: K, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "LaunchCreated");

  rec.scenario("MUST launchpad-presets", `One createLaunch per preset; decay measured in blocks; kit blockTimeCentis=${blockTimeCentis} vs real ~1210`);
  const launches = {};
  const decay = {};
  const presetOrder = ["FairLaunch", "AntiSniperAggressive", "Stealth", "NoTax"];
  for (const [i, name] of presetOrder.entries()) {
    const token = await launchToken(`L${i}`);
    const p = params({ token, preset: PRESET[name], maxBuyPerTx: name === "AntiSniperAggressive" ? 10n ** 21n : 0n, register: i === 0, steward: i === 0 ? ADDR.opsKey : ZERO });
    const r = await rec.send({ from: [alice, bob, carol, alice][i] === alice ? alice : alice, to: KIT, abi: K, fn: "createLaunch", args: [p], contract: "LaunchpadKit", note: `preset ${name}${i === 0 ? " + listing.register" : ""}` });
    const ev = created(r);
    const key = { ...clKey(token, quote, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: LGH, bitmap: 0x41 }) };
    const id = poolId(key);
    rec.assert(`${name}: LaunchCreated poolId matches the computed key`, ev.args.poolId, id);
    const pp = PRESET_PARAMS[name];
    const expectedBlocks = BigInt(Math.max(1, Math.ceil((pp.windowSeconds * 100) / Number(blockTimeCentis))));
    rec.assert(`${name}: decayBlocks == ceil(${pp.windowSeconds} s * 100 / ${blockTimeCentis})`, BigInt(ev.args.decayBlocks), expectedBlocks);
    const startBlock = BigInt(ev.args.startBlock);
    launches[name] = { token, key, id, startBlock, decayBlocks: BigInt(ev.args.decayBlocks), tx: r.txHash, gasUsed: r.gasUsed };
    rec.assert(`${name}: launchOwner is the kit`, await chain.read(LGH, G, "launchOwner", [id]), KIT);
    rec.assert(`${name}: getLaunchRecord.operator == alice`, (await chain.read(KIT, K, "getLaunchRecord", [id])).operator, alice);
    // measure THIS launch immediately, before the next launch mines any blocks
    {
    const L = launches[name];
    const pp = PRESET_PARAMS[name];
    const at = async () => chain.read(LGH, G, "currentFee", [L.id]);
    const f0 = await chain.read(LGH, G, "feeAt", [L.id, L.startBlock]);
    const fNow = await at();
    await chain.warp(pp.windowSeconds + 60);
    const fWarp = await at();
    const elapsedAfterWarp = (await evmBlock()) - L.startBlock;
    const half = L.decayBlocks / 2n > elapsedAfterWarp ? L.decayBlocks / 2n - elapsedAfterWarp : 0n;
    if (half > 0n) await chain.mine(half);
    const fHalf = await at();
    const rest = L.startBlock + L.decayBlocks - (await evmBlock());
    if (rest > 0n) await chain.mine(rest);
    const fEnd = await at();
    const intendedMin = pp.windowSeconds / 60;
    const realHours = (Number(L.decayBlocks) * REAL_SECONDS_PER_CONTRACT_BLOCK) / 3600;
    decay[name] = { decayBlocks: L.decayBlocks.toString(), intendedWindow: `${pp.windowSeconds} s`, realWindowAt12_1s: `${realHours.toFixed(2)} h`, ratio: ((Number(L.decayBlocks) * REAL_SECONDS_PER_CONTRACT_BLOCK) / pp.windowSeconds).toFixed(1), feeAtStart: f0, feeBeforeWarp: fNow, feeAfterWarpingIntendedWindow: fWarp, feeAtHalfDecayBlocks: fHalf, feeAtDecayEnd: fEnd };
    if (name !== "NoTax") {
      rec.assert(`${name}: feeAt(startBlock) == initial ${pp.initial}`, f0, pp.initial);
      rec.assert(`${name}: warping ${pp.windowSeconds + 60} s of TIMESTAMP leaves the fee essentially undecayed (block-denominated)`, fWarp >= fNow - Math.ceil((pp.initial - pp.final) / Number(L.decayBlocks)) * 2, true);
      rec.assert(`${name}: fee at half the decay blocks is between initial and final`, fHalf < pp.initial && fHalf > pp.final, true);
    }
    rec.assert(`${name}: fee after decayBlocks == final ${pp.final}`, fEnd, pp.final);
  }
  }
  rec.assert("listing.register listed LaunchGuardHook in LatchRegistry", await chain.read(REG, ABI.LatchRegistry, "isRegistered", [LGH]), true);
  rec.assert("listing steward is the ops key", (await chain.read(REG, ABI.LatchRegistry, "getLatch", [LGH])).steward, ADDR.opsKey);

  rec.hazard("§3b-launch-windows", "LaunchpadKit/LaunchGuardHook blockTimeCentis 10: every preset window lasts ~121x its intended duration on the real ~12.1 s contract clock", decay, Number(decay.FairLaunch.ratio) > 100);
  rec.results.extra = { launches: Object.fromEntries(Object.entries(launches).map(([k, v]) => [k, { poolId: v.id, token: v.token, startBlock: v.startBlock.toString(), decayBlocks: v.decayBlocks.toString(), tx: v.tx, gasUsed: v.gasUsed }])), decay };

  rec.scenario("launch trading guards", "maxBuyPerTx and exact-output buys during the AntiSniper window; trades on each preset pool");
  // fresh AntiSniper launch still inside its window
  const as = await launchToken("AS");
  const asr = await rec.send({ from: alice, to: KIT, abi: K, fn: "createLaunch", args: [params({ token: as, preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 10n ** 20n })], contract: "LaunchpadKit", note: "AntiSniper, maxBuyPerTx 100" });
  const asKey = clKey(as, quote, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: LGH, bitmap: 0x41 });
  const asTokenIs0 = BigInt(as) < BigInt(quote);
  const buyZ = !asTokenIs0; // buy = quote -> launch token
  for (const trader of [bob, carol]) {
    await rec.send({ from: trader, to: quote, abi: ABI["helpers/CampaignToken"], fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "CampaignToken" });
  }
  const f0 = await chain.read(LGH, G, "currentFee", [poolId(asKey)]);
  const b0 = await balanceOf(chain, as, bob);
  await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(asKey, buyZ, 5n * 10n ** 19n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", note: "buy 50 (< max 100) at the initial 50% fee - beforeSwap via the router" });
  rec.assert("AntiSniper buy under max succeeded and delivered launch tokens", (await balanceOf(chain, as, bob)) > b0, true);
  rec.assert("AntiSniper fee at the first trade ~50%", f0 >= 490000, true);
  await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(asKey, buyZ, 2n * 10n ** 20n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "BuyExceedsMaxPerTx", note: "buy 200 > max 100" });
  await rec.send({ from: carol, to: UR, abi: R, fn: "execute", args: ["0x10", [swapOutPlan(asKey, buyZ, 10n ** 18n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "ExactOutputBuyBlockedDuringLaunch" });
  await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(asKey, !buyZ, 10n ** 18n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", note: "a SELL of any size is not capped" });
  for (const name of ["FairLaunch", "Stealth", "NoTax"]) {
    const L = launches[name];
    const z = !(BigInt(L.token) < BigInt(quote));
    await rec.send({ from: carol, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(L.key, z, 10n ** 19n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", note: `buy on the ${name} pool after its decay (final fee)` });
  }

  rec.scenario("launch start delay + reconfigureLaunch", "startDelaySeconds, TradingNotOpen, operator-only reconfigure until startBlock");
  const recon = [];
  for (let i = 0; i < 3; i++) {
    const t = await launchToken(`D${i}`);
    const delaySec = [60, 300, 1800][i];
    const r = await rec.send({ from: alice, to: KIT, abi: K, fn: "createLaunch", args: [params({ token: t, preset: PRESET.Custom, initial: 200_000, final: 5_000, decayBlocks: 100, startDelaySeconds: delaySec, operator: [alice, bob, carol][i] })], contract: "LaunchpadKit", note: `Custom preset, start delay ${delaySec} s -> ${Math.ceil((delaySec * 100) / Number(blockTimeCentis))} blocks, operator ${[alice, bob, carol][i]}` });
    const ev = created(r);
    recon.push({ token: t, key: clKey(t, quote, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: LGH, bitmap: 0x41 }), startBlock: BigInt(ev.args.startBlock), operator: [alice, bob, carol][i] });
    rec.assert(`start delay ${delaySec} s -> startBlock = block + ${Math.ceil((delaySec * 100) / Number(blockTimeCentis))}`, BigInt(ev.args.startBlock), BigInt(r.block) + BigInt(Math.ceil((delaySec * 100) / Number(blockTimeCentis))));
  }
  const z0 = !(BigInt(recon[0].token) < BigInt(quote));
  await rec.send({ from: dave, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(recon[0].key, z0, 10n ** 18n)], await dl()], sig: "beforeSwap", contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "TradingNotOpen", note: "trade before startBlock" });
  for (let i = 0; i < 3; i++) {
    const cur = await evmBlock();
    const cfg = { startBlock: cur + 50n + BigInt(i) * 10n, decayBlocks: 200 + i, initialFeeBips: 300_000, finalFeeBips: 1_000, maxBuyPerTx: 0n, launchTokenIsCurrency0: true, enabled: i !== 2 };
    await rec.send({ from: recon[i].operator, to: KIT, abi: K, fn: "reconfigureLaunch", args: [recon[i].key, cfg], contract: "LaunchpadKit", note: "operator, before startBlock; kit pins launchTokenIsCurrency0" });
    const l = await chain.read(LGH, G, "getLaunch", [poolId(recon[i].key)]);
    rec.assert(`reconfigure ${i + 1}: decayBlocks ${200 + i}, launchTokenIsCurrency0 pinned to the record`, [l.decayBlocks, l.launchTokenIsCurrency0], [200 + i, BigInt(recon[i].token) < BigInt(quote)], (a, b) => a[0] === b[0] && a[1] === b[1]);
    recon[i].startBlock = cfg.startBlock;
  }
  await rec.send({ from: mallory, to: KIT, abi: K, fn: "reconfigureLaunch", args: [recon[0].key, { startBlock: (await evmBlock()) + 5n, decayBlocks: 1, initialFeeBips: 500_000, finalFeeBips: 100_000, maxBuyPerTx: 0n, launchTokenIsCurrency0: true, enabled: true }], contract: "LaunchpadKit", role: "unauthorized", expect: "revert", expectError: "NotLaunchOperator" });
  await chain.mine(recon[0].startBlock - (await evmBlock()) + 1n);
  await rec.send({ from: alice, to: KIT, abi: K, fn: "reconfigureLaunch", args: [recon[0].key, { startBlock: (await evmBlock()) + 100n, decayBlocks: 1, initialFeeBips: 500_000, finalFeeBips: 100_000, maxBuyPerTx: 0n, launchTokenIsCurrency0: true, enabled: true }], contract: "LaunchpadKit", role: "unauthorized", expect: "revert", expectError: "LaunchAlreadyStarted", note: "operator after startBlock: frozen" });
  await rec.send({ from: alice, to: KIT, abi: K, fn: "createLaunch", args: [params({ token: launches.FairLaunch.token, preset: PRESET.FairLaunch })], contract: "LaunchpadKit", role: "unauthorized", expect: "revert", expectError: "LaunchAlreadyExists" });
  const noMax = await launchToken("NM");
  await rec.send({ from: alice, to: KIT, abi: K, fn: "createLaunch", args: [params({ token: noMax, preset: PRESET.AntiSniperAggressive, maxBuyPerTx: 0n })], contract: "LaunchpadKit", role: "unauthorized", expect: "revert", expectError: "MaxBuyRequiredByPreset" });
  await rec.send({ from: alice, to: KIT, abi: K, fn: "createLaunch", args: [params({ token: noMax, preset: PRESET.Custom, initial: 10_000, final: 5_000, decayBlocks: 10, startDelaySeconds: 4_294_967_295 })], contract: "LaunchpadKit", role: "unauthorized", expect: "revert", expectError: "StartDelayTooLong", note: "start delay above MAX_START_DELAY (26,000,000 blocks)" });
  rec.notExercised("LaunchpadKit", "createLaunch", "permissionless by design (no unauthorized caller); negative cases are duplicate/invalid-input reverts");

  rec.scenario("LaunchpadKit.listHook", "listHook x3: the first registers, later calls return false");
  const listed = await chain.read(REG, ABI.LatchRegistry, "isRegistered", [LGH]);
  for (let i = 0; i < 3; i++) await rec.send({ from: [bob, carol, mallory][i], to: KIT, abi: K, fn: "listHook", args: [meta(`LGH ${i}`), [bob, carol, mallory][i]], contract: "LaunchpadKit", note: listed ? "already registered by the first launch: returns false, no state change" : "registers" });
  rec.assert("listHook did not change the steward set by the first listing", (await chain.read(REG, ABI.LatchRegistry, "getLatch", [LGH])).steward, ADDR.opsKey);
  rec.notExercised("LaunchpadKit", "listHook", "permissionless by design; once listed it is a no-op returning false (first-listing-wins is the runbook risk in CLAUDE.md)");

  rec.scenario("LaunchGuardHook direct", "configureLaunch x3 by EOAs on hook pools not created by the kit; callbacks");
  const direct = [];
  for (let i = 0; i < 3; i++) {
    const t = await launchToken(`G${i}`);
    const k = clKey(t, quote, { fee: DYNAMIC_FEE_FLAG, tickSpacing: [60, 10, 200][i], hooks: LGH, bitmap: 0x41 });
    const cur = await evmBlock();
    const cfg = { startBlock: cur + 500n, decayBlocks: [100, 1000, 26_000_000][i], initialFeeBips: [100_000, 500_000, 3_000][i], finalFeeBips: [3_000, 100_000, 3_000][i], maxBuyPerTx: [0n, 10n ** 20n, 0n][i], launchTokenIsCurrency0: BigInt(t) < BigInt(quote), enabled: true };
    await rec.send({ from: [bob, carol, dave][i], to: LGH, abi: G, fn: "configureLaunch", args: [k, cfg], contract: "LaunchGuardHook", note: i === 2 ? "decayBlocks at MAX_DECAY_BLOCKS 26,000,000 (≈10 years on the real clock)" : "first claim by an EOA" });
    direct.push({ k, owner: [bob, carol, dave][i], cfg });
    await rec.send({ from: [bob, carol, dave][i], to: CLM, abi: CL, fn: "initialize", args: [k, Q96], contract: "LaunchGuardHook", sig: "beforeInitialize", note: "CLPoolManager.initialize -> LaunchGuardHook.beforeInitialize accepts a claimed pool" });
    rec.assert(`direct ${i + 1}: launchOwner`, await chain.read(LGH, G, "launchOwner", [poolId(k)]), [bob, carol, dave][i]);
  }
  await rec.send({ from: bob, to: LGH, abi: G, fn: "configureLaunch", args: [direct[0].k, { ...direct[0].cfg, decayBlocks: 26_000_001 }], contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "InvalidDecayBlocks" });
  await rec.send({ from: mallory, to: LGH, abi: G, fn: "configureLaunch", args: [direct[0].k, direct[0].cfg], contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "NotLaunchOwner" });
  await rec.send({ from: mallory, to: LGH, abi: G, fn: "configureLaunch", args: [{ ...direct[0].k, fee: 3000 }, direct[0].cfg], contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "PoolMustUseDynamicFee" });
  await chain.mine(direct[0].cfg.startBlock - (await evmBlock()) + 1n);
  await rec.send({ from: bob, to: LGH, abi: G, fn: "configureLaunch", args: [direct[0].k, { ...direct[0].cfg, startBlock: (await evmBlock()) + 10n }], contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "LaunchAlreadyStarted", note: "owner after startBlock: powerless" });
  const nk = clKey(await launchToken("UN"), quote, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: LGH, bitmap: 0x41 });
  await rec.send({ from: mallory, to: CLM, abi: CL, fn: "initialize", args: [nk, Q96], contract: "LaunchGuardHook", sig: "beforeInitialize", role: "unauthorized", expect: "revert", expectError: "LaunchNotConfigured", note: "an unclaimed pool cannot be initialized" });
  for (const [fn, args] of hookCallbackCalls(direct[0].k, bob)) await rec.send({ from: mallory, to: LGH, abi: G, fn, args, contract: "LaunchGuardHook", role: "unauthorized", expect: "revert", expectError: "NotPoolManager" });
  for (const [fn] of hookCallbackCalls(direct[0].k, bob)) rec.notExercised("LaunchGuardHook", fn, ["beforeInitialize", "beforeSwap"].includes(fn) ? "pool-manager-only callback; exercised by every kit launch (initialize) and router trade (beforeSwap) above" : "not in bitmap 0x41: the manager never calls it");
}

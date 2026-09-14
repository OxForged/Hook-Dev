// SPDX-License-Identifier: MIT
// MUST-TEST: a stock-token-quoted pool using the real NVDA token 0xd060 (Robinhood beacon proxy).
// NVDA comes from a real holder, impersonated on the fork. Pausing is attempted ONLY from an
// address that holds NVDA's pause authority on chain: candidates come from scripts/find-stock-roles.mjs
// (RoleGranted logs on the access-controlled registry) and each is proven by simulating pause().
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi, encodeFunctionData, getAddress } from "viem";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, clKey, poolId, Q96, A, P, plan, MAX128, ZERO, deployToken, swapInPlan, swapOutPlan, balanceOf, maxUint256, maxUint160, maxUint48, DYNAMIC_FEE_FLAG } from "../lib.mjs";
import { ERC20_ABI, EXTERNAL_ABI, decodeRevert } from "../abis.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STOCK = parseAbi(["function pause()", "function unpause()", "function tokenPaused() view returns (bool)", "function paused() view returns (bool)", "function uiMultiplier() view returns (uint256)", "function decimals() view returns (uint8)", "function name() view returns (string)"]);

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  const { alice, bob, carol, dave, mallory } = ACTORS;
  const { nvda: NVDA, nvdaHolder: HOLDER, clPositionManager: POSM, universalRouter: UR, clPoolManager: CLM, vault: VAULT, launchpadKit: KIT } = ADDR;
  const CPM = ABI.CLPositionManager, R = ABI.UniversalRouter, CL = ABI.CLPoolManager;
  const dl = async () => (await chain.head()).timestamp + 3600n;

  rec.scenario("MUST stock-quoted pool (NVDA)", "MEME/NVDA CL pool on the real Vault; LP, router buys/sells, a LaunchpadKit launch quoted in NVDA; transfer accounting");
  const holderBal = await balanceOf(chain, NVDA, HOLDER);
  rec.assert(`suggested holder ${HOLDER} has NVDA (it is the Uniswap v4 PoolManager on 4663; impersonated on the fork only)`, holderBal > 10n ** 21n, true);
  const mult = await chain.read(NVDA, STOCK, "uiMultiplier");
  rec.note("NVDA facts on the fork", { name: await chain.read(NVDA, STOCK, "name"), decimals: await chain.read(NVDA, STOCK, "decimals"), uiMultiplier: mult, holderBalance: holderBal, tokenPaused: await chain.read(NVDA, STOCK, "tokenPaused") });
  for (const [who, amt] of [[alice, 200n * 10n ** 18n], [bob, 50n * 10n ** 18n], [carol, 50n * 10n ** 18n]]) {
    await rec.send({ from: HOLDER, to: NVDA, abi: ERC20_ABI, fn: "transfer", args: [who, amt], role: "setup", contract: "NVDA", note: "impersonated holder" });
    await rec.send({ from: who, to: NVDA, abi: ERC20_ABI, fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "NVDA" });
    for (const s of [POSM, UR]) await rec.send({ from: who, to: ADDR.permit2, abi: EXTERNAL_ABI, fn: "approve", args: [NVDA, s, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
    await rec.send({ from: who, to: NVDA, abi: ERC20_ABI, fn: "approve", args: [KIT, maxUint256], role: "setup", contract: "NVDA" });
  }
  const meme = await deployToken(rec, alice, "Meme Quoted In NVDA", "MEMEN", 18);
  for (const who of [alice, bob, carol]) {
    await rec.send({ from: alice, to: meme, abi: ABI["helpers/CampaignToken"], fn: "mint", args: [who, 10n ** 27n], role: "setup", contract: "CampaignToken" });
    await rec.send({ from: who, to: meme, abi: ERC20_ABI, fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "CampaignToken" });
    for (const s of [POSM, UR]) await rec.send({ from: who, to: ADDR.permit2, abi: EXTERNAL_ABI, fn: "approve", args: [meme, s, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
    await rec.send({ from: who, to: meme, abi: ERC20_ABI, fn: "approve", args: [KIT, maxUint256], role: "setup", contract: "CampaignToken" });
  }
  const key = clKey(meme, NVDA, { fee: 10000, tickSpacing: 200 });
  const id = poolId(key);
  // price: 1 NVDA (~$180) = 1,000,000 MEME -> sqrt of the raw ratio in the key's orientation
  const memeIs0 = BigInt(meme) < BigInt(NVDA);
  const sqrtP = memeIs0 ? Q96 / 1000n : Q96 * 1000n; // price = token1/token0 = 1e-6 or 1e6
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "initializePool", args: [key, sqrtP], contract: "CLPositionManager", note: "MEME/NVDA 1% pool" });
  const tickNow = Number((await chain.read(CLM, CL, "getSlot0", [id]))[1]);
  const lo = Math.floor((tickNow - 20000) / 200) * 200, hi = Math.floor((tickNow + 20000) / 200) * 200;
  const vb0 = await balanceOf(chain, NVDA, VAULT);
  const nb0 = await balanceOf(chain, NVDA, alice);
  const tokenId = await chain.read(POSM, CPM, "nextTokenId");
  await rec.send({ from: alice, to: POSM, abi: CPM, fn: "modifyLiquidities", args: [plan([[A.CL_MINT_POSITION, P.clMint(key, lo, hi, 10n ** 21n, MAX128, MAX128, alice)], [A.SETTLE_PAIR, P.pair(key.currency0, key.currency1)]]), await dl()], contract: "CLPositionManager", note: "LP into MEME/NVDA" });
  const paid = nb0 - (await balanceOf(chain, NVDA, alice));
  rec.assert("NVDA is not fee-on-transfer: vault NVDA balance rose by exactly what alice paid", (await balanceOf(chain, NVDA, VAULT)) - vb0, paid);
  const zBuy = !memeIs0; // pay NVDA, receive MEME
  const swaps = [];
  for (const [who, p, note] of [[bob, swapInPlan(key, zBuy, 10n ** 18n), "buy MEME with 1 NVDA (exact in)"], [carol, swapInPlan(key, !zBuy, 10n ** 23n), "sell 100k MEME for NVDA (exact in)"], [bob, swapOutPlan(key, zBuy, 10n ** 22n), "buy exactly 10k MEME (exact out)"]]) {
    const n0 = await balanceOf(chain, NVDA, who), m0 = await balanceOf(chain, meme, who);
    const r = await rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [p], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", note: `NVDA pool: ${note}` });
    swaps.push({ note, tx: r.txHash, gasUsed: r.gasUsed, nvdaDelta: ((await balanceOf(chain, NVDA, who)) - n0).toString(), memeDelta: ((await balanceOf(chain, meme, who)) - m0).toString() });
  }
  rec.assert("MEME/NVDA pool protocolFee stamped by V2 for the 1% tier (3322|3322<<12)", (await chain.read(CLM, CL, "getSlot0", [id]))[2], 3322 | (3322 << 12));
  // a kit launch quoted in NVDA
  const launchTok = await deployToken(rec, alice, "Launch Quoted In NVDA", "LQN", 18);
  await rec.send({ from: alice, to: launchTok, abi: ABI["helpers/CampaignToken"], fn: "mint", args: [alice, 10n ** 27n], role: "setup", contract: "CampaignToken" });
  await rec.send({ from: alice, to: launchTok, abi: ERC20_ABI, fn: "approve", args: [KIT, maxUint256], role: "setup", contract: "CampaignToken" });
  const lp = { launchToken: launchTok, quoteToken: NVDA, tickSpacing: 60, sqrtPriceX96: BigInt(launchTok) < BigInt(NVDA) ? Q96 / 1000n : Q96 * 1000n, preset: 1, initialFeeBips: 0, finalFeeBips: 0, decayBlocks: 0, enabled: true, startDelaySeconds: 0, maxBuyPerTx: 0n, launchOperator: ZERO, seed: { tickLower: -887220, tickUpper: 887220, launchTokenAmount: 10n ** 24n, quoteTokenAmount: 10n ** 18n, positionRecipient: ZERO, deadline: 0n }, listing: { register: false, steward: ZERO, metadata: { name: "x", description: "", sourceURI: "", auditURI: "", chainIds: [] } } };
  const kr = await rec.send({ from: alice, to: KIT, abi: ABI.LaunchpadKit, fn: "createLaunch", args: [lp], contract: "LaunchpadKit", note: "FairLaunch preset, quote token NVDA, seeded with NVDA" });
  const lkey = clKey(launchTok, NVDA, { fee: DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: ADDR.launchGuardHook, bitmap: 0x41 });
  await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(lkey, !(BigInt(launchTok) < BigInt(NVDA)), 10n ** 17n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", note: "buy the NVDA-quoted launch token at the launch fee" });

  rec.scenario("MUST NVDA paused", "Pause only with the real pause authority; show swaps and LP withdrawal behaviour while paused");
  const rolesFile = path.resolve(here, "..", "..", "results", "stock-roles.json");
  const candidates = fs.existsSync(rolesFile) ? JSON.parse(fs.readFileSync(rolesFile, "utf8")).holders ?? [] : [];
  let pauser = null;
  const tried = [];
  for (const c of candidates) {
    const a = getAddress(c.account);
    try {
      await chain.rpc("eth_call", [{ from: a, to: NVDA, data: encodeFunctionData({ abi: STOCK, functionName: "pause" }) }, "latest"]);
      pauser = a;
      tried.push({ account: a, role: c.role, canPause: true });
      break;
    } catch (e) {
      tried.push({ account: a, role: c.role, canPause: false, error: e.rpcError?.data ? decodeRevert(e.rpcError.data).text : e.message.slice(0, 80) });
    }
  }
  try {
    await chain.rpc("eth_call", [{ from: mallory, to: NVDA, data: encodeFunctionData({ abi: STOCK, functionName: "pause" }) }, "latest"]);
    rec.note("UNEXPECTED: an arbitrary address could pause NVDA");
  } catch (e) {
    await rec.send({ from: mallory, to: NVDA, abi: STOCK, fn: "pause", contract: "NVDA", role: "unauthorized", expect: "revert", note: "an arbitrary address cannot pause the stock token" });
  }
  rec.results.extra = { nvdaSwaps: swaps, kitLaunchTx: kr.txHash, pauseCandidates: tried, pauser };
  if (!pauser) {
    rec.notExercised("NVDA", "pause", `no address with NVDA pause authority could be identified and proven on the fork (candidates tried: ${tried.length}; see extra.pauseCandidates). Paused behaviour NOT tested.`);
    rec.note("NVDA pause behaviour could not be tested: pause authority not identified/proven.");
    return;
  }
  await rec.send({ from: pauser, to: NVDA, abi: STOCK, fn: "pause", contract: "NVDA", note: `real pause authority ${pauser}, impersonated on the fork` });
  rec.assert("NVDA tokenPaused() or paused() is true", (await chain.read(NVDA, STOCK, "tokenPaused")) || (await chain.read(NVDA, STOCK, "paused")), true);
  const buy = await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(key, zBuy, 10n ** 17n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "hazard", expect: "revert", note: "PAUSED: buy MEME paying NVDA" });
  const sell = await rec.send({ from: carol, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(key, !zBuy, 10n ** 22n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", role: "hazard", expect: "revert", note: "PAUSED: sell MEME for NVDA (vault must transfer NVDA out)" });
  const exit = await rec.send({ from: alice, to: POSM, abi: CPM, fn: "modifyLiquidities", args: [plan([[A.CL_BURN_POSITION, P.clBurn(tokenId, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(key.currency0, key.currency1, alice)]]), await dl()], contract: "CLPositionManager", role: "hazard", expect: "revert", note: "PAUSED: LP tries to withdraw (both legs)" });
  const vaultClaim = await rec.send({ from: alice, to: ADDR.vault, abi: ABI.Vault, fn: "transfer", args: [bob, NVDA, 0n], contract: "Vault", role: "hazard", note: "PAUSED: ERC-6909 claim transfers do not touch the token" });
  await rec.send({ from: pauser, to: NVDA, abi: STOCK, fn: "unpause", contract: "NVDA", note: "real authority unpauses" });
  const after = await rec.send({ from: bob, to: UR, abi: R, fn: "execute", args: ["0x10", [swapInPlan(key, zBuy, 10n ** 17n)], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", note: "UNPAUSED: trading resumes" });
  const exit2 = await rec.send({ from: alice, to: POSM, abi: CPM, fn: "modifyLiquidities", args: [plan([[A.CL_BURN_POSITION, P.clBurn(tokenId, 0n, 0n)], [A.TAKE_PAIR, P.pairTo(key.currency0, key.currency1, alice)]]), await dl()], contract: "CLPositionManager", note: "UNPAUSED: LP withdraws" });
  rec.hazard("stock-pause", "Robinhood can pause NVDA: every NVDA-quoted pool on the Latch Vault stops trading AND LPs cannot withdraw until unpaused", { pauser, buyWhilePaused: buy.error, sellWhilePaused: sell.error, lpExitWhilePaused: exit.error, claimTransferWhilePaused: vaultClaim.status, tradeAfterUnpause: after.status, lpExitAfterUnpause: exit2.status }, buy.status === "revert" && exit.status === "revert");
}


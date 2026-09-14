// SPDX-License-Identifier: MIT
// Shared fixtures: throwaway tokens, test doubles, approvals, and one liquid CL and Bin pool on the
// REAL Vault and managers, built through the REAL position managers.
import { artifact } from "../abis.mjs";
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, A, P, plan, clKey, binKey, poolId, deployToken, fundAndApprove, Q96, BIN_ID_ONE, deadline, ZERO, maxUint256 } from "../lib.mjs";

export async function run(ctx) {
  const { chain, rec, state } = ctx;
  if (state.setupDone) return;
  rec.scenario("setup", "Throwaway tokens, VaultActor, approvals, base CL and Bin pools with liquidity");
  const { alice, bob, carol, dave } = ACTORS;

  const tokens = {};
  for (const sym of ["TKA", "TKB", "TKC", "TKD", "TKE", "TKF"]) tokens[sym] = await deployToken(rec, alice, `Campaign ${sym}`, sym, 18);
  tokens.USD6 = await deployToken(rec, alice, "Campaign Six Decimals", "USD6", 6);
  state.tokens = tokens;

  const actorArt = artifact("helpers/VaultActor");
  state.actor = await rec.deploy({ from: alice, abi: actorArt.abi, bytecode: actorArt.bytecode, args: [ADDR.vault], contract: "VaultActor" });
  state.actor2 = await rec.deploy({ from: bob, abi: actorArt.abi, bytecode: actorArt.bytecode, args: [ADDR.vault], contract: "VaultActor" });
  const lp = artifact("helpers/MockLaunchpad");
  state.mockLaunchpad = await rec.deploy({ from: alice, abi: lp.abi, bytecode: lp.bytecode, contract: "MockLaunchpad" });

  const spenders = [ADDR.clPositionManager, ADDR.binPositionManager, ADDR.universalRouter];
  const big = 10n ** 30n;
  for (const who of [alice, bob, carol, dave]) {
    for (const sym of ["TKA", "TKB", "TKC", "TKD", "TKE", "TKF", "USD6"]) {
      await fundAndApprove(rec, tokens[sym], who, big, spenders);
      await rec.send({ from: who, to: tokens[sym], abi: ABI["helpers/CampaignToken"], fn: "approve", args: [ADDR.launchpadKit, maxUint256], role: "setup", contract: "CampaignToken" });
    }
  }

  // Base CL pool TKA/TKB 0.30% ts60, no hook.
  const key = clKey(tokens.TKA, tokens.TKB, { fee: 3000, tickSpacing: 60 });
  state.baseCL = { key, id: poolId(key) };
  await rec.send({ from: alice, to: ADDR.clPoolManager, abi: ABI.CLPoolManager, fn: "initialize", args: [key, Q96], contract: "CLPoolManager", role: "setup", note: "base pool" });
  const ts = (await chain.head()).timestamp;
  const tokenId = await chain.read(ADDR.clPositionManager, ABI.CLPositionManager, "nextTokenId");
  await rec.send({
    from: alice, to: ADDR.clPositionManager, abi: ABI.CLPositionManager, fn: "modifyLiquidities", role: "setup", contract: "CLPositionManager",
    args: [plan([[A.CL_MINT_POSITION, P.clMint(key, -6000, 6000, 10n ** 24n, 10n ** 27n, 10n ** 27n, alice)], [A.SETTLE_PAIR, P.pair(key.currency0, key.currency1)]]), deadline(ts)],
  });
  state.baseCL.tokenId = tokenId;

  // Base Bin pool TKA/TKB 0.30% binStep 10, no hook; liquidity spread over 5 bins.
  const bkey = binKey(tokens.TKA, tokens.TKB, { fee: 3000, binStep: 10 });
  state.baseBin = { key: bkey, id: poolId(bkey) };
  await rec.send({ from: alice, to: ADDR.binPoolManager, abi: ABI.BinPoolManager, fn: "initialize", args: [bkey, BIN_ID_ONE], contract: "BinPoolManager", role: "setup", note: "base pool" });
  await rec.send({
    from: alice, to: ADDR.binPositionManager, abi: ABI.BinPositionManager, fn: "modifyLiquidities", role: "setup", contract: "BinPositionManager",
    args: [plan([[A.BIN_ADD_LIQUIDITY, binAddParams(bkey, 10n ** 23n, alice)], [A.SETTLE_PAIR, P.pair(bkey.currency0, bkey.currency1)]]), deadline(ts)],
  });
  rec.assert("base CL pool has liquidity", (await chain.read(ADDR.clPoolManager, ABI.CLPoolManager, "getLiquidity", [state.baseCL.id])) > 0n, true);
  const [activeId] = await chain.read(ADDR.binPoolManager, ABI.BinPoolManager, "getSlot0", [state.baseBin.id]);
  rec.assert("base Bin pool active id", activeId, BIN_ID_ONE);
  state.setupDone = true;
}

/** 5 bins around the active id: Y (token1) below, X (token0) above, both in the active bin. */
export function binAddParams(key, amountEach, to, activeId = BIN_ID_ONE) {
  const E18 = 10n ** 18n;
  return P.binAdd({
    poolKey: key, amount0: amountEach, amount1: amountEach, amount0Max: amountEach, amount1Max: amountEach,
    activeIdDesired: BigInt(activeId), idSlippage: 0n,
    deltaIds: [-2n, -1n, 0n, 1n, 2n],
    distributionX: [0n, 0n, E18 / 3n, E18 / 3n, E18 / 3n],
    distributionY: [E18 / 3n, E18 / 3n, E18 / 3n, 0n, 0n],
    minLiquidities: [0n, 0n, 0n, 0n, 0n], to, hookData: "0x",
  });
}
export { ZERO };

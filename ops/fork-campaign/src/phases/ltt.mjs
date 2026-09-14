// SPDX-License-Identifier: MIT
// MUST-TEST: swaps on the EXISTING LTT1/LTT2 pool (hook = retired RevShareHook 0x23CE, the only pool
// with liquidity on mainnet), through the real UniversalRouter.
import { ADDR } from "../addresses.mjs";
import { ABI, ACTORS, swapInPlan, swapOutPlan, balanceOf, maxUint256, maxUint160, maxUint48 } from "../lib.mjs";
import { ERC20_ABI, EXTERNAL_ABI } from "../abis.mjs";

export async function run(ctx) {
  const { chain, rec } = ctx;
  const { alice, bob, carol } = ACTORS;
  const { opsKey, universalRouter: UR, clPoolManager: CLM, revShareHookRetired: H, ltt1, ltt2, demoPoolId } = ADDR;
  const CL = ABI.CLPoolManager, R = ABI.UniversalRouter, RS = ABI.RevShareHook_23CE;
  rec.scenario("MUST ltt1-ltt2-swaps", "Three router swaps on the live LTT1/LTT2 pool: 0->1 exact-in, 1->0 exact-in, 0->1 exact-out");

  const keyArr = await chain.read(CLM, CL, "poolIdToPoolKey", [demoPoolId]);
  const key = { currency0: keyArr[0], currency1: keyArr[1], hooks: keyArr[2], poolManager: keyArr[3], fee: keyArr[4], parameters: keyArr[5] };
  rec.assert("LTT pool key hooks == 0x23CE", key.hooks, H);
  const [sqrt0, tick0, protocolFee, lpFee] = await chain.read(CLM, CL, "getSlot0", [demoPoolId]);
  const liq0 = await chain.read(CLM, CL, "getLiquidity", [demoPoolId]);
  const cfg = await chain.read(H, RS, "getConfig", [demoPoolId]);
  rec.note("LTT1/LTT2 live state at fork", { sqrtPriceX96: sqrt0, tick: tick0, protocolFee, lpFee, liquidity: liq0, revShareConfig: cfg });

  // traders get LTT from the ops key (impersonated on the fork; it holds ~1M of each)
  for (const who of [alice, bob, carol]) {
    for (const t of [ltt1, ltt2]) {
      await rec.send({ from: opsKey, to: t, abi: ERC20_ABI, fn: "transfer", args: [who, 10n ** 22n], role: "setup", contract: "LTT" });
      await rec.send({ from: who, to: t, abi: ERC20_ABI, fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "LTT" });
      await rec.send({ from: who, to: ADDR.permit2, abi: EXTERNAL_ABI, fn: "approve", args: [t, UR, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
    }
  }
  const dl = async () => (await chain.head()).timestamp + 600n;
  const plans = [
    [alice, swapInPlan(key, true, 10n ** 20n), "LTT1 -> LTT2 exact in 100", key.currency1],
    [bob, swapInPlan(key, false, 25n * 10n ** 19n), "LTT2 -> LTT1 exact in 250", key.currency0],
    [carol, swapOutPlan(key, true, 5n * 10n ** 19n), "LTT1 -> LTT2 exact out 50", key.currency0], // exact-out: the unspecified (cut) currency is the INPUT
  ];
  const out = [];
  for (const [who, p, note, cut] of plans) {
    const pb0 = await chain.read(H, RS, "pendingBeneficiary", [demoPoolId, cut]);
    const tt0 = await chain.read(H, RS, "totalTaken", [demoPoolId, cut]);
    const b1 = await balanceOf(chain, key.currency1, who), b0 = await balanceOf(chain, key.currency0, who);
    const r = await rec.send({ from: who, to: UR, abi: R, fn: "execute", args: ["0x10", [p], await dl()], sig: "execute(bytes,bytes[],uint256)", contract: "UniversalRouter", note: `LTT1/LTT2: ${note}` });
    const pb1 = await chain.read(H, RS, "pendingBeneficiary", [demoPoolId, cut]);
    const tt1 = await chain.read(H, RS, "totalTaken", [demoPoolId, cut]);
    rec.assert(`${note}: RevShareTaken emitted`, r.events.includes("RevShareTaken"), true);
    rec.assert(`${note}: beneficiary pot grew (beneficiaryBps 8000)`, pb1 > pb0, true);
    const skipped = r.events.includes("LpDonationSkipped");
    if (skipped) rec.assert(`${note}: LP leg skipped (range exhausted, active liquidity 0) so the whole taken cut is the beneficiary leg`, pb1 - pb0, tt1 - tt0);
    else rec.assert(`${note}: beneficiary share == 80% of the cut (floor rounding on both legs)`, (() => { const d = (pb1 - pb0) * 10000n - (tt1 - tt0) * 8000n; return (d < 0n ? -d : d) <= 20000n; })(), true);
    out.push({ note, lpDonationSkipped: r.events.includes("LpDonationSkipped"), activeLiquidityAfter: (await chain.read(CLM, CL, "getLiquidity", [demoPoolId])).toString(), txHash: r.txHash, gasUsed: r.gasUsed, cutCurrency: cut, cut: (tt1 - tt0).toString(), toBeneficiaries: (pb1 - pb0).toString(), trader0Delta: ((await balanceOf(chain, key.currency0, who)) - b0).toString(), trader1Delta: ((await balanceOf(chain, key.currency1, who)) - b1).toString() });
  }
  const [sqrt1] = await chain.read(CLM, CL, "getSlot0", [demoPoolId]);
  rec.note("Informational: 'exact in 100 LTT1' consumed only part of the input and did not revert - the pool's liquidity is one narrow range and CL swaps stop at the range edge when amountOutMinimum is 0. Any UI quoting this pool must set amountOutMinimum from a quote.");
  rec.results.extra = { lttSwaps: out, priceBefore: sqrt0.toString(), priceAfter: sqrt1.toString(), protocolFeeOnPool: protocolFee };
  rec.assert("LTT pool protocolFee is 0 (created before the V2 controller; never synced)", protocolFee, 0);
}

import { describe, expect, it } from "vitest";
import { splitSwapFee } from "../dimension-adapters/dexs/latch.js";

const PIPS = 1_000_000n;

/**
 * Reference implementation of `ProtocolFeeLibrary.calculateSwapFee`, transcribed
 * from the assembly in packages/core/src/libraries/ProtocolFeeLibrary.sol:
 *
 *   self := and(self, 0xfff)
 *   lpFee := and(lpFee, 0xffffff)
 *   swapFee := sub(add(self, lpFee), div(mul(self, lpFee), PIPS_DENOMINATOR))
 */
function calculateSwapFee(protocolFee: bigint, lpFee: bigint): bigint {
  const p = protocolFee & 0xfffn;
  const l = lpFee & 0xffffffn;
  return p + l - (p * l) / PIPS;
}

describe("swap fee composition", () => {
  it("matches the contract formula: protocol first, LP on the remainder", () => {
    // 0.1% protocol (the live default on Sepolia) over a 0.30% LP tier.
    expect(calculateSwapFee(1000n, 3000n)).toBe(1000n + 3000n - 3n);
    // A zero protocol fee leaves the LP fee untouched.
    expect(calculateSwapFee(0n, 3000n)).toBe(3000n);
    // Max protocol fee (ProtocolFeeLibrary.MAX_PROTOCOL_FEE = 4000) over 1%.
    expect(calculateSwapFee(4000n, 10_000n)).toBe(4000n + 10_000n - 40n);
  });

  it("never exceeds the naive sum, and is strictly below it once the cross term rounds up to a pip", () => {
    for (const p of [1n, 500n, 1000n, 4000n])
      for (const l of [100n, 500n, 3000n, 10_000n, 100_000n]) {
        const composed = calculateSwapFee(p, l);
        expect(composed).toBeLessThanOrEqual(p + l);
        // The cross term is `p * l / 1e6` under integer division, so it vanishes
        // for small fee pairs (1 pip protocol over a 1bp tier is 1 * 100 / 1e6 = 0)
        // and only bites once the product reaches a whole pip.
        if ((p * l) / 1_000_000n > 0n) expect(composed).toBeLessThan(p + l);
      }
  });

  it("matches the live Sepolia pool: 0.1% protocol over a 0.30% tier == 3997 pips", () => {
    // Both real Swap logs on Sepolia carry fee=3997, protocolFee=1000.
    expect(calculateSwapFee(1000n, 3000n)).toBe(3997n);
    // and inverting the composition recovers the tier exactly
    const lpFee = ((3997n - 1000n) * PIPS) / (PIPS - 1000n);
    expect(lpFee).toBe(3000n);
  });

  it("ignores bits above the 12-bit single-direction protocol fee field", () => {
    // getZeroForOneFee is `self & 0xfff`; the high 12 bits are the other direction.
    expect(calculateSwapFee(0x1000n + 1000n, 3000n)).toBe(calculateSwapFee(1000n, 3000n));
  });
});

describe("splitSwapFee", () => {
  const GROSS = 1_000_000_000_000_000_000n; // 1e18 of the input token

  it("decomposes the swap fee into protocol and LP shares that sum exactly", () => {
    const swapFee = calculateSwapFee(1000n, 3000n); // 3997 pips
    const { total, protocol, lp } = splitSwapFee(GROSS, swapFee, 1000n);

    expect(total).toBe((GROSS * swapFee) / PIPS);
    expect(protocol).toBe((GROSS * 1000n) / PIPS);
    expect(lp).toBe(total - protocol);
    // The identity DefiLlama's income statement requires:
    // dailyFees == dailyRevenue + dailySupplySideRevenue
    expect(protocol + lp).toBe(total);
  });

  it("gives LPs everything when the protocol fee is zero", () => {
    const { total, protocol, lp } = splitSwapFee(GROSS, 3000n, 0n);
    expect(protocol).toBe(0n);
    expect(lp).toBe(total);
    expect(total).toBe(3_000_000_000_000_000n); // 0.3% of 1e18
  });

  it("reproduces the protocol accrual formula used in CLPool.swap", () => {
    // CLPool: protocolFeesAccrued += (step.amountIn + step.feeAmount) * protocolFee / 1e6
    // where (amountIn + feeAmount) summed over steps is the gross input.
    for (const p of [0n, 1n, 1000n, 4000n]) {
      const swapFee = calculateSwapFee(p, 500n);
      expect(splitSwapFee(GROSS, swapFee, p).protocol).toBe((GROSS * p) / PIPS);
    }
  });

  it("reproduces the bin accrual formula, which arrives the long way round", () => {
    // BinPool: pFee = totalFee.getProtocolFeeAmt(protocolFee, swapFee)
    //               = totalFee * protocolFee / swapFee
    // and totalFee = gross * swapFee / 1e6, so the two agree up to truncation.
    const p = 1000n;
    const swapFee = calculateSwapFee(p, 2500n);
    const total = (GROSS * swapFee) / PIPS;
    const binWay = (total * p) / swapFee;
    const ours = splitSwapFee(GROSS, swapFee, p).protocol;
    const diff = ours > binWay ? ours - binWay : binWay - ours;
    expect(diff).toBeLessThanOrEqual(1n); // pure integer-truncation noise
  });

  it("never returns a negative LP share, even for an impossible log", () => {
    // protocolFee > fee cannot happen on-chain; a corrupt log must not create
    // negative supply-side revenue, which DefiLlama would reject.
    const { total, protocol, lp } = splitSwapFee(GROSS, 100n, 4000n);
    expect(lp).toBe(0n);
    expect(protocol).toBe(total);
  });

  it("returns zeros for a zero-amount or zero-fee swap", () => {
    expect(splitSwapFee(0n, 3000n, 1000n)).toEqual({ total: 0n, protocol: 0n, lp: 0n });
    expect(splitSwapFee(GROSS, 0n, 0n)).toEqual({ total: 0n, protocol: 0n, lp: 0n });
  });

  it("keeps full precision on amounts above 2^53", () => {
    // AGENTS.md: "Number(bigint) / 1e18 loses precision past 2^53."
    const huge = 2n ** 100n;
    expect(splitSwapFee(huge, 3000n, 1000n).total).toBe((huge * 3000n) / PIPS);
  });
});

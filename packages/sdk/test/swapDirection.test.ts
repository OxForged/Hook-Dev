// SPDX-License-Identifier: MIT
/* ============================================================================
   Swap direction from a `Swap` event's signed amounts.

   Fixture: Robinhood Chain (4663) tx
   0x68286e9b10e1e4d7e42adc9bc02bda0484ac53f6943dc8cd37cfd1d959bc629a, a swap in
   the LTT1/LTT2 pool. The CLPoolManager `Swap` event emitted
     amount0 = -1000000000000000000
     amount1 =  996006981039903216
   and in the same transaction exactly 1e18 of currency0 (LTT1, 0x2A21…58A6, the
   lower address) moved INTO the Vault while LTT2 moved out. So amount0 < 0
   means currency0 was PAID IN: a zero-for-one swap.

   This pins the fix of `swapIsZeroForOne`, which used to return
   `amount0 > 0n` — every swap reported backwards.
   ============================================================================ */

import { describe, expect, it } from "vitest";

import { swapIsZeroForOne } from "../src/indexer/index.js";

const TX_AMOUNT0 = -1_000_000_000_000_000_000n;
const TX_AMOUNT1 = 996_006_981_039_903_216n;

describe("swapIsZeroForOne", () => {
  it("reads the live 4663 swap, where currency0 was paid in, as zero-for-one", () => {
    expect(swapIsZeroForOne(TX_AMOUNT0)).toBe(true);
  });

  it("reads the mirror-image swap (currency1 paid in) as one-for-zero", () => {
    // amount0 positive: the caller RECEIVED currency0.
    expect(swapIsZeroForOne(TX_AMOUNT1)).toBe(false);
  });

  it("a zero amount0 is not a zero-for-one input", () => {
    expect(swapIsZeroForOne(0n)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { decodePackedUint128 } from "../dimension-adapters/dexs/latch.js";

/**
 * Ground truth for these vectors is the protocol's own test suite,
 * packages/core/test/pool-bin/libraries/math/PackedUint128Math.t.sol, which asserts:
 *
 *   testFuzz_Encode:  bytes32(x1 | (uint256(x2) << 128)) == x1.encode(x2)
 *   testFuzz_Decode:  x1 == uint128(uint256(x))            // LOW  128 bits
 *                     x2 == uint128(uint256(x) >> 128)     // HIGH 128 bits
 *   test_AddSelf:     bytes32(uint256((1 << 128) | 1))  decodes as (1, 1)
 *
 * (Run with `forge test --match-path test/pool-bin/libraries/math/PackedUint128Math.t.sol`
 * from packages/core - 19 tests, all passing, checked 2026-09-09.)
 *
 * Which half is which token is pinned by BinPoolManager.swap, not by the library:
 *   protocolFeesAccrued[key.currency0] += feeAmountToProtocol.decodeX();  // low
 *   protocolFeesAccrued[key.currency1] += feeAmountToProtocol.decodeY();  // high
 * so low = amount0 and high = amount1. Getting this backwards silently swaps the
 * two tokens of every bin position.
 */

const encode = (x1: bigint, x2: bigint): string =>
  "0x" + ((x2 << 128n) | (x1 & ((1n << 128n) - 1n))).toString(16).padStart(64, "0");

describe("PackedUint128Math", () => {
  it("reads amount0 from the LOW 128 bits and amount1 from the HIGH 128 bits", () => {
    // Written out longhand so the byte order is visible: leading half is amount1.
    const word =
      "0x" +
      "00000000000000000000000000000002" + // high 128 -> x2 -> amount1
      "00000000000000000000000000000001"; //  low 128 -> x1 -> amount0
    expect(decodePackedUint128(word)).toEqual([1n, 2n]);
  });

  it("matches the test_AddSelf vector from the core test suite", () => {
    // bytes32(uint256((1 << 128) | 1)) decodes as (x1 = 1, x2 = 1)
    expect(decodePackedUint128(encode(1n, 1n))).toEqual([1n, 1n]);
    // and its double, (2 << 128) | 2
    expect(decodePackedUint128(encode(2n, 2n))).toEqual([2n, 2n]);
  });

  it("round-trips the full uint128 range including the boundaries", () => {
    const MAX = (1n << 128n) - 1n;
    const cases: Array<[bigint, bigint]> = [
      [0n, 0n],
      [MAX, 0n],
      [0n, MAX],
      [MAX, MAX],
      [1n, MAX],
      [123_456_789_000_000_000_000n, 987_654_321n],
    ];
    for (const [x1, x2] of cases) expect(decodePackedUint128(encode(x1, x2))).toEqual([x1, x2]);
  });

  it("does not let the high half bleed into the low half", () => {
    // A large amount1 with a zero amount0 must not report a non-zero amount0.
    const [a0, a1] = decodePackedUint128(encode(0n, (1n << 128n) - 1n));
    expect(a0).toBe(0n);
    expect(a1).toBe((1n << 128n) - 1n);
  });

  it("accepts short words and rejects non-hex", () => {
    expect(decodePackedUint128("0x01")).toEqual([1n, 0n]);
    expect(() => decodePackedUint128("0xzz")).toThrow(/not a bytes32 word/);
    expect(() => decodePackedUint128("0x" + "f".repeat(65))).toThrow(/not a bytes32 word/);
  });
});

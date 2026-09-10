import { describe, expect, it } from "vitest";
import { describeBitmap, flagTable, toBinaryLiteral } from "../src/services/permissions.service.js";

/**
 * These assertions pin the bit layout to the Solidity constants in
 * `packages/core/src/pool-cl/interfaces/ICLHooks.sol` and
 * `packages/core/src/pool-bin/interfaces/IBinHooks.sol`. If the offsets ever
 * change upstream, this is where it should be noticed.
 */
describe("permission bitmaps", () => {
  it("places the CL callbacks at their ICLHooks offsets", () => {
    const table = Object.fromEntries(flagTable("CL").map((f) => [f.name, f.offset]));
    expect(table).toMatchObject({
      beforeInitialize: 0,
      afterInitialize: 1,
      beforeAddLiquidity: 2,
      afterAddLiquidity: 3,
      beforeRemoveLiquidity: 4,
      afterRemoveLiquidity: 5,
      beforeSwap: 6,
      afterSwap: 7,
      beforeDonate: 8,
      afterDonate: 9,
      beforeSwapReturnsDelta: 10,
      afterSwapReturnsDelta: 11,
      afterAddLiquidityReturnsDelta: 12,
      afterRemoveLiquidityReturnsDelta: 13,
    });
  });

  it("uses the same offsets for bin, with mint/burn naming", () => {
    const table = Object.fromEntries(flagTable("BIN").map((f) => [f.name, f.offset]));
    expect(table).toMatchObject({
      beforeMint: 2,
      afterMint: 3,
      beforeBurn: 4,
      afterBurn: 5,
      beforeSwap: 6,
      afterSwap: 7,
      afterMintReturnsDelta: 12,
      afterBurnReturnsDelta: 13,
    });
  });

  it("decodes a beforeSwap + afterSwap + afterSwapReturnsDelta bitmap", () => {
    // bits 6, 7, 11
    const bitmap = (1 << 6) | (1 << 7) | (1 << 11);
    const summary = describeBitmap("CL", bitmap);

    expect(summary.hex).toBe("0x08c0");
    expect(summary.enabled.sort()).toEqual(
      ["afterSwap", "afterSwapReturnsDelta", "beforeSwap"].sort(),
    );
    expect(summary.valid).toBe(true);
    // The returns-delta bit is what lets this hook pay itself.
    expect(summary.canTakeHookFees).toBe(true);
  });

  it("rejects a returns-delta bit without its parent callback", () => {
    // bit 11 (afterSwapReturnsDelta) with no bit 7 (afterSwap).
    // On-chain this reverts in CLHooks.validatePermissionsConflict with
    // Hooks.HookPermissionsValidationError.
    const summary = describeBitmap("CL", 1 << 11);
    expect(summary.valid).toBe(false);
    expect(summary.problems.map((p) => p.code)).toContain("MISSING_DEPENDENCY");
  });

  it("rejects bits above the assigned range", () => {
    // Bits 14-15 of the bitmap field are unassigned.
    const summary = describeBitmap("CL", 1 << 14);
    expect(summary.valid).toBe(false);
    expect(summary.problems.map((p) => p.code)).toContain("UNASSIGNED_BIT_SET");
  });

  it("treats an empty bitmap as a valid hookless configuration", () => {
    const summary = describeBitmap("CL", 0);
    expect(summary.valid).toBe(true);
    expect(summary.enabled).toEqual([]);
    expect(summary.canTakeHookFees).toBe(false);
  });

  it("reads the same bitmap differently per pool type", () => {
    // Bit 2 is beforeAddLiquidity on CL and beforeMint on bin. Same bits,
    // different meaning — which is why decoding always takes a pool type.
    const bitmap = 1 << 2;
    expect(describeBitmap("CL", bitmap).enabled).toEqual(["beforeAddLiquidity"]);
    expect(describeBitmap("BIN", bitmap).enabled).toEqual(["beforeMint"]);
  });

  it("formats a binary literal the way a hook declares it", () => {
    expect(toBinaryLiteral((1 << 6) | (1 << 7))).toBe("0b0000_0000_1100_0000");
    expect(toBinaryLiteral(0)).toBe("0b0000_0000_0000_0000");
  });

  it("marks exactly bits 10-13 as returns-delta", () => {
    const returnsDelta = flagTable("CL")
      .filter((f) => f.returnsDelta)
      .map((f) => f.offset)
      .sort((a, b) => a - b);
    expect(returnsDelta).toEqual([10, 11, 12, 13]);
  });
});

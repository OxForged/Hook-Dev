import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  namesForBitmap,
  parsePermissionList,
  poolParametersFor,
  resolvePermissions,
  toBitmapHex,
} from "../src/permissions.js";

describe("parsePermissionList", () => {
  it("accepts the canonical spelling", () => {
    expect(parsePermissionList("beforeSwap,afterSwap")).toEqual(["beforeSwap", "afterSwap"]);
  });

  it("accepts dashes, underscores and any casing", () => {
    expect(parsePermissionList("before-swap, AFTER_SWAP")).toEqual(["beforeSwap", "afterSwap"]);
  });

  it("de-duplicates and returns bit order regardless of input order", () => {
    expect(parsePermissionList("afterSwap,beforeSwap,afterSwap")).toEqual(["beforeSwap", "afterSwap"]);
  });

  it("understands all and none", () => {
    expect(parsePermissionList("all")).toEqual([...ALL_PERMISSIONS]);
    expect(parsePermissionList("none")).toEqual([]);
    expect(parsePermissionList("")).toEqual([]);
  });

  it("rejects an unknown name with the valid list in the hint", () => {
    expect(() => parsePermissionList("beforeSwapp")).toThrowError(/unknown hook permission "beforeSwapp"/);
  });
});

describe("resolvePermissions", () => {
  it("encodes the bitmap the pool manager will compare against", () => {
    const resolved = resolvePermissions(["beforeSwap"]);
    expect(resolved.bitmap).toBe(0x0040);
    expect(resolved.bitmapHex).toBe("0x0040");
    expect(resolved.solidityExpression).toBe("BEFORE_SWAP");
  });

  it("adds the base callback a *ReturnsDelta flag depends on", () => {
    const resolved = resolvePermissions(["afterSwapReturnsDelta"]);
    expect(resolved.names).toEqual(["afterSwap", "afterSwapReturnsDelta"]);
    expect(resolved.addedDependencies).toEqual(["afterSwap"]);
    expect(resolved.bitmap).toBe((1 << 7) | (1 << 11));
  });

  it("adds every missing base callback, not just the first", () => {
    const resolved = resolvePermissions([
      "beforeSwapReturnsDelta",
      "afterAddLiquidityReturnsDelta",
      "afterRemoveLiquidityReturnsDelta",
    ]);
    expect(resolved.addedDependencies).toEqual([
      "afterAddLiquidity",
      "afterRemoveLiquidity",
      "beforeSwap",
    ]);
  });

  it("keeps the whole assigned range inside the reserved-bit mask", () => {
    const resolved = resolvePermissions([...ALL_PERMISSIONS]);
    expect(resolved.bitmap).toBe(0x3fff);
    expect(resolved.bitmap & 0xc000).toBe(0);
  });

  it("emits the Solidity expression in bit order so output is deterministic", () => {
    const a = resolvePermissions(["afterSwap", "beforeSwap"]);
    const b = resolvePermissions(["beforeSwap", "afterSwap"]);
    expect(a.solidityExpression).toBe("BEFORE_SWAP | AFTER_SWAP");
    expect(a.solidityExpression).toBe(b.solidityExpression);
  });

  it("renders 0 for an empty permission set", () => {
    expect(resolvePermissions([]).solidityExpression).toBe("0");
    expect(resolvePermissions([]).bitmap).toBe(0);
  });
});

describe("poolParametersFor", () => {
  it("packs bitmap and tick spacing into one word", () => {
    expect(poolParametersFor(0x0040, 60)).toBe(
      "0x00000000000000000000000000000000000000000000000000000000003c0040",
    );
  });

  it("leaves every bit at or above 40 zero, as CLPoolManager requires", () => {
    const parameters = poolParametersFor(0x3fff, 32767);
    expect(BigInt(parameters) >> 40n).toBe(0n);
  });
});

describe("round-tripping", () => {
  it("decodes a bitmap back to the names it was built from", () => {
    const names = ["beforeSwap", "afterSwap", "afterSwapReturnsDelta"] as const;
    const { bitmap } = resolvePermissions([...names]);
    expect(namesForBitmap(bitmap)).toEqual([...names]);
  });

  it("formats bitmaps as four hex digits", () => {
    expect(toBitmapHex(1)).toBe("0x0001");
    expect(toBitmapHex(0x3fff)).toBe("0x3fff");
  });
});

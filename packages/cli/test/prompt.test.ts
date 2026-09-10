import { describe, expect, it } from "vitest";
import { parseSelection } from "../src/util/prompt.js";

const PRESELECTED = new Set([1, 3]);

describe("parseSelection", () => {
  it("keeps the pre-selected set on an empty answer", () => {
    expect(parseSelection("", 5, PRESELECTED)).toEqual([1, 3]);
    expect(parseSelection("   ", 5, PRESELECTED)).toEqual([1, 3]);
  });

  it("understands all and none", () => {
    expect(parseSelection("all", 3, PRESELECTED)).toEqual([0, 1, 2]);
    expect(parseSelection("ALL", 3, PRESELECTED)).toEqual([0, 1, 2]);
    expect(parseSelection("none", 3, PRESELECTED)).toEqual([]);
  });

  it("reads a comma-separated list, one-based", () => {
    expect(parseSelection("1,3", 5, PRESELECTED)).toEqual([0, 2]);
    expect(parseSelection(" 2 , 1 ", 5, PRESELECTED)).toEqual([0, 1]);
  });

  it("reads ranges", () => {
    expect(parseSelection("2-4", 5, PRESELECTED)).toEqual([1, 2, 3]);
    expect(parseSelection("1-2,5", 5, PRESELECTED)).toEqual([0, 1, 4]);
  });

  it("de-duplicates overlapping input", () => {
    expect(parseSelection("1-3,2,3", 5, PRESELECTED)).toEqual([0, 1, 2]);
  });

  it("rejects anything out of range rather than silently clamping", () => {
    expect(parseSelection("0", 5, PRESELECTED)).toBeUndefined();
    expect(parseSelection("6", 5, PRESELECTED)).toBeUndefined();
    expect(parseSelection("1-9", 5, PRESELECTED)).toBeUndefined();
    expect(parseSelection("4-2", 5, PRESELECTED)).toBeUndefined();
    expect(parseSelection("beforeSwap", 5, PRESELECTED)).toBeUndefined();
    expect(parseSelection("2x", 5, PRESELECTED)).toBeUndefined();
  });

  it("drops pre-selected indices that no longer exist", () => {
    expect(parseSelection("", 2, PRESELECTED)).toEqual([1]);
  });
});

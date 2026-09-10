import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEE_CONTROLLER_EVENTS_ABI, normalizeAddress } from "../src/chain/contracts.js";
import { decodeCursor, encodeCursor, toPage } from "../src/lib/pagination.js";
import { addressRowId, clPositionRowId, eventRowId, poolRowId } from "../src/lib/ids.js";
import { labelFor, metaFor } from "../src/lib/response.js";

describe("LatchProtocolFeeController ABI", () => {
  /**
   * The fee controller's events are hand-declared in src/chain/contracts.ts,
   * because the SDK's generator covers packages/core only. This test is what
   * keeps that declaration honest: it diffs it against the compiled artifact.
   */
  it("matches the compiled artifact", () => {
    const artifactPath = fileURLToPath(
      new URL(
        "../../../packages/fees/foundry-out/LatchProtocolFeeController.sol/LatchProtocolFeeController.json",
        import.meta.url,
      ),
    );

    let artifact: { abi: { type: string; name?: string; inputs?: unknown[] }[] };
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch {
      // The artifact only exists after `forge build`. Skip rather than fail in
      // an environment without the Solidity toolchain.
      console.warn("skipping: fee controller artifact not built");
      return;
    }

    const compiled = artifact.abi.filter((f) => f.type === "event");
    const declared = FEE_CONTROLLER_EVENTS_ABI.filter((f) => f.type === "event");

    const signature = (f: { name?: string; inputs?: unknown[] }) =>
      `${f.name}(${(f.inputs ?? [])
        .map((i) => {
          const input = i as { type: string; indexed?: boolean; name?: string };
          return `${input.type}${input.indexed ? " indexed" : ""} ${input.name}`;
        })
        .join(",")})`;

    const compiledSigs = compiled.map(signature).sort();
    const declaredSigs = declared.map((f) => signature(f as never)).sort();

    expect(declaredSigs).toEqual(compiledSigs);
  });

  it("declares the five fee-governance events the ingestion model expects", () => {
    const names = FEE_CONTROLLER_EVENTS_ABI.filter((f) => f.type === "event").map(
      (f) => (f as { name: string }).name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "DefaultFeeUpdated",
        "PoolFeeUpdated",
        "TierFeeUpdated",
        "DynamicFeeUpdated",
        "FeesDisabledSet",
      ]),
    );
  });
});

describe("keyset pagination", () => {
  it("round-trips a cursor", () => {
    const cursor = { ts: 1_756_000_000_000, id: "31337-0xabc-3" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("survives ids containing the separator", () => {
    // Row ids are `${chainId}-${txHash}-${logIndex}` and the encoding splits on
    // the FIRST separator only, so hyphens in the id are safe.
    const cursor = { ts: 1, id: "31337-0xdeadbeef-12" };
    expect(decodeCursor(encodeCursor(cursor)).id).toBe(cursor.id);
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrow();
    expect(() => decodeCursor(Buffer.from("nope", "utf8").toString("base64url"))).toThrow();
  });

  it("slices an over-fetched page and emits a next cursor", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `row-${i}`,
      at: new Date(2_000_000_000_000 - i * 1_000),
    }));

    const page = toPage(rows, 5, (r) => r.at);
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor!).id).toBe("row-4");
  });

  it("reports the end of a feed", () => {
    const rows = [{ id: "only", at: new Date() }];
    const page = toPage(rows, 5, (r) => r.at);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

describe("row ids", () => {
  it("scopes every id by chain so the same pool on two chains stays distinct", () => {
    expect(poolRowId(1, "0xABC")).toBe("1-0xabc");
    expect(poolRowId(8453, "0xABC")).toBe("8453-0xabc");
    expect(poolRowId(1, "0xABC")).not.toBe(poolRowId(8453, "0xABC"));
  });

  it("lowercases addresses", () => {
    expect(addressRowId(1, "0xAaBb")).toBe("1-0xaabb");
    expect(normalizeAddress("0xAaBb")).toBe("0xaabb");
  });

  it("builds a stable event id", () => {
    expect(eventRowId(31337, "0xDEAD", 7)).toBe("31337-0xdead-7");
  });

  it("distinguishes CL positions by range and salt", () => {
    const a = clPositionRowId(1, "0xpool", "0xowner", -60, 60, "0x00");
    const b = clPositionRowId(1, "0xpool", "0xowner", -120, 120, "0x00");
    const c = clPositionRowId(1, "0xpool", "0xowner", -60, 60, "0x01");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("response provenance", () => {
  it("attaches a disclaimer to fixture-derived payloads", () => {
    const meta = metaFor("fixture");
    expect(meta.dataSource).toBe("fixture");
    expect(meta.disclaimer).toMatch(/not deployed/i);
  });

  it("does not disclaim genuine chain data", () => {
    expect(metaFor("onchain").disclaimer).toBeUndefined();
  });

  it("labels a mixed result set loudly", () => {
    expect(labelFor([{ dataSource: "FIXTURE" }, { dataSource: "ONCHAIN" }])).toBe("mixed");
    expect(metaFor("mixed").disclaimer).toBeDefined();
  });

  it("labels homogeneous result sets", () => {
    expect(labelFor([{ dataSource: "ONCHAIN" }, { dataSource: "ONCHAIN" }])).toBe("onchain");
    expect(labelFor([{ dataSource: "FIXTURE" }])).toBe("fixture");
    expect(labelFor([])).toBe("empty");
  });

  it("defaults an unlabelled row to fixture rather than onchain", () => {
    // Failing closed matters here: an unlabelled row must never be presented
    // as real protocol data.
    expect(labelFor([{}])).toBe("fixture");
  });
});

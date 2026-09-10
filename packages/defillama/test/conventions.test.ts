import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import adapter, { chainConfig, isConfigured } from "../dimension-adapters/dexs/latch.js";
import type { BaseAdapter } from "../dimension-adapters/adapters/types.js";
import { CHAIN } from "../dimension-adapters/helpers/chains.js";

const require = createRequire(import.meta.url);
const tvlConfig = require("../DefiLlama-Adapters/projects/latch/config.js");

/**
 * Guards against the two ways this package rots: drifting from DefiLlama's
 * conventions, and the two config tables disagreeing because they live in
 * different upstream repositories.
 */

describe("dimension-adapters conventions", () => {
  it("is a version 2 adapter with pullHourly set explicitly", () => {
    // AGENTS.md: "New adapters must be version: 2"; "Every version: 2 adapter must
    // explicitly set the pullHourly key."
    expect(adapter.version).toBe(2);
    expect(adapter.pullHourly).toBe(true);
  });

  it("takes a single FetchOptions argument", () => {
    // "The old v1 3-argument signature (timestamp, chainBlocks, options) no longer
    // exists and will fail."
    expect(adapter.fetch).toBeTypeOf("function");
    expect(adapter.fetch!.length).toBe(1);
  });

  it("declares methodology for every dimension it returns", () => {
    const m = adapter.methodology as Record<string, string>;
    // Keys are DISPLAY names, not code field names.
    expect(Object.keys(m).sort()).toEqual(
      ["Fees", "ProtocolRevenue", "Revenue", "SupplySideRevenue", "UserFees", "Volume"].sort(),
    );
    for (const v of Object.values(m)) expect(v.length).toBeGreaterThan(20);
  });

  it("declares breakdownMethodology for every label it emits", () => {
    const bd = adapter.breakdownMethodology as Record<string, Record<string, string>>;
    const labelsUsed = {
      Fees: "Token Swap Fees",
      UserFees: "Token Swap Fees",
      Revenue: "Swap Fees To Protocol",
      ProtocolRevenue: "Swap Fees To Protocol",
      SupplySideRevenue: "Swap Fees To Liquidity Providers",
    };
    for (const [dimension, label] of Object.entries(labelsUsed)) {
      expect(bd[dimension], `missing breakdownMethodology.${dimension}`).toBeDefined();
      expect(
        bd[dimension]![label],
        `label "${label}" used in code but absent from breakdownMethodology.${dimension}`,
      ).toBeDefined();
    }
    // and nothing declared that the code never emits
    const emitted = new Set(Object.values(labelsUsed));
    for (const [dimension, entry] of Object.entries(bd)) {
      expect(labelsUsed, `breakdownMethodology.${dimension} has no code behind it`).toHaveProperty(
        dimension,
      );
      for (const label of Object.keys(entry))
        expect(emitted, `label "${label}" declared but never emitted`).toContain(label);
    }
  });

  it("uses only DefiLlama chain slugs, and never a testnet", () => {
    const slugs = Object.values(CHAIN) as string[];
    for (const chain of Object.keys(chainConfig)) {
      expect(slugs, `${chain} is not a CHAIN enum value`).toContain(chain);
      expect(chain).toMatch(/^[a-z0-9_]+$/);
    }
    // helpers/chains.ts has no `sepolia`; the live testnet lives in the harness.
    expect(Object.keys(chainConfig)).not.toContain("sepolia");
  });

  it("exports only chains that actually have a deployment", () => {
    const exported = Object.keys(adapter.adapter ?? {});
    for (const chain of exported) expect(isConfigured(chainConfig[chain])).toBe(true);
    // Today: nothing is deployed on a mainnet, so nothing is exported. When that
    // changes this assertion is the reminder to re-check `start`.
    const configured = Object.keys(chainConfig).filter((c) => isConfigured(chainConfig[c]));
    expect(exported.sort()).toEqual(configured.sort());
  });

  it("gives every exported chain a YYYY-MM-DD start", () => {
    const exported: BaseAdapter = adapter.adapter ?? {};
    for (const [chain, cfg] of Object.entries(exported))
      expect(cfg.start, `${chain} start`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("config parity across the two upstream repos", () => {
  const fields = ["vault", "clPoolManager", "binPoolManager", "fromBlock", "start"] as const;

  it("covers exactly the same chains", () => {
    expect(Object.keys(tvlConfig.DEPLOYMENTS).sort()).toEqual(Object.keys(chainConfig).sort());
  });

  it("agrees on every address, block and start date", () => {
    for (const chain of Object.keys(chainConfig)) {
      const ts = chainConfig[chain]!;
      const js = tvlConfig.DEPLOYMENTS[chain];
      for (const f of fields)
        expect(
          normalize(js[f]),
          `${chain}.${f} differs between dexs/latch.ts and projects/latch/config.js`,
        ).toEqual(normalize(ts[f]));
    }
  });

  it("agrees on which chains are live", () => {
    for (const chain of Object.keys(chainConfig))
      expect(tvlConfig.isConfigured(chain)).toBe(isConfigured(chainConfig[chain]));
    expect(tvlConfig.enabledChains().sort()).toEqual(Object.keys(adapter.adapter ?? {}).sort());
  });
});

const normalize = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

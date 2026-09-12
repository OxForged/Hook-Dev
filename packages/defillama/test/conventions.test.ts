import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import adapter, {
  LATCH_TEST_TOKENS,
  chainConfig,
  isConfigured,
} from "../dimension-adapters/dexs/latch.js";
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
    const configured = Object.keys(chainConfig).filter((c) => isConfigured(chainConfig[c]));
    expect(exported.sort()).toEqual(configured.sort());
  });

  it("exports exactly the one live mainnet, Robinhood Chain, with its real addresses", () => {
    // Pinned on purpose. Adding a chain here is a deliberate act that should
    // fail this test until the new row is acknowledged; a placeholder row that
    // accidentally satisfies isConfigured() must not slip into the export.
    expect(Object.keys(adapter.adapter ?? {})).toEqual([CHAIN.ROBINHOOD]);
    const r = chainConfig[CHAIN.ROBINHOOD]!;
    expect(r.vault).toBe("0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c");
    expect(r.clPoolManager).toBe("0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66");
    expect(r.binPoolManager).toBe("0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979");
    for (const a of [r.vault, r.clPoolManager, r.binPoolManager])
      expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(r.fromBlock).toBe(60124455);
    expect(r.start).toBe("2026-09-11");
  });

  it("excludes Latch's test tokens on Robinhood and never a priced asset", () => {
    const bl = (chainConfig[CHAIN.ROBINHOOD]!.blacklistTokens ?? []).map((t) => t.toLowerCase());
    for (const t of LATCH_TEST_TOKENS[CHAIN.ROBINHOOD]!)
      expect(bl, `${t} (test token) must be excluded`).toContain(t.toLowerCase());
    // The real assets on the chain must never end up on the list by accident:
    // excluding them would silently zero any future WETH/USDG pool.
    const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
    const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
    expect(bl).not.toContain(WETH);
    expect(bl).not.toContain(USDG);
    expect(bl).not.toContain("0x0000000000000000000000000000000000000000");
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
    // Not vacuous: at least one chain must be live for the parity above to have
    // compared anything but empty strings.
    expect(tvlConfig.enabledChains().length).toBeGreaterThan(0);
  });

  it("agrees on the excluded test tokens, chain by chain", () => {
    // Same list in both repos: LATCH_TEST_TOKENS here, LATCH_TEST_TOKENS there.
    // A test token excluded from volume but counted in TVL (or the reverse)
    // would be the two adapters disagreeing about whether a token has value.
    expect(Object.keys(tvlConfig.LATCH_TEST_TOKENS).sort()).toEqual(
      Object.keys(LATCH_TEST_TOKENS).sort(),
    );
    for (const chain of Object.keys(LATCH_TEST_TOKENS)) {
      const ts = LATCH_TEST_TOKENS[chain]!.map(normalize).sort();
      const js = (tvlConfig.LATCH_TEST_TOKENS[chain] as string[]).map(normalize).sort();
      expect(js, `${chain} test-token list differs`).toEqual(ts);
      // and each side actually applies its own list
      expect(tvlConfig.blacklistedTokens(chain).sort()).toEqual(js);
      const dex = (chainConfig[chain]!.blacklistTokens ?? []).map(normalize);
      for (const t of ts) expect(dex).toContain(t);
    }
  });

  it("agrees on the chain id where the TVL config carries one", () => {
    // Only the TVL side stores chainId. Pin the one live chain so the slug and
    // the id cannot drift apart: "robinhood" is 4663 and nothing else.
    expect(tvlConfig.DEPLOYMENTS[CHAIN.ROBINHOOD].chainId).toBe(4663);
  });
});

const normalize = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

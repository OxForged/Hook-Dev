import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Offline tests for `DefiLlama-Adapters/projects/latch/index.js` - the exact
 * CommonJS file that ships - driven by SYNTHETIC Initialize logs.
 *
 * Two behaviours are pinned here because getting either wrong produces a number
 * that looks right:
 *
 *   1. A token on the chain's exclusion list never reaches a balance call. Not
 *      "is read and then valued at zero" - never read. On Robinhood the only
 *      pool is LTT1/LTT2, so with this rule the adapter must ask the Vault about
 *      nothing at all.
 *   2. The hook a pool's balances are summed against is the one in THAT pool's
 *      Initialize log. `poolKey.hooks` is part of the pool id, so a pool created
 *      with a since-retired hook is still bound to it, and an adapter that read
 *      a "current hook" address would miss that pool's hook balance forever.
 *
 * The helper stubs are replaced through `require.cache` before index.js is
 * evaluated, so no RPC is touched. Every address and number below is invented.
 */

const require = createRequire(import.meta.url);
const TVL_DIR = "../DefiLlama-Adapters/projects/latch";
const HELPER = "../DefiLlama-Adapters/projects/helper";

const CL = "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66"; // the real Robinhood CL manager
const BIN = "0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979"; // and Bin manager
const VAULT = "0x78e8359c6d34df797b8a793de8c7c6bffa97fb6c";

const LTT1 = "0x2a21c0826848f2d597b7c87a4b931de1407958a6";
const LTT2 = "0xa29927045bdffd61b8f539d491085f1b6f7a8be4";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const NATIVE = "0x0000000000000000000000000000000000000000";

const RETIRED_HOOK = "0x23ce34e8199927dd270dddd8579c947542bde446";
const CURRENT_HOOK = "0xfc00485afb2f9c73bd7f9f5e72d14709233e2ad2";

type InitLog = { id: string; currency0: string; currency1: string; hooks: string };

interface Captured {
  logQueries: Array<{ target: string; fromBlock: number; eventAbi: string }>;
  sumArgs: any;
}

function loadAdapterWith(logsByTarget: Record<string, InitLog[]>): {
  adapter: any;
  captured: Captured;
} {
  const captured: Captured = { logQueries: [], sumArgs: undefined };

  const seed = (rel: string, exportsObj: unknown) => {
    const path = require.resolve(rel);
    delete require.cache[path];
    require.cache[path] = {
      id: path,
      filename: path,
      loaded: true,
      exports: exportsObj,
    } as any;
  };

  seed(`${HELPER}/cache/getLogs`, {
    getLogs2: async ({ target, fromBlock, eventAbi }: any) => {
      captured.logQueries.push({ target, fromBlock, eventAbi });
      return logsByTarget[target.toLowerCase()] ?? [];
    },
  });
  seed(`${HELPER}/unwrapLPs`, {
    sumTokens2: async (args: any) => {
      captured.sumArgs = args;
      return {};
    },
  });

  for (const rel of [`${TVL_DIR}/config.js`, `${TVL_DIR}/index.js`])
    delete require.cache[require.resolve(rel)];
  const adapter = require(`${TVL_DIR}/index.js`);
  return { adapter, captured };
}

const api = { chain: "robinhood" };

/** Flatten sumTokens2's ownerTokens into [token, owner] pairs, lower-cased. */
const pairs = (sumArgs: any): Array<[string, string]> =>
  (sumArgs.ownerTokens as Array<[string[], string]>).flatMap(([tokens, owner]) =>
    tokens.map((t) => [t.toLowerCase(), owner.toLowerCase()] as [string, string]),
  );

beforeEach(() => {
  // Each test seeds its own stubs; make sure no stale module survives.
  for (const rel of [
    `${HELPER}/cache/getLogs`,
    `${HELPER}/unwrapLPs`,
    `${TVL_DIR}/config.js`,
    `${TVL_DIR}/index.js`,
  ])
    delete require.cache[require.resolve(rel)];
});

describe("TVL adapter: excluded test tokens", () => {
  it("never asks the Vault about a pool made only of excluded tokens", async () => {
    // The real Robinhood situation: one CL pool, LTT1/LTT2, on the retired hook.
    const { adapter, captured } = loadAdapterWith({
      [CL.toLowerCase()]: [
        { id: "0x" + "aa".repeat(32), currency0: LTT1, currency1: LTT2, hooks: RETIRED_HOOK },
      ],
    });
    await adapter.robinhood.tvl(api);

    expect(pairs(captured.sumArgs)).toEqual([]);
    // and the same list is handed to upstream's own filter
    expect(captured.sumArgs.blacklistedTokens.map((t: string) => t.toLowerCase()).sort()).toEqual(
      [LTT1, LTT2].sort(),
    );
    expect(captured.sumArgs.permitFailure).toBe(true);
  });

  it("keeps the priced leg of a mixed pool and drops the excluded one", async () => {
    const { adapter, captured } = loadAdapterWith({
      [CL.toLowerCase()]: [
        { id: "0x" + "bb".repeat(32), currency0: WETH, currency1: LTT1, hooks: NATIVE },
      ],
    });
    await adapter.robinhood.tvl(api);
    expect(pairs(captured.sumArgs)).toEqual([[WETH, VAULT]]);
  });

  it("counts a real pair in full, native currency as the zero address", async () => {
    const { adapter, captured } = loadAdapterWith({
      [CL.toLowerCase()]: [
        { id: "0x" + "cc".repeat(32), currency0: NATIVE, currency1: USDG, hooks: NATIVE },
      ],
      [BIN.toLowerCase()]: [
        { id: "0x" + "dd".repeat(32), currency0: WETH, currency1: USDG, hooks: NATIVE },
      ],
    });
    await adapter.robinhood.tvl(api);
    expect(pairs(captured.sumArgs).sort()).toEqual(
      (
        [
          [NATIVE, VAULT],
          [USDG, VAULT],
          [WETH, VAULT],
        ] as Array<[string, string]>
      ).sort(),
    );
  });
});

describe("TVL adapter: hooks come from the pool's own log", () => {
  it("sums a pool's pair against the hook it was created with, retired or not", async () => {
    const { adapter, captured } = loadAdapterWith({
      [CL.toLowerCase()]: [
        // an old pool still bound to the retired RevShareHook
        { id: "0x" + "01".repeat(32), currency0: WETH, currency1: USDG, hooks: RETIRED_HOOK },
        // a newer pool on the current one
        { id: "0x" + "02".repeat(32), currency0: NATIVE, currency1: USDG, hooks: CURRENT_HOOK },
      ],
    });
    await adapter.robinhood.tvl(api);
    const p = pairs(captured.sumArgs);

    expect(p).toContainEqual([WETH, RETIRED_HOOK]);
    expect(p).toContainEqual([USDG, RETIRED_HOOK]);
    expect(p).toContainEqual([NATIVE, CURRENT_HOOK]);
    expect(p).toContainEqual([USDG, CURRENT_HOOK]);
    // the retired hook is not summed for the pool it never had
    expect(p).not.toContainEqual([NATIVE, RETIRED_HOOK]);
    // and the Vault is asked about each token exactly once
    expect(p.filter(([, o]) => o === VAULT).sort()).toEqual(
      (
        [
          [NATIVE, VAULT],
          [USDG, VAULT],
          [WETH, VAULT],
        ] as Array<[string, string]>
      ).sort(),
    );
  });

  it("does not sum an excluded-only pool against its hook either", async () => {
    const { adapter, captured } = loadAdapterWith({
      [CL.toLowerCase()]: [
        { id: "0x" + "03".repeat(32), currency0: LTT1, currency1: LTT2, hooks: RETIRED_HOOK },
      ],
    });
    await adapter.robinhood.tvl(api);
    expect(pairs(captured.sumArgs).some(([, o]) => o === RETIRED_HOOK)).toBe(false);
  });
});

describe("TVL adapter: log query discipline", () => {
  it("scans each pool manager from the configured floor with its own Initialize ABI", async () => {
    const { adapter, captured } = loadAdapterWith({});
    await adapter.robinhood.tvl(api);

    expect(captured.logQueries.map((q) => q.target)).toEqual([CL, BIN]);
    for (const q of captured.logQueries) expect(q.fromBlock).toBe(60124455);
    const [cl, bin] = captured.logQueries;
    expect(cl!.eventAbi).toContain("uint160 sqrtPriceX96, int24 tick)");
    expect(bin!.eventAbi).toContain("uint24 activeId)");
    // No pools -> nothing to sum, but sumTokens2 is still called with an empty
    // list so the result is a real (empty) read rather than a skipped one.
    expect(pairs(captured.sumArgs)).toEqual([]);
  });
});

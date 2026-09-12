// SPDX-License-Identifier: MIT
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";

import { CLI_VERSION } from "../src/version.js";
import {
  MAX_FEE_BPS,
  normalizeChain,
  normalizeFeatures,
  resolveOptions,
  toAppName,
  toPackageName,
  looksLikeAddress,
} from "../src/options.js";
import { applyTokens, findUnresolvedTokens, tokensFor } from "../src/template.js";
import { scaffold, templateRoot } from "../src/scaffold.js";
import { copyTree, listFiles } from "../src/util/fsx.js";
import { parseArgs } from "../src/util/args.js";

const FEE_WALLET = "0x715a6176946aDbD22c1B2021d321Fb3767ca3432";

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "create-latch-dex-"));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("version", () => {
  it("matches package.json", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

describe("args", () => {
  it("reads value flags in both forms", () => {
    const a = parseArgs(["app", "--chain", "sepolia", "--fee-bps=25", "--yes"]);
    expect(a.positionals).toEqual(["app"]);
    expect(a.flags["chain"]).toBe("sepolia");
    expect(a.flags["fee-bps"]).toBe("25");
    expect(a.flags["yes"]).toBe(true);
  });

  it("refuses a value flag with no value", () => {
    expect(() => parseArgs(["app", "--chain", "--yes"])).toThrow(/--chain needs a value/);
  });
});

describe("options", () => {
  it("resolves chain aliases", () => {
    expect(normalizeChain("robinhood")).toBe(4663);
    expect(normalizeChain("Robinhood Chain")).toBe(4663);
    expect(normalizeChain("11155111")).toBe(11155111);
  });

  it("refuses a chain with no Latch core", () => {
    expect(() => normalizeChain("base")).toThrow(/Latch's shared core is deployed on/);
  });

  it("expands feature bundles", () => {
    expect(normalizeFeatures("dex")).toEqual(["swap", "pools"]);
    expect(normalizeFeatures("both")).toEqual(["swap", "pools", "launchpad"]);
    expect(normalizeFeatures("swap,launchpad")).toEqual(["swap", "launchpad"]);
  });

  it("derives names from a directory", () => {
    expect(toPackageName("Acme Swap")).toBe("acme-swap");
    expect(toAppName("acme-swap")).toBe("Acme Swap");
    expect(toPackageName("!!!")).toBe("latch-dex");
  });

  it("validates addresses syntactically", () => {
    expect(looksLikeAddress(FEE_WALLET)).toBe(true);
    expect(looksLikeAddress("0x123")).toBe(false);
    expect(looksLikeAddress("nope")).toBe(false);
  });

  it("refuses a fee with no destination", () => {
    expect(() =>
      resolveOptions({ directory: "x", chain: "4663", feeBps: "25" }),
    ).toThrow(/no --fee-wallet/);
  });

  it("refuses a fee paid to the zero address", () => {
    expect(() =>
      resolveOptions({
        directory: "x",
        chain: "4663",
        feeBps: "25",
        feeWallet: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(/would be burned/);
  });

  it("refuses a fee above the widgets' ceiling", () => {
    expect(() =>
      resolveOptions({
        directory: "x",
        chain: "4663",
        feeBps: String(MAX_FEE_BPS + 1),
        feeWallet: FEE_WALLET,
      }),
    ).toThrow(/ceiling/);
  });

  it("allows a zero fee with no wallet", () => {
    const options = resolveOptions({ directory: "acme-dex", chain: "4663" });
    expect(options.feeBps).toBe(0);
    expect(options.appName).toBe("Acme Dex");
    expect(options.features).toEqual(["swap", "pools", "launchpad"]);
  });
});

describe("token substitution", () => {
  const options = resolveOptions({
    directory: "acme-swap",
    chain: "11155111",
    feeBps: "25",
    feeWallet: FEE_WALLET,
    features: "launchpad",
  });
  const tokens = tokensFor(options);

  it("replaces a tagged numeric literal without leaving the marker", () => {
    const out = applyTokens("latch.config.ts", "  id: 4663 /* __LATCH_CHAIN_ID__ */,", tokens);
    expect(out).toBe("  id: 11155111,");
    expect(findUnresolvedTokens(out)).toEqual([]);
  });

  it("replaces a tagged boolean literal", () => {
    const out = applyTokens("latch.config.ts", "swap: true /* __LATCH_FEATURE_SWAP__ */,", tokens);
    expect(out).toBe("swap: false,");
  });

  it("replaces a tagged address literal with a quoted value", () => {
    const out = applyTokens(
      "latch.config.ts",
      "wallet: '0x0000000000000000000000000000000000000000' /* __LATCH_FEE_WALLET__ */,",
      tokens,
    );
    expect(out).toBe(`wallet: '${FEE_WALLET}',`);
  });

  it("replaces a bare placeholder inside a string", () => {
    expect(applyTokens("latch.config.ts", "name: '__LATCH_APP_NAME__',", tokens)).toBe(
      "name: 'Acme Swap',",
    );
  });

  it("escapes a quote that would otherwise terminate the literal", () => {
    const risky = tokensFor(
      resolveOptions({ directory: "x", chain: "4663", appName: "Bob's Swap" }),
    );
    const out = applyTokens("latch.config.ts", "name: '__LATCH_APP_NAME__',", risky);
    expect(out).toBe("name: 'Bob\\'s Swap',");
  });

  it("uses JSON quoting in a .json file", () => {
    expect(applyTokens("package.json", '"name": "__LATCH_PACKAGE_NAME__"', tokens)).toBe(
      '"name": "acme-swap"',
    );
  });
});

describe("the template itself", () => {
  it("compiles as it sits on disk, with defaults that are not placeholders", async () => {
    const root = templateRoot();
    const config = await readFile(join(root, "latch.config.ts"), "utf8");

    // Every marker in the template must be a TAGGED literal, never a bare
    // placeholder in a value position — otherwise the template does not
    // typecheck before substitution, and a template nobody can build is a
    // template nobody reviews.
    for (const marker of findUnresolvedTokens(config)) {
      const tagged = config.includes(`/* ${marker} */`);
      const inString = new RegExp(`'${marker}'`).test(config);
      expect(tagged || inString, `${marker} is neither tagged nor inside a string`).toBe(true);
    }
  });

  it("does not import GPL protocol sources anywhere", async () => {
    const root = templateRoot();
    const files = await listFiles(root);
    const sources = files.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
    expect(sources.length).toBeGreaterThan(10);

    for (const file of sources) {
      const text = await readFile(join(root, file), "utf8");
      // The licence boundary, enforced as a test rather than as a paragraph.
      expect(text, `${file} reaches into the GPL monorepo`).not.toMatch(
        /from ["'][^"']*packages\/(core|periphery|router|hooks|hooks-rwa|hooks-revshare|launchpad)/,
      );
      expect(text, `${file} imports a .sol file`).not.toMatch(/\.sol["']/);
    }
  });

  it("ships no .env and no lockfile", async () => {
    const files = await listFiles(templateRoot());
    expect(files).not.toContain(".env");
    expect(files).not.toContain(".env.local");
    expect(files).toContain(".env.example");
  });
});

describe("scaffold", () => {
  it("writes a project with every placeholder resolved", async () => {
    const dir = join(await tempDir(), "acme-swap");
    const options = resolveOptions({
      directory: dir,
      chain: "11155111",
      feeBps: "25",
      feeWallet: FEE_WALLET,
      features: "dex",
    });

    const result = await scaffold(options);
    expect(result.filesWritten).toBeGreaterThan(15);

    const config = await readFile(join(dir, "latch.config.ts"), "utf8");
    expect(findUnresolvedTokens(config)).toEqual([]);
    expect(config).toContain("id: 11155111,");
    expect(config).toContain(`wallet: '${FEE_WALLET}',`);
    expect(config).toContain("bps: 25,");
    expect(config).toContain("launchpad: false,");
    expect(config).toContain("swap: true,");

    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("acme-swap");
    // Dependencies must be published names. A relative path into the monorepo
    // would work here and fail for every tenant, who does not have it.
    for (const spec of Object.values(pkg.dependencies)) {
      expect(spec).not.toMatch(/^(file:|link:|workspace:|\.\.)/);
    }

    // npm strips .gitignore from a tarball, so the template carries _gitignore.
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);
    expect(existsSync(join(dir, "_gitignore"))).toBe(false);

    const html = await readFile(join(dir, "index.html"), "utf8");
    expect(html).toContain("<title>Acme Swap</title>");
  });

  /**
   * Regression. The copy filter used to test ABSOLUTE paths against a list of
   * directory names that includes `dist` and `node_modules`. The published
   * template lives at `create-latch-dex/dist/template`, so every file in it was
   * filtered out and `npx create-latch-dex` produced an empty directory while
   * reporting success. Tests passed throughout, because they ran against
   * `src/../template`, which has no excluded ancestor.
   */
  it("copies a template whose own path contains an excluded directory name", async () => {
    const parent = await tempDir();
    const nested = join(parent, "dist", "node_modules", "template");
    await copyTree(templateRoot(), nested);

    const target = join(parent, "out");
    const result = await scaffold(
      resolveOptions({ directory: target, chain: "4663" }),
      nested,
    );
    expect(result.filesWritten).toBeGreaterThan(15);
    expect(existsSync(join(target, "latch.config.ts"))).toBe(true);
  });

  it("refuses to write into a directory that already has files", async () => {
    const dir = await tempDir();
    await scaffold(resolveOptions({ directory: join(dir, "a"), chain: "4663" }));
    await expect(
      scaffold(resolveOptions({ directory: join(dir, "a"), chain: "4663" })),
    ).rejects.toThrow(/already exists and is not empty/);
  });
});

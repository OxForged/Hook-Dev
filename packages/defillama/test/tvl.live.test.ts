import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Rpc } from "../harness/rpc.js";
import { SEPOLIA, SEPOLIA_MAX_BLOCK_RANGE, SEPOLIA_RPC } from "../harness/sepolia.js";

/**
 * Runs the TVL adapter file itself - `DefiLlama-Adapters/projects/latch/index.js`,
 * the exact CommonJS file that would be submitted - against the live Sepolia
 * deployment, through the harness stubs in `projects/helper/`.
 *
 * The point is the singleton premise: TVL is the Vault's balances. That is asserted
 * two ways here - the adapter's own output is compared against a direct `balanceOf`
 * on the Vault, and both pool managers are checked to hold nothing at all.
 *
 * Balances are raw token units of two testnet tokens nobody prices. Nothing in this
 * file is a USD figure or a production metric.
 */

const require = createRequire(import.meta.url);
const TVL_DIR = "../DefiLlama-Adapters/projects/latch";

const LTUSD = "0x5c00ea81eedced610c5174b9d20f83ca245e269c";
const LTETH = "0xbef6e0f94fe1a96390eb25d32759aad85fd1f067";

const rpc = new Rpc({ url: SEPOLIA_RPC, maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE });
const skip = process.env["LATCH_SKIP_LIVE"] === "1";

const reachable = await (async () => {
  if (skip) return false;
  try {
    return Number(await rpc.call<string>("eth_chainId", [])) === SEPOLIA.chainId;
  } catch {
    return false;
  }
})();

describe("TVL adapter export shape", () => {
  it("exports exactly Robinhood Chain and nothing without contracts", () => {
    // Loaded fresh, before the harness injects Sepolia. An adapter that exported a
    // chain with no contracts would publish $0 as a fact; one that omitted the
    // live chain would publish nothing about a real deployment.
    const config = require(`${TVL_DIR}/config.js`);
    expect(config.enabledChains()).toEqual(["robinhood"]);

    const adapter = require(`${TVL_DIR}/index.js`);
    expect(Object.keys(adapter).sort()).toEqual(["methodology", "robinhood"]);
    expect(adapter.methodology).toMatch(/Vault/);
    expect(adapter.methodology).toMatch(/LTT1\/LTT2/);
    expect(adapter.robinhood.start).toBe("2026-09-11");
    expect(adapter.robinhood.tvl).toBeTypeOf("function");
  });
});

describe.skipIf(!reachable)("TVL adapter against live Sepolia", () => {
  it("counts the Vault's balances and nothing on the pool managers", async () => {
    const { makeApi } = require("../DefiLlama-Adapters/_harness/chainApi.js");
    const config = require(`${TVL_DIR}/config.js`);

    // Inject the testnet the same way the dimension harness does: never from the
    // adapter, only from here. Must happen before index.js is evaluated, because
    // that is when it reads enabledChains().
    config.DEPLOYMENTS["sepolia"] = {
      chainId: SEPOLIA.chainId,
      vault: SEPOLIA.vault,
      clPoolManager: SEPOLIA.clPoolManager,
      binPoolManager: SEPOLIA.binPoolManager,
      protocolFeeController: SEPOLIA.protocolFeeController,
      fromBlock: SEPOLIA.fromBlock,
      start: SEPOLIA.start,
    };
    expect(config.enabledChains().sort()).toEqual(["robinhood", "sepolia"]);

    // index.js builds its chain exports at evaluation time, and the shape test
    // above already loaded it with an empty chain list. Drop it from the require
    // cache so it is re-evaluated against the injected config.
    delete require.cache[require.resolve(`${TVL_DIR}/index.js`)];
    const adapter = require(`${TVL_DIR}/index.js`);
    expect(adapter["sepolia"]).toBeDefined();
    expect(adapter["sepolia"].start).toBe("2026-09-10");

    const api = makeApi({
      chain: "sepolia",
      rpcUrl: SEPOLIA_RPC,
      maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE,
    });
    await adapter["sepolia"].tvl(api);
    const balances = api.getBalances();

    // Token discovery came from Initialize logs on both pool managers; only the CL
    // manager has a pool, and its pair is ltUSD/ltETH.
    expect(Object.keys(balances).sort()).toEqual([LTUSD, LTETH].sort());

    // The adapter's numbers must be the Vault's actual ERC20 balances.
    for (const token of [LTUSD, LTETH]) {
      const onChain = await balanceOf(token, SEPOLIA.vault);
      expect(balances[token], `${token} does not match the Vault balance`).toBe(onChain);
      expect(onChain).toBeGreaterThan(0n);

      // The singleton premise: pool managers are accounting apps, not custodians.
      expect(await balanceOf(token, SEPOLIA.clPoolManager)).toBe(0n);
      expect(await balanceOf(token, SEPOLIA.binPoolManager)).toBe(0n);
    }
  });
});

describe.skipIf(reachable)("TVL adapter against live Sepolia (skipped)", () => {
  it("was skipped because the RPC was unreachable or LATCH_SKIP_LIVE=1", () => {
    expect(reachable).toBe(false);
  });
});

async function balanceOf(token: string, owner: string): Promise<bigint> {
  const res = await rpc.call<string>("eth_call", [
    { to: token, data: "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0") },
    "latest",
  ]);
  return BigInt(res);
}

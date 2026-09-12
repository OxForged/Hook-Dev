import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import adapter, { CL_INITIALIZE_EVENT, CL_SWAP_EVENT, chainConfig } from "../dimension-adapters/dexs/latch.js";
import { Balances } from "../harness/balances.js";
import { makeGetLogs, Rpc } from "../harness/rpc.js";
import { runFetch } from "../harness/runFetch.js";
import {
  ROBINHOOD,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_KEY,
  ROBINHOOD_DEPLOY_BLOCKS,
  ROBINHOOD_MAX_BLOCK_RANGE,
  ROBINHOOD_PROTOCOL_FEE_CONTROLLER,
  ROBINHOOD_REVSHARE_HOOKS,
  ROBINHOOD_RPC,
  ROBINHOOD_TOKENS,
} from "../harness/robinhood.js";

/**
 * Runs against the LIVE Robinhood Chain deployment - the first mainnet - over a
 * public RPC, using the adapter's real config row (nothing injected).
 *
 * The window is FIXED and historical: blocks 60244104-60244176 hold the only
 * pool's `Initialize` and the only two swaps that existed when this was written
 * (2026-09-12). Later activity cannot change these assertions.
 *
 * What this proves, on a mainnet:
 *
 *   - the premises the adapters' text makes claims about are true on chain:
 *     both managers are registered apps, and the fee-controller wiring is a
 *     consistent governance state (both managers agree; a set controller has
 *     code and a fee within MAX_PROTOCOL_FEE). Its VALUE is deliberately not
 *     asserted: it changed from address(0) to the LatchProtocolFeeController
 *     between two reads while this file was being written, and the adapter does
 *     not depend on it - it reads the rate each swap carried;
 *   - the event signatures decode real mainnet logs, and both swaps to date
 *     carry `protocolFee == 0` - so "Revenue is zero here" is read, not assumed;
 *   - the one pool is bound to the RETIRED RevShareHook, which is why the TVL
 *     adapter takes the hook from the log and not from a constant;
 *   - the submitted adapters report NOTHING for this window, and the reason is
 *     the deliberate exclusion of LTT1/LTT2 - shown by lifting the exclusion and
 *     reproducing the raw on-chain amounts to the wei;
 *   - token decimals are what the config assumes (USDG is 6, not 18).
 *
 * What it does NOT prove: any USD figure. There is no price feed here.
 *
 * The endpoint meters a per-minute quota; `harness/rpc.ts` waits it out. A run
 * takes roughly a minute. Skipped when LATCH_SKIP_LIVE=1 or the RPC is
 * unreachable - a flaky endpoint must not fail the suite, and must never be
 * mistaken for a pass.
 */

const POOL_ID = "0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8";
const INIT_BLOCK = 60_244_104;
const WINDOW_FROM = INIT_BLOCK;
const WINDOW_TO = 60_244_176;

const LTT1 = ROBINHOOD_TOKENS.LTT1.address.toLowerCase();
const LTT2 = ROBINHOOD_TOKENS.LTT2.address.toLowerCase();

/**
 * The two swaps, read on 2026-09-12:
 *
 *   block 60244152  amount0 -1000000000000000000  amount1  +996006981039903216
 *   block 60244176  amount0  +997993017974011107  amount1 -1000000000000000000
 *   both:           fee 3000   protocolFee 0
 *
 * Neither LTT is a core asset, so `addOneToken` prices off currency1 (LTT2) and
 * books |amount1| per swap - when the exclusion is lifted.
 */
const LEG = [996_006_981_039_903_216n, 1_000_000_000_000_000_000n];
const sum = (f: (x: bigint) => bigint) => LEG.reduce((a, x) => a + f(x), 0n);
const EXPECTED_IF_COUNTED = {
  volume: sum((x) => x),
  fees: sum((x) => (x * 3000n) / 1_000_000n),
};

const skip = process.env["LATCH_SKIP_LIVE"] === "1";
const rpc = new Rpc({ url: ROBINHOOD_RPC, maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE });

/**
 * Each adapter run scans Initialize from `fromBlock` to the window in 10 000-block
 * pages - 12 per manager - under a per-minute quota shared with whoever else is
 * using the public endpoint. Measured at 1-2 minutes per run; allow ten before
 * calling it a failure, so a slow quota is never reported as a wrong number.
 */
const HEAVY_TIMEOUT = 600_000;

const reachable = await (async () => {
  if (skip) return false;
  try {
    return Number(await rpc.call<string>("eth_chainId", [])) === ROBINHOOD_CHAIN_ID;
  } catch {
    return false;
  }
})();

const word = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");
const call = (to: string, data: string) => rpc.call<string>("eth_call", [{ to, data }, "latest"]);
const balanceOf = async (token: string, owner: string) =>
  BigInt(await call(token, "0x70a08231" + word(owner)));

describe.skipIf(!reachable)("live Robinhood Chain deployment", () => {
  it("is the adapter's own row: real code at every address, both managers registered", async () => {
    for (const [name, address] of Object.entries({
      vault: ROBINHOOD.vault,
      clPoolManager: ROBINHOOD.clPoolManager,
      binPoolManager: ROBINHOOD.binPoolManager,
      protocolFeeController: ROBINHOOD_PROTOCOL_FEE_CONTROLLER,
    })) {
      const code = await rpc.call<string>("eth_getCode", [address, "latest"]);
      expect(code, `${name} has no code`).not.toBe("0x");
    }
    // Vault.isAppRegistered(address) -> 0x8403be91
    for (const manager of [ROBINHOOD.clPoolManager, ROBINHOOD.binPoolManager])
      expect(BigInt(await call(ROBINHOOD.vault, "0x8403be91" + word(manager)))).toBe(1n);
  });

  it("reads a consistent fee-controller wiring, without asserting what governance chose", async () => {
    // protocolFeeController() -> 0xf02de3b2. Governance state: it went from
    // address(0) to the LatchProtocolFeeController on 2026-09-12 between two
    // reads fifteen minutes apart. The adapter never reads it - Revenue comes
    // from each swap's own `protocolFee` - so this test checks only that the
    // state is coherent, not that it has any particular value.
    const controllers = await Promise.all(
      [ROBINHOOD.clPoolManager, ROBINHOOD.binPoolManager].map(async (m) =>
        ("0x" + (await call(m, "0xf02de3b2")).slice(-40)).toLowerCase(),
      ),
    );
    expect(controllers[0], "CL and Bin managers point at different controllers").toBe(controllers[1]);

    const controller = controllers[0]!;
    if (controller !== "0x" + "0".repeat(40)) {
      expect(await rpc.call<string>("eth_getCode", [controller, "latest"])).not.toBe("0x");
      // defaultFee() -> 0x5a6c72d0 returning (bool isSet, uint16 zeroForOne, uint16 oneForZero).
      // Whatever governance set, it cannot exceed ProtocolFeeLibrary.MAX_PROTOCOL_FEE.
      const words = (await call(controller, "0x5a6c72d0")).slice(2).match(/.{64}/g)!;
      expect(BigInt("0x" + words[1]!)).toBeLessThanOrEqual(4000n);
      expect(BigInt("0x" + words[2]!)).toBeLessThanOrEqual(4000n);
    }
  });

  it("has the pool managers where fromBlock says, and nothing earlier", async () => {
    const codeAt = async (a: string, b: number) =>
      (await rpc.call<string>("eth_getCode", [a, "0x" + b.toString(16)])) !== "0x";
    expect(ROBINHOOD.fromBlock).toBe(ROBINHOOD_DEPLOY_BLOCKS.clPoolManager);
    expect(await codeAt(ROBINHOOD.clPoolManager, ROBINHOOD.fromBlock)).toBe(true);
    expect(await codeAt(ROBINHOOD.clPoolManager, ROBINHOOD.fromBlock - 1)).toBe(false);
    expect(await codeAt(ROBINHOOD.binPoolManager, ROBINHOOD_DEPLOY_BLOCKS.binPoolManager)).toBe(true);
    expect(await codeAt(ROBINHOOD.binPoolManager, ROBINHOOD_DEPLOY_BLOCKS.binPoolManager - 1)).toBe(
      false,
    );
  });

  it("reports the token decimals the config depends on", async () => {
    for (const [symbol, t] of Object.entries(ROBINHOOD_TOKENS)) {
      // decimals() -> 0x313ce567
      expect(BigInt(await call(t.address, "0x313ce567")), `${symbol} decimals`).toBe(
        BigInt(t.decimals),
      );
    }
  });

  it("finds one pool, bound to the RETIRED RevShareHook, in test tokens only", async () => {
    const getLogs = makeGetLogs(rpc, INIT_BLOCK, INIT_BLOCK);
    const logs = await getLogs({ target: ROBINHOOD.clPoolManager, eventAbi: CL_INITIALIZE_EVENT });
    expect(logs).toHaveLength(1);
    const init = logs[0]!;
    expect(String(init.id).toLowerCase()).toBe(POOL_ID);
    expect(String(init.currency0).toLowerCase()).toBe(LTT1);
    expect(String(init.currency1).toLowerCase()).toBe(LTT2);
    expect(String(init.hooks).toLowerCase()).toBe(ROBINHOOD_REVSHARE_HOOKS.retired.toLowerCase());
    expect(String(init.hooks).toLowerCase()).not.toBe(ROBINHOOD_REVSHARE_HOOKS.current.toLowerCase());
    expect(Number(init.fee)).toBe(3000);
  });

  it("decodes real mainnet swaps, each with protocolFee == 0", async () => {
    const getLogs = makeGetLogs(rpc, WINDOW_FROM, WINDOW_TO);
    const logs = await getLogs({ target: ROBINHOOD.clPoolManager, eventAbi: CL_SWAP_EVENT });
    // A wrong signature returns an empty array, which a laxer test would accept.
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(BigInt(log.fee)).toBe(3000n);
      // The whole fee is the LP fee: this pool was initialized before any
      // controller was wired, so its protocol fee is 0 and fee == lpFee exactly.
      expect(BigInt(log.protocolFee)).toBe(0n);
      const a0 = BigInt(log.amount0);
      const a1 = BigInt(log.amount1);
      expect(a0 < 0n !== a1 < 0n).toBe(true);
    }
    expect(BigInt(logs[0]!.amount1)).toBe(LEG[0]!);
    expect(BigInt(logs[1]!.amount1)).toBe(-LEG[1]!);
  });

  it("reports nothing for this window - the exclusion of LTT1/LTT2 is doing exactly that", async () => {
    const result = await runFetch(adapter.fetch!, {
      chain: ROBINHOOD_CHAIN_KEY,
      rpcUrl: ROBINHOOD_RPC,
      fromBlock: WINDOW_FROM,
      toBlock: WINDOW_TO,
      maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE,
    });
    for (const key of [
      "dailyVolume",
      "dailyFees",
      "dailyUserFees",
      "dailyRevenue",
      "dailyProtocolRevenue",
      "dailySupplySideRevenue",
    ])
      expect((result[key] as Balances).isEmpty(), `${key} should be empty`).toBe(true);
  }, HEAVY_TIMEOUT);

  describe("with the exclusion lifted (proves the arithmetic, never shipped)", () => {
    const saved = chainConfig[ROBINHOOD_CHAIN_KEY]!.blacklistTokens;
    afterEach(() => {
      chainConfig[ROBINHOOD_CHAIN_KEY]!.blacklistTokens = saved;
    });

    it("reproduces the on-chain amounts to the wei, with zero protocol revenue", async () => {
      chainConfig[ROBINHOOD_CHAIN_KEY]!.blacklistTokens = [];
      const result = await runFetch(adapter.fetch!, {
        chain: ROBINHOOD_CHAIN_KEY,
        rpcUrl: ROBINHOOD_RPC,
        fromBlock: WINDOW_FROM,
        toBlock: WINDOW_TO,
        maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE,
      });
      const totals = (key: string) => (result[key] as Balances).totals();

      expect(totals("dailyVolume")).toEqual({ [LTT2]: EXPECTED_IF_COUNTED.volume });
      expect(totals("dailyFees")).toEqual({ [LTT2]: EXPECTED_IF_COUNTED.fees });
      expect(totals("dailySupplySideRevenue")).toEqual({ [LTT2]: EXPECTED_IF_COUNTED.fees });
      // Revenue is a real zero read from `protocolFee`, present as an entry of 0.
      expect((result["dailyRevenue"] as Balances).isEmpty()).toBe(true);
      expect((result["dailyProtocolRevenue"] as Balances).isEmpty()).toBe(true);
    }, HEAVY_TIMEOUT);
  });

  it("TVL: the Vault holds the test tokens, and the adapter deliberately counts none of it", async () => {
    // Direct reads first, so the empty result below is provably "excluded", not
    // "missed": the tokens ARE there, on the Vault, and nowhere else.
    for (const token of [LTT1, LTT2]) {
      expect(await balanceOf(token, ROBINHOOD.vault), `Vault holds no ${token}`).toBeGreaterThan(0n);
      expect(await balanceOf(token, ROBINHOOD.clPoolManager)).toBe(0n);
      expect(await balanceOf(token, ROBINHOOD.binPoolManager)).toBe(0n);
    }

    const require = createRequire(import.meta.url);
    const { makeApi } = require("../DefiLlama-Adapters/_harness/chainApi.js");
    const tvlAdapter = require("../DefiLlama-Adapters/projects/latch/index.js");
    // Bound the Initialize scan at the window so this stays a fixed-history read.
    const api = makeApi({
      chain: ROBINHOOD_CHAIN_KEY,
      rpcUrl: ROBINHOOD_RPC,
      maxBlockRange: ROBINHOOD_MAX_BLOCK_RANGE,
      block: WINDOW_TO,
    });
    await tvlAdapter[ROBINHOOD_CHAIN_KEY].tvl(api);
    expect(api.getBalances()).toEqual({});
  }, HEAVY_TIMEOUT);
});

describe.skipIf(reachable)("live Robinhood Chain deployment (skipped)", () => {
  it("was skipped because the RPC was unreachable or LATCH_SKIP_LIVE=1", () => {
    expect(reachable).toBe(false);
  });
});

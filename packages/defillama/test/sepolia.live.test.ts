import { describe, expect, it } from "vitest";
import adapter, { CL_SWAP_EVENT } from "../dimension-adapters/dexs/latch.js";
import { Balances } from "../harness/balances.js";
import { makeGetLogs, Rpc } from "../harness/rpc.js";
import { runFetch } from "../harness/runFetch.js";
import {
  SEPOLIA,
  SEPOLIA_MAX_BLOCK_RANGE,
  SEPOLIA_RPC,
  SEPOLIA_START_TIMESTAMP,
  withSepolia,
} from "../harness/sepolia.js";

/**
 * Runs against the LIVE Sepolia deployment over a public RPC.
 *
 * The window below is FIXED and historical, so these are exact regression
 * assertions against real chain data rather than a moving target: blocks
 * 11672619-11672630 contain the first pool's `Initialize` and the only two swaps
 * that had happened when this test was written. Later activity on the deployment
 * cannot change them.
 *
 * What this proves:
 *   - the event signatures in the adapter match the deployed bytecode (a wrong
 *     signature returns zero logs and would pass a laxer test silently);
 *   - the live `fee`/`protocolFee` pair is exactly what the fee model predicts;
 *   - the adapter's volume, fee and split arithmetic reproduces the on-chain
 *     numbers to the wei;
 *   - the Vault, not the pool managers, holds the tokens - the premise the whole
 *     TVL adapter rests on.
 *
 * What it does NOT prove: any USD figure, or that the numbers are economically
 * meaningful. This is a testnet with two swaps from what is evidently a deployment
 * script. There is no price feed here and no real trading anywhere.
 *
 * Skipped when LATCH_SKIP_LIVE=1 or the RPC is unreachable - a flaky public
 * endpoint must not fail the suite, but it must never be mistaken for a pass.
 */

// The first pool, and the first two swaps through it.
const WINDOW_FROM = 11_672_619;
const WINDOW_TO = 11_672_630;

const LTUSD = "0x5c00ea81eedced610c5174b9d20f83ca245e269c"; // currency0
const LTETH = "0xbef6e0f94fe1a96390eb25d32759aad85fd1f067"; // currency1

/**
 * Expected output over the window, derived from the two Swap logs:
 *
 *   block 11672622  amount0 -1000000000000000000  amount1  +995903807681983732
 *   block 11672623  amount0  +996102192317032356  amount1 -1000000000000000000
 *   both:           fee 3997   protocolFee 1000
 *
 * `addOneToken` prices off currency1 here (neither token is a core asset, so it
 * falls through to token1), giving |amount1| per swap.
 */
const LEG = [995_903_807_681_983_732n, 1_000_000_000_000_000_000n];
const sum = (f: (x: bigint) => bigint) => LEG.reduce((a, x) => a + f(x), 0n);
const EXPECTED = {
  volume: sum((x) => x),
  fees: sum((x) => (x * 3997n) / 1_000_000n),
  revenue: sum((x) => (x * 1000n) / 1_000_000n),
};

const skip = process.env["LATCH_SKIP_LIVE"] === "1";
const rpc = new Rpc({ url: SEPOLIA_RPC, maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE });

const reachable = await (async () => {
  if (skip) return false;
  try {
    return Number(await rpc.call<string>("eth_chainId", [])) === SEPOLIA.chainId;
  } catch {
    return false;
  }
})();

describe.skipIf(!reachable)("live Sepolia deployment", () => {
  it("has bytecode at all four addresses", async () => {
    for (const [name, address] of Object.entries({
      vault: SEPOLIA.vault,
      clPoolManager: SEPOLIA.clPoolManager,
      binPoolManager: SEPOLIA.binPoolManager,
      protocolFeeController: SEPOLIA.protocolFeeController,
    })) {
      const code = await rpc.call<string>("eth_getCode", [address, "latest"]);
      expect(code, `${name} has no code`).not.toBe("0x");
      expect(code.length).toBeGreaterThan(100);
    }
  });

  it("has both pool managers registered as apps on the Vault", async () => {
    // Vault.isAppRegistered(address) -> 0x8403be91 (from the compiled artifact's
    // methodIdentifiers). This registration is what makes the Vault the single
    // custodian, and therefore what makes "TVL = Vault balances" true.
    for (const manager of [SEPOLIA.clPoolManager, SEPOLIA.binPoolManager]) {
      const res = await rpc.call<string>("eth_call", [
        { to: SEPOLIA.vault, data: "0x8403be91" + word(manager) },
        "latest",
      ]);
      expect(BigInt(res), `${manager} is not a registered app`).toBe(1n);
    }
  });

  it("keeps every token on the Vault and nothing on the pool managers", async () => {
    // The premise of the TVL adapter, checked directly rather than assumed.
    for (const token of [LTUSD, LTETH]) {
      const [vault, cl, bin] = await Promise.all(
        [SEPOLIA.vault, SEPOLIA.clPoolManager, SEPOLIA.binPoolManager].map((who) =>
          balanceOf(token, who),
        ),
      );
      expect(vault, `Vault holds no ${token}`).toBeGreaterThan(0n);
      expect(cl, "CLPoolManager must never custody tokens").toBe(0n);
      expect(bin, "BinPoolManager must never custody tokens").toBe(0n);

      // Vault.reservesOfApp(app, currency) -> 0x322c3620. The Vault's internal
      // accounting for the CL app should equal its whole ERC20 balance, since the
      // Bin manager has no pools yet.
      const reserve = BigInt(
        await rpc.call<string>("eth_call", [
          {
            to: SEPOLIA.vault,
            data: "0x322c3620" + word(SEPOLIA.clPoolManager) + word(token),
          },
          "latest",
        ]),
      );
      expect(reserve).toBe(vault);
    }
  });

  it("reports the protocol fee configuration the adapter's fee split assumes", async () => {
    // LatchProtocolFeeController.defaultFee() -> 0x5a6c72d0, returning
    // (bool isSet, uint16 zeroForOne, uint16 oneForZero).
    const res = await rpc.call<string>("eth_call", [
      { to: SEPOLIA.protocolFeeController, data: "0x5a6c72d0" },
      "latest",
    ]);
    const words = res.slice(2).match(/.{64}/g)!;
    expect(BigInt("0x" + words[0]!)).toBe(1n); // isSet
    expect(BigInt("0x" + words[1]!)).toBe(1000n); // 0.1% zeroForOne
    expect(BigInt("0x" + words[2]!)).toBe(1000n); // 0.1% oneForZero
    // within ProtocolFeeLibrary.MAX_PROTOCOL_FEE
    expect(BigInt("0x" + words[1]!)).toBeLessThanOrEqual(4000n);
  });

  it("finds the Vault's first log at the configured fromBlock", async () => {
    const logs = await rpc.rawLogs({
      address: SEPOLIA.vault,
      fromBlock: SEPOLIA.fromBlock,
      toBlock: SEPOLIA.fromBlock,
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(await rpc.blockTimestamp(SEPOLIA.fromBlock)).toBe(SEPOLIA_START_TIMESTAMP);
  });

  it("decodes real Swap logs, and the live fee pair matches the composition formula", async () => {
    const getLogs = makeGetLogs(rpc, WINDOW_FROM, WINDOW_TO);
    const logs = await getLogs({ target: SEPOLIA.clPoolManager, eventAbi: CL_SWAP_EVENT });

    // A wrong event signature yields an empty array, which a weaker assertion
    // would happily accept. AGENTS.md calls this out explicitly.
    expect(logs).toHaveLength(2);

    for (const log of logs) {
      const fee = BigInt(log.fee);
      const protocolFee = BigInt(log.protocolFee);
      expect(fee).toBe(3997n);
      expect(protocolFee).toBe(1000n);
      // fee == protocolFee + lpFee - protocolFee*lpFee/1e6, so inverting it must
      // land on a whole basis-point tier. 3997 -> 3000 == 0.30%.
      const lpFee = ((fee - protocolFee) * 1_000_000n) / (1_000_000n - protocolFee);
      expect(lpFee).toBe(3000n);
      expect(protocolFee).toBeLessThan(fee);
      expect(protocolFee).toBeLessThanOrEqual(4000n);

      // Signed int128, one leg negative (the caller pays) and one positive.
      const a0 = BigInt(log.amount0);
      const a1 = BigInt(log.amount1);
      expect(a0 < 0n !== a1 < 0n).toBe(true);
    }
  });

  it("reproduces the on-chain numbers to the wei over a fixed historical window", async () => {
    const chain = withSepolia();
    const result = await runFetch(adapter.fetch!, {
      chain,
      rpcUrl: SEPOLIA_RPC,
      fromBlock: WINDOW_FROM,
      toBlock: WINDOW_TO,
      maxBlockRange: SEPOLIA_MAX_BLOCK_RANGE,
    });

    const totals = (key: string) => (result[key] as Balances).totals();

    expect(totals("dailyVolume")).toEqual({ [LTETH]: EXPECTED.volume });
    expect(totals("dailyFees")).toEqual({ [LTETH]: EXPECTED.fees });
    expect(totals("dailyUserFees")).toEqual({ [LTETH]: EXPECTED.fees });
    expect(totals("dailyRevenue")).toEqual({ [LTETH]: EXPECTED.revenue });
    expect(totals("dailyProtocolRevenue")).toEqual({ [LTETH]: EXPECTED.revenue });
    expect(totals("dailySupplySideRevenue")).toEqual({
      [LTETH]: EXPECTED.fees - EXPECTED.revenue,
    });

    // Fees = Revenue + SupplySideRevenue, on real data.
    expect(totals("dailyRevenue")[LTETH]! + totals("dailySupplySideRevenue")[LTETH]!).toBe(
      totals("dailyFees")[LTETH],
    );
    // and the effective rate is the pool's swap fee, not something drifted.
    expect((EXPECTED.volume * 3997n) / 1_000_000n - EXPECTED.fees).toBeLessThanOrEqual(1n);
  });

  it("returns nothing for the Bin pool manager, which has no pools yet", async () => {
    const getLogs = makeGetLogs(rpc, SEPOLIA.fromBlock, WINDOW_TO);
    const logs = await getLogs({
      target: SEPOLIA.binPoolManager,
      eventAbi:
        "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, address hooks, uint24 fee, bytes32 parameters, uint24 activeId)",
      fromBlock: SEPOLIA.fromBlock,
    });
    // An honest zero: the query ran and the manager genuinely has no pools. The
    // adapter must not fall over on this, and must not attribute CL activity to it.
    expect(logs).toHaveLength(0);
  });
});

describe.skipIf(reachable)("live Sepolia deployment (skipped)", () => {
  it("was skipped because the RPC was unreachable or LATCH_SKIP_LIVE=1", () => {
    expect(reachable).toBe(false);
  });
});

const word = (address: string) => address.slice(2).toLowerCase().padStart(64, "0");

async function balanceOf(token: string, owner: string): Promise<bigint> {
  return BigInt(
    await rpc.call<string>("eth_call", [
      { to: token, data: "0x70a08231" + word(owner) },
      "latest",
    ]),
  );
}

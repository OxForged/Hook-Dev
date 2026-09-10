import { ALL_EVENT_TOPICS, EVENT_DESCRIPTORS, descriptorsForTopic } from "@latchprotocol/sdk";
import { describe, expect, it } from "vitest";
import { decodeLog } from "../src/chain/decode.js";
import {
  FIXTURE_ADDRESSES,
  FIXTURE_CHAIN_ID,
  FIXTURE_POOLS,
  addressForRole,
  fixtureLogs,
} from "../src/chain/fixtures/devnet.js";
import { FixtureChainLogProvider } from "../src/chain/provider/fixture.js";
import type { ContractRole } from "../src/chain/contracts.js";
import type { RawLog } from "../src/chain/provider/types.js";

const ROLE_BY_ADDRESS = new Map<string, ContractRole>([
  [FIXTURE_ADDRESSES.vault, "Vault"],
  [FIXTURE_ADDRESSES.clPoolManager, "CLPoolManager"],
  [FIXTURE_ADDRESSES.binPoolManager, "BinPoolManager"],
  [FIXTURE_ADDRESSES.feeController, "FeeController"],
]);

function roleFor(log: RawLog): ContractRole {
  const role = ROLE_BY_ADDRESS.get(log.address.toLowerCase());
  if (!role) throw new Error(`fixture emitted from an unmapped address: ${log.address}`);
  return role;
}

describe("event signature collisions", () => {
  it("has more event declarations than distinct signatures", () => {
    // 34 declarations, 22 unique topic0s. This is the whole reason the pipeline
    // keys on (chainId, contract, topic0) rather than topic0 alone.
    expect(EVENT_DESCRIPTORS.length).toBeGreaterThan(ALL_EVENT_TOPICS.length);
  });

  it("maps the shared ProtocolFees events to more than one contract", () => {
    const colliding = ALL_EVENT_TOPICS.map((topic) => descriptorsForTopic(topic)).filter(
      (d) => d.length > 1,
    );

    const names = new Set(colliding.map((d) => d[0]!.eventName));
    expect(names).toContain("ProtocolFeeUpdated");
    expect(names).toContain("DynamicLPFeeUpdated");
    expect(names).toContain("ProtocolFeeControllerUpdated");
    expect(names).toContain("OwnershipTransferred");
  });

  it("attributes an identical topic0 to the right pool type using the emitting address", () => {
    const logs = fixtureLogs();

    // The fixture timeline emits ProtocolFeeUpdated from BOTH pool managers.
    const feeUpdates = logs
      .map((log) => ({ log, decoded: decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log) }))
      .filter(({ decoded }) => decoded.eventName === "ProtocolFeeUpdated");

    expect(feeUpdates.length).toBeGreaterThanOrEqual(2);

    // Same signature...
    const topics = new Set(feeUpdates.map(({ log }) => log.topics[0]));
    expect(topics.size).toBe(1);

    // ...different emitters, and therefore different attribution.
    const emitters = new Set(feeUpdates.map(({ log }) => log.address));
    expect(emitters).toContain(FIXTURE_ADDRESSES.clPoolManager);
    expect(emitters).toContain(FIXTURE_ADDRESSES.binPoolManager);

    for (const { log, decoded } of feeUpdates) {
      expect(decoded.event?.kind).toBe("ProtocolFeeChange");
      expect(decoded.event?.meta.contract).toBe(log.address);
      expect(decoded.event?.meta.role).toBe(roleFor(log));
    }
  });

  it("refuses to decode a pool-manager log under the wrong role", () => {
    const clSwap = fixtureLogs().find(
      (l) => l.address === FIXTURE_ADDRESSES.clPoolManager && decodeLog(FIXTURE_CHAIN_ID, "CLPoolManager", l).eventName === "Swap",
    );
    expect(clSwap).toBeDefined();

    // A CL Swap has a different signature from a bin Swap, so decoding it as a
    // bin log must fail rather than silently produce a bin event.
    const wrong = decodeLog(FIXTURE_CHAIN_ID, "BinPoolManager", clSwap!);
    expect(wrong.event).toBeUndefined();
    expect(wrong.skipReason).toBeDefined();
  });
});

describe("decodeLog over the fixture timeline", () => {
  const logs = fixtureLogs();

  it("decodes every fixture log it is meant to model", () => {
    const results = logs.map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log));
    const undecoded = results.filter((r) => !r.event);

    // The fixture timeline only contains modelled events, so nothing should be
    // skipped. If this fails, either the fixture or the decoder has drifted.
    expect(undecoded.map((r) => r.skipReason ?? "?")).toEqual([]);
  });

  it("produces the expected event kinds", () => {
    const kinds = new Set(
      logs.map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log).event?.kind),
    );
    expect(kinds).toContain("AppRegistered");
    expect(kinds).toContain("PoolInitialized");
    expect(kinds).toContain("Swap");
    expect(kinds).toContain("LiquidityChange");
    expect(kinds).toContain("Donate");
    expect(kinds).toContain("DynamicLpFee");
    expect(kinds).toContain("ProtocolFeeChange");
    expect(kinds).toContain("VaultToken");
  });

  it("builds chain-scoped, deterministic event ids", () => {
    const first = logs[0]!;
    const decoded = decodeLog(FIXTURE_CHAIN_ID, roleFor(first), first);
    expect(decoded.event?.meta.id).toBe(
      `${FIXTURE_CHAIN_ID}-${first.transactionHash}-${first.logIndex}`,
    );

    const ids = logs.map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log).event?.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recovers the pool ids the fixture pools were built with", () => {
    const initialized = logs
      .map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log).event)
      .filter((e) => e?.kind === "PoolInitialized");

    expect(initialized).toHaveLength(FIXTURE_POOLS.length);
    const decodedIds = new Set(initialized.map((e) => (e as { poolId: string }).poolId));
    for (const pool of FIXTURE_POOLS) {
      expect(decodedIds).toContain(pool.poolId);
    }
  });

  it("keeps bin Mint/Burn amounts opaque", () => {
    const binChange = logs
      .map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log).event)
      .find((e) => e?.kind === "LiquidityChange" && e.poolType === "BIN");

    expect(binChange).toBeDefined();
    const change = binChange as { binIds?: bigint[]; binAmounts?: string[] };
    expect(change.binIds?.length).toBeGreaterThan(0);
    // Stored as 32-byte words, not unpacked into amount0/amount1. Decoding them
    // requires verifying PackedUint128Math's layout first.
    expect(change.binAmounts?.length).toBe(change.binIds?.length);
    for (const word of change.binAmounts ?? []) {
      expect(word).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("signs swap amounts from the pool's point of view", () => {
    const swaps = logs
      .map((log) => decodeLog(FIXTURE_CHAIN_ID, roleFor(log), log).event)
      .filter((e) => e?.kind === "Swap") as { amount0: bigint; amount1: bigint }[];

    expect(swaps.length).toBeGreaterThan(0);
    for (const swap of swaps) {
      // Exactly one side is the input. Both positive or both negative would
      // mean the decoder lost a sign somewhere.
      expect(swap.amount0 > 0n).not.toBe(swap.amount1 > 0n);
    }
  });
});

describe("FixtureChainLogProvider", () => {
  const provider = new FixtureChainLogProvider(FIXTURE_CHAIN_ID);

  const contracts = (["Vault", "CLPoolManager", "BinPoolManager", "FeeController"] as const).map(
    (role) => ({
      chainId: FIXTURE_CHAIN_ID,
      role,
      address: addressForRole(role),
      label: role,
    }),
  );

  it("reports its kind so the boundary is visible at runtime", () => {
    expect(provider.kind).toBe("fixture");
    expect(provider.describe()).toContain("fixture");
  });

  it("respects the requested block range", async () => {
    const head = await provider.getLatestBlockNumber();
    const all = await provider.getLogs({ fromBlock: 0n, toBlock: head, contracts });
    expect(all.length).toBe(fixtureLogs().length);

    const mid = all[Math.floor(all.length / 2)]!.blockNumber;
    const firstHalf = await provider.getLogs({ fromBlock: 0n, toBlock: mid, contracts });
    const secondHalf = await provider.getLogs({ fromBlock: mid + 1n, toBlock: head, contracts });

    expect(firstHalf.length + secondHalf.length).toBe(all.length);
    // Windows must not overlap, or ingestion would double-read every boundary.
    const ids = new Set([...firstHalf, ...secondHalf].map((l) => `${l.transactionHash}-${l.logIndex}`));
    expect(ids.size).toBe(all.length);
  });

  it("returns nothing when no contracts are watched", async () => {
    const logs = await provider.getLogs({ fromBlock: 0n, toBlock: 10_000_000n, contracts: [] });
    expect(logs).toEqual([]);
  });

  it("filters by emitting address", async () => {
    const head = await provider.getLatestBlockNumber();
    const vaultOnly = await provider.getLogs({
      fromBlock: 0n,
      toBlock: head,
      contracts: [contracts[0]!],
    });
    expect(vaultOnly.length).toBeGreaterThan(0);
    for (const log of vaultOnly) {
      expect(log.address).toBe(FIXTURE_ADDRESSES.vault);
    }
  });

  it("orders logs by (blockNumber, logIndex)", async () => {
    const head = await provider.getLatestBlockNumber();
    const logs = await provider.getLogs({ fromBlock: 0n, toBlock: head, contracts });
    for (let i = 1; i < logs.length; i++) {
      const prev = logs[i - 1]!;
      const cur = logs[i]!;
      const ordered =
        cur.blockNumber > prev.blockNumber ||
        (cur.blockNumber === prev.blockNumber && cur.logIndex > prev.logIndex);
      expect(ordered).toBe(true);
    }
  });
});

describe("fixture labelling", () => {
  it("marks every fabricated address with the fixture prefix", () => {
    const addresses = Object.entries(FIXTURE_ADDRESSES).filter(
      ([, value]) => !/^0x0+$/.test(value),
    );
    expect(addresses.length).toBeGreaterThan(0);
    for (const [name, value] of addresses) {
      expect(value, `${name} must be visibly a fixture address`).toMatch(/^0xf1c7/);
    }
  });
});

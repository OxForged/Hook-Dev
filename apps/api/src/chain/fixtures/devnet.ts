/**
 * ============================================================================
 *  FIXTURES — NOT CHAIN DATA
 * ============================================================================
 *
 * Every value in this file is invented. LatchProtocol is not deployed on any
 * network, so there are no logs to read; these exist so the ingestion pipeline,
 * the decoders and the API can be exercised end to end before that changes.
 *
 * Guard rails, so a fixture row can never be mistaken for an observation:
 *
 *   1. The chain is id 31337, named "Fixture Devnet (not a real network)".
 *   2. Every address begins with the marker nibbles `0xf1c7` ("fict"). No real
 *      contract will ever occupy that prefix by accident, and it is visible in
 *      any UI that shows an address.
 *   3. Token symbols are prefixed `FIX`.
 *   4. Every row written from these logs is stamped `dataSource: FIXTURE`, and
 *      every API response derived from them reports `dataSource: "fixture"`.
 *
 * The logs are ABI-encoded for real using the SDK's generated event ABIs, so
 * the decode path under test is the same one that will run against live logs —
 * only the source of the bytes differs.
 */

import {
  DYNAMIC_FEE_FLAG,
  LATCH_PROTOCOL_EVENT_ABIS,
  encodeBinPoolParameters,
  encodeCLPoolParameters,
  poolKeyToId,
} from "@latchprotocol/sdk";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  type Abi,
  type AbiEvent,
  type AbiParameter,
  type Hex,
} from "viem";
import { FEE_CONTROLLER_EVENTS_ABI, type ContractRole } from "../contracts.js";
import type { RawLog } from "../provider/types.js";

/** The fixture chain. Deliberately the Hardhat/Anvil devnet id. */
export const FIXTURE_CHAIN_ID = 31337;
export const FIXTURE_CHAIN_SLUG = "fixture-devnet";

/** Marker prefix carried by every fabricated address in this file. */
export const FIXTURE_ADDRESS_PREFIX = "0xf1c7";

/** An address is 20 bytes = 40 hex characters: the `f1c7` marker, zero padding, then a suffix. */
const ADDRESS_HEX_LENGTH = 40;
const MARKER = "f1c7";

const addr = (suffix: string): Hex => {
  const padding = ADDRESS_HEX_LENGTH - MARKER.length - suffix.length;
  if (padding < 0) throw new Error(`fixture address suffix too long: ${suffix}`);
  return `0x${MARKER}${"0".repeat(padding)}${suffix}`.toLowerCase() as Hex;
};

export const FIXTURE_ADDRESSES = {
  vault: addr("a11a"),
  clPoolManager: addr("c1c1"),
  binPoolManager: addr("b1b1"),
  feeController: addr("fee0"),

  // Tokens
  tokenA: addr("70a0"),
  tokenB: addr("70b0"),
  tokenC: addr("70c0"),
  native: "0x0000000000000000000000000000000000000000" as Hex,

  // Hooks
  hookDynamicFee: addr("40a1"),
  hookFeeTaking: addr("40b2"),
  hookLimitOrder: addr("40c3"),
  hookNone: "0x0000000000000000000000000000000000000000" as Hex,

  // Actors
  routerA: addr("f0a1"),
  routerB: addr("f0b2"),
  lpA: addr("50a1"),
  lpB: addr("50b2"),
  governance: addr("90a1"),
} as const;

/** Fixture token metadata, seeded alongside the logs. */
export const FIXTURE_TOKENS = [
  { address: FIXTURE_ADDRESSES.native, symbol: "FIXETH", name: "Fixture Native", decimals: 18, isNative: true },
  { address: FIXTURE_ADDRESSES.tokenA, symbol: "FIXA", name: "Fixture Token A", decimals: 18, isNative: false },
  { address: FIXTURE_ADDRESSES.tokenB, symbol: "FIXB", name: "Fixture Token B", decimals: 6, isNative: false },
  { address: FIXTURE_ADDRESSES.tokenC, symbol: "FIXC", name: "Fixture Token C", decimals: 18, isNative: false },
] as const;

// ---------------------------------------------------------------------------
// Log encoding
// ---------------------------------------------------------------------------

const ABI_FOR_ROLE: Record<ContractRole, Abi> = {
  Vault: LATCH_PROTOCOL_EVENT_ABIS.Vault as unknown as Abi,
  CLPoolManager: LATCH_PROTOCOL_EVENT_ABIS.CLPoolManager as unknown as Abi,
  BinPoolManager: LATCH_PROTOCOL_EVENT_ABIS.BinPoolManager as unknown as Abi,
  FeeController: FEE_CONTROLLER_EVENTS_ABI as unknown as Abi,
};

function eventFragment(role: ContractRole, eventName: string): AbiEvent {
  const found = ABI_FOR_ROLE[role].find(
    (item): item is AbiEvent => item.type === "event" && item.name === eventName,
  );
  if (!found) {
    throw new Error(`Fixture builder: ${role} has no event named ${eventName}`);
  }
  return found;
}

interface FixtureEvent {
  readonly role: ContractRole;
  readonly eventName: string;
  readonly args: Record<string, unknown>;
  /** Blocks after the fixture genesis block. */
  readonly block: number;
  readonly txIndex: number;
  readonly logIndex: number;
}

/** Genesis of the fixture timeline. Fixed so runs are reproducible. */
export const FIXTURE_START_BLOCK = 1_000_000n;
const FIXTURE_START_TIMESTAMP = 1_756_000_000n; // 2025-08-24T02:26:40Z
const SECONDS_PER_BLOCK = 2n;

function txHashFor(block: number, txIndex: number): Hex {
  return keccak256(new TextEncoder().encode(`latchprotocol-fixture-tx-${block}-${txIndex}`));
}

function encode(event: FixtureEvent): RawLog {
  const fragment = eventFragment(event.role, event.eventName);
  const abi = ABI_FOR_ROLE[event.role];

  const topics = encodeEventTopics({
    abi,
    eventName: event.eventName,
    args: event.args,
  } as never) as Hex[];

  const nonIndexed = fragment.inputs.filter((i) => !i.indexed);
  const data: Hex =
    nonIndexed.length === 0
      ? "0x"
      : encodeAbiParameters(
          nonIndexed as readonly AbiParameter[],
          nonIndexed.map((input) => {
            const name = input.name ?? "";
            if (!(name in event.args)) {
              throw new Error(
                `Fixture builder: ${event.role}.${event.eventName} is missing argument "${name}"`,
              );
            }
            return event.args[name];
          }),
        );

  const blockNumber = FIXTURE_START_BLOCK + BigInt(event.block);
  return {
    address: addressForRole(event.role),
    topics,
    data,
    blockNumber,
    blockTimestamp: FIXTURE_START_TIMESTAMP + BigInt(event.block) * SECONDS_PER_BLOCK,
    transactionHash: txHashFor(event.block, event.txIndex),
    logIndex: event.logIndex,
  };
}

export function addressForRole(role: ContractRole): Hex {
  switch (role) {
    case "Vault":
      return FIXTURE_ADDRESSES.vault;
    case "CLPoolManager":
      return FIXTURE_ADDRESSES.clPoolManager;
    case "BinPoolManager":
      return FIXTURE_ADDRESSES.binPoolManager;
    case "FeeController":
      return FIXTURE_ADDRESSES.feeController;
  }
}

// ---------------------------------------------------------------------------
// Pool key construction
// ---------------------------------------------------------------------------

interface FixturePoolSpec {
  readonly label: string;
  readonly role: "CLPoolManager" | "BinPoolManager";
  readonly currency0: Hex;
  readonly currency1: Hex;
  readonly hooks: Hex;
  readonly fee: number;
  readonly bitmap: number;
  /** tickSpacing for CL, binStep for bin. */
  readonly config: number;
}

const POOL_SPECS: readonly FixturePoolSpec[] = [
  {
    label: "FIXA/FIXB 0.30% · no hook",
    role: "CLPoolManager",
    currency0: FIXTURE_ADDRESSES.tokenA,
    currency1: FIXTURE_ADDRESSES.tokenB,
    hooks: FIXTURE_ADDRESSES.hookNone,
    fee: 3_000,
    bitmap: 0,
    config: 60,
  },
  {
    label: "FIXA/FIXC dynamic · fee hook",
    role: "CLPoolManager",
    currency0: FIXTURE_ADDRESSES.tokenA,
    currency1: FIXTURE_ADDRESSES.tokenC,
    hooks: FIXTURE_ADDRESSES.hookDynamicFee,
    fee: DYNAMIC_FEE_FLAG,
    // afterInitialize | beforeSwap  => bits 1, 6
    bitmap: (1 << 1) | (1 << 6),
    config: 10,
  },
  {
    label: "FIXETH/FIXA 0.05% · fee-taking hook",
    role: "CLPoolManager",
    currency0: FIXTURE_ADDRESSES.native,
    currency1: FIXTURE_ADDRESSES.tokenA,
    hooks: FIXTURE_ADDRESSES.hookFeeTaking,
    fee: 500,
    // beforeSwap | afterSwap | afterSwapReturnsDelta => bits 6, 7, 11
    bitmap: (1 << 6) | (1 << 7) | (1 << 11),
    config: 10,
  },
  {
    label: "FIXB/FIXC bin 25bps · limit-order hook",
    role: "BinPoolManager",
    currency0: FIXTURE_ADDRESSES.tokenB,
    currency1: FIXTURE_ADDRESSES.tokenC,
    hooks: FIXTURE_ADDRESSES.hookLimitOrder,
    fee: 2_500,
    // afterMint | afterBurn | beforeSwap | afterSwap => bits 3, 5, 6, 7
    bitmap: (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7),
    config: 25,
  },
];

export interface FixturePool extends FixturePoolSpec {
  readonly poolId: Hex;
  readonly parameters: Hex;
  readonly poolManager: Hex;
}

export const FIXTURE_POOLS: readonly FixturePool[] = POOL_SPECS.map((spec) => {
  const poolManager =
    spec.role === "CLPoolManager"
      ? FIXTURE_ADDRESSES.clPoolManager
      : FIXTURE_ADDRESSES.binPoolManager;
  // Both the parameters packing and the pool id come from the SDK, so fixture
  // pool ids are computed exactly the way the chain would compute them.
  const parameters =
    spec.role === "CLPoolManager"
      ? encodeCLPoolParameters(spec.bitmap, spec.config)
      : encodeBinPoolParameters(spec.bitmap, spec.config);
  return {
    ...spec,
    poolManager,
    parameters,
    poolId: poolKeyToId({
      currency0: spec.currency0,
      currency1: spec.currency1,
      hooks: spec.hooks,
      poolManager,
      fee: spec.fee,
      parameters,
    }),
  };
});

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and identical on every run and platform. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The fixture timeline
// ---------------------------------------------------------------------------

const SALT_ZERO = `0x${"0".repeat(64)}` as Hex;

function buildEvents(): FixtureEvent[] {
  const events: FixtureEvent[] = [];
  const rng = makeRng(0x484f_4f4b); // "HOOK"

  let block = 0;
  const push = (
    role: ContractRole,
    eventName: string,
    args: Record<string, unknown>,
    opts?: { sameBlock?: boolean; logIndex?: number },
  ) => {
    if (!opts?.sameBlock) block += 1;
    events.push({
      role,
      eventName,
      args,
      block,
      txIndex: 0,
      logIndex: opts?.logIndex ?? 0,
    });
  };

  // --- deployment: the vault accepts both pool managers as apps -------------
  push("Vault", "AppRegistered", { app: FIXTURE_ADDRESSES.clPoolManager });
  push("Vault", "AppRegistered", { app: FIXTURE_ADDRESSES.binPoolManager });

  // --- the fee controller is installed and configured -----------------------
  push("CLPoolManager", "ProtocolFeeControllerUpdated", {
    protocolFeeController: FIXTURE_ADDRESSES.feeController,
  });
  push("BinPoolManager", "ProtocolFeeControllerUpdated", {
    protocolFeeController: FIXTURE_ADDRESSES.feeController,
  });
  // Launch at zero, as the revenue model calls for.
  push("FeeController", "DefaultFeeUpdated", { zeroForOne: 0, oneForZero: 0 });

  // --- pools are initialised ------------------------------------------------
  for (const pool of FIXTURE_POOLS) {
    if (pool.role === "CLPoolManager") {
      push("CLPoolManager", "Initialize", {
        id: pool.poolId,
        currency0: pool.currency0,
        currency1: pool.currency1,
        hooks: pool.hooks,
        fee: pool.fee,
        parameters: pool.parameters,
        sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n, // 1:1
        tick: 0,
      });
    } else {
      push("BinPoolManager", "Initialize", {
        id: pool.poolId,
        currency0: pool.currency0,
        currency1: pool.currency1,
        hooks: pool.hooks,
        fee: pool.fee,
        parameters: pool.parameters,
        activeId: 8_388_608, // 2**23 — price 1:1
      });
    }

    // A dynamic-fee pool's hook sets its opening fee in afterInitialize.
    if (pool.fee === DYNAMIC_FEE_FLAG) {
      push(pool.role, "DynamicLPFeeUpdated", { id: pool.poolId, dynamicLPFee: 500 }, { sameBlock: true, logIndex: 1 });
    }
  }

  // --- initial liquidity ----------------------------------------------------
  for (const pool of FIXTURE_POOLS) {
    if (pool.role === "CLPoolManager") {
      push("CLPoolManager", "ModifyLiquidity", {
        id: pool.poolId,
        sender: FIXTURE_ADDRESSES.lpA,
        tickLower: -pool.config * 10,
        tickUpper: pool.config * 10,
        liquidityDelta: 5_000_000_000_000_000_000n,
        salt: SALT_ZERO,
      });
    } else {
      push("BinPoolManager", "Mint", {
        id: pool.poolId,
        sender: FIXTURE_ADDRESSES.lpA,
        ids: [8_388_607n, 8_388_608n, 8_388_609n],
        salt: SALT_ZERO,
        // bytes32[] of packed (amount0, amount1) pairs. Left OPAQUE on purpose:
        // the packing is PackedUint128Math's, and this pipeline does not decode
        // it. See the note on LiquidityChange.binAmounts in schema.prisma.
        amounts: [
          `0x${"0".repeat(64)}` as Hex,
          `0x${"0".repeat(64)}` as Hex,
          `0x${"0".repeat(64)}` as Hex,
        ],
        compositionFeeAmount: `0x${"0".repeat(64)}` as Hex,
        feeAmountToProtocol: `0x${"0".repeat(64)}` as Hex,
      });
    }
  }

  // --- trading activity -----------------------------------------------------
  const routers = [FIXTURE_ADDRESSES.routerA, FIXTURE_ADDRESSES.routerB];
  for (let i = 0; i < 240; i++) {
    const pool = FIXTURE_POOLS[i % FIXTURE_POOLS.length]!;
    const router = routers[i % routers.length]!;
    const zeroForOne = rng() > 0.5;
    const magnitude = BigInt(Math.floor(1e15 + rng() * 4e17));
    const out = (magnitude * BigInt(9_950 + Math.floor(rng() * 80))) / 10_000n;

    // Signed from the pool's point of view: the input arrives (+), the output leaves (-).
    const amount0 = zeroForOne ? magnitude : -out;
    const amount1 = zeroForOne ? -out : magnitude;

    if (pool.role === "CLPoolManager") {
      push("CLPoolManager", "Swap", {
        id: pool.poolId,
        sender: router,
        amount0,
        amount1,
        sqrtPriceX96: 79_228_162_514_264_337_593_543_950_336n + BigInt(Math.floor((rng() - 0.5) * 1e24)),
        liquidity: 5_000_000_000_000_000_000n,
        tick: Math.floor((rng() - 0.5) * 200),
        fee: pool.fee === DYNAMIC_FEE_FLAG ? 500 : pool.fee,
        protocolFee: 0,
      });
    } else {
      push("BinPoolManager", "Swap", {
        id: pool.poolId,
        sender: router,
        amount0,
        amount1,
        activeId: 8_388_608 + Math.floor((rng() - 0.5) * 20),
        fee: pool.fee,
        protocolFee: 0,
      });
    }

    // Occasional liquidity churn and hook-driven fee changes.
    if (i % 17 === 0) {
      const clPool = FIXTURE_POOLS.find((p) => p.role === "CLPoolManager")!;
      push("CLPoolManager", "ModifyLiquidity", {
        id: clPool.poolId,
        sender: rng() > 0.5 ? FIXTURE_ADDRESSES.lpA : FIXTURE_ADDRESSES.lpB,
        tickLower: -clPool.config * 10,
        tickUpper: clPool.config * 10,
        liquidityDelta: rng() > 0.4 ? 250_000_000_000_000_000n : -180_000_000_000_000_000n,
        salt: SALT_ZERO,
      });
    }
    if (i % 29 === 0) {
      const dynamicPool = FIXTURE_POOLS.find((p) => p.fee === DYNAMIC_FEE_FLAG)!;
      push("CLPoolManager", "DynamicLPFeeUpdated", {
        id: dynamicPool.poolId,
        dynamicLPFee: 300 + Math.floor(rng() * 700),
      });
    }
    if (i % 53 === 0) {
      const pool0 = FIXTURE_POOLS[0]!;
      push("CLPoolManager", "Donate", {
        id: pool0.poolId,
        sender: FIXTURE_ADDRESSES.lpB,
        amount0: BigInt(Math.floor(1e15 + rng() * 1e16)),
        amount1: BigInt(Math.floor(1e15 + rng() * 1e16)),
        tick: 0,
      });
    }
  }

  // --- a bin burn -----------------------------------------------------------
  const binPool = FIXTURE_POOLS.find((p) => p.role === "BinPoolManager")!;
  push("BinPoolManager", "Burn", {
    id: binPool.poolId,
    sender: FIXTURE_ADDRESSES.lpA,
    ids: [8_388_607n, 8_388_609n],
    salt: SALT_ZERO,
    amounts: [`0x${"0".repeat(64)}` as Hex, `0x${"0".repeat(64)}` as Hex],
  });

  // --- governance turns on a small protocol fee -----------------------------
  // NOTE: this is the topic0 collision in the flesh. Both of the next two logs
  // carry an identical topic0 (`ProtocolFeeUpdated(bytes32,uint24)`); only the
  // emitting address says which pool type they belong to.
  const clPool0 = FIXTURE_POOLS[0]!;
  push("FeeController", "PoolFeeUpdated", {
    poolId: clPool0.poolId,
    isSet: true,
    zeroForOne: 500,
    oneForZero: 500,
  });
  push("CLPoolManager", "ProtocolFeeUpdated", {
    id: clPool0.poolId,
    protocolFee: (500 << 12) | 500,
  });
  push("BinPoolManager", "ProtocolFeeUpdated", {
    id: binPool.poolId,
    protocolFee: (250 << 12) | 250,
  });
  push("FeeController", "TierFeeUpdated", {
    lpFeeTier: 3_000,
    isSet: true,
    zeroForOne: 400,
    oneForZero: 400,
  });

  // --- vault claim-token activity ------------------------------------------
  push("Vault", "Transfer", {
    caller: FIXTURE_ADDRESSES.routerA,
    from: FIXTURE_ADDRESSES.routerA,
    to: FIXTURE_ADDRESSES.lpA,
    currency: FIXTURE_ADDRESSES.tokenA,
    amount: 1_500_000_000_000_000_000n,
  });
  push("Vault", "Approval", {
    owner: FIXTURE_ADDRESSES.lpA,
    spender: FIXTURE_ADDRESSES.routerB,
    currency: FIXTURE_ADDRESSES.tokenB,
    amount: 10_000_000_000n,
  });
  push("Vault", "OperatorSet", {
    owner: FIXTURE_ADDRESSES.lpB,
    operator: FIXTURE_ADDRESSES.routerA,
    approved: true,
  });

  return events;
}

let cachedLogs: RawLog[] | undefined;

/** Every fixture log, ordered by (blockNumber, logIndex). Built once. */
export function fixtureLogs(): readonly RawLog[] {
  if (!cachedLogs) {
    cachedLogs = buildEvents()
      .map(encode)
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? a.logIndex - b.logIndex
          : a.blockNumber < b.blockNumber
            ? -1
            : 1,
      );
  }
  return cachedLogs;
}

/** Highest block in the fixture timeline. */
export function fixtureHeadBlock(): bigint {
  const logs = fixtureLogs();
  const last = logs.at(-1);
  return last ? last.blockNumber + 10n : FIXTURE_START_BLOCK;
}

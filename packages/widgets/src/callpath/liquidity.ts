// SPDX-License-Identifier: MIT
/**
 * Liquidity call-path construction for both pool types.
 *
 * Concentrated liquidity and the liquidity book differ in what a "range" is -
 * a tick pair versus a span of bins - and in the shape of their position
 * manager params. Everything above this file works with the single
 * {@link ../adapters/protocol.js | LiquidityRange} union; the divergence is
 * confined to the two encoders here.
 *
 * Both paths go through `PositionManager.modifyLiquidities(unlockData, deadline)`
 * with the same `abi.encode(actions, params)` transport the swap path uses.
 *
 * ## Why there is no integrator fee on this path
 *
 * `PAY_PORTION` and `TAKE_PORTION` split an output currency. Adding liquidity
 * has no output to split, and removing it returns the user's own principal -
 * skimming that is not a referral fee, it is a withdrawal charge. Integrator
 * revenue on liquidity, if it is ever added, belongs in a hook that earns from
 * the position, not in a router step that taxes the deposit. The `integrator`
 * config is still carried here so it can be recorded in analytics events.
 */

import { encodeAbiParameters, encodeFunctionData, type Address, type Hex } from "viem";
import type { PoolKey } from "@latchprotocol/sdk";
import { ACTIONS, MSG_SENDER, POSITION_MANAGER_ABI } from "./constants.js";
import { plan } from "./plan.js";
import { POOL_KEY_COMPONENTS } from "./swap.js";

const CL_MINT_PARAMS = [
  { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
  { name: "tickLower", type: "int24" },
  { name: "tickUpper", type: "int24" },
  { name: "liquidity", type: "uint256" },
  { name: "amount0Max", type: "uint128" },
  { name: "amount1Max", type: "uint128" },
  { name: "owner", type: "address" },
  { name: "hookData", type: "bytes" },
] as const;

const CL_MODIFY_PARAMS = [
  { name: "tokenId", type: "uint256" },
  { name: "liquidity", type: "uint256" },
  { name: "amount0", type: "uint128" },
  { name: "amount1", type: "uint128" },
  { name: "hookData", type: "bytes" },
] as const;

const CURRENCY_PAIR = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
] as const;

const CURRENCY_PAIR_AND_ADDRESS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "recipient", type: "address" },
] as const;

const BIN_ADD_LIQUIDITY_PARAMS = [
  {
    name: "params",
    type: "tuple",
    components: [
      { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "amount0", type: "uint128" },
      { name: "amount1", type: "uint128" },
      { name: "amount0Max", type: "uint128" },
      { name: "amount1Max", type: "uint128" },
      { name: "activeIdDesired", type: "uint256" },
      { name: "idSlippage", type: "uint256" },
      { name: "deltaIds", type: "int256[]" },
      { name: "distributionX", type: "uint256[]" },
      { name: "distributionY", type: "uint256[]" },
      { name: "minLiquidities", type: "uint256[]" },
      { name: "to", type: "address" },
      { name: "hookData", type: "bytes" },
    ],
  },
] as const;

const BIN_REMOVE_LIQUIDITY_PARAMS = [
  {
    name: "params",
    type: "tuple",
    components: [
      { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "amount0Min", type: "uint128" },
      { name: "amount1Min", type: "uint128" },
      { name: "ids", type: "uint256[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "from", type: "address" },
      { name: "hookData", type: "bytes" },
    ],
  },
] as const;

function poolKeyStruct(key: PoolKey): {
  currency0: Address;
  currency1: Address;
  hooks: Address;
  poolManager: Address;
  fee: number;
  parameters: Hex;
} {
  return {
    currency0: key.currency0,
    currency1: key.currency1,
    hooks: key.hooks,
    poolManager: key.poolManager,
    fee: key.fee,
    parameters: key.parameters,
  };
}

/** An encoded position-manager call. */
export interface EncodedLiquidityCall {
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly planTrace: string;
}

/** Arguments for minting a new concentrated-liquidity position. */
export interface BuildCLMintArgs {
  readonly positionManager: Address;
  readonly poolKey: PoolKey;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: bigint;
  readonly amount0Max: bigint;
  readonly amount1Max: bigint;
  readonly owner: Address;
  readonly deadline: bigint;
  readonly hookData?: Hex;
  /** Native value to attach, when one side of the pair is the native asset. */
  readonly value?: bigint;
}

/** Encodes `CL_MINT_POSITION` followed by `SETTLE_PAIR`. */
export function buildCLMintCall(args: BuildCLMintArgs): EncodedLiquidityCall {
  assertTickRange(args.tickLower, args.tickUpper);
  if (args.liquidity <= 0n) {
    throw new RangeError(`[@latchprotocol/widgets] liquidity must be positive: ${args.liquidity}`);
  }
  const p = plan()
    .add(
      ACTIONS.CL_MINT_POSITION,
      encodeAbiParameters(CL_MINT_PARAMS, [
        poolKeyStruct(args.poolKey),
        args.tickLower,
        args.tickUpper,
        args.liquidity,
        args.amount0Max,
        args.amount1Max,
        args.owner,
        args.hookData ?? "0x",
      ]),
      `mint CL position [${args.tickLower}, ${args.tickUpper}]`,
    )
    .add(
      ACTIONS.SETTLE_PAIR,
      encodeAbiParameters(CURRENCY_PAIR, [args.poolKey.currency0, args.poolKey.currency1]),
      "settle both currencies from the caller",
    );

  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [p.encode(), args.deadline],
    }),
    value: args.value ?? 0n,
    planTrace: p.describe(),
  };
}

/** Arguments for decreasing or closing a concentrated-liquidity position. */
export interface BuildCLDecreaseArgs {
  readonly positionManager: Address;
  readonly poolKey: PoolKey;
  readonly tokenId: bigint;
  readonly liquidity: bigint;
  readonly amount0Min: bigint;
  readonly amount1Min: bigint;
  readonly recipient: Address;
  readonly owner: Address;
  readonly deadline: bigint;
  readonly hookData?: Hex;
}

/** Encodes `CL_DECREASE_LIQUIDITY` followed by `TAKE_PAIR`. */
export function buildCLDecreaseCall(args: BuildCLDecreaseArgs): EncodedLiquidityCall {
  if (args.liquidity <= 0n) {
    throw new RangeError(
      `[@latchprotocol/widgets] liquidity to remove must be positive: ${args.liquidity}`,
    );
  }
  const recipient = args.recipient === args.owner ? MSG_SENDER : args.recipient;
  const p = plan()
    .add(
      ACTIONS.CL_DECREASE_LIQUIDITY,
      encodeAbiParameters(CL_MODIFY_PARAMS, [
        args.tokenId,
        args.liquidity,
        args.amount0Min,
        args.amount1Min,
        args.hookData ?? "0x",
      ]),
      `decrease CL position #${args.tokenId} by ${args.liquidity}`,
    )
    .add(
      ACTIONS.TAKE_PAIR,
      encodeAbiParameters(CURRENCY_PAIR_AND_ADDRESS, [
        args.poolKey.currency0,
        args.poolKey.currency1,
        recipient,
      ]),
      "take both currencies to the recipient",
    );

  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [p.encode(), args.deadline],
    }),
    value: 0n,
    planTrace: p.describe(),
  };
}

/** Arguments for adding liquidity to a bin pool. */
export interface BuildBinAddArgs {
  readonly positionManager: Address;
  readonly poolKey: PoolKey;
  readonly amount0: bigint;
  readonly amount1: bigint;
  readonly amount0Max: bigint;
  readonly amount1Max: bigint;
  readonly activeIdDesired: number;
  readonly idSlippage: number;
  /** Bin offsets relative to the active id, one entry per bin. */
  readonly deltaIds: readonly number[];
  /** Share of `amount0` per bin, scaled to 1e18. Must sum to <= 1e18. */
  readonly distributionX: readonly bigint[];
  /** Share of `amount1` per bin, scaled to 1e18. Must sum to <= 1e18. */
  readonly distributionY: readonly bigint[];
  readonly to: Address;
  readonly deadline: bigint;
  readonly hookData?: Hex;
  readonly value?: bigint;
}

/** Encodes `BIN_ADD_LIQUIDITY` followed by `SETTLE_PAIR`. */
export function buildBinAddCall(args: BuildBinAddArgs): EncodedLiquidityCall {
  const binCount = args.deltaIds.length;
  if (binCount === 0) {
    throw new RangeError("[@latchprotocol/widgets] a bin mint must target at least one bin");
  }
  if (args.distributionX.length !== binCount || args.distributionY.length !== binCount) {
    throw new RangeError(
      "[@latchprotocol/widgets] deltaIds, distributionX and distributionY must be the same length",
    );
  }
  if (!Number.isInteger(args.activeIdDesired) || args.activeIdDesired < 0) {
    throw new RangeError(
      `[@latchprotocol/widgets] activeIdDesired must be a non-negative integer: ${args.activeIdDesired}`,
    );
  }

  const p = plan()
    .add(
      ACTIONS.BIN_ADD_LIQUIDITY,
      encodeAbiParameters(BIN_ADD_LIQUIDITY_PARAMS, [
        {
          poolKey: poolKeyStruct(args.poolKey),
          amount0: args.amount0,
          amount1: args.amount1,
          amount0Max: args.amount0Max,
          amount1Max: args.amount1Max,
          activeIdDesired: BigInt(args.activeIdDesired),
          idSlippage: BigInt(args.idSlippage),
          deltaIds: args.deltaIds.map((id) => BigInt(id)),
          distributionX: [...args.distributionX],
          distributionY: [...args.distributionY],
          // One entry per bin. Zero means "accept whatever the pool mints"; the
          // real slippage guard for a bin mint is idSlippage plus amountNMax.
          minLiquidities: args.deltaIds.map(() => 0n),
          to: args.to,
          hookData: args.hookData ?? "0x",
        },
      ]),
      `add bin liquidity across ${binCount} bins around id ${args.activeIdDesired}`,
    )
    .add(
      ACTIONS.SETTLE_PAIR,
      encodeAbiParameters(CURRENCY_PAIR, [args.poolKey.currency0, args.poolKey.currency1]),
      "settle both currencies from the caller",
    );

  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [p.encode(), args.deadline],
    }),
    value: args.value ?? 0n,
    planTrace: p.describe(),
  };
}

/** Arguments for removing liquidity from a bin pool. */
export interface BuildBinRemoveArgs {
  readonly positionManager: Address;
  readonly poolKey: PoolKey;
  readonly amount0Min: bigint;
  readonly amount1Min: bigint;
  /** Bin ids being burned. */
  readonly ids: readonly number[];
  /** Share amount burned per bin, aligned with `ids`. */
  readonly amounts: readonly bigint[];
  readonly from: Address;
  readonly recipient: Address;
  readonly deadline: bigint;
  readonly hookData?: Hex;
}

/** Encodes `BIN_REMOVE_LIQUIDITY` followed by `TAKE_PAIR`. */
export function buildBinRemoveCall(args: BuildBinRemoveArgs): EncodedLiquidityCall {
  if (args.ids.length === 0) {
    throw new RangeError("[@latchprotocol/widgets] a bin burn must target at least one bin");
  }
  if (args.ids.length !== args.amounts.length) {
    throw new RangeError("[@latchprotocol/widgets] ids and amounts must be the same length");
  }
  const recipient = args.recipient === args.from ? MSG_SENDER : args.recipient;
  const p = plan()
    .add(
      ACTIONS.BIN_REMOVE_LIQUIDITY,
      encodeAbiParameters(BIN_REMOVE_LIQUIDITY_PARAMS, [
        {
          poolKey: poolKeyStruct(args.poolKey),
          amount0Min: args.amount0Min,
          amount1Min: args.amount1Min,
          ids: args.ids.map((id) => BigInt(id)),
          amounts: [...args.amounts],
          from: args.from,
          hookData: args.hookData ?? "0x",
        },
      ]),
      `remove bin liquidity from ${args.ids.length} bins`,
    )
    .add(
      ACTIONS.TAKE_PAIR,
      encodeAbiParameters(CURRENCY_PAIR_AND_ADDRESS, [
        args.poolKey.currency0,
        args.poolKey.currency1,
        recipient,
      ]),
      "take both currencies to the recipient",
    );

  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: POSITION_MANAGER_ABI,
      functionName: "modifyLiquidities",
      args: [p.encode(), args.deadline],
    }),
    value: 0n,
    planTrace: p.describe(),
  };
}

function assertTickRange(tickLower: number, tickUpper: number): void {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
    throw new RangeError(
      `[@latchprotocol/widgets] ticks must be integers: [${tickLower}, ${tickUpper}]`,
    );
  }
  if (tickLower >= tickUpper) {
    throw new RangeError(
      `[@latchprotocol/widgets] tickLower must be below tickUpper: [${tickLower}, ${tickUpper}]`,
    );
  }
}

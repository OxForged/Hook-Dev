// SPDX-License-Identifier: MIT
// Encoders for Infinity pool keys, periphery action plans and router commands, plus token and
// account helpers shared by every phase. Written against the ABIs in artifacts/, not copied code.
import { encodeAbiParameters, encodeFunctionData, keccak256, maxUint256, maxUint160, maxUint48, getAddress, concatHex, toHex, pad, numberToHex } from "viem";
import { artifact, ERC20_ABI, EXTERNAL_ABI } from "./abis.mjs";
import { ADDR } from "./addresses.mjs";
import { ANVIL_ACCOUNTS } from "./chain.mjs";

export const ZERO = "0x0000000000000000000000000000000000000000";
export const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const Q96 = 2n ** 96n;
export const DYNAMIC_FEE_FLAG = 0x800000;
export const BIN_ID_ONE = 2 ** 23;

export const ACTORS = {
  alice: getAddress(ANVIL_ACCOUNTS[0]),
  bob: getAddress(ANVIL_ACCOUNTS[1]),
  carol: getAddress(ANVIL_ACCOUNTS[2]),
  dave: getAddress(ANVIL_ACCOUNTS[3]),
  erin: getAddress(ANVIL_ACCOUNTS[4]),
  mallory: getAddress(ANVIL_ACCOUNTS[9]), // the unauthorized caller everywhere
};

export const ABI = new Proxy({}, { get: (_, name) => artifact(name).abi });

export const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
];
const POOL_KEY = { type: "tuple", components: POOL_KEY_COMPONENTS };

export function poolId(key) {
  return keccak256(encodeAbiParameters([POOL_KEY], [key]));
}

export function clParameters(tickSpacing, bitmap = 0) {
  return pad(numberToHex((BigInt(tickSpacing) << 16n) | BigInt(bitmap)), { size: 32 });
}
export function binParameters(binStep, bitmap = 0) {
  return pad(numberToHex((BigInt(binStep) << 16n) | BigInt(bitmap)), { size: 32 });
}

export function sortTokens(a, b) {
  return BigInt(a) < BigInt(b) ? [getAddress(a), getAddress(b)] : [getAddress(b), getAddress(a)];
}

export function clKey(tokenA, tokenB, { fee = 3000, tickSpacing = 60, hooks = ZERO, bitmap = 0 } = {}) {
  const [c0, c1] = sortTokens(tokenA, tokenB);
  return { currency0: c0, currency1: c1, hooks: getAddress(hooks), poolManager: ADDR.clPoolManager, fee, parameters: clParameters(tickSpacing, bitmap) };
}
export function binKey(tokenA, tokenB, { fee = 3000, binStep = 10, hooks = ZERO, bitmap = 0 } = {}) {
  const [c0, c1] = sortTokens(tokenA, tokenB);
  return { currency0: c0, currency1: c1, hooks: getAddress(hooks), poolManager: ADDR.binPoolManager, fee, parameters: binParameters(binStep, bitmap) };
}

/* ----------------------------- action plans ----------------------------- */

export const A = {
  CL_INCREASE_LIQUIDITY: 0x00, CL_DECREASE_LIQUIDITY: 0x01, CL_MINT_POSITION: 0x02, CL_BURN_POSITION: 0x03,
  CL_INCREASE_LIQUIDITY_FROM_DELTAS: 0x04, CL_MINT_POSITION_FROM_DELTAS: 0x05, CL_SWAP_EXACT_IN_SINGLE: 0x06,
  CL_SWAP_EXACT_IN: 0x07, CL_SWAP_EXACT_OUT_SINGLE: 0x08, CL_SWAP_EXACT_OUT: 0x09, CL_DONATE: 0x0a,
  SETTLE: 0x0b, SETTLE_ALL: 0x0c, SETTLE_PAIR: 0x0d, TAKE: 0x0e, TAKE_ALL: 0x0f, TAKE_PORTION: 0x10, TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12, CLEAR_OR_TAKE: 0x13, SWEEP: 0x14, WRAP: 0x15, UNWRAP: 0x16, MINT_6909: 0x17, BURN_6909: 0x18,
  BIN_ADD_LIQUIDITY: 0x19, BIN_REMOVE_LIQUIDITY: 0x1a, BIN_ADD_LIQUIDITY_FROM_DELTAS: 0x1b, BIN_SWAP_EXACT_IN_SINGLE: 0x1c,
  BIN_SWAP_EXACT_IN: 0x1d, BIN_SWAP_EXACT_OUT_SINGLE: 0x1e, BIN_SWAP_EXACT_OUT: 0x1f, BIN_DONATE: 0x20,
};

const enc = (types, values) => encodeAbiParameters(types.map((t) => (typeof t === "string" ? { type: t } : t)), values);

export const P = {
  clMint: (key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData = "0x") =>
    enc([POOL_KEY, "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"], [key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData]),
  clModify: (tokenId, liquidity, a0, a1, hookData = "0x") => enc(["uint256", "uint256", "uint128", "uint128", "bytes"], [tokenId, liquidity, a0, a1, hookData]),
  clBurn: (tokenId, a0Min, a1Min, hookData = "0x") => enc(["uint256", "uint128", "uint128", "bytes"], [tokenId, a0Min, a1Min, hookData]),
  pair: (c0, c1) => enc(["address", "address"], [c0, c1]),
  pairTo: (c0, c1, to) => enc(["address", "address", "address"], [c0, c1, to]),
  currencyAmount: (c, amt) => enc(["address", "uint256"], [c, amt]),
  sweep: (c, to) => enc(["address", "address"], [c, to]),
  clSwapExactInSingle: (key, zeroForOne, amountIn, amountOutMinimum, hookData = "0x") =>
    enc([{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum, hookData }]),
  clSwapExactOutSingle: (key, zeroForOne, amountOut, amountInMaximum, hookData = "0x") =>
    enc([{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "zeroForOne", type: "bool" }, { name: "amountOut", type: "uint128" }, { name: "amountInMaximum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, zeroForOne, amountOut, amountInMaximum, hookData }]),
  binSwapExactInSingle: (key, swapForY, amountIn, amountOutMinimum, hookData = "0x") =>
    enc([{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "swapForY", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, swapForY, amountIn, amountOutMinimum, hookData }]),
  binAdd: (o) =>
    enc(
      [{ type: "tuple", components: [
        { name: "poolKey", ...POOL_KEY }, { name: "amount0", type: "uint128" }, { name: "amount1", type: "uint128" }, { name: "amount0Max", type: "uint128" }, { name: "amount1Max", type: "uint128" },
        { name: "activeIdDesired", type: "uint256" }, { name: "idSlippage", type: "uint256" }, { name: "deltaIds", type: "int256[]" }, { name: "distributionX", type: "uint256[]" },
        { name: "distributionY", type: "uint256[]" }, { name: "minLiquidities", type: "uint256[]" }, { name: "to", type: "address" }, { name: "hookData", type: "bytes" },
      ] }],
      [o],
    ),
  binRemove: (o) =>
    enc([{ type: "tuple", components: [{ name: "poolKey", ...POOL_KEY }, { name: "amount0Min", type: "uint128" }, { name: "amount1Min", type: "uint128" }, { name: "ids", type: "uint256[]" }, { name: "amounts", type: "uint256[]" }, { name: "from", type: "address" }, { name: "hookData", type: "bytes" }] }], [o]),
};

/** abi.encode(bytes actions, bytes[] params) — the payload for modifyLiquidities and INFI_SWAP. */
export function plan(steps) {
  const actions = concatHex(steps.map(([a]) => toHex(a, { size: 1 })));
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, steps.map(([, p]) => p)]);
}

export const deadline = (chainTs) => chainTs + 3600n;

/** UniversalRouter.execute(commands, inputs, deadline) for a single INFI_SWAP. */
export function routerInfiSwap(steps) {
  return { commands: "0x10", inputs: [plan(steps)] };
}

/* ----------------------------- token helpers ----------------------------- */

export async function deployToken(rec, from, name, symbol, decimals = 18) {
  const a = artifact("helpers/CampaignToken");
  return getAddress(await rec.deploy({ from, abi: a.abi, bytecode: a.bytecode, args: [name, symbol, decimals], contract: "CampaignToken", note: `throwaway ${symbol}` }));
}

/** Mint (throwaway) and approve Permit2 + Permit2-approve the given spenders. Setup txs are recorded with role=setup. */
export async function fundAndApprove(rec, token, owner, amount, spenders = [], { mint = true } = {}) {
  if (mint) await rec.send({ from: owner, to: token, abi: ABI["helpers/CampaignToken"], fn: "mint", args: [owner, amount], role: "setup", contract: "CampaignToken" });
  await rec.send({ from: owner, to: token, abi: ERC20_ABI, fn: "approve", args: [ADDR.permit2, maxUint256], role: "setup", contract: "ERC20" });
  for (const s of spenders) {
    await rec.send({ from: owner, to: ADDR.permit2, abi: EXTERNAL_ABI, fn: "approve", args: [token, s, maxUint160, Number(maxUint48)], role: "setup", contract: "Permit2" });
  }
}

export async function balanceOf(chain, token, who) {
  return chain.read(token, ERC20_ABI, "balanceOf", [who]);
}

export function actorCall(target, abi, fn, args = [], value = 0n) {
  return { target, value, data: encodeFunctionData({ abi, functionName: fn, args }) };
}

export const MAX128 = 2n ** 128n - 1n;
export { maxUint256, maxUint160, maxUint48 };

/** Dummy args for every CL hook callback, for the "only the pool manager may call" negative tests. */
export function hookCallbackCalls(key, sender) {
  const mlp = { tickLower: -60, tickUpper: 60, liquidityDelta: 1n, salt: ZERO32 };
  const sp = { zeroForOne: true, amountSpecified: -1n, sqrtPriceLimitX96: 4295128740n };
  return [
    ["beforeInitialize", [sender, key, Q96]],
    ["afterInitialize", [sender, key, Q96, 0]],
    ["beforeAddLiquidity", [sender, key, mlp, "0x"]],
    ["afterAddLiquidity", [sender, key, mlp, 0n, 0n, "0x"]],
    ["beforeRemoveLiquidity", [sender, key, mlp, "0x"]],
    ["afterRemoveLiquidity", [sender, key, mlp, 0n, 0n, "0x"]],
    ["beforeSwap", [sender, key, sp, "0x"]],
    ["afterSwap", [sender, key, sp, 0n, "0x"]],
    ["beforeDonate", [sender, key, 1n, 1n, "0x"]],
    ["afterDonate", [sender, key, 1n, 1n, "0x"]],
  ];
}

export const MIN_SQRT = 4295128740n;
export const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

/** Router plan for an exact-in single CL swap paid by msg.sender. */
export function swapInPlan(k, zeroForOne, amountIn, minOut = 0n) {
  const cin = zeroForOne ? k.currency0 : k.currency1, cout = zeroForOne ? k.currency1 : k.currency0;
  return plan([[A.CL_SWAP_EXACT_IN_SINGLE, P.clSwapExactInSingle(k, zeroForOne, amountIn, minOut)], [A.SETTLE_ALL, P.currencyAmount(cin, maxUint256)], [A.TAKE_ALL, P.currencyAmount(cout, minOut)]]);
}
export function swapOutPlan(k, zeroForOne, amountOut, maxIn = MAX128) {
  const cin = zeroForOne ? k.currency0 : k.currency1, cout = zeroForOne ? k.currency1 : k.currency0;
  return plan([[A.CL_SWAP_EXACT_OUT_SINGLE, P.clSwapExactOutSingle(k, zeroForOne, amountOut, maxIn)], [A.SETTLE_ALL, P.currencyAmount(cin, maxUint256)], [A.TAKE_ALL, P.currencyAmount(cout, 0n)]]);
}

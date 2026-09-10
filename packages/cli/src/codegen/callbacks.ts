/**
 * The Solidity shape of every `BaseCLHook` override point.
 *
 * Signatures are transcribed from `packages/hooks/src/base/BaseCLHook.sol`. A
 * template supplies a body for the callbacks it cares about; every other
 * selected permission gets the pass-through body below, so a generated hook
 * always implements exactly the callbacks it registers. That matters: the base
 * contract's unimplemented override points `revert HookNotImplemented()`, so a
 * registered-but-unimplemented callback would brick the pool at the first swap.
 */

import type { PermissionName } from "../permissions.js";

export interface CallbackParam {
  readonly type: string;
  readonly name: string;
}

export interface CallbackSpec {
  /** Internal override point on `BaseCLHook`, e.g. `_beforeSwap`. */
  readonly fn: string;
  readonly params: readonly CallbackParam[];
  /** Return type list as it appears after `returns`. */
  readonly returns: string;
  /** Body used when the template does not implement this callback. */
  readonly passthroughBody: string;
  /** Solidity types referenced by the signature, used to compute imports. */
  readonly types: readonly string[];
}

const KEY: CallbackParam = { type: "PoolKey calldata", name: "key" };
const SENDER: CallbackParam = { type: "address", name: "sender" };
const HOOK_DATA: CallbackParam = { type: "bytes calldata", name: "hookData" };
const LIQUIDITY_PARAMS: CallbackParam = {
  type: "ICLPoolManager.ModifyLiquidityParams calldata",
  name: "params",
};

/** Only the ten real callbacks appear here; the four delta flags add no function. */
export const CALLBACKS: Readonly<Partial<Record<PermissionName, CallbackSpec>>> = {
  beforeInitialize: {
    fn: "_beforeInitialize",
    params: [SENDER, KEY, { type: "uint160", name: "sqrtPriceX96" }],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.beforeInitialize.selector;",
    types: ["PoolKey", "ICLHooks"],
  },
  afterInitialize: {
    fn: "_afterInitialize",
    params: [SENDER, KEY, { type: "uint160", name: "sqrtPriceX96" }, { type: "int24", name: "tick" }],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.afterInitialize.selector;",
    types: ["PoolKey", "ICLHooks"],
  },
  beforeAddLiquidity: {
    fn: "_beforeAddLiquidity",
    params: [SENDER, KEY, LIQUIDITY_PARAMS, HOOK_DATA],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.beforeAddLiquidity.selector;",
    types: ["PoolKey", "ICLPoolManager", "ICLHooks"],
  },
  afterAddLiquidity: {
    fn: "_afterAddLiquidity",
    params: [
      SENDER,
      KEY,
      LIQUIDITY_PARAMS,
      { type: "BalanceDelta", name: "delta" },
      { type: "BalanceDelta", name: "feesAccrued" },
      HOOK_DATA,
    ],
    returns: "(bytes4, BalanceDelta)",
    passthroughBody: "return _passthroughLiquidity(ICLHooks.afterAddLiquidity.selector);",
    types: ["PoolKey", "ICLPoolManager", "BalanceDelta", "ICLHooks"],
  },
  beforeRemoveLiquidity: {
    fn: "_beforeRemoveLiquidity",
    params: [SENDER, KEY, LIQUIDITY_PARAMS, HOOK_DATA],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.beforeRemoveLiquidity.selector;",
    types: ["PoolKey", "ICLPoolManager", "ICLHooks"],
  },
  afterRemoveLiquidity: {
    fn: "_afterRemoveLiquidity",
    params: [
      SENDER,
      KEY,
      LIQUIDITY_PARAMS,
      { type: "BalanceDelta", name: "delta" },
      { type: "BalanceDelta", name: "feesAccrued" },
      HOOK_DATA,
    ],
    returns: "(bytes4, BalanceDelta)",
    passthroughBody: "return _passthroughLiquidity(ICLHooks.afterRemoveLiquidity.selector);",
    types: ["PoolKey", "ICLPoolManager", "BalanceDelta", "ICLHooks"],
  },
  beforeSwap: {
    fn: "_beforeSwap",
    params: [SENDER, KEY, { type: "ICLPoolManager.SwapParams calldata", name: "params" }, HOOK_DATA],
    returns: "(bytes4, BeforeSwapDelta, uint24)",
    passthroughBody: "return _passthroughSwap();",
    types: ["PoolKey", "ICLPoolManager", "BeforeSwapDelta", "ICLHooks"],
  },
  afterSwap: {
    fn: "_afterSwap",
    params: [
      SENDER,
      KEY,
      { type: "ICLPoolManager.SwapParams calldata", name: "params" },
      { type: "BalanceDelta", name: "delta" },
      HOOK_DATA,
    ],
    returns: "(bytes4, int128)",
    passthroughBody: "return (ICLHooks.afterSwap.selector, int128(0));",
    types: ["PoolKey", "ICLPoolManager", "BalanceDelta", "ICLHooks"],
  },
  beforeDonate: {
    fn: "_beforeDonate",
    params: [
      SENDER,
      KEY,
      { type: "uint256", name: "amount0" },
      { type: "uint256", name: "amount1" },
      HOOK_DATA,
    ],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.beforeDonate.selector;",
    types: ["PoolKey", "ICLHooks"],
  },
  afterDonate: {
    fn: "_afterDonate",
    params: [
      SENDER,
      KEY,
      { type: "uint256", name: "amount0" },
      { type: "uint256", name: "amount1" },
      HOOK_DATA,
    ],
    returns: "bytes4",
    passthroughBody: "return ICLHooks.afterDonate.selector;",
    types: ["PoolKey", "ICLHooks"],
  },
};

/** A template's implementation of one callback. */
export interface CallbackImpl {
  /** Parameter names the body reads; the rest are emitted unnamed to avoid warnings. */
  readonly uses?: readonly string[];
  /** `view`, `pure`, or omitted for a state-mutating override. */
  readonly mutability?: "view" | "pure";
  /** Body, without the surrounding braces. Indented to 8 spaces by the renderer. */
  readonly body: string;
  /** Doc comment lines placed above the function. */
  readonly doc?: readonly string[];
  /** Extra Solidity types this body needs imported. */
  readonly types?: readonly string[];
}

function indent(body: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return body
    .split("\n")
    .map((line) => (line.trim().length === 0 ? "" : pad + line))
    .join("\n");
}

/**
 * Renders one override.
 *
 * Parameters the body does not read are emitted without a name. Solidity allows
 * that, and it keeps `forge build` free of "unused parameter" warnings so real
 * warnings stay visible.
 */
export function renderCallback(spec: CallbackSpec, impl: CallbackImpl | undefined): string {
  const used = new Set(impl?.uses ?? []);
  const params = spec.params
    .map((param) => (used.has(param.name) ? `${param.type} ${param.name}` : param.type))
    .join(", ");

  // A pass-through body only returns a constant, so it is `pure`. Saying so keeps
  // `forge build` free of "can be restricted to pure" warnings, which otherwise
  // bury the warnings that matter.
  const effectiveMutability = impl === undefined ? "pure" : impl.mutability;
  const mutability = effectiveMutability === undefined ? "" : `\n        ${effectiveMutability}`;
  const body = indent(impl?.body ?? spec.passthroughBody, 8);
  const doc = (impl?.doc ?? []).map((line) => `    /// ${line}`).join("\n");

  // Solidity always parenthesises a `returns` list, even a single type.
  const returns = spec.returns.startsWith("(") ? spec.returns : `(${spec.returns})`;

  const header = `    function ${spec.fn}(${params})\n        internal${mutability}\n        override\n        returns ${returns}\n    {`;

  return `${doc.length > 0 ? `${doc}\n` : ""}${header}\n${body}\n    }`;
}

/** Import statements for a set of Solidity type names. */
const IMPORT_LINES: Readonly<Record<string, string>> = {
  PoolKey: 'import {PoolKey} from "infinity-core/src/types/PoolKey.sol";',
  ICLPoolManager: 'import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";',
  ICLHooks: 'import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";',
  BalanceDelta: 'import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";',
  BeforeSwapDelta:
    'import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "infinity-core/src/types/BeforeSwapDelta.sol";',
  LPFeeLibrary: 'import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";',
  PoolId: 'import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";',
  Currency: 'import {Currency} from "infinity-core/src/types/Currency.sol";',
};

/** Deterministic import block for the given type names. */
export function renderImports(types: Iterable<string>): string {
  const order = Object.keys(IMPORT_LINES);
  const unique = [...new Set(types)].filter((type) => IMPORT_LINES[type] !== undefined);
  unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return unique.map((type) => IMPORT_LINES[type] as string).join("\n");
}

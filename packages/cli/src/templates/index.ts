/**
 * Starting points for a generated hook.
 *
 * A template supplies bodies for the callbacks it needs, plus contract members,
 * constructor arguments and extra tests. It does NOT own the permission set:
 * the developer's selection wins, and the template contributes only its default
 * selection. If a template's callback is deselected the template's body for it
 * is dropped and the generator falls back to a pass-through, so the emitted
 * project always compiles and always registers exactly what it implements.
 */

import type { CallbackImpl } from "../codegen/callbacks.js";
import type { PermissionName } from "../permissions.js";

/** An extra constructor argument a template needs. */
export interface ExtraConstructorArg {
  readonly type: string;
  readonly name: string;
  /** NatSpec `@param` text. */
  readonly doc: string;
  /** Literal used by the generated tests. */
  readonly testValue: string;
  /** Expression used by the generated deploy script (may read env vars). */
  readonly deployExpr: string;
}

export interface HookTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Permissions pre-selected when this template is chosen. */
  readonly defaultPermissions: readonly PermissionName[];
  /**
   * Permissions the template's bodies and tests depend on. When the developer
   * deselects one of these, the template's custom code is dropped.
   */
  readonly requires: readonly PermissionName[];
  /** `true` when the template only makes sense on a dynamic-fee pool. */
  readonly dynamicFee: boolean;
  /** NatSpec lines for the contract. */
  readonly contractDoc: readonly string[];
  /** Solidity types needed by members/constructor beyond the callbacks' own. */
  readonly types?: readonly string[];
  /** State variables, constants, events and errors, already indented 4 spaces. */
  readonly members?: string;
  readonly constructorArgs?: readonly ExtraConstructorArg[];
  readonly implementations: Partial<Record<PermissionName, CallbackImpl>>;
  /** Extra test functions, already indented 4 spaces. Rendered after the shared ones. */
  readonly extraTests?: (contractName: string) => string;
  /** Extra imports for the generated test file. */
  readonly testImports?: readonly string[];
  /** Bullet points appended to the generated README. */
  readonly readmeNotes: readonly string[];
}

const NOOP: HookTemplate = {
  id: "noop",
  label: "noop",
  description: "the smallest hook that builds, deploys and backs a live pool",
  defaultPermissions: ["beforeSwap"],
  requires: ["beforeSwap"],
  dynamicFee: false,
  contractDoc: [
    "@notice A hook that observes swaps and changes nothing.",
    "@dev Start here. It registers exactly one callback, implements exactly that",
    "callback, and returns the selector the pool manager expects. Replace the body",
    "of `_beforeSwap` with your logic, and add permissions with",
    "`create-latch-hook --permissions` (or by hand - but then remember to update",
    "BOTH `getHooksRegistrationBitmap()` and the pool key's `parameters`).",
  ],
  implementations: {
    beforeSwap: {
      doc: [
        "@dev Pass-through. The third return value is an LP fee override; it is",
        "read only on dynamic-fee pools, so returning 0 here is a no-op.",
      ],
      mutability: "pure",
      body: "return _passthroughSwap();",
    },
  },
  readmeNotes: [
    "`_beforeSwap` currently does nothing. It is the hot path for dynamic fees, swap gating and custom curves.",
  ],
};

const DYNAMIC_FEE: HookTemplate = {
  id: "dynamic-fee",
  label: "dynamic-fee",
  description: "beforeSwap sets the LP fee per swap, priced off swap size",
  defaultPermissions: ["beforeSwap"],
  requires: ["beforeSwap"],
  dynamicFee: true,
  contractDoc: [
    "@notice Charges a higher LP fee on large swaps than on small ones.",
    "@dev Two things have to line up for a fee override to take effect:",
    "  1. the pool's `fee` field must be exactly `LPFeeLibrary.DYNAMIC_FEE_FLAG`",
    "     (0x800000) - the generated deploy script and tests already do this; and",
    "  2. the fee returned from `beforeSwap` must carry `OVERRIDE_FEE_FLAG`.",
    "Miss either and the pool silently keeps using its stored LP fee, which for a",
    "dynamic-fee pool starts at ZERO. That is the quiet failure mode of fee hooks:",
    "no revert, no event, just free swaps.",
  ],
  types: ["LPFeeLibrary", "BeforeSwapDelta"],
  members: `    /// @notice LP fee charged below the threshold: 0.30%, in hundredths of a bip
    uint24 public constant BASE_FEE = 3000;

    /// @notice LP fee charged at or above the threshold: 1.00%
    uint24 public constant LARGE_SWAP_FEE = 10_000;

    /// @notice Swap size, in the swap's specified currency, at which LARGE_SWAP_FEE starts to apply
    /// @dev Immutable so the fee schedule cannot be changed after deployment. If you make it
    /// mutable, gate the setter: a hook that can raise the fee mid-block can sandwich its own users.
    uint256 public immutable largeSwapThreshold;`,
  constructorArgs: [
    {
      type: "uint256",
      name: "largeSwapThreshold",
      doc: "Swap size at or above which LARGE_SWAP_FEE applies",
      testValue: "1 ether",
      deployExpr: 'vm.envOr("LARGE_SWAP_THRESHOLD", uint256(1 ether))',
    },
  ],
  implementations: {
    beforeSwap: {
      uses: ["params"],
      mutability: "view",
      doc: [
        "@dev Returns `fee | OVERRIDE_FEE_FLAG`. Without the flag the pool manager",
        "ignores the value entirely (see `CLPool.swap`).",
      ],
      body: `int256 specified = params.amountSpecified;
// Negate without overflowing on type(int256).min.
uint256 size = specified < 0 ? uint256(-(specified + 1)) + 1 : uint256(specified);

uint24 fee = size >= largeSwapThreshold ? LARGE_SWAP_FEE : BASE_FEE;

return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);`,
    },
  },
  extraTests: (contractName) => `    /// @notice The fee schedule actually reaches the pool.
    /// @dev Two pools, identical except for the hook's threshold, so one always charges
    /// BASE_FEE and the other always charges LARGE_SWAP_FEE. Same liquidity, same swap:
    /// the expensive pool must return strictly less.
    function test_largeSwapsPayMore() public {
        ${contractName} cheapHook = new ${contractName}(poolManager, type(uint256).max);
        ${contractName} pricyHook = new ${contractName}(poolManager, 1);

        PoolKey memory cheapKey = _keyWithHook(address(cheapHook));
        PoolKey memory pricyKey = _keyWithHook(address(pricyHook));

        poolManager.initialize(cheapKey, SQRT_PRICE_1_1);
        poolManager.initialize(pricyKey, SQRT_PRICE_1_1);
        _addLiquidity(cheapKey);
        _addLiquidity(pricyKey);

        int128 cheapOut = _swap(cheapKey, true, -1 ether).amount1();
        int128 pricyOut = _swap(pricyKey, true, -1 ether).amount1();

        assertGt(cheapOut, 0, "cheap pool returned nothing");
        assertLt(pricyOut, cheapOut, "higher fee did not reduce the swap output");
    }

    /// @notice A dynamic-fee pool with no working override charges nothing.
    /// @dev Guards the failure mode described on the contract: the pool's stored LP fee
    /// starts at 0, so a broken override does not revert, it just gives swaps away.
    function test_overrideFlagIsSet() public view {
        assertTrue(
            hook.BASE_FEE() & LPFeeLibrary.OVERRIDE_FEE_FLAG == 0,
            "BASE_FEE must not already carry the override flag"
        );
        assertTrue(LPFeeLibrary.isDynamicLPFee(LP_FEE), "pool must be a dynamic-fee pool");
    }`,
  testImports: ["LPFeeLibrary"],
  readmeNotes: [
    "The pool is created with `fee = LPFeeLibrary.DYNAMIC_FEE_FLAG`. A static-fee pool ignores the override and this hook becomes a no-op.",
    "`largeSwapThreshold` is a constructor argument; the deploy script reads `LARGE_SWAP_THRESHOLD` from the environment.",
  ],
};

const SWAP_COUNTER: HookTemplate = {
  id: "swap-counter",
  label: "swap-counter",
  description: "afterSwap keeps a per-pool swap count on chain",
  defaultPermissions: ["afterSwap"],
  requires: ["afterSwap"],
  dynamicFee: false,
  contractDoc: [
    "@notice Counts the swaps executed on every pool that registers this hook.",
    "@dev One hook deployment can back many pools, so the counter is keyed by",
    "`PoolId` rather than kept in a single slot. Note the hook does not, and must",
    "not, trust anything but the pool manager: `onlyPoolManager` on the external",
    "callback is what stops anyone from inflating the counter for free.",
  ],
  types: ["PoolId"],
  members: `    /// @notice Number of swaps seen on each pool
    mapping(PoolId poolId => uint256 count) public swapCount;

    /// @notice Emitted once per swap, after the swap has been executed
    event SwapCounted(PoolId indexed poolId, uint256 count);`,
  implementations: {
    afterSwap: {
      uses: ["key"],
      body: `PoolId poolId = key.toId();
uint256 count = ++swapCount[poolId];
emit SwapCounted(poolId, count);

// The second return value is the hook's delta in the unspecified currency.
// It is only read when afterSwapReturnsDelta is registered; this hook takes nothing.
return (ICLHooks.afterSwap.selector, int128(0));`,
    },
  },
  extraTests: () => `    /// @notice Every swap bumps the counter for its own pool, and only its own pool.
    function test_countsSwapsPerPool() public {
        PoolId poolId = key.toId();
        assertEq(hook.swapCount(poolId), 0, "counter should start at zero");

        _swap(key, true, -0.1 ether);
        _swap(key, false, -0.1 ether);
        _swap(key, true, -0.1 ether);

        assertEq(hook.swapCount(poolId), 3, "counter did not follow the swaps");
    }

    /// @notice The callback is not reachable except through the pool manager.
    /// @dev Without this guard anyone could call afterSwap directly and desynchronise
    /// the counter from reality - cheap here, fatal for a hook that moves funds.
    function test_afterSwapRejectsDirectCalls() public {
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.afterSwap(
            address(this),
            key,
            ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 0}),
            BalanceDelta.wrap(0),
            ""
        );
    }`,
  readmeNotes: [
    "`swapCount` is keyed by `PoolId`, so one deployment can serve many pools.",
    "The counter is written from `afterSwap`, which runs after the swap is settled - it can observe, not veto.",
  ],
};

export const TEMPLATES: readonly HookTemplate[] = [NOOP, DYNAMIC_FEE, SWAP_COUNTER];

export const DEFAULT_TEMPLATE_ID = NOOP.id;

export function findTemplate(id: string): HookTemplate | undefined {
  const wanted = id.trim().toLowerCase();
  return TEMPLATES.find((template) => template.id === wanted);
}

export function templateIds(): string[] {
  return TEMPLATES.map((template) => template.id);
}

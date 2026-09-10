// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal stand-ins for the core types a hook sees.
/// @dev Deliberately self-contained: the fixtures must compile without the
/// protocol's GPL core, and the rules key on callback names and structure
/// rather than on core's concrete types. The no-false-positive test runs
/// against the real hooks, which do use the real core.

struct PoolKey {
    address currency0;
    address currency1;
    address hooks;
    address poolManager;
    uint24 fee;
    bytes32 parameters;
}

type BalanceDelta is int256;

type BeforeSwapDelta is int256;

library BeforeSwapDeltaLibrary {
    BeforeSwapDelta internal constant ZERO_DELTA = BeforeSwapDelta.wrap(0);
}

library BalanceDeltaLibrary {
    BalanceDelta internal constant ZERO_DELTA = BalanceDelta.wrap(0);
}

library LPFeeLibrary {
    uint24 internal constant DYNAMIC_FEE_FLAG = 0x800000;
    uint24 internal constant OVERRIDE_FEE_FLAG = 0x400000;
    uint24 internal constant ONE_HUNDRED_PERCENT_FEE = 1_000_000;

    function isDynamicLPFee(uint24 self) internal pure returns (bool) {
        return self == DYNAMIC_FEE_FLAG;
    }
}

library PoolIdLibrary {
    function toId(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}

interface ICLPoolManager {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta);

    function donate(PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external
        returns (BalanceDelta);
}

interface IHooks {
    function getHooksRegistrationBitmap() external view returns (uint16);
    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4);
    function afterInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96, int24 tick)
        external
        returns (bytes4);
    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4);
    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta);
    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4);
    function afterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta);
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, BeforeSwapDelta, uint24);
    function afterSwap(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128);
    function beforeDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external
        returns (bytes4);
    function afterDonate(address sender, PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external
        returns (bytes4);
}

/// @notice A thing a hook might consult. Used to exercise the external-call rules.
interface IOracle {
    function isPaused() external view returns (bool);
    function price() external view returns (uint256);
}

/// @notice Uniswap v4's permission struct, so the linter's v4 support can be tested.
library Hooks {
    struct Permissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveLiquidityReturnDelta;
    }
}

interface IBinPoolManager {
    struct MintParams {
        bytes32[] liquidityConfigs;
        bytes32 amountIn;
        bytes32 salt;
    }

    struct BurnParams {
        uint256[] ids;
        uint256[] amountsToBurn;
        bytes32 salt;
    }

    struct SwapParams {
        bool swapForY;
        int128 amountSpecified;
    }
}

/// @notice Bin callbacks. `beforeMint` returns `(bytes4, uint24)`: the fee sits
/// at tuple position 1, not 2 as it does on `beforeSwap`.
interface IBinHooks {
    function beforeInitialize(address sender, PoolKey calldata key, uint24 activeId) external returns (bytes4);
    function afterInitialize(address sender, PoolKey calldata key, uint24 activeId) external returns (bytes4);
    function beforeMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, uint24);
    function afterMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta);
    function beforeBurn(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.BurnParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4);
    function afterBurn(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.BurnParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta);
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4, BeforeSwapDelta, uint24);
    function afterSwap(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    Hooks,
    ICLPoolManager,
    IHooks,
    PoolKey
} from "../Stubs.sol";

/// @notice A Uniswap-v4-shaped hook: permissions come from a `Permissions`
/// struct rather than a uint16 bitmap. It is written correctly, so the linter
/// must find nothing - the point being that the rules apply to a v4 hook a
/// Latch user never deploys.
contract CleanV4Hook {
    error NotPoolManager();

    ICLPoolManager public immutable poolManager;

    constructor(ICLPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) external view onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

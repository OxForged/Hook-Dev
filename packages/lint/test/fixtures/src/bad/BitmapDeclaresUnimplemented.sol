// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixtureBaseHook} from "../FixtureBaseHook.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";

/// @dev LATCH-002. The bitmap registers `afterSwap`, but `_afterSwap` was never
/// overridden, so the base's `revert HookNotImplemented()` is what the pool
/// manager will actually reach on every swap.
contract BitmapDeclaresUnimplemented is FixtureBaseHook {
    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP | AFTER_SWAP;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

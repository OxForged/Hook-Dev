// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    BalanceDelta,
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    ICLPoolManager,
    IHooks,
    PoolKey
} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-002, the other direction. `_afterSwap` is implemented and does
/// real accounting, but bit 7 is missing from the bitmap, so the pool manager
/// never calls it and the accounting silently never happens.
contract BitmapOmitsImplemented is FixtureBaseHook {
    uint256 public swapCount;

    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _afterSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        BalanceDelta, /* delta */
        bytes calldata /* hookData */
    ) internal override returns (bytes4, int128) {
        swapCount += 1;
        return (IHooks.afterSwap.selector, int128(0));
    }
}

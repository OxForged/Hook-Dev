// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-008. A copy-paste slip: `beforeSwap` hands back `afterSwap`'s
/// selector. Core compares the returned value and reverts with
/// `InvalidHookResponse`, so every swap on the pool fails.
contract WrongSelectorReturn is FixtureBaseHook {
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
        return (IHooks.afterSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

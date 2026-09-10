// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-010. The callback calls back into the pool manager while the
/// manager is part-way through the swap that invoked it, with the Vault lock
/// already held and the pool's state mid-update.
contract ManagerReentrancy is FixtureBaseHook {
    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        poolManager.donate(key, 1, 1, "");
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

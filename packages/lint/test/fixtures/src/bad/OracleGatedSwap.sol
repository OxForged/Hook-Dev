// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, IOracle, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-006. Trading stops whenever an outside contract says so. Whoever
/// controls that contract - or anything that makes the call revert - can make
/// the pool untradeable at will.
contract OracleGatedSwap is FixtureBaseHook {
    error MarketPaused();

    IOracle public immutable oracle;

    constructor(ICLPoolManager _poolManager, IOracle _oracle) FixtureBaseHook(_poolManager) {
        oracle = _oracle;
    }

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        if (oracle.isPaused()) revert MarketPaused();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

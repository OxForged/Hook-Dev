// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BalanceDelta, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-003. `beforeSwapReturnsDelta` (bit 10) is declared without
/// `beforeSwap` (bit 6). The pool manager rejects the combination, so no pool
/// naming this hook can ever be initialized.
contract DeltaWithoutBaseCallback is FixtureBaseHook {
    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return AFTER_SWAP | BEFORE_SWAP_RETURNS_DELTA;
    }

    function _afterSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        BalanceDelta, /* delta */
        bytes calldata /* hookData */
    ) internal pure override returns (bytes4, int128) {
        return (IHooks.afterSwap.selector, int128(0));
    }
}

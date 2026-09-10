// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-005. A per-wallet buy cap keyed on `sender`. `sender` is the Vault
/// locker - the router - so one router's first buyer consumes the whole cap on
/// behalf of everyone, and anyone can bypass it by locking the Vault directly.
contract PerWalletCap is FixtureBaseHook {
    error CapExceeded(address buyer, uint256 total);

    uint256 public constant CAP = 1 ether;

    mapping(address buyer => uint256 amount) internal _bought;

    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP;
    }

    function _beforeSwap(
        address sender,
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata params,
        bytes calldata /* hookData */
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        int256 specified = params.amountSpecified;
        uint256 amountIn = specified < 0 ? uint256(-specified) : 0;

        _bought[sender] += amountIn;
        if (_bought[sender] > CAP) revert CapExceeded(sender, _bought[sender]);

        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }
}

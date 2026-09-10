// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    ICLPoolManager,
    IHooks,
    LPFeeLibrary,
    PoolKey
} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-004. This hook exists to charge a launch tax, and returns one from
/// `beforeSwap` - but it never registers `beforeInitialize`, so nothing stops a
/// pool being created against it with a static fee, where core discards the
/// returned value with no revert and no event. The protection is decorative.
contract SilentFeeOverride is FixtureBaseHook {
    uint24 public constant LAUNCH_FEE = 300_000;

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
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            LAUNCH_FEE | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}

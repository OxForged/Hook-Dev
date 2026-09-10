// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixtureBaseBinHook} from "../FixtureBaseBinHook.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    IBinHooks,
    IBinPoolManager,
    ICLPoolManager,
    LPFeeLibrary,
    PoolKey
} from "../Stubs.sol";

/// @dev LATCH-011. A line-for-line port of a CL launch guard to bin: it charges
/// a launch tax through `beforeSwap` and registers nothing else. On bin, minting
/// lopsidedly into the active bin is an implicit swap priced from the pool's
/// STORED LP fee - 0 on a dynamic-fee pool - so mint+burn is a free route
/// straight past the tax, and it works even while `beforeSwap` reverts.
contract BinNaivePortFreeMintRoute is FixtureBaseBinHook {
    error PoolMustUseDynamicFee(uint24 fee);

    uint24 public constant LAUNCH_FEE = 50_000;

    constructor(ICLPoolManager _poolManager) FixtureBaseBinHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    function _beforeInitialize(address, /* sender */ PoolKey calldata key, uint24 /* activeId */ )
        internal
        pure
        override
        returns (bytes4)
    {
        if (!LPFeeLibrary.isDynamicLPFee(key.fee)) revert PoolMustUseDynamicFee(key.fee);
        return IBinHooks.beforeInitialize.selector;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        IBinPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        return (
            IBinHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            LAUNCH_FEE | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}

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

/// @dev LATCH-012. A 50% opening tax carried over from a CL launch guard. Core
/// validates a bin LP fee against `TEN_PERCENT_FEE` (100_000), so this reverts
/// with `LPFeeTooLarge` on the first swap.
///
/// `beforeMint` is registered and returns the same fee, so LATCH-011 is silent
/// here: the two bin rules are independent.
contract BinFeeAboveCeiling is FixtureBaseBinHook {
    error PoolMustUseDynamicFee(uint24 fee);

    uint24 public constant LAUNCH_FEE = 500_000;

    constructor(ICLPoolManager _poolManager) FixtureBaseBinHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_MINT | BEFORE_SWAP;
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

    function _beforeMint(
        address, /* sender */
        PoolKey calldata, /* key */
        IBinPoolManager.MintParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal pure override returns (bytes4, uint24) {
        return (IBinHooks.beforeMint.selector, LAUNCH_FEE | LPFeeLibrary.OVERRIDE_FEE_FLAG);
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

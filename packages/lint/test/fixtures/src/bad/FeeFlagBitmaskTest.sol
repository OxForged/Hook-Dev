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

/// @dev LATCH-004, the subtle variant. The author knew the pool has to be
/// dynamic-fee and wrote a check - but a bitmask test, not the exact equality
/// core performs. `isDynamicLPFee` is `self == 0x800000`; the marker is a
/// sentinel value, not a flag bit inside a fee.
contract FeeFlagBitmaskTest is FixtureBaseHook {
    error PoolMustUseDynamicFee(uint24 fee);

    uint24 public constant LAUNCH_FEE = 100_000;

    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    function _beforeInitialize(address, /* sender */ PoolKey calldata key, uint160 /* sqrtPriceX96 */ )
        internal
        pure
        override
        returns (bytes4)
    {
        if ((key.fee & LPFeeLibrary.DYNAMIC_FEE_FLAG) == 0) revert PoolMustUseDynamicFee(key.fee);
        return IHooks.beforeInitialize.selector;
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

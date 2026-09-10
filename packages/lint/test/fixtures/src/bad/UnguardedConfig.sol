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

/// @dev LATCH-009. `setFee` has no caller restriction and writes the value
/// `beforeSwap` charges. Anyone can set the fee to 100% in the same block as
/// somebody else's swap - or from inside a callback - and the swap pays it.
contract UnguardedConfig is FixtureBaseHook {
    error PoolMustUseDynamicFee(uint24 fee);

    uint24 internal _feeBips;

    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    function setFee(uint24 feeBips) external {
        _feeBips = feeBips;
    }

    function feeBips() external view returns (uint24) {
        return _feeBips;
    }

    function _beforeInitialize(address, /* sender */ PoolKey calldata key, uint160 /* sqrtPriceX96 */ )
        internal
        pure
        override
        returns (bytes4)
    {
        if (!LPFeeLibrary.isDynamicLPFee(key.fee)) revert PoolMustUseDynamicFee(key.fee);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            _feeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}

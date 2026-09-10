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

/// @notice A correct bin launch guard: it prices the swap route AND the mint
/// composition swap, and stays under core's 10% bin ceiling. Every rule must be
/// silent, including the two bin-specific ones - a bin hook that does the right
/// thing must not be punished for being a bin hook.
contract CleanBinHook is FixtureBaseBinHook {
    error PoolMustUseDynamicFee(uint24 fee);
    error NotOwner();
    error TradingNotOpen();
    error FeeTooHigh();

    /// @dev Core's ceiling for a bin LP fee, not the CL 1_000_000.
    uint24 public constant MAX_FEE = 100_000;

    address public immutable owner;

    uint48 internal _startBlock;
    uint24 internal _feeBips;

    constructor(ICLPoolManager _poolManager, address _owner) FixtureBaseBinHook(_poolManager) {
        owner = _owner;
    }

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_MINT | BEFORE_SWAP;
    }

    function configure(uint48 startBlock, uint24 feeBips) external {
        if (msg.sender != owner) revert NotOwner();
        if (feeBips > MAX_FEE) revert FeeTooHigh();
        _startBlock = startBlock;
        _feeBips = feeBips;
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

    /// @dev Closes the composition-swap route: the same fee applies to a mint
    /// into the active bin as to an ordinary swap.
    function _beforeMint(
        address, /* sender */
        PoolKey calldata, /* key */
        IBinPoolManager.MintParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, uint24) {
        return (IBinHooks.beforeMint.selector, _feeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        IBinPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        if (block.number < _startBlock) revert TradingNotOpen();
        return (
            IBinHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            _feeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}

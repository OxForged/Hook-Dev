// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FixtureBaseHook} from "../FixtureBaseHook.sol";
import {
    BeforeSwapDelta,
    BeforeSwapDeltaLibrary,
    ICLPoolManager,
    IHooks,
    LPFeeLibrary,
    PoolIdLibrary,
    PoolKey
} from "../Stubs.sol";

/// @notice A hook that does everything right, so every rule must stay silent.
///
/// It exercises the shapes most likely to produce a false positive: a fee
/// override (LATCH-004), reverts on the swap path (LATCH-006), an external
/// configuration function that writes state the callbacks read (LATCH-009), and
/// callbacks reached only through the base's delegation (LATCH-001, LATCH-002,
/// LATCH-008).
contract CleanCLHook is FixtureBaseHook {
    using LPFeeLibrary for uint24;
    using PoolIdLibrary for PoolKey;

    error PoolMustUseDynamicFee(uint24 fee);
    error NotOwner();
    error NotConfigured();
    error TradingNotOpen();
    error FeeTooHigh();

    struct Config {
        address owner;
        uint48 startBlock;
        uint24 feeBips;
    }

    uint24 public constant MAX_FEE = 100_000;

    mapping(bytes32 poolId => Config) internal _configs;

    constructor(ICLPoolManager _poolManager) FixtureBaseHook(_poolManager) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    /// @dev First caller claims the pool; afterwards only the owner may write,
    /// and only before trading opens.
    function configure(PoolKey calldata key, uint48 startBlock, uint24 feeBips) external {
        if (feeBips > MAX_FEE) revert FeeTooHigh();
        bytes32 poolId = key.toId();
        Config storage config = _configs[poolId];

        if (config.owner == address(0)) {
            config.owner = msg.sender;
        } else {
            if (msg.sender != config.owner) revert NotOwner();
            if (block.number >= config.startBlock) revert TradingNotOpen();
        }

        config.startBlock = startBlock;
        config.feeBips = feeBips;
    }

    function configOf(bytes32 poolId) external view returns (Config memory) {
        return _configs[poolId];
    }

    /// @dev `sender` is the locker, not the trader, so it is left unnamed.
    function _beforeInitialize(address, /* sender */ PoolKey calldata key, uint160 /* sqrtPriceX96 */ )
        internal
        view
        override
        returns (bytes4)
    {
        // Without this, the fee returned from `beforeSwap` would be discarded.
        if (!key.fee.isDynamicLPFee()) revert PoolMustUseDynamicFee(key.fee);
        if (_configs[key.toId()].owner == address(0)) revert NotConfigured();
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        Config storage config = _configs[key.toId()];
        if (config.owner == address(0)) revert NotConfigured();
        if (block.number < config.startBlock) revert TradingNotOpen();

        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            config.feeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    BalanceDelta,
    BeforeSwapDelta,
    IBinHooks,
    IBinPoolManager,
    ICLPoolManager,
    PoolKey
} from "./Stubs.sol";

/// @notice The bin-flavoured base hook. Same delegation shape as the CL one,
/// different callback set and different return tuples - `beforeMint` returns
/// `(bytes4, uint24)`, and `beforeInitialize` takes an `activeId` rather than a
/// sqrt price.
abstract contract FixtureBaseBinHook {
    error NotPoolManager();
    error HookNotImplemented();

    ICLPoolManager public immutable poolManager;

    uint16 internal constant BEFORE_INITIALIZE = 1 << 0;
    uint16 internal constant AFTER_INITIALIZE = 1 << 1;
    uint16 internal constant BEFORE_MINT = 1 << 2;
    uint16 internal constant AFTER_MINT = 1 << 3;
    uint16 internal constant BEFORE_BURN = 1 << 4;
    uint16 internal constant AFTER_BURN = 1 << 5;
    uint16 internal constant BEFORE_SWAP = 1 << 6;
    uint16 internal constant AFTER_SWAP = 1 << 7;

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(ICLPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function getHooksRegistrationBitmap() public pure virtual returns (uint16);

    function beforeInitialize(address sender, PoolKey calldata key, uint24 activeId)
        external
        onlyPoolManager
        returns (bytes4)
    {
        return _beforeInitialize(sender, key, activeId);
    }

    function beforeMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, uint24) {
        return _beforeMint(sender, key, params, hookData);
    }

    function beforeBurn(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.BurnParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4) {
        return _beforeBurn(sender, key, params, hookData);
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        return _beforeSwap(sender, key, params, hookData);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }

    function _beforeInitialize(address, PoolKey calldata, uint24) internal virtual returns (bytes4) {
        revert HookNotImplemented();
    }

    function _beforeMint(address, PoolKey calldata, IBinPoolManager.MintParams calldata, bytes calldata)
        internal
        virtual
        returns (bytes4, uint24)
    {
        revert HookNotImplemented();
    }

    function _beforeBurn(address, PoolKey calldata, IBinPoolManager.BurnParams calldata, bytes calldata)
        internal
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function _beforeSwap(address, PoolKey calldata, IBinPoolManager.SwapParams calldata, bytes calldata)
        internal
        virtual
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function _afterSwap(address, PoolKey calldata, IBinPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        virtual
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function _binSelector() internal pure returns (bytes4) {
        return IBinHooks.beforeMint.selector;
    }
}

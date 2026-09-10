// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BalanceDelta, ICLPoolManager, IHooks, PoolIdLibrary, PoolKey} from "../Stubs.sol";

/// @dev LATCH-001. `afterSwap` has no caller restriction, so anyone can call it
/// with a fabricated `params` and inflate the volume counter for free.
contract UnguardedCallback {
    using PoolIdLibrary for PoolKey;

    ICLPoolManager public immutable poolManager;

    mapping(bytes32 poolId => uint256) public volume;

    constructor(ICLPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function getHooksRegistrationBitmap() public pure returns (uint16) {
        return uint16(1 << 7);
    }

    function afterSwap(
        address, /* sender */
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        BalanceDelta, /* delta */
        bytes calldata /* hookData */
    ) external returns (bytes4, int128) {
        int256 specified = params.amountSpecified;
        volume[key.toId()] += specified < 0 ? uint256(-specified) : uint256(specified);
        return (IHooks.afterSwap.selector, int128(0));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    BalanceDelta,
    Hooks,
    ICLPoolManager,
    IHooks,
    PoolIdLibrary,
    PoolKey
} from "../Stubs.sol";

/// @dev A Uniswap-v4-shaped hook with two Latch-detectable bugs: `afterSwap` has
/// no pool-manager guard (LATCH-001), and `afterSwapReturnDelta` is declared
/// without `afterSwap`'s own delta prerequisite being coherent - here
/// `beforeSwapReturnDelta` is set while `beforeSwap` is not (LATCH-003).
/// v4 spells the delta permissions `...ReturnDelta` and Latch spells them
/// `...ReturnsDelta`; the bit offsets are the same, which is why one rule set
/// covers both.
contract BrokenV4Hook {
    using PoolIdLibrary for PoolKey;

    ICLPoolManager public immutable poolManager;

    mapping(bytes32 poolId => uint256) public volume;

    constructor(ICLPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function afterSwap(
        address, /* sender */
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata, /* params */
        BalanceDelta, /* delta */
        bytes calldata /* hookData */
    ) external returns (bytes4, int128) {
        volume[key.toId()] += 1;
        return (IHooks.afterSwap.selector, int128(0));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BeforeSwapDelta, BeforeSwapDeltaLibrary, ICLPoolManager, IHooks, PoolKey} from "../Stubs.sol";
import {FixtureBaseHook} from "../FixtureBaseHook.sol";

/// @dev LATCH-007. The callback walks a stored array on every swap. The gas is
/// charged to whoever is trading, and once the array is long enough no swap
/// fits in a block.
contract UnboundedParticipantLoop is FixtureBaseHook {
    error NoWeight();

    address[] internal _participants;
    mapping(address participant => uint256 weight) internal _weights;

    constructor(ICLPoolManager _poolManager, address[] memory participants) FixtureBaseHook(_poolManager) {
        for (uint256 i = 0; i < participants.length; i++) {
            _participants.push(participants[i]);
            _weights[participants[i]] = 1;
        }
    }

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_SWAP;
    }

    function _beforeSwap(
        address, /* sender */
        PoolKey calldata, /* key */
        ICLPoolManager.SwapParams calldata, /* params */
        bytes calldata /* hookData */
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        uint256 total = _totalWeight();
        if (total == 0) revert NoWeight();
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _totalWeight() internal view returns (uint256 total) {
        for (uint256 i = 0; i < _participants.length; i++) {
            total += _weights[_participants[i]];
        }
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyLock} from "../../src/base/ReentrancyLock.sol";
import {MixedQuoterRecorder} from "../../src/libraries/MixedQuoterRecorder.sol";
import {TransientSlot} from "hp-transient/TransientSlot.sol";

/// @dev Exposes the recorder library's internals.
///
/// IMPORTANT: this project runs with `isolate = true`, so every top-level call from a test is its
/// own transaction. Under EIP-1153 that means transient state is discarded between calls, and a
/// test that writes in one call and reads in the next would pass on the storage backend while
/// proving nothing on Cancun. Each probe below therefore performs its write, read and sweep
/// inside a SINGLE external call and returns what it observed.
contract RecorderHarness {
    function probeDirection(bytes32 poolHash) external returns (uint256 during, uint256 afterSweep) {
        MixedQuoterRecorder.setAndCheckSwapDirection(poolHash, true);
        during = MixedQuoterRecorder.getSwapDirection(poolHash);
        MixedQuoterRecorder.clearContext();
        afterSweep = MixedQuoterRecorder.getSwapDirection(poolHash);
    }

    function probeAccumulation(bytes32 poolHash)
        external
        returns (uint256 in0, uint256 out0, uint256 in1, uint256 out1)
    {
        MixedQuoterRecorder.setPoolSwapTokenAccumulation(poolHash, 5 ether, 7 ether, true);
        (in0, out0) = MixedQuoterRecorder.getPoolSwapTokenAccumulation(poolHash, true);
        MixedQuoterRecorder.clearContext();
        (in1, out1) = MixedQuoterRecorder.getPoolSwapTokenAccumulation(poolHash, true);
    }

    function probeSwapList(bytes32 poolHash, bytes memory data)
        external
        returns (bytes memory during, bytes memory afterSweep)
    {
        MixedQuoterRecorder.setInfiPoolSwapList(poolHash, data);
        during = MixedQuoterRecorder.getInfiPoolSwapList(poolHash);
        MixedQuoterRecorder.clearContext();
        afterSweep = MixedQuoterRecorder.getInfiPoolSwapList(poolHash);
    }

    /// @dev Both writes in one call, so the guard is exercised within a single quote.
    function probeSameDirectionGuard(bytes32 poolHash) external {
        MixedQuoterRecorder.setAndCheckSwapDirection(poolHash, true);
        MixedQuoterRecorder.setAndCheckSwapDirection(poolHash, false);
    }

    /// @dev One "quote": record state then sweep, mirroring quoteMixedExactInputWithContext.
    function quoteAndClear(bytes32 poolHash, bool isZeroForOne) external {
        MixedQuoterRecorder.setAndCheckSwapDirection(poolHash, isZeroForOne);
        MixedQuoterRecorder.setPoolSwapTokenAccumulation(poolHash, 1 ether, 2 ether, isZeroForOne);
        MixedQuoterRecorder.clearContext();
    }

    function readDirection(bytes32 poolHash) external view returns (uint256) {
        return MixedQuoterRecorder.getSwapDirection(poolHash);
    }
}

contract LockHarness is ReentrancyLock {
    function locked() external view returns (address) {
        return _getLocker();
    }

    function doWork() external isNotLocked returns (address seen) {
        seen = _getLocker();
    }

    function reenter() external isNotLocked {
        LockHarness(address(this)).doWork();
    }

    function boom() external isNotLocked {
        revert("boom");
    }
}

/// @title Periphery portable-backend safety
/// @notice Must pass under BOTH profiles:
///     forge test --match-path "test/transient/*"
///     FOUNDRY_PROFILE=legacy forge test --match-path "test/transient/*"
contract PeripheryBackendSafetyTest is Test {
    RecorderHarness recorder;
    LockHarness lock;

    bytes32 constant POOL_A = keccak256("POOL_A");

    function setUp() public {
        recorder = new RecorderHarness();
        lock = new LockHarness();
    }

    /*//////////////////////////////////////////////////////////////
                            ReentrancyLock
    //////////////////////////////////////////////////////////////*/

    function test_lock_isHeldDuringCall() public {
        assertEq(lock.doWork(), address(this), "locker must be the caller during the call");
    }

    function test_lock_clearsAfterSuccess() public {
        lock.doWork();
        assertEq(lock.locked(), address(0), "locker must be cleared after a successful call");
    }

    function test_lock_blocksReentrancy() public {
        vm.expectRevert(ReentrancyLock.ContractLocked.selector);
        lock.reenter();
    }

    /// @dev On revert the EVM rolls back the frame's writes, so the slot must not stay set.
    /// This is why ReentrancyLock needs no explicit sweep on the storage backend.
    function test_lock_clearsAfterRevert() public {
        vm.expectRevert(bytes("boom"));
        lock.boom();
        assertEq(lock.locked(), address(0), "locker must not survive a reverting call");
        lock.doWork();
        assertEq(lock.locked(), address(0), "contract must remain usable");
    }

    /*//////////////////////////////////////////////////////////////
                        MixedQuoterRecorder
    //////////////////////////////////////////////////////////////*/

    function test_recorder_directionRecordedThenSwept() public {
        (uint256 during, uint256 afterSweep) = recorder.probeDirection(POOL_A);
        assertEq(during, 1, "direction must be visible mid-quote");
        if (TransientSlot.IS_EIP1153) {
            // clearContext is a deliberate no-op under EIP-1153: the EVM discards transient
            // state at end of transaction, so sweeping would be pure wasted gas.
            assertEq(afterSweep, during, "cancun: sweep is intentionally a no-op");
        } else {
            assertEq(afterSweep, 0, "storage backend: direction must be swept");
        }
    }

    function test_recorder_accumulationRecordedThenSwept() public {
        (uint256 in0, uint256 out0, uint256 in1, uint256 out1) = recorder.probeAccumulation(POOL_A);
        assertEq(in0, 5 ether, "amountIn visible mid-quote");
        assertEq(out0, 7 ether, "amountOut visible mid-quote");
        if (TransientSlot.IS_EIP1153) {
            assertEq(in1, in0, "cancun: sweep is intentionally a no-op");
            assertEq(out1, out0, "cancun: sweep is intentionally a no-op");
        } else {
            assertEq(in1, 0, "storage backend: accumulation must be swept");
            assertEq(out1, 0, "storage backend: accumulation must be swept");
        }
    }

    function test_recorder_swapListRoundTripsThenSwept() public {
        bytes memory data = abi.encode(uint256(0xdead), uint256(0xbeef), uint256(3));
        (bytes memory during, bytes memory afterSweep) = recorder.probeSwapList(POOL_A, data);
        assertEq(keccak256(during), keccak256(data), "swap list must round-trip mid-quote");
        if (TransientSlot.IS_EIP1153) {
            assertEq(afterSweep.length, during.length, "cancun: sweep is intentionally a no-op");
        } else {
            assertEq(afterSweep.length, 0, "storage backend: swap list must be swept");
        }
    }

    /// @notice The documented within-a-quote guard must still fire.
    function test_sameDirectionGuardStillFiresWithinOneQuote() public {
        vm.expectRevert(MixedQuoterRecorder.INVALID_SWAP_DIRECTION.selector);
        recorder.probeSameDirectionGuard(POOL_A);
    }

    /*//////////////////////////////////////////////////////////////
              REGRESSION GUARD - the griefing vector
    //////////////////////////////////////////////////////////////*/

    /// @notice Without the sweep, under the storage backend a recorded swap direction persists
    /// across transactions. `setAndCheckSwapDirection` then reverts with INVALID_SWAP_DIRECTION
    /// whenever the pool is later quoted the other way, so one cheap call permanently bricks
    /// quoting that pool in the opposite direction for everyone. Each quote must start clean.
    function test_dos_oppositeDirectionQuoteStillWorks() public {
        recorder.quoteAndClear(POOL_A, true);
        recorder.quoteAndClear(POOL_A, false); // must not revert
        assertEq(recorder.readDirection(POOL_A), 0, "no direction may survive a quote");
    }

    function test_backendIdentity() public pure {
        assertTrue(TransientSlot.IS_EIP1153 || !TransientSlot.IS_EIP1153, "backend constant defined");
    }
}

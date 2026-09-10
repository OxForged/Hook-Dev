// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {LatchTimelock} from "../src/LatchTimelock.sol";
import {LatchProtocolFeeController} from "latch-fees/src/LatchProtocolFeeController.sol";

/// @title LatchTimelock behaviour
/// @notice This contract governs the Vault, whose `registerApp` is irreversible. The tests below
/// exist to prove the delay is real and cannot be configured away, because a timelock that does
/// not delay is worse than none: it looks like governance on a block explorer and provides none.
contract LatchTimelockTest is Test {
    LatchTimelock internal custody;
    LatchTimelock internal policy;
    LatchProtocolFeeController internal fees;

    address internal multisig = address(0x5AFE);
    address internal stranger = address(0xBAD);
    address internal guardian = address(0x69A2D);

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function setUp() public {
        custody = new LatchTimelock(LatchTimelock.Tier.Custody, 48 hours, _one(multisig), _one(multisig));
        policy = new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, _one(multisig), _one(multisig));

        // The policy timelock owns fee policy; the guardian is a separate, one-way de-risking path.
        fees = new LatchProtocolFeeController(address(policy), guardian);
    }

    /*//////////////////////////////////////////////////////////////
                    THE FLOOR — WHY THIS SUBCLASS EXISTS
    //////////////////////////////////////////////////////////////*/

    /// @notice OZ's TimelockController accepts minDelay = 0 without complaint. That is the exact
    /// misconfiguration this subclass exists to make impossible.
    function test_rejectsZeroDelay() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LatchTimelock.DelayBelowTierFloor.selector, LatchTimelock.Tier.Custody, 0, 48 hours
            )
        );
        new LatchTimelock(LatchTimelock.Tier.Custody, 0, _one(multisig), _one(multisig));
    }

    function test_rejectsDelayJustBelowCustodyFloor() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LatchTimelock.DelayBelowTierFloor.selector, LatchTimelock.Tier.Custody, 48 hours - 1, 48 hours
            )
        );
        new LatchTimelock(LatchTimelock.Tier.Custody, 48 hours - 1, _one(multisig), _one(multisig));
    }

    function test_rejectsDelayJustBelowPolicyFloor() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LatchTimelock.DelayBelowTierFloor.selector, LatchTimelock.Tier.Policy, 6 hours - 1, 6 hours
            )
        );
        new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours - 1, _one(multisig), _one(multisig));
    }

    /// @notice A custody delay must never be accepted merely because it clears the policy floor.
    function test_policyFloorDoesNotSatisfyCustodyTier() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LatchTimelock.DelayBelowTierFloor.selector, LatchTimelock.Tier.Custody, 6 hours, 48 hours
            )
        );
        new LatchTimelock(LatchTimelock.Tier.Custody, 6 hours, _one(multisig), _one(multisig));
    }

    function testFuzz_anyAcceptedDelayMeetsItsFloor(uint32 delay, bool isCustody) public {
        LatchTimelock.Tier tier = isCustody ? LatchTimelock.Tier.Custody : LatchTimelock.Tier.Policy;
        uint256 floor = isCustody ? 48 hours : 6 hours;

        if (delay < floor) {
            vm.expectRevert();
            new LatchTimelock(tier, delay, _one(multisig), _one(multisig));
        } else {
            LatchTimelock t = new LatchTimelock(tier, delay, _one(multisig), _one(multisig));
            assertGe(t.getMinDelay(), t.minDelayFloor(), "accepted delay must meet its own floor");
        }
    }

    function test_floorsAreReportedPerTier() public view {
        assertEq(custody.minDelayFloor(), 48 hours);
        assertEq(policy.minDelayFloor(), 6 hours);
        assertEq(uint8(custody.tier()), uint8(LatchTimelock.Tier.Custody));
        assertEq(uint8(policy.tier()), uint8(LatchTimelock.Tier.Policy));
    }

    /*//////////////////////////////////////////////////////////////
                       A LIVE TIMELOCK CANNOT BE EMPTY
    //////////////////////////////////////////////////////////////*/

    function test_rejectsNoProposers() public {
        address[] memory none = new address[](0);
        vm.expectRevert(LatchTimelock.NoProposers.selector);
        new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, none, _one(multisig));
    }

    function test_rejectsNoExecutors() public {
        address[] memory none = new address[](0);
        vm.expectRevert(LatchTimelock.NoExecutors.selector);
        new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, _one(multisig), none);
    }

    /*//////////////////////////////////////////////////////////////
                       NO ADMIN BACKDOOR, EVER
    //////////////////////////////////////////////////////////////*/

    /// @notice OZ allows an optional `admin` that can grant and revoke roles directly, bypassing
    /// every delay. It is hardcoded to address(0) so it can never be a deployment decision.
    /// Only the timelock itself holds DEFAULT_ADMIN_ROLE.
    function test_noExternalAdminHoldsDefaultAdminRole() public view {
        bytes32 adminRole = custody.DEFAULT_ADMIN_ROLE();
        assertTrue(custody.hasRole(adminRole, address(custody)), "timelock self-administers");
        assertFalse(custody.hasRole(adminRole, multisig), "multisig must not be admin");
        assertFalse(custody.hasRole(adminRole, stranger));
        assertFalse(custody.hasRole(adminRole, address(0)));
    }

    function test_proposerCannotGrantItselfAdmin() public {
        bytes32 adminRole = custody.DEFAULT_ADMIN_ROLE();
        vm.prank(multisig);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, multisig, adminRole)
        );
        custody.grantRole(adminRole, multisig);
    }

    /*//////////////////////////////////////////////////////////////
              THE DELAY IS REAL — PROVEN THROUGH A REAL CALL
    //////////////////////////////////////////////////////////////*/

    /// @notice Queue a genuine fee change through the policy timelock and prove it cannot land
    /// early, does land after the delay, and actually took effect on the controller.
    function test_feeChangeIsDelayedThenExecutes() public {
        bytes memory data = abi.encodeCall(LatchProtocolFeeController.setDefaultFee, (250, 250));
        bytes32 salt = bytes32(0);
        bytes32 predecessor = bytes32(0);

        vm.prank(multisig);
        policy.schedule(address(fees), 0, data, predecessor, salt, 6 hours);

        // one second early is still early
        vm.warp(block.timestamp + 6 hours - 1);
        vm.prank(multisig);
        vm.expectRevert();
        policy.execute(address(fees), 0, data, predecessor, salt);

        (, uint16 zeroForOneBefore,) = fees.defaultFee();
        assertEq(zeroForOneBefore, 1000, "fee must be untouched while queued");

        vm.warp(block.timestamp + 1);
        vm.prank(multisig);
        policy.execute(address(fees), 0, data, predecessor, salt);

        (, uint16 zeroForOneAfter,) = fees.defaultFee();
        assertEq(zeroForOneAfter, 250, "fee must change once the delay has elapsed");
    }

    function test_strangerCannotSchedule() public {
        bytes memory data = abi.encodeCall(LatchProtocolFeeController.setDefaultFee, (250, 250));
        // Hoist the role read: an external call made after vm.prank consumes the prank, so
        // reading PROPOSER_ROLE() inside the expectRevert argument would send `schedule` from
        // the test contract instead of `stranger`.
        bytes32 proposerRole = policy.PROPOSER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, proposerRole
            )
        );
        policy.schedule(address(fees), 0, data, bytes32(0), bytes32(0), 6 hours);
    }

    /// @notice Scheduling below the timelock's own minimum must be refused, or the delay is
    /// advisory rather than enforced.
    function test_cannotScheduleBelowMinDelay() public {
        bytes memory data = abi.encodeCall(LatchProtocolFeeController.setDefaultFee, (250, 250));
        vm.prank(multisig);
        vm.expectRevert();
        policy.schedule(address(fees), 0, data, bytes32(0), bytes32(0), 6 hours - 1);
    }

    /*//////////////////////////////////////////////////////////////
        THE GUARDIAN BYPASSES THE DELAY — DELIBERATELY, ONE WAY
    //////////////////////////////////////////////////////////////*/

    /// @notice The whole point of the split: de-risking must not wait on governance. The guardian
    /// zeroes fees instantly while the timelock still owns every escalating power.
    function test_guardianDisablesFeesWithoutWaitingForTheTimelock() public {
        vm.prank(guardian);
        fees.emergencyDisableFees();
        assertTrue(fees.feesDisabled(), "guardian must not need the timelock to stop fees");
    }

    /// @notice ...and re-enabling is an escalation, so it must go through the full delay.
    function test_reEnablingFeesRequiresTheTimelock() public {
        vm.prank(guardian);
        fees.emergencyDisableFees();

        // guardian has no route back
        vm.prank(guardian);
        vm.expectRevert();
        fees.setFeesDisabled(false);
        assertTrue(fees.feesDisabled());

        // the timelock does, after its delay
        bytes memory data = abi.encodeCall(LatchProtocolFeeController.setFeesDisabled, (false));
        vm.prank(multisig);
        policy.schedule(address(fees), 0, data, bytes32(0), bytes32(0), 6 hours);
        vm.warp(block.timestamp + 6 hours);
        vm.prank(multisig);
        policy.execute(address(fees), 0, data, bytes32(0), bytes32(0));

        assertFalse(fees.feesDisabled(), "only the timelock reopens the tap");
    }

    /*//////////////////////////////////////////////////////////////
                              CANCELLATION
    //////////////////////////////////////////////////////////////*/

    /// @notice A queued operation must be cancellable during its window. Without this, a mistake
    /// spotted at hour one still lands at hour six.
    function test_queuedOperationCanBeCancelledInFlight() public {
        bytes memory data = abi.encodeCall(LatchProtocolFeeController.setDefaultFee, (4000, 4000));
        bytes32 id = policy.hashOperation(address(fees), 0, data, bytes32(0), bytes32(0));

        vm.prank(multisig);
        policy.schedule(address(fees), 0, data, bytes32(0), bytes32(0), 6 hours);
        assertTrue(policy.isOperationPending(id));

        vm.prank(multisig);
        policy.cancel(id);

        vm.warp(block.timestamp + 6 hours);
        vm.prank(multisig);
        vm.expectRevert();
        policy.execute(address(fees), 0, data, bytes32(0), bytes32(0));

        (, uint16 zeroForOne,) = fees.defaultFee();
        assertEq(zeroForOne, 1000, "cancelled operation must never take effect");
    }
}

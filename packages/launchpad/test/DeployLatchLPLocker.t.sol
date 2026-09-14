// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {LatchLPLocker} from "../src/LatchLPLocker.sol";
import {LaunchTokenFactory} from "../src/LaunchTokenFactory.sol";
import {DeployLatchLPLockerScript} from "../script/DeployLatchLPLocker.s.sol";

import {LockerFixture} from "./utils/LockerFixture.sol";

contract FakeSafe {}

contract DeployLatchLPLockerTest is LockerFixture {
    DeployLatchLPLockerScript script;
    address safe;
    uint256 constant PK = 0xA11CE;

    function setUp() public {
        _deployCore();
        script = new DeployLatchLPLockerScript();
        safe = address(new FakeSafe());
    }

    function test_deploy_assertsTheOwnersNumbers() public {
        (LatchLPLocker l, LaunchTokenFactory f) = script.runWith(
            DeployLatchLPLockerScript.Wiring({pk: PK, positionManager: address(posm), protocolRecipient: safe})
        );
        assertEq(l.minProtocolBps(), 2_000);
        assertEq(l.maxProtocolBps(), 5_000);
        assertEq(l.maxIntegratorBps(), 2_000);
        assertEq(l.protocolRecipient(), safe);
        assertTrue(address(f).code.length > 0);
    }

    function test_deploy_refusesEoaRecipient() public {
        vm.expectRevert("LOCKER_PROTOCOL_RECIPIENT has no code - must be the Safe");
        script.runWith(
            DeployLatchLPLockerScript.Wiring({pk: PK, positionManager: address(posm), protocolRecipient: address(0xE0A)})
        );
    }

    function test_deploy_refusesPositionManagerWithoutCode() public {
        vm.expectRevert("CL_POSITION_MANAGER has no code");
        script.runWith(
            DeployLatchLPLockerScript.Wiring({pk: PK, positionManager: address(0x1234), protocolRecipient: safe})
        );
    }
}

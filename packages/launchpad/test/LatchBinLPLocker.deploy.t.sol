// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {LatchBinLPLocker} from "../src/LatchBinLPLocker.sol";
import {DeployLatchBinLPLockerScript} from "../script/DeployLatchBinLPLocker.s.sol";

import {BinLockerFixture} from "./utils/BinLockerFixture.sol";

contract BinFakeSafe {}

contract BinCLLockerStub {
    address public protocolRecipient;
    uint16 public minProtocolBps;
    uint16 public maxProtocolBps = 5_000;
    uint16 public maxIntegratorBps = 2_000;
    address public vault;

    constructor(address recipient_, uint16 min_, address vault_) {
        protocolRecipient = recipient_;
        minProtocolBps = min_;
        vault = vault_;
    }
}

contract DeployLatchBinLPLockerTest is BinLockerFixture {
    DeployLatchBinLPLockerScript script;
    address safe;
    uint256 constant PK = 0xA11CE;

    function setUp() public {
        _deployCore();
        script = new DeployLatchBinLPLockerScript();
        safe = address(new BinFakeSafe());
    }

    function _w(address pm, address recipient, address cl) internal pure returns (DeployLatchBinLPLockerScript.Wiring memory) {
        return DeployLatchBinLPLockerScript.Wiring({pk: PK, positionManager: pm, protocolRecipient: recipient, clLocker: cl});
    }

    function test_deploy_assertsEveryImmutable() public {
        LatchBinLPLocker l = script.runWith(_w(address(binPm), safe, address(0)));
        assertEq(address(l.positionManager()), address(binPm));
        assertEq(address(l.binPoolManager()), address(binPoolManager));
        assertEq(l.vault(), address(vault));
        assertEq(l.protocolRecipient(), safe);
        assertEq(l.minProtocolBps(), 2_000);
        assertEq(l.maxProtocolBps(), 5_000);
        assertEq(l.maxIntegratorBps(), 2_000);
        assertEq(l.maxBinsPerLock(), 64);
    }

    function test_deploy_crossChecksTheClLocker() public {
        BinCLLockerStub good = new BinCLLockerStub(safe, 2_000, address(vault));
        script.runWith(_w(address(binPm), safe, address(good)));

        BinCLLockerStub otherRecipient = new BinCLLockerStub(address(0x5AFE), 2_000, address(vault));
        vm.expectRevert("CL locker pays a different protocol recipient");
        script.runWith(_w(address(binPm), safe, address(otherRecipient)));

        BinCLLockerStub lowFloor = new BinCLLockerStub(safe, 1_000, address(vault));
        vm.expectRevert("CL locker floor differs");
        script.runWith(_w(address(binPm), safe, address(lowFloor)));

        BinCLLockerStub otherVault = new BinCLLockerStub(safe, 2_000, address(0x1234));
        vm.expectRevert("CL locker is on a different vault");
        script.runWith(_w(address(binPm), safe, address(otherVault)));
    }

    function test_deploy_refusesEoaRecipient() public {
        vm.expectRevert("LOCKER_PROTOCOL_RECIPIENT has no code - must be the Safe");
        script.runWith(_w(address(binPm), address(0xE0A), address(0)));
    }

    function test_deploy_refusesPositionManagerWithoutCode() public {
        vm.expectRevert("BIN_POSITION_MANAGER has no code");
        script.runWith(_w(address(0x1234), safe, address(0)));
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {IProtocolFeeController} from "infinity-core/src/interfaces/IProtocolFeeController.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";

import {LaunchGuardHook, ILaunchTokenOrigin} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {BinLaunchGuardHook} from "latch-hooks/src/launch/BinLaunchGuardHook.sol";
import {LatchProtocolFeeControllerV3} from "latch-fees/src/LatchProtocolFeeControllerV3.sol";

import {LaunchpadKitV2} from "../../src/LaunchpadKitV2.sol";
import {LatchLPLocker} from "../../src/LatchLPLocker.sol";
import {LaunchParamsV2, LaunchResultV2, LegParams} from "../../src/interfaces/ILaunchpadKitV2.sol";
import {DeployLaunchpadKitV2Script} from "../../script/DeployLaunchpadKitV2.s.sol";
import {DeployBinLaunchGuardHookScript} from "../../script/DeployBinLaunchGuardHook.s.sol";

import {KitV2Fixture, FakeSafe} from "./KitV2Fixture.sol";

/// @notice Both new deploy scripts run end to end as contracts, with representative pre-flight guards tripped.
/// @dev Driven through `runWith`, never the environment (see test/DeployScripts.t.sol for why).
contract DeployLaunchpadKitV2Test is KitV2Fixture {
    uint256 internal constant PK = 0xBEEF_0003;

    DeployLaunchpadKitV2Script internal script;

    function setUp() public {
        _deployAll();
        script = new DeployLaunchpadKitV2Script();
    }

    function _wiring() internal view returns (DeployLaunchpadKitV2Script.Wiring memory w) {
        w = DeployLaunchpadKitV2Script.Wiring({
            pk: PK,
            clPoolManager: address(clPM),
            binPoolManager: address(binPM),
            clPositionManager: address(clPosm),
            binPositionManager: address(binPosm),
            clHook: address(clHook),
            binHook: address(binHook),
            clLocker: address(clLocker),
            binLocker: address(binLocker),
            tokenFactory: address(factory),
            launchRegistry: address(launchRegistry),
            safe: safe,
            launchpadSteward: LAUNCHPAD_STEWARD,
            initialLaunchFeeWei: 0.0005 ether,
            maxLaunchFeeWei: 0.01 ether,
            maxIntegratorLaunchFeeWei: 0.005 ether,
            feePolicyV2: address(v2)
        });
    }

    function test_SCRIPT_deploysReadsBackAndSatisfiesTheV3DeployChecks() public {
        LaunchpadKitV2 k = script.runWith(_wiring());
        assertEq(k.owner(), safe);
        assertEq(k.maxLegs(), 4, "gas-sized: matches LaunchpadKitV2Gas DEPLOY_MAX_LEGS");
        assertEq(k.maxBinsPerLeg(), 20, "gas-sized: matches LaunchpadKitV2Gas DEPLOY_MAX_BINS_PER_LEG");
        assertEq(k.launchFeeNoticeSeconds(), 7 days);

        // Step 6 of the order: a V3 bound to this kit constructs (its constructor probes isLockedLaunch(0)).
        LatchProtocolFeeControllerV3 bound = new LatchProtocolFeeControllerV3(safe, IProtocolFeeController(address(v2)), address(k));
        assertEq(bound.launchOracle(), address(k));
    }

    /// @dev Owner decision #2: before V3 names this kit, a launch still works and is born at V2's fee - the
    /// Safe zeroes it by hand. The kit's zero-fee assertion must not block that window.
    function test_SCRIPT_kitIsUsableBeforeItsV3IsInstalled() public {
        LaunchpadKitV2 k = script.runWith(_wiring());
        bytes32 salt = keccak256("pre-v3");
        LaunchParamsV2 memory p = _oneCL(salt, address(quote));
        p.legs[0] = _clLeg(k.predictLaunchToken(LAUNCHER, salt), address(quote), 10_000);
        vm.deal(LAUNCHER, 1 ether);
        vm.prank(LAUNCHER);
        LaunchResultV2 memory r = k.createLaunch{value: 0.0005 ether}(p);
        assertTrue(k.isLockedLaunch(r.poolIds[0]));
        assertEq(_clProtocolFee(r.poolIds[0]), PACKED_999, "installed V3 is bound to a different kit");
        assertTrue(clLocker.isLocked(r.lockIds[0]));
    }

    function test_SCRIPT_refusesAnEoaSafe() public {
        DeployLaunchpadKitV2Script.Wiring memory w = _wiring();
        w.safe = address(0x5AFE);
        vm.expectRevert(bytes("an input address has no code"));
        script.runWith(w);
    }

    function test_SCRIPT_refusesFeeAboveCap() public {
        DeployLaunchpadKitV2Script.Wiring memory w = _wiring();
        w.initialLaunchFeeWei = w.maxLaunchFeeWei + 1;
        vm.expectRevert(bytes("INITIAL_LAUNCH_FEE_WEI above the cap"));
        script.runWith(w);
    }

    function test_SCRIPT_refusesAPrePortBinGuard() public {
        DeployLaunchpadKitV2Script.Wiring memory w = _wiring();
        w.binHook = address(new BinLaunchGuardHook(IBinPoolManager(address(binPM)), ILaunchTokenOrigin(address(0))));
        vm.expectRevert(bytes("Bin guard: reservation factory - the pre-port hook?"));
        script.runWith(w);
    }

    function test_SCRIPT_refusesALockerPayingSomeoneElse() public {
        DeployLaunchpadKitV2Script.Wiring memory w = _wiring();
        w.clLocker = address(new LatchLPLocker(clPosm, address(new FakeSafe()), 2_000, 5_000, 2_000));
        vm.expectRevert(bytes("a locker pays someone other than the Safe"));
        script.runWith(w);
    }

    function test_SCRIPT_refusesAKitNotOwnedByTheV2Safe() public {
        DeployLaunchpadKitV2Script.Wiring memory w = _wiring();
        w.feePolicyV2 = address(clHook); // not V2
        vm.expectRevert();
        script.runWith(w);
    }

    function test_SCRIPT_binGuardDeploysListedWithTheReservation() public {
        DeployBinLaunchGuardHookScript binScript = new DeployBinLaunchGuardHookScript();
        BinLaunchGuardHook h = binScript.runWith(PK, address(binPM), address(factory), address(latchRegistry), LAUNCHPAD_STEWARD);
        assertEq(address(h.LAUNCH_TOKEN_FACTORY()), address(factory));
        assertTrue(latchRegistry.isRegistered(address(h)));

        vm.expectRevert(bytes("LAUNCH_TOKEN_FACTORY has no code"));
        binScript.runWith(PK, address(binPM), address(0), address(latchRegistry), LAUNCHPAD_STEWARD);
    }
}

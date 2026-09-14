// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";

import {LaunchpadKit} from "../../src/LaunchpadKit.sol";
import {LaunchTokenFactory} from "../../src/LaunchTokenFactory.sol";
import {Preset} from "../../src/libraries/LaunchPresets.sol";
import {LaunchParams, LaunchResult, SeedParams} from "../../src/interfaces/ILaunchpadKit.sol";
import {DeployLatchLPLockerScript} from "../../script/DeployLatchLPLocker.s.sol";
import {DeployLaunchGuardHookMainnetScript} from "../../script/DeployLaunchGuardHookMainnet.s.sol";
import {DeployLaunchpadKitMainnetScript} from "../../script/DeployLaunchpadKitMainnet.s.sol";

/**
 * FORK REHEARSAL of the timestamp launchpad redeploy on Robinhood Chain (4663), in deployment order:
 *
 *   1. `DeployLatchLPLocker`          -> LatchLPLocker + LaunchTokenFactory
 *   2. `DeployLaunchGuardHookMainnet` -> LaunchGuardHook(poolManager, factory), listed, steward = Ops
 *   3. `DeployLaunchpadKitMainnet`    -> LaunchpadKit(poolManager, hook, positionManager, permit2, registry)
 *
 * then a factory token is created, a front-runner fails to claim its launch pool, the creator names
 * the kit, the kit launches it, and the fee decays on `block.timestamp`. Every script is driven through
 * its real `runWith`, against the LIVE shared core and registry on a fork. Nothing is broadcast: a
 * Foundry test cannot send a transaction, and the key below holds nothing on any chain.
 *
 * Skipped unless `REHEARSAL_RPC_URL` is set. Addresses come from the deployment's own variable names:
 *
 *   REHEARSAL_RPC_URL=<4663 RPC> CL_POOL_MANAGER=... CL_POSITION_MANAGER=... PERMIT2=... \
 *   LOCKER_PROTOCOL_RECIPIENT=<Safe> LAUNCH_GUARD_REGISTRY=... LAUNCH_GUARD_STEWARD=<Ops> \
 *   LAUNCHPAD_REGISTRY=... \
 *   forge test --match-path test/fork/TimestampRedeployRehearsal.t.sol --threads 2 -vvv
 */
contract TimestampLaunchpadRedeployRehearsal is Test {
    /// @dev A throwaway key for the forked simulation only. Never funded, never used to broadcast.
    uint256 internal constant REHEARSAL_PK = 0xBEEF_0002;
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant FRONT_RUNNER = address(0xBAD);
    int24 internal constant TICK_SPACING = 60;
    uint160 internal constant SQRT_1_1 = 79228162514264337593543950336;

    bool internal live;

    function setUp() public {
        string memory rpc = vm.envOr("REHEARSAL_RPC_URL", string(""));
        live = bytes(rpc).length != 0;
        if (live) vm.createSelectFork(rpc);
    }

    function test_REHEARSE_deployInOrderThenLaunchAFactoryToken() public {
        if (!live) {
            vm.skip(true);
            return;
        }
        assertEq(block.chainid, 4663, "rehearsal must fork Robinhood Chain");
        address poolManager = vm.envAddress("CL_POOL_MANAGER");
        address positionManager = vm.envAddress("CL_POSITION_MANAGER");

        (, LaunchTokenFactory factory) = new DeployLatchLPLockerScript().runWith(
            DeployLatchLPLockerScript.Wiring({
                pk: REHEARSAL_PK,
                positionManager: positionManager,
                protocolRecipient: vm.envAddress("LOCKER_PROTOCOL_RECIPIENT")
            })
        );
        LaunchGuardHook hook = new DeployLaunchGuardHookMainnetScript().runWith(
            REHEARSAL_PK,
            poolManager,
            address(factory),
            vm.envAddress("LAUNCH_GUARD_REGISTRY"),
            vm.envAddress("LAUNCH_GUARD_STEWARD")
        );
        LaunchpadKit kit = new DeployLaunchpadKitMainnetScript().runWith(
            DeployLaunchpadKitMainnetScript.Wiring({
                pk: REHEARSAL_PK,
                poolManager: poolManager,
                hook: address(hook),
                positionManager: positionManager,
                permit2: vm.envAddress("PERMIT2"),
                registry: vm.envAddress("LAUNCHPAD_REGISTRY")
            })
        );

        vm.prank(CREATOR);
        address token = factory.createToken("Rehearsal", "RHR", "", 1_000_000 ether, CREATOR, keccak256("rehearsal"));

        LaunchParams memory p;
        p.launchToken = token;
        p.quoteToken = address(0); // native quote: no second token needed, nothing live touched
        p.tickSpacing = TICK_SPACING;
        p.sqrtPriceX96 = SQRT_1_1;
        p.preset = Preset.FairLaunch;
        p.startDelaySeconds = 120;
        p.launchOperator = CREATOR;
        p.seed = SeedParams({
            tickLower: 0, tickUpper: 0, launchTokenAmount: 0, quoteTokenAmount: 0, positionRecipient: address(0), deadline: 0
        });

        // The reservation: a copier cannot take the factory token's pool, and neither can the kit
        // until the creator names it.
        (PoolKey memory key,,) = kit.computePoolKey(token, address(0), TICK_SPACING);
        LaunchGuardHook.LaunchConfig memory squat = LaunchGuardHook.LaunchConfig({
            startTime: uint40(block.timestamp + 100),
            decaySeconds: 300,
            initialFeeBips: 100_000,
            finalFeeBips: 3_000,
            maxBuyPerTx: 0,
            launchTokenIsCurrency0: Currency.unwrap(key.currency0) == token,
            enabled: true
        });
        vm.prank(FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchPoolReserved.selector, token, CREATOR, FRONT_RUNNER));
        hook.configureLaunch(key, squat);

        vm.prank(CREATOR);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchPoolReserved.selector, token, CREATOR, address(kit)));
        kit.createLaunch(p);

        vm.prank(CREATOR);
        hook.setLaunchClaimer(token, address(kit));
        vm.prank(CREATOR);
        LaunchResult memory r = kit.createLaunch(p);
        PoolId poolId = r.poolId;
        assertEq(hook.launchOwner(poolId), address(kit));

        // The schedule is seconds of block.timestamp: FairLaunch is five minutes after a two-minute delay.
        LaunchGuardHook.Launch memory l = hook.getLaunch(poolId);
        assertEq(uint256(l.startTime), block.timestamp + 120, "startTime");
        assertEq(uint256(l.decaySeconds), 300, "FairLaunch window");
        uint24 opening = hook.feeAt(poolId, l.startTime);
        uint24 closing = hook.feeAt(poolId, uint256(l.startTime) + l.decaySeconds);
        assertGt(opening, closing, "fee decays");
        assertEq(closing, l.finalFeeBips);

        vm.warp(uint256(l.startTime) + l.decaySeconds / 2);
        uint24 mid = hook.currentFee(poolId);
        assertLt(mid, opening);
        assertGt(mid, closing);
        vm.warp(uint256(l.startTime) + l.decaySeconds);
        assertEq(hook.currentFee(poolId), closing, "settled at the window's end");
    }
}

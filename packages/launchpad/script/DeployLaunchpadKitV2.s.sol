// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {ICLPositionManager} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionManager.sol";
import {IBinPositionManager} from "infinity-periphery/src/pool-bin/interfaces/IBinPositionManager.sol";
import {IBinFungibleToken} from "infinity-periphery/src/pool-bin/interfaces/IBinFungibleToken.sol";
import {IImmutableState} from "infinity-periphery/src/interfaces/IImmutableState.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {BinLaunchGuardHook} from "latch-hooks/src/launch/BinLaunchGuardHook.sol";
import {ContractClockProbe} from "latch-hooks/script/ContractClock.sol";
import {ILockedLaunchOracle} from "latch-fees/src/interfaces/ILockedLaunchOracle.sol";
import {DeployFeeControllerV3Script} from "latch-fees/script/DeployFeeControllerV3.s.sol";

import {LaunchpadKitV2} from "../src/LaunchpadKitV2.sol";
import {LatchLPLocker} from "../src/LatchLPLocker.sol";
import {LatchBinLPLocker} from "../src/LatchBinLPLocker.sol";
import {ILaunchTokenFactory} from "../src/interfaces/ILaunchTokenFactory.sol";
import {ILaunchRegistryWriter} from "../src/interfaces/ILaunchRegistryWriter.sol";

interface IVaultApps {
    function isAppRegistered(address app) external view returns (bool);
}

/**
 * Deploys `LaunchpadKitV2` (and, automatically, its linked `LaunchLegs` library) against an EXISTING shared
 * core. Design: docs/kit-v2-integration.md, "Kit v2 (implemented)".
 *
 * ORDER (each step asserts the previous):
 *   1. DeployLatchLPLocker.s.sol        -> LatchLPLocker + LaunchTokenFactory
 *   2. DeployLatchBinLPLocker.s.sol     -> LatchBinLPLocker (same Safe, same bounds)
 *   3. DeployLaunchGuardHookMainnet     -> LaunchGuardHook(clPoolManager, factory), listed
 *   4. DeployBinLaunchGuardHook         -> BinLaunchGuardHook(binPoolManager, factory), listed
 *   5. THIS SCRIPT                      -> LaunchpadKitV2 (owner = Safe from birth; never the deployer)
 *   6. packages/fees DeployFeeControllerV3 with LAUNCHPAD_KIT_V2 = the address printed here
 *   7. Custody (48h): setProtocolFeeController(V3) on both manager-owner wrappers
 * Until step 7 executes, kit pools are born at V2's 999 pips and the Safe zeroes each by hand (Kit v2
 * decision #2). The kit's own `ProtocolFeeNotZero` assertion is gated on the installed controller naming
 * THIS kit, so it does not block launches in that window.
 *
 * WHAT CANNOT BE UNDONE: every argument except the launch fee value. The owner's only power is
 * `setLaunchFee` inside `maxLaunchFeeWei` (CLAUDE.md "Kit v2 decisions" #1 and the Ownership table row
 * `LaunchpadKit v2 owner -> Safe`). So every immutable is asserted before the broadcast and read back after.
 *
 * THE NUMBERS. Owner-decided: protocol LP floor 20% / cap 50% / integrator cap 20% (asserted on both lockers),
 * notice ~7 days. Measured here: `MAX_LEGS = 4` and `MAX_BINS_PER_LEG = 20` - four 32-bin legs cost 35.5M gas,
 * over Nitro's 32M block; four 20-bin legs cost 24.4M (`test/kitv2/LaunchpadKitV2Gas.t.sol`). The fee values
 * (initial wei, cap wei, integrator cap wei) are the owner's to price in native and come from the environment.
 *
 * CLOCK: `run()` probes the chain's `block.timestamp` (ContractClockProbe) before anything else; the kit's
 * constructor refuses any guard that is not `CLOCK_MODE() == "mode=timestamp"`; the notice delay is seconds.
 *
 * BUILD PROFILE: default (cancun) on Robinhood, as for every other contract on that chain. The kit and its
 * library compile at 9000 optimizer runs (foundry.toml `compilation_restrictions`) to fit EIP-170.
 *
 * Usage (dry run - never add --broadcast without a human reading the simulation):
 *   CL_POOL_MANAGER=.. BIN_POOL_MANAGER=.. CL_POSITION_MANAGER=.. BIN_POSITION_MANAGER=.. \
 *   LAUNCH_GUARD_HOOK=.. BIN_LAUNCH_GUARD_HOOK=.. LATCH_LP_LOCKER=.. LATCH_BIN_LP_LOCKER=.. \
 *   LAUNCH_TOKEN_FACTORY=.. LAUNCH_REGISTRY=.. KIT_OWNER_SAFE=0x715a6176946aDbD22c1B2021d321Fb3767ca3432 \
 *   LAUNCHPAD_STEWARD=<ops> INITIAL_LAUNCH_FEE_WEI=.. MAX_LAUNCH_FEE_WEI=.. MAX_INTEGRATOR_LAUNCH_FEE_WEI=.. \
 *   FEE_POLICY_V2=0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB \
 *   forge script script/DeployLaunchpadKitV2.s.sol --rpc-url $ROBINHOOD_RPC
 */
contract DeployLaunchpadKitV2Script is Script {
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    address internal constant ROBINHOOD_SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;

    uint16 internal constant CL_BITMAP = 0x0041;
    uint16 internal constant BIN_BITMAP = 0x0045;
    uint16 internal constant MIN_PROTOCOL_BPS = 2_000;
    uint16 internal constant MAX_PROTOCOL_BPS = 5_000;
    uint16 internal constant MAX_INTEGRATOR_BPS = 2_000;
    uint32 internal constant LAUNCH_FEE_NOTICE_SECONDS = 7 days;
    uint8 internal constant MAX_LEGS = 4;
    uint16 internal constant MAX_BINS_PER_LEG = 20;

    struct Wiring {
        uint256 pk;
        address clPoolManager;
        address binPoolManager;
        address clPositionManager;
        address binPositionManager;
        address clHook;
        address binHook;
        address clLocker;
        address binLocker;
        address tokenFactory;
        address launchRegistry;
        address safe;
        address launchpadSteward;
        uint256 initialLaunchFeeWei;
        uint256 maxLaunchFeeWei;
        uint256 maxIntegratorLaunchFeeWei;
        /// @dev Optional. When set, the V3 deploy script's own input checks are run against the new kit.
        address feePolicyV2;
    }

    function run() public returns (LaunchpadKitV2 kit) {
        ContractClockProbe.Reading memory clock = ContractClockProbe.check();
        console.log("chain clock: block.timestamp (EVM) ", clock.evmTimestamp);
        console.log("chain clock: header / wall clock   ", clock.headerTimestamp, clock.wallClockSeconds);
        return runWith(
            Wiring({
                pk: vm.envUint("PRIVATE_KEY"),
                clPoolManager: vm.envAddress("CL_POOL_MANAGER"),
                binPoolManager: vm.envAddress("BIN_POOL_MANAGER"),
                clPositionManager: vm.envAddress("CL_POSITION_MANAGER"),
                binPositionManager: vm.envAddress("BIN_POSITION_MANAGER"),
                clHook: vm.envAddress("LAUNCH_GUARD_HOOK"),
                binHook: vm.envAddress("BIN_LAUNCH_GUARD_HOOK"),
                clLocker: vm.envAddress("LATCH_LP_LOCKER"),
                binLocker: vm.envAddress("LATCH_BIN_LP_LOCKER"),
                tokenFactory: vm.envAddress("LAUNCH_TOKEN_FACTORY"),
                launchRegistry: vm.envAddress("LAUNCH_REGISTRY"),
                safe: vm.envAddress("KIT_OWNER_SAFE"),
                launchpadSteward: vm.envAddress("LAUNCHPAD_STEWARD"),
                initialLaunchFeeWei: vm.envUint("INITIAL_LAUNCH_FEE_WEI"),
                maxLaunchFeeWei: vm.envUint("MAX_LAUNCH_FEE_WEI"),
                maxIntegratorLaunchFeeWei: vm.envUint("MAX_INTEGRATOR_LAUNCH_FEE_WEI"),
                feePolicyV2: vm.envOr("FEE_POLICY_V2", address(0))
            })
        );
    }

    function runWith(Wiring memory w) public returns (LaunchpadKitV2 kit) {
        preflight(w);

        vm.startBroadcast(w.pk);
        kit = new LaunchpadKitV2(
            LaunchpadKitV2.Deployment({
                owner: w.safe,
                clPoolManager: ICLPoolManager(w.clPoolManager),
                clHook: LaunchGuardHook(w.clHook),
                clPositionManager: ICLPositionManager(w.clPositionManager),
                clLocker: LatchLPLocker(payable(w.clLocker)),
                binPoolManager: IBinPoolManager(w.binPoolManager),
                binHook: BinLaunchGuardHook(w.binHook),
                binPositionManager: IBinPositionManager(w.binPositionManager),
                binLocker: LatchBinLPLocker(payable(w.binLocker)),
                tokenFactory: ILaunchTokenFactory(w.tokenFactory),
                launchRegistry: ILaunchRegistryWriter(w.launchRegistry),
                protocolFeeRecipient: w.safe,
                launchpadSteward: w.launchpadSteward,
                initialLaunchFeeWei: w.initialLaunchFeeWei,
                maxLaunchFeeWei: w.maxLaunchFeeWei,
                launchFeeNoticeSeconds: LAUNCH_FEE_NOTICE_SECONDS,
                maxIntegratorLaunchFeeWei: w.maxIntegratorLaunchFeeWei,
                maxLegs: MAX_LEGS,
                maxBinsPerLeg: MAX_BINS_PER_LEG
            })
        );
        vm.stopBroadcast();

        postflight(kit, w);
    }

    /// @notice Every check that must pass before anything is broadcast. Public so tests drive it.
    function preflight(Wiring memory w) public view {
        address deployer = vm.addr(w.pk);
        address[11] memory mustHaveCode = [
            w.clPoolManager,
            w.binPoolManager,
            w.clPositionManager,
            w.binPositionManager,
            w.clHook,
            w.binHook,
            w.clLocker,
            w.binLocker,
            w.tokenFactory,
            w.launchRegistry,
            w.safe
        ];
        for (uint256 i; i < mustHaveCode.length; ++i) {
            require(mustHaveCode[i].code.length > 0, "an input address has no code");
        }

        // ---- ownership: the Safe from birth, and it is also the protocol fee recipient ----
        require(w.safe != deployer, "KIT_OWNER_SAFE is the deployer");
        if (block.chainid == ROBINHOOD_CHAIN_ID) require(w.safe == ROBINHOOD_SAFE, "KIT_OWNER_SAFE is not the governance Safe");
        require(w.launchpadSteward != address(0), "LAUNCHPAD_STEWARD unset - Ops");

        // ---- fees ----
        require(w.maxLaunchFeeWei > 0, "MAX_LAUNCH_FEE_WEI is zero - the owner could never charge");
        require(w.initialLaunchFeeWei <= w.maxLaunchFeeWei, "INITIAL_LAUNCH_FEE_WEI above the cap");

        // ---- one core ----
        address vault = address(ICLPoolManager(w.clPoolManager).vault());
        require(address(IBinPoolManager(w.binPoolManager).vault()) == vault, "managers on different vaults");
        require(IVaultApps(vault).isAppRegistered(w.clPoolManager), "CL manager not a Vault app");
        require(IVaultApps(vault).isAppRegistered(w.binPoolManager), "Bin manager not a Vault app");
        require(ILaunchRegistryWriter(w.launchRegistry).vault() == vault, "launch registry trusts another vault");
        require(address(IImmutableState(w.clPositionManager).vault()) == vault, "CL position manager vault");
        require(address(IImmutableState(w.binPositionManager).vault()) == vault, "Bin position manager vault");

        // ---- guards: timestamp clock, reservation bound to THIS factory ----
        LaunchGuardHook cl = LaunchGuardHook(w.clHook);
        BinLaunchGuardHook bin = BinLaunchGuardHook(w.binHook);
        require(address(cl.poolManager()) == w.clPoolManager, "CL guard: pool manager");
        require(address(bin.poolManager()) == w.binPoolManager, "Bin guard: pool manager");
        require(cl.getHooksRegistrationBitmap() == CL_BITMAP, "CL guard: bitmap");
        require(bin.getHooksRegistrationBitmap() == BIN_BITMAP, "Bin guard: bitmap");
        require(keccak256(bytes(cl.CLOCK_MODE())) == keccak256("mode=timestamp"), "CL guard: not timestamp");
        require(keccak256(bytes(bin.CLOCK_MODE())) == keccak256("mode=timestamp"), "Bin guard: not timestamp");
        require(address(cl.LAUNCH_TOKEN_FACTORY()) == w.tokenFactory, "CL guard: reservation factory");
        require(address(bin.LAUNCH_TOKEN_FACTORY()) == w.tokenFactory, "Bin guard: reservation factory - the pre-port hook?");

        // ---- lockers: the owner's numbers, paying the Safe ----
        LatchLPLocker cll = LatchLPLocker(payable(w.clLocker));
        LatchBinLPLocker bll = LatchBinLPLocker(payable(w.binLocker));
        require(address(cll.positionManager()) == w.clPositionManager, "CL locker: position manager");
        require(address(bll.positionManager()) == w.binPositionManager, "Bin locker: position manager");
        require(cll.protocolRecipient() == w.safe && bll.protocolRecipient() == w.safe, "a locker pays someone other than the Safe");
        require(cll.minProtocolBps() == MIN_PROTOCOL_BPS && bll.minProtocolBps() == MIN_PROTOCOL_BPS, "locker floor");
        require(cll.maxProtocolBps() == MAX_PROTOCOL_BPS && bll.maxProtocolBps() == MAX_PROTOCOL_BPS, "locker cap");
        require(cll.maxIntegratorBps() == MAX_INTEGRATOR_BPS && bll.maxIntegratorBps() == MAX_INTEGRATOR_BPS, "integrator cap");
        require(bll.maxBinsPerLock() >= MAX_BINS_PER_LEG, "Bin locker cannot hold a full leg");
    }

    /// @notice Read back the deployed reality. Public so tests drive it.
    function postflight(LaunchpadKitV2 kit, Wiring memory w) public {
        require(address(kit).code.length > 0 && address(kit).code.length <= 24_576, "kit code size");
        require(kit.owner() == w.safe, "owner is not the Safe");
        require(kit.pendingOwner() == address(0), "unexpected pending owner");
        require(address(kit.clPoolManager()) == w.clPoolManager, "clPoolManager");
        require(address(kit.binPoolManager()) == w.binPoolManager, "binPoolManager");
        require(address(kit.clPositionManager()) == w.clPositionManager, "clPositionManager");
        require(address(kit.binPositionManager()) == w.binPositionManager, "binPositionManager");
        require(address(kit.clHook()) == w.clHook, "clHook");
        require(address(kit.binHook()) == w.binHook, "binHook");
        require(address(kit.clLocker()) == w.clLocker, "clLocker");
        require(address(kit.binLocker()) == w.binLocker, "binLocker");
        require(address(kit.tokenFactory()) == w.tokenFactory, "tokenFactory");
        require(address(kit.launchRegistry()) == w.launchRegistry, "launchRegistry");
        require(kit.protocolFeeRecipient() == w.safe, "protocolFeeRecipient");
        require(kit.launchpadSteward() == w.launchpadSteward, "launchpadSteward");
        require(kit.maxLaunchFeeWei() == w.maxLaunchFeeWei, "maxLaunchFeeWei");
        require(kit.launchFeeWei() == w.initialLaunchFeeWei, "launchFeeWei");
        require(kit.launchFeeNoticeSeconds() == LAUNCH_FEE_NOTICE_SECONDS, "notice");
        require(kit.maxIntegratorLaunchFeeWei() == w.maxIntegratorLaunchFeeWei, "maxIntegratorLaunchFeeWei");
        require(kit.maxLegs() == MAX_LEGS && kit.maxBinsPerLeg() == MAX_BINS_PER_LEG, "caps");
        require(kit.maxIntegratorBps() == MAX_INTEGRATOR_BPS, "maxIntegratorBps");
        require(keccak256(bytes(kit.CLOCK_MODE())) == keccak256("mode=timestamp"), "clock mode");
        (uint256 pendingWei, uint64 pendingAt) = kit.pendingLaunchFee();
        require(pendingWei == 0 && pendingAt == 0, "born with a pending fee change");
        require(kit.totalFeesOwed() == 0 && address(kit).balance == 0, "kit not empty");
        require(
            IBinFungibleToken(w.binPositionManager).isApprovedForAll(address(kit), w.binLocker),
            "Bin locker approval missing"
        );
        try kit.renounceOwnership() {
            revert("renounceOwnership did not revert");
        } catch {}

        // ---- the V3 relationship: exactly what LatchProtocolFeeControllerV3's constructor probes ----
        (bool ok, bytes memory ret) =
            address(kit).staticcall{gas: 50_000}(abi.encodeCall(ILockedLaunchOracle.isLockedLaunch, (bytes32(0))));
        require(ok && ret.length == 32 && uint256(bytes32(ret)) == 0, "isLockedLaunch(0) is not a 32-byte false within V3's stipend");
        if (w.feePolicyV2 != address(0)) {
            // Runs the V3 deploy script's own pre-broadcast checks against this kit, so step 6 cannot fail.
            new DeployFeeControllerV3Script().checkInputs(w.safe, w.feePolicyV2, address(kit));
        }

        console.log("LaunchpadKitV2          ", address(kit));
        console.log("  owner (Safe)          ", kit.owner());
        console.log("  launch fee / cap, wei ", kit.launchFeeWei(), kit.maxLaunchFeeWei());
        console.log("  notice, s             ", kit.launchFeeNoticeSeconds());
        console.log("  integrator fee cap    ", kit.maxIntegratorLaunchFeeWei());
        console.log("  legs / bins per leg   ", kit.maxLegs(), kit.maxBinsPerLeg());
        console.log("");
        console.log("OWNERSHIP: Safe from the constructor; the deployer never held it. The owner can ONLY set");
        console.log("  the launch fee inside the immutable cap (raise: 7 days notice; lower: immediate).");
        console.log("NEXT: packages/fees DeployFeeControllerV3 with LAUNCHPAD_KIT_V2=<kit>, then the Custody install.");
        console.log("  Until V3 is installed, the runbook must zero each kit pool's core fee in the launch session.");
    }
}

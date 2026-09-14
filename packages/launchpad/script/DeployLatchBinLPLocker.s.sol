// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {IBinPositionManager} from "infinity-periphery/src/pool-bin/interfaces/IBinPositionManager.sol";
import {IImmutableState} from "infinity-periphery/src/interfaces/IImmutableState.sol";

import {LatchBinLPLocker} from "../src/LatchBinLPLocker.sol";
import {LatchLPLocker} from "../src/LatchLPLocker.sol";

/**
 * Deploys `LatchBinLPLocker` against an EXISTING shared core's `BinPositionManager`.
 *
 * ############################ WHAT CANNOT BE UNDONE ############################
 *
 * Everything. No owner, no setter, no pause, no upgrade. `protocolRecipient`, the three bps bounds and
 * `maxBinsPerLock` are immutables every future lock is validated against, forever, and every share locked
 * under a wrong value stays locked under it. So every argument is checked before the broadcast and read
 * back after it.
 *
 * THE NUMBERS ARE THE OWNER'S, not this script's. CLAUDE.md "Kit fees: decided by the owner, 2026-09-13":
 * protocol floor 20% of LP fees, protocol cap 50%, integrator cap 20% - the same as `LatchLPLocker`.
 * Duplicated as constants here rather than read from the contract, because an assertion that sources its
 * expectation from the contract under test asserts nothing.
 *
 * MAX_BINS_PER_LOCK = 64 is sized from `test_gas_lockCollectClaim_10_and_64_bins`: a 64-bin lock and a
 * worst-case 64-bin collect (every bin crossed) both fit comfortably in one transaction on an Arbitrum
 * Nitro chain. Kit v2's own `maxBins` must be <= this.
 *
 * If `LATCH_LP_LOCKER` is set, the script also asserts the CL locker on the same chain uses the same
 * protocol recipient and the same bounds, so a Bin leg and a CL leg of one launch cannot silently disagree.
 *
 * OWNERSHIP: nothing to transfer, nothing to accept. `protocolRecipient` must be the governance Safe
 * (CLAUDE.md "The governance Safe"), and the script refuses an EOA.
 *
 * Usage (dry run first - no --broadcast):
 *   BIN_POSITION_MANAGER=0x... \
 *   LOCKER_PROTOCOL_RECIPIENT=0x715a6176946aDbD22c1B2021d321Fb3767ca3432 \
 *   LATCH_LP_LOCKER=0x... \
 *   forge script script/DeployLatchBinLPLocker.s.sol --rpc-url $ROBINHOOD_RPC
 */
contract DeployLatchBinLPLockerScript is Script {
    uint16 internal constant MIN_PROTOCOL_BPS = 2_000;
    uint16 internal constant MAX_PROTOCOL_BPS = 5_000;
    uint16 internal constant MAX_INTEGRATOR_BPS = 2_000;
    uint16 internal constant MAX_BINS_PER_LOCK = 64;

    struct Wiring {
        /// @dev Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
        uint256 pk;
        address positionManager;
        address protocolRecipient;
        /// @dev Optional. `address(0)` skips the cross-check.
        address clLocker;
    }

    function run() public returns (LatchBinLPLocker locker) {
        return runWith(
            Wiring({
                pk: vm.envUint("PRIVATE_KEY"),
                positionManager: vm.envAddress("BIN_POSITION_MANAGER"),
                protocolRecipient: vm.envAddress("LOCKER_PROTOCOL_RECIPIENT"),
                clLocker: vm.envOr("LATCH_LP_LOCKER", address(0))
            })
        );
    }

    function runWith(Wiring memory w) public returns (LatchBinLPLocker locker) {
        _preflight(w);

        vm.startBroadcast(w.pk);
        locker = new LatchBinLPLocker(
            IBinPositionManager(w.positionManager),
            w.protocolRecipient,
            MIN_PROTOCOL_BPS,
            MAX_PROTOCOL_BPS,
            MAX_INTEGRATOR_BPS,
            MAX_BINS_PER_LOCK
        );
        vm.stopBroadcast();

        _postflight(locker, w);
    }

    function _preflight(Wiring memory w) internal view {
        require(w.positionManager.code.length > 0, "BIN_POSITION_MANAGER has no code");
        address vault = address(IImmutableState(w.positionManager).vault());
        require(vault != address(0), "BIN_POSITION_MANAGER reports no vault");
        address bpm = address(IBinPositionManager(w.positionManager).binPoolManager());
        require(bpm.code.length > 0, "BIN_POSITION_MANAGER reports no bin pool manager");
        require(address(IBinPoolManager(bpm).vault()) == vault, "bin pool manager and position manager disagree on vault");

        require(w.protocolRecipient != address(0), "LOCKER_PROTOCOL_RECIPIENT is zero");
        // A Safe, not an EOA: the recipient is immutable, and a Safe's signers rotate without its address changing.
        require(w.protocolRecipient.code.length > 0, "LOCKER_PROTOCOL_RECIPIENT has no code - must be the Safe");
        require(w.protocolRecipient != vm.addr(w.pk), "LOCKER_PROTOCOL_RECIPIENT is the deployer");

        if (w.clLocker != address(0)) {
            LatchLPLocker cl = LatchLPLocker(payable(w.clLocker));
            require(cl.protocolRecipient() == w.protocolRecipient, "CL locker pays a different protocol recipient");
            require(cl.minProtocolBps() == MIN_PROTOCOL_BPS, "CL locker floor differs");
            require(cl.maxProtocolBps() == MAX_PROTOCOL_BPS, "CL locker cap differs");
            require(cl.maxIntegratorBps() == MAX_INTEGRATOR_BPS, "CL locker integrator cap differs");
            require(cl.vault() == vault, "CL locker is on a different vault");
        }
    }

    function _postflight(LatchBinLPLocker locker, Wiring memory w) internal view {
        require(address(locker.positionManager()) == w.positionManager, "locker: positionManager");
        require(
            address(locker.binPoolManager()) == address(IBinPositionManager(w.positionManager).binPoolManager()),
            "locker: binPoolManager"
        );
        require(locker.vault() == address(IImmutableState(w.positionManager).vault()), "locker: vault");
        require(locker.protocolRecipient() == w.protocolRecipient, "locker: protocolRecipient");
        require(locker.minProtocolBps() == MIN_PROTOCOL_BPS, "locker: minProtocolBps");
        require(locker.maxProtocolBps() == MAX_PROTOCOL_BPS, "locker: maxProtocolBps");
        require(locker.maxIntegratorBps() == MAX_INTEGRATOR_BPS, "locker: maxIntegratorBps");
        require(locker.maxBinsPerLock() == MAX_BINS_PER_LOCK, "locker: maxBinsPerLock");
        require(locker.BPS_DENOMINATOR() == 10_000, "locker: denominator");
        require(locker.MAX_BINS_HARD_CAP() == 256, "locker: hard cap");
        require(locker.lockCount() == 0, "locker: not fresh");

        console.log("LatchBinLPLocker   ", address(locker));
        console.log("positionManager    ", w.positionManager);
        console.log("protocolRecipient  ", w.protocolRecipient);
    }
}

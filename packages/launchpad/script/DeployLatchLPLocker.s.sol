// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPositionManager} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionManager.sol";
import {IImmutableState} from "infinity-periphery/src/interfaces/IImmutableState.sol";

import {LatchLPLocker} from "../src/LatchLPLocker.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {LaunchTokenFactory} from "../src/LaunchTokenFactory.sol";

/**
 * Deploys `LatchLPLocker` and `LaunchTokenFactory` against an EXISTING shared core.
 *
 * ############################ WHAT CANNOT BE UNDONE ############################
 *
 * Everything. Neither contract has an owner, a setter, a pause or an upgrade path. The locker's
 * `protocolRecipient` and its three bps bounds are immutables that every future lock is validated
 * against, forever. A wrong value here is a contract to abandon, not a setting to fix - and every
 * position already locked in it stays locked under the wrong value. So every argument is checked
 * before the broadcast and read back after it.
 *
 * THE NUMBERS ARE THE OWNER'S, not this script's. CLAUDE.md "Kit fees: decided by the owner,
 * 2026-09-13": protocol floor 20% of LP fees, protocol cap 50%, integrator cap 20%. They are
 * constants HERE (duplicated rather than read from the contract, because an assertion that sources
 * its expectation from the contract under test asserts nothing) and constructor arguments THERE.
 *
 * OWNERSHIP: nothing to transfer, nothing to accept. The deployer holds no authority over either
 * contract the moment this script returns. `protocolRecipient` must be the governance Safe
 * (CLAUDE.md "The governance Safe": "Protocol fees go here"), and the script refuses an EOA.
 *
 * Usage (dry run first - no --broadcast):
 *   CL_POSITION_MANAGER=0x957cc13b24a563cc92253213d9d5e6954c8db6a7 \
 *   LOCKER_PROTOCOL_RECIPIENT=0x715a6176946aDbD22c1B2021d321Fb3767ca3432 \
 *   forge script script/DeployLatchLPLocker.s.sol --rpc-url $ROBINHOOD_RPC
 */
contract DeployLatchLPLockerScript is Script {
    uint16 internal constant MIN_PROTOCOL_BPS = 2_000;
    uint16 internal constant MAX_PROTOCOL_BPS = 5_000;
    uint16 internal constant MAX_INTEGRATOR_BPS = 2_000;

    struct Wiring {
        /// @dev Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
        uint256 pk;
        address positionManager;
        address protocolRecipient;
    }

    function run() public returns (LatchLPLocker locker, LaunchTokenFactory factory) {
        return runWith(
            Wiring({
                pk: vm.envUint("PRIVATE_KEY"),
                positionManager: vm.envAddress("CL_POSITION_MANAGER"),
                protocolRecipient: vm.envAddress("LOCKER_PROTOCOL_RECIPIENT")
            })
        );
    }

    function runWith(Wiring memory w) public returns (LatchLPLocker locker, LaunchTokenFactory factory) {
        _preflight(w);

        vm.startBroadcast(w.pk);
        locker = new LatchLPLocker(
            ICLPositionManager(w.positionManager),
            w.protocolRecipient,
            MIN_PROTOCOL_BPS,
            MAX_PROTOCOL_BPS,
            MAX_INTEGRATOR_BPS
        );
        factory = new LaunchTokenFactory();
        vm.stopBroadcast();

        _postflight(locker, factory, w);
    }

    function _preflight(Wiring memory w) internal view {
        require(w.positionManager.code.length > 0, "CL_POSITION_MANAGER has no code");
        require(
            address(IImmutableState(w.positionManager).vault()) != address(0), "CL_POSITION_MANAGER reports no vault"
        );
        require(w.protocolRecipient != address(0), "LOCKER_PROTOCOL_RECIPIENT is zero");
        // A Safe, not an EOA: the recipient is immutable, and a Safe's signers rotate without its address
        // changing. An EOA here is an unrotatable revenue key for the life of the locker.
        require(w.protocolRecipient.code.length > 0, "LOCKER_PROTOCOL_RECIPIENT has no code - must be the Safe");
        require(w.protocolRecipient != vm.addr(w.pk), "LOCKER_PROTOCOL_RECIPIENT is the deployer");
    }

    function _postflight(LatchLPLocker locker, LaunchTokenFactory factory, Wiring memory w) internal view {
        require(address(locker.positionManager()) == w.positionManager, "locker: positionManager");
        require(locker.vault() == address(IImmutableState(w.positionManager).vault()), "locker: vault");
        require(locker.protocolRecipient() == w.protocolRecipient, "locker: protocolRecipient");
        require(locker.minProtocolBps() == MIN_PROTOCOL_BPS, "locker: minProtocolBps");
        require(locker.maxProtocolBps() == MAX_PROTOCOL_BPS, "locker: maxProtocolBps");
        require(locker.maxIntegratorBps() == MAX_INTEGRATOR_BPS, "locker: maxIntegratorBps");
        require(locker.BPS_DENOMINATOR() == 10_000, "locker: denominator");
        require(locker.lockCount() == 0, "locker: not fresh");

        require(
            factory.launchTokenInitCodeHash() == keccak256(type(LaunchToken).creationCode), "factory: init code hash"
        );
        require(factory.MAX_NAME_BYTES() == 64, "factory: name bound");
        require(factory.MAX_SYMBOL_BYTES() == 32, "factory: symbol bound");
        require(factory.MAX_METADATA_URI_BYTES() == 512, "factory: uri bound");

        console.log("LatchLPLocker      ", address(locker));
        console.log("LaunchTokenFactory ", address(factory));
        console.log("protocolRecipient  ", w.protocolRecipient);
        console.logBytes32(factory.launchTokenInitCodeHash());
    }
}

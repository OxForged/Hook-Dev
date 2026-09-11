// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {LatchProtocolFeeController} from "../src/LatchProtocolFeeController.sol";

/**
 * Deploys `LatchProtocolFeeController` for a MAINNET chain.
 *
 * Separate from `DeployLatchFeeController.s.sol`, which passes the deployer as
 * BOTH owner and guardian so a testnet can be exercised from one key. On
 * mainnet those two must be different addresses, because the whole design of
 * the guardian is that it is a DIFFERENT, hotter key than the owner:
 *
 *   owner    -> the Safe. Sets fees, sets the guardian. Everything that can
 *               INCREASE what the protocol takes lives here, and it is the
 *               interim step before the 6h POLICY timelock
 *               (0x1Da3AD33AB8151Af9EE91b90fA23fFdDFf9C0C3A).
 *
 *   guardian -> the ops key. Can disable fees IMMEDIATELY and can do nothing
 *               else — it cannot enable them, raise them, or change any
 *               configuration. Delay belongs on privilege escalation, never on
 *               privilege reduction: if the only route to switching fees off
 *               runs through a six-hour queue, then during an incident the
 *               protocol keeps charging for six hours.
 *
 * Do not add powers to the guardian. Anything that can increase what the
 * protocol takes, or change who controls it, belongs behind the owner.
 *
 * Usage:
 *   FEE_OWNER=0x...     (the Safe)
 *   FEE_GUARDIAN=0x...  (ops key)
 *   forge script script/DeployLatchFeeControllerMainnet.s.sol --rpc-url <chain> --broadcast --slow
 */
contract DeployLatchFeeControllerMainnetScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address owner = vm.envAddress("FEE_OWNER");
        address guardian = vm.envAddress("FEE_GUARDIAN");

        // A typo'd owner is almost always an EOA, and nothing downstream would
        // notice that fee policy answers to one key.
        require(owner.code.length > 0, "FEE_OWNER has no code - not a contract");
        require(owner != deployer, "FEE_OWNER must not be the deployer");
        // The separation IS the design. Same address for both collapses the
        // guardian into the owner and removes the fast path it exists to give.
        require(owner != guardian, "FEE_OWNER and FEE_GUARDIAN must differ");

        vm.startBroadcast(pk);
        LatchProtocolFeeController controller = new LatchProtocolFeeController(owner, guardian);
        vm.stopBroadcast();

        require(controller.owner() == owner, "owner not set");
        require(controller.guardian() == guardian, "guardian not set");

        console.log("LatchProtocolFeeController ", address(controller));
        console.log("  owner                    ", controller.owner());
        console.log("  guardian                 ", controller.guardian());
        console.log("  max protocol fee (pips)  ", controller.MAX_PROTOCOL_FEE());
        console.log("  deployer holds nothing.");
    }
}

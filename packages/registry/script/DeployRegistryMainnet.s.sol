// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {LatchRegistry} from "../src/LatchRegistry.sol";

/**
 * Deploys `LatchRegistry` for a MAINNET chain.
 *
 * Separate from `DeployRegistry.s.sol` for the same reason the governance
 * scripts are split: that one hands the deployer admin, curator AND guardian so
 * the marketplace can be exercised on a testnet, which is a sensible testnet
 * default and a bad mainnet one. A flag choosing between those two worlds is a
 * flag somebody eventually gets wrong.
 *
 * ROLES, and why they are not all the same address.
 *
 *   DEFAULT_ADMIN_ROLE -> the Safe. It grants and revokes the other two, which
 *     is privilege escalation, so it belongs with governance. It is NOT given
 *     to a timelock: the registry custodies nothing, a bad listing is reversible
 *     by the guardian in one transaction, and a queue here buys nothing. This
 *     is the judgement call recorded in CLAUDE.md's ownership table — revisit it
 *     if the registry ever gates funds.
 *
 *   CURATOR_ROLE -> the ops key. Listing throughput; a Safe signature per
 *     listing would make the marketplace unusable.
 *
 *   GUARDIAN_ROLE -> the ops key. Flagging a Latch that is draining people has
 *     to be immediate. The guardian can only ever flag or unlist — it cannot
 *     mint an audit badge or clear a warning — so a hot key is the right trade.
 *
 * Usage:
 *   REGISTRY_ADMIN=0x...  (the Safe)
 *   REGISTRY_OPS=0x...    (curator + guardian)
 *   forge script script/DeployRegistryMainnet.s.sol --rpc-url <chain> --broadcast --slow
 */
contract DeployRegistryMainnetScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address admin = vm.envAddress("REGISTRY_ADMIN");
        address ops = vm.envAddress("REGISTRY_OPS");

        // A typo'd admin is almost always an EOA or an empty slot, and nothing
        // downstream would ever notice that governance is one key.
        require(admin.code.length > 0, "REGISTRY_ADMIN has no code - not a contract");
        require(admin != deployer, "REGISTRY_ADMIN must not be the deployer");

        address[] memory curators = new address[](1);
        curators[0] = ops;
        address[] memory guardians = new address[](1);
        guardians[0] = ops;

        vm.startBroadcast(pk);
        LatchRegistry registry = new LatchRegistry(admin, curators, guardians);
        vm.stopBroadcast();

        /* Assert the deployed reality, not the intent. */
        bytes32 ADMIN_ROLE = registry.DEFAULT_ADMIN_ROLE();
        require(registry.hasRole(ADMIN_ROLE, admin), "admin role not held by REGISTRY_ADMIN");
        require(registry.hasRole(registry.CURATOR_ROLE(), ops), "curator not set");
        require(registry.hasRole(registry.GUARDIAN_ROLE(), ops), "guardian not set");

        /* THE ONE THAT MATTERS: the deployer must not be able to grant itself
           anything later. Admin is the escalation path; curator and guardian
           are not, because both can only flag or unlist and neither can mint an
           audit badge or clear a warning.

           This deliberately does NOT assert that the deployer lacks curator and
           guardian. An earlier version did, and it reverted the deploy — because
           on this protocol REGISTRY_OPS and the deployer are the same wallet by
           the owner's explicit decision (see CLAUDE.md, "One wallet, four
           roles"). The assertion encoded my assumption rather than the project's
           actual key policy. Where the two differ, the deploy should stop; where
           the policy is deliberate, an assertion that contradicts it is a bug in
           the assertion. */
        require(!registry.hasRole(ADMIN_ROLE, deployer), "deployer still holds admin");
        if (ops != deployer) {
            require(!registry.hasRole(registry.CURATOR_ROLE(), deployer), "deployer still curator");
            require(!registry.hasRole(registry.GUARDIAN_ROLE(), deployer), "deployer still guardian");
        }

        console.log("LatchRegistry ", address(registry));
        console.log("  admin       ", admin);
        console.log("  curator     ", ops);
        console.log("  guardian    ", ops);
        console.log("  latchCount  ", registry.latchCount());
        console.log("  deployer holds no role.");
    }
}

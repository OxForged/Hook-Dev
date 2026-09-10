// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchHookRegistry} from "../src/LatchHookRegistry.sol";

/**
 * Deploys the hook registry — the contract backing the marketplace.
 *
 * Role model, deliberately asymmetric:
 *   DEFAULT_ADMIN  only decides who holds the other two roles. On mainnet this MUST
 *                  be the 48h custody LatchTimelock (0x35D72DbEeD5F2CE95a4DFb3917D2CD3c43e544CA
 *                  on Sepolia), since granting CURATOR is how a bad actor would mint
 *                  audit badges.
 *   CURATOR        attests in both directions (promote and demote).
 *   GUARDIAN       can ONLY move a listing to a more cautious state. A compromised
 *                  guardian can slander a hook — visible, reversible, costs nobody
 *                  funds — but cannot mint an audit badge or clear a warning.
 *
 * Curators are deliberately NOT timelocked: a six-hour queue on "this hook is
 * draining people" makes the flag useless.
 *
 * TESTNET: deployer holds all three so the marketplace can be exercised.
 */
contract DeployRegistryScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address[] memory curators = new address[](1);
        curators[0] = deployer;
        address[] memory guardians = new address[](1);
        guardians[0] = deployer;

        vm.startBroadcast(pk);
        LatchHookRegistry registry = new LatchHookRegistry(deployer, curators, guardians);
        vm.stopBroadcast();

        require(registry.hasRole(registry.CURATOR_ROLE(), deployer), "curator not set");
        require(registry.hasRole(registry.GUARDIAN_ROLE(), deployer), "guardian not set");

        console.log("LatchHookRegistry  ", address(registry));
        console.log("  admin            ", deployer);
        console.log("  hookCount        ", registry.hookCount());
    }
}

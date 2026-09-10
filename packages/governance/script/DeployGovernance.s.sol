// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchTimelock} from "../src/LatchTimelock.sol";

/**
 * Deploys both governance timelocks.
 *
 * Two tiers, because delay should be proportional to how hard an action is to undo:
 *
 *   CUSTODY (48h) — owns Vault and the pool managers. `Vault.registerApp` is
 *     onlyOwner and IRREVERSIBLE; there is no unregister anywhere in the Vault or
 *     its interface. A registered app can move funds against the Vault forever, so
 *     the only real defence is a window long enough for the public to notice.
 *
 *   POLICY (6h) — owns the protocol fee controller. Fee changes are reversible and
 *     sometimes need to answer market conditions. A multi-day delay on a fee tweak
 *     buys nothing and creates pressure to hand someone an emergency bypass.
 *
 * TESTNET: the deployer is proposer and executor so Sepolia stays iterable.
 * MAINNET: the proposer MUST be a Safe multisig. Executors may be left open —
 * once an operation has survived its delay in public, anyone executing it is
 * harmless, and it removes the multisig as a liveness dependency.
 *
 * These are deployed but NOT yet wired as owners on Sepolia. Handing the Vault to a
 * 48h timelock on a testnet makes iteration miserable; the wiring is a mainnet step.
 * Deploying them now means the governance model is real code at a real address that
 * can be exercised, rather than a diagram.
 */
contract DeployGovernanceScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;

        vm.startBroadcast(pk);

        LatchTimelock custody =
            new LatchTimelock(LatchTimelock.Tier.Custody, 48 hours, proposers, executors);
        LatchTimelock policy =
            new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, proposers, executors);

        vm.stopBroadcast();

        // Prove the floors are live, not just compiled.
        require(custody.getMinDelay() == 48 hours, "custody delay wrong");
        require(policy.getMinDelay() == 6 hours, "policy delay wrong");
        require(!custody.hasRole(custody.DEFAULT_ADMIN_ROLE(), deployer), "deployer must not be admin");

        console.log("LatchTimelock CUSTODY ", address(custody));
        console.log("  minDelay (s)        ", custody.getMinDelay());
        console.log("  floor    (s)        ", custody.minDelayFloor());
        console.log("LatchTimelock POLICY  ", address(policy));
        console.log("  minDelay (s)        ", policy.getMinDelay());
        console.log("  floor    (s)        ", policy.minDelayFloor());
        console.log("");
        console.log("No external admin holds DEFAULT_ADMIN_ROLE - the timelocks self-administer.");
    }
}

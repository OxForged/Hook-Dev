// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchTimelock} from "../src/LatchTimelock.sol";

/**
 * TESTNET rehearsal deployment. Deploys BOTH tiers on purpose — see below.
 *
 *   CUSTODY (48h) — owns Vault and the pool managers. `Vault.registerApp` is
 *     onlyOwner and IRREVERSIBLE; there is no unregister anywhere in the Vault or
 *     its interface. A registered app can move funds against the Vault forever, so
 *     the only real defence is a window long enough for the public to notice.
 *
 *   POLICY (6h) — retained here, and DELIBERATELY NOT DEPLOYED ON MAINNET.
 *     `DeployGovernanceMainnet.s.sol` deploys Custody only; everything the
 *     ownership table used to route through Policy is held by the Safe directly,
 *     because a delay on a reversible action is a check on co-signers that a
 *     single operator does not have. The tier stays exercised here so that
 *     bringing it back — when there is a team — is a script change against code
 *     that is known to work, rather than an untested path.
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

        /* The canceller must not be a proposer, which the constructor enforces, so a
           testnet run needs a second address. `GOVERNANCE_CANCELLER` if one is set,
           otherwise a deterministic throwaway — this is a testnet script and the
           point is to exercise the role's existence, not to secure it. */
        address canceller = vm.envOr("GOVERNANCE_CANCELLER", address(uint160(uint256(keccak256("latch.testnet.canceller")))));
        require(canceller != deployer, "GOVERNANCE_CANCELLER must not be the deployer");

        vm.startBroadcast(pk);

        LatchTimelock custody =
            new LatchTimelock(LatchTimelock.Tier.Custody, 48 hours, proposers, executors, canceller);
        LatchTimelock policy =
            new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, proposers, executors, canceller);

        vm.stopBroadcast();

        // Prove the floors are live, not just compiled.
        require(custody.getMinDelay() == 48 hours, "custody delay wrong");
        require(policy.getMinDelay() == 6 hours, "policy delay wrong");
        require(!custody.hasRole(custody.DEFAULT_ADMIN_ROLE(), deployer), "deployer must not be admin");
        require(custody.hasRole(custody.CANCELLER_ROLE(), canceller), "canceller role not granted");

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

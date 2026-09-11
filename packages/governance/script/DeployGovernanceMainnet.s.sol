// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchTimelock} from "../src/LatchTimelock.sol";

/**
 * Deploys both governance timelocks for a MAINNET chain.
 *
 * Separate from `DeployGovernance.s.sol` rather than a flag on it. That script
 * makes the deployer both proposer and executor so Sepolia stays iterable — a
 * sensible testnet default and a catastrophic mainnet one, since it reduces the
 * whole governance model to a 48-hour delay on a single key. A boolean argument
 * deciding which of those two worlds you are in is a boolean somebody
 * eventually gets wrong at 2am. Two files, two names, no flag.
 *
 * THE ORDER MATTERS. These must exist BEFORE the Vault, because
 * `01_DeployVault.s.sol` ends with `transferOwnership(config.poolOwner)` — so
 * whatever the chain config names becomes the Vault's owner the instant it is
 * deployed. Deploy these first, paste the addresses into
 * `packages/core/script/config/latch-<chain>.json`, and the Vault is never
 * EOA-owned on mainnet, not for a single block. Deploying the Vault first and
 * transferring afterwards leaves a window in which one key can call
 * `registerApp`, which is irreversible.
 *
 * Usage:
 *   GOVERNANCE_SAFE=0x... \
 *   forge script script/DeployGovernanceMainnet.s.sol \
 *     --rpc-url <chain> --broadcast --slow
 */
contract DeployGovernanceMainnetScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address safe = vm.envAddress("GOVERNANCE_SAFE");

        /* ---- pre-flight, before anything is broadcast ---------------------
           Each of these has a specific failure it prevents, and each is
           cheaper to hit here than to discover after the timelocks own the
           protocol. There is no unregister, and no way to re-point a timelock
           that was deployed with the wrong proposer — only a redeploy and a
           re-transfer of everything it owns. */

        // A typo'd Safe address is almost always an EOA or an empty slot. If
        // the sole proposer has no code, governance is one private key with
        // extra steps, and nothing downstream would ever notice.
        require(safe.code.length > 0, "GOVERNANCE_SAFE has no code - not a contract");

        // The deployer is a hot key that just held the deployment. It must not
        // also be the thing that proposes.
        require(safe != deployer, "GOVERNANCE_SAFE must not be the deployer");

        /* Sole proposer: the Safe. */
        address[] memory proposers = new address[](1);
        proposers[0] = safe;

        /* OPEN EXECUTION, deliberately. OpenZeppelin treats address(0) in the
           executor set as "anyone may execute". Once an operation has survived
           its delay in public there is nothing left to protect — the delay was
           the protection — and an open executor removes the Safe as a liveness
           dependency, so a lost quorum cannot strand a matured operation.

           It is a one-element array rather than an empty one because
           `LatchTimelock` reverts `NoExecutors()` on an empty set: a timelock
           that can queue but never execute is a bricked timelock, and that
           check exists to catch exactly that mistake. */
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        vm.startBroadcast(pk);

        LatchTimelock custody =
            new LatchTimelock(LatchTimelock.Tier.Custody, 48 hours, proposers, executors);
        LatchTimelock policy =
            new LatchTimelock(LatchTimelock.Tier.Policy, 6 hours, proposers, executors);

        vm.stopBroadcast();

        /* ---- post-flight: assert the deployed reality, not the intent ----- */
        bytes32 PROPOSER = custody.PROPOSER_ROLE();
        bytes32 EXECUTOR = custody.EXECUTOR_ROLE();
        bytes32 ADMIN = custody.DEFAULT_ADMIN_ROLE();

        require(custody.getMinDelay() == 48 hours, "custody delay wrong");
        require(policy.getMinDelay() == 6 hours, "policy delay wrong");

        require(custody.hasRole(PROPOSER, safe), "custody: safe is not proposer");
        require(policy.hasRole(PROPOSER, safe), "policy: safe is not proposer");

        // The deployer must hold NOTHING. This is the assertion that would have
        // caught the Sepolia deployment, where the deployer is still proposer.
        require(!custody.hasRole(PROPOSER, deployer), "custody: deployer is proposer");
        require(!policy.hasRole(PROPOSER, deployer), "policy: deployer is proposer");
        require(!custody.hasRole(ADMIN, deployer), "custody: deployer is admin");
        require(!policy.hasRole(ADMIN, deployer), "policy: deployer is admin");

        // Open execution, confirmed on chain rather than assumed from the input.
        require(custody.hasRole(EXECUTOR, address(0)), "custody: execution not open");
        require(policy.hasRole(EXECUTOR, address(0)), "policy: execution not open");

        console.log("");
        console.log("=== Paste these into packages/core/script/config/latch-<chain>.json ===");
        console.log('  "poolOwner":                  ', address(custody));
        console.log('  "protocolFeeControllerOwner": ', address(policy));
        console.log("");
        console.log("CUSTODY (48h) ", address(custody));
        console.log("POLICY  (6h)  ", address(policy));
        console.log("proposer      ", safe);
        console.log("executor       open - anyone may execute a matured operation");
        console.log("admin          none - the timelocks self-administer");
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {LatchProtocolFeeControllerV2} from "../src/LatchProtocolFeeControllerV2.sol";

/**
 * Deploys the replacement protocol fee controller for Robinhood Chain.
 *
 * WHY WE ARE REPLACING A CONTRACT THAT WORKS. V1 at
 * `0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c` prices pools correctly and cannot withdraw a
 * single wei. `ProtocolFees.collectProtocolFees` admits only the installed controller, and V1
 * has no function that calls it — verified against its live bytecode, which is byte-for-byte
 * identical to its source. Every pip charged under V1 accrues into `protocolFeesAccrued` where
 * nobody can reach it.
 *
 * Nothing already accrued is lost: the caller check runs at COLLECTION time, so once V2 is
 * installed it can sweep balances that built up under V1. That is why this migration is not
 * urgent and why the order of the two Safe transactions does not matter.
 *
 * OWNERSHIP IS SET IN THE CONSTRUCTOR, NOT AFTERWARDS. This contract can move collected funds,
 * which makes it more valuable than V1, and a deploy-then-transfer window would put that power
 * on the deployer key — the one that lives on a shared VPS. `Ownable2Step` means a transfer
 * would also need the Safe to accept, so the window would be measured in Safe latency rather
 * than in blocks. Passing the Safe directly closes it.
 *
 *   owner    = the governance Safe, which is what `CLPoolManagerOwner.owner()` reads today.
 *   guardian = the ops key. It may zero fees in an incident and can NEVER collect.
 *
 * Usage — dry run first, without --broadcast:
 *
 *   forge script script/DeployFeeControllerV2.s.sol \
 *     --rpc-url $ROBINHOOD_RPC
 *
 * Then, to send:
 *
 *   forge script script/DeployFeeControllerV2.s.sol \
 *     --rpc-url $ROBINHOOD_RPC --broadcast --slow
 *
 * Afterwards the Safe executes ops/safe/robinhood-install-fee-controller-v2.json, which points
 * both pool managers at the new address. Until that batch lands this contract is inert: it is
 * not the controller of anything, and it prices no pools.
 */
contract DeployFeeControllerV2Script is Script {
    /// The governance Safe. Same address on Robinhood Chain and Sepolia.
    address constant SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;

    /// Ops key: deployer, keeper, guardian and oracle publisher. Disable-only here.
    address constant GUARDIAN = 0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9;

    /// Live pool managers, for the read-back below.
    address constant CL_POOL_MANAGER = 0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66;
    address constant BIN_POOL_MANAGER = 0x1bB57b3A59b69f128700Ff59cC6EE22835aE6979;

    /// The controller being replaced.
    address constant V1 = 0x2a03E6E6900b9cF93CcC27e3A75a5a95FB4a154c;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("=== DEPLOY LatchProtocolFeeControllerV2 ===");
        console.log("  deployer  ", deployer);
        console.log("  owner     ", SAFE, "(set in the constructor, never transferred)");
        console.log("  guardian  ", GUARDIAN);

        vm.startBroadcast(pk);
        LatchProtocolFeeControllerV2 controller = new LatchProtocolFeeControllerV2(SAFE, GUARDIAN);
        vm.stopBroadcast();

        /* Read every claim back off the deployed contract. A constructor argument that was
           mistyped looks exactly like one that was not, until something reads it. */
        console.log("");
        console.log("=== DEPLOYED ===");
        console.log("  address              ", address(controller));
        console.log("  owner()              ", controller.owner());
        console.log("  guardian()           ", controller.guardian());
        console.log("  splitRatio           ", controller.protocolFeeSplitRatio(), "(25% of the total swap fee)");
        console.log("  MAX_PROTOCOL_FEE     ", controller.MAX_PROTOCOL_FEE());

        require(controller.owner() == SAFE, "owner is not the Safe");
        require(controller.guardian() == GUARDIAN, "guardian mismatch");
        require(controller.protocolFeeSplitRatio() == 250_000, "split ratio is not 25%");

        /* The tier table, printed so the numbers in the PR and the numbers on chain can be
           compared without a calculator. */
        console.log("");
        console.log("=== FEE PER TIER (pips per direction) ===");
        uint24[5] memory tiers = [uint24(100), 500, 2500, 3000, 10000];
        for (uint256 i = 0; i < tiers.length; i++) {
            console.log("  lpFee", tiers[i], "-> protocol", controller.feeForLpFee(tiers[i]));
        }
        require(controller.feeForLpFee(3000) == 999, "0.30% tier is not 999 pips");

        console.log("");
        console.log("=== NOT LIVE YET ===");
        console.log("This contract prices nothing until the Safe executes:");
        console.log("  ops/safe/robinhood-install-fee-controller-v2.json");
        console.log("which calls setProtocolFeeController on both pool manager owners.");
        console.log("  CL  manager ", CL_POOL_MANAGER);
        console.log("  BIN manager ", BIN_POOL_MANAGER);
        console.log("  replacing   ", V1);
    }
}

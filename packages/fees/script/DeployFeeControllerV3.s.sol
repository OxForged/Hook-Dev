// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {IProtocolFeeController} from "infinity-core/src/interfaces/IProtocolFeeController.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";

import {LatchProtocolFeeControllerV3} from "../src/LatchProtocolFeeControllerV3.sol";
import {ILockedLaunchOracle} from "../src/interfaces/ILockedLaunchOracle.sol";

interface IV2Identity {
    function owner() external view returns (address);
    function DYNAMIC_FEE_PIPS() external view returns (uint16);
    function DEFAULT_SPLIT_RATIO() external view returns (uint256);
    function MAX_PROTOCOL_FEE() external view returns (uint16);
}

/**
 * Deploys LatchProtocolFeeControllerV3. Design: packages/fees/docs/controller-v3.md.
 *
 * INERT UNTIL INSTALLED. Deploying this changes no pool's fee. It prices nothing until the custody
 * timelock executes `setProtocolFeeController(V3)` on both pool-manager owner wrappers, a 48h
 * operation whose calldata `BuildInstallFeeControllerV3.s.sol` prints.
 *
 * OWNERSHIP, per the CLAUDE.md table (`LatchProtocolFeeController` owner = Safe): set in the
 * constructor, never transferred, so the deployer key never holds it. V3 has no guardian; the
 * Ops guardian stays on V2, where it can only disable fees.
 *
 * Every input comes from the environment and is checked on chain BEFORE broadcasting; every
 * immutable is read back AFTER. On Robinhood (4663) the Safe and V2 must also equal the addresses
 * of record.
 *
 *   PRIVATE_KEY        deployer (gas only)
 *   FEE_OWNER_SAFE     governance Safe
 *   FEE_POLICY_V2      live LatchProtocolFeeControllerV2
 *   LAUNCHPAD_KIT_V2   the LaunchpadKit v2 deployment - never an adapter
 *
 *   forge script script/DeployFeeControllerV3.s.sol --rpc-url $RPC            # dry run
 *   forge script script/DeployFeeControllerV3.s.sol --rpc-url $RPC --broadcast --slow
 */
contract DeployFeeControllerV3Script is Script {
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    address internal constant ROBINHOOD_SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;
    address internal constant ROBINHOOD_V2 = 0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address safe = vm.envAddress("FEE_OWNER_SAFE");
        address policy = vm.envAddress("FEE_POLICY_V2");
        address kit = vm.envAddress("LAUNCHPAD_KIT_V2");

        if (block.chainid == ROBINHOOD_CHAIN_ID) {
            require(safe == ROBINHOOD_SAFE, "FEE_OWNER_SAFE is not the Robinhood governance Safe");
            require(policy == ROBINHOOD_V2, "FEE_POLICY_V2 is not the installed V2");
        }

        checkInputs(safe, policy, kit);

        console.log("=== DEPLOY LatchProtocolFeeControllerV3 ===");
        console.log("  deployer     ", vm.addr(pk));
        console.log("  owner        ", safe);
        console.log("  policy (V2)  ", policy);
        console.log("  launchOracle ", kit);

        vm.startBroadcast(pk);
        LatchProtocolFeeControllerV3 controller =
            new LatchProtocolFeeControllerV3(safe, IProtocolFeeController(policy), kit);
        vm.stopBroadcast();

        verifyDeployment(controller, safe, policy, kit);

        console.log("");
        console.log("=== DEPLOYED, NOT INSTALLED ===");
        console.log("  V3 ", address(controller));
        console.log("Next: FEE_CONTROLLER_V3=<V3> forge script script/BuildInstallFeeControllerV3.s.sol --rpc-url $RPC");
    }

    /// @notice Pre-broadcast checks. Public so the test suite exercises the exact code that gates a deploy.
    function checkInputs(address safe, address policy, address kit) public view {
        require(safe != address(0) && policy != address(0) && kit != address(0), "zero address input");
        require(safe.code.length > 0, "owner must be the Safe contract, not an EOA");
        require(policy.code.length > 0, "policy has no code");
        require(kit.code.length > 0, "kit has no code");
        require(kit != policy && kit != safe && policy != safe, "inputs must be three distinct contracts");

        IV2Identity v2 = IV2Identity(policy);
        require(v2.owner() == safe, "V2 is not owned by the Safe: V3 would compose over foreign policy");
        require(v2.DYNAMIC_FEE_PIPS() == 999, "policy is not LatchProtocolFeeControllerV2 (DYNAMIC_FEE_PIPS)");
        require(v2.DEFAULT_SPLIT_RATIO() == 250_000, "policy is not LatchProtocolFeeControllerV2 (split)");
        require(v2.MAX_PROTOCOL_FEE() == 4000, "policy is not LatchProtocolFeeControllerV2 (cap)");

        (bool ok, bytes memory ret) =
            kit.staticcall(abi.encodeCall(ILockedLaunchOracle.isLockedLaunch, (bytes32(0))));
        require(ok && ret.length == 32 && uint256(bytes32(ret)) == 0, "kit does not implement isLockedLaunch");

        /* Kit v2's owner is the Safe (Kit v2 decisions #1). A kit governed by anyone else is a
           tenant's kit, and the protocol's zero-fee rule must not be bound to it. */
        (ok, ret) = kit.staticcall(abi.encodeWithSignature("owner()"));
        require(ok && ret.length == 32, "kit has no owner(): not LaunchpadKit v2");
        require(abi.decode(ret, (address)) == safe, "kit is not owned by the Safe: not Latch's kit");
    }

    /// @notice Post-broadcast read-back of every immutable and every ownership claim.
    function verifyDeployment(LatchProtocolFeeControllerV3 c, address safe, address policy, address kit)
        public
        view
    {
        require(address(c).code.length > 0, "no code at V3");
        require(c.owner() == safe, "owner is not the Safe");
        require(c.pendingOwner() == address(0), "unexpected pending owner");
        require(address(c.policy()) == policy, "policy immutable mismatch");
        require(c.launchOracle() == kit, "launchOracle immutable mismatch");
        require(c.treasury() == safe, "treasury is not the Safe");
        require(c.LAUNCH_ORACLE_GAS() == 50_000, "oracle stipend changed");

        /* V3 must agree with V2 on a pool the kit never created. */
        PoolKey memory probe = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            hooks: IHooks(address(0)),
            poolManager: IPoolManager(address(0x3)),
            fee: 3000,
            parameters: bytes32(uint256(60) << 16)
        });
        require(
            c.protocolFeeForPool(probe) == IProtocolFeeController(policy).protocolFeeForPool(probe),
            "V3 disagrees with V2 on a non-launch pool"
        );
        probe.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        probe.hooks = IHooks(address(0x4));
        require(
            c.protocolFeeForPool(probe) == IProtocolFeeController(policy).protocolFeeForPool(probe),
            "V3 disagrees with V2 on a non-launch dynamic pool"
        );

        try c.renounceOwnership() {
            revert("renounceOwnership did not revert");
        } catch {}
    }
}

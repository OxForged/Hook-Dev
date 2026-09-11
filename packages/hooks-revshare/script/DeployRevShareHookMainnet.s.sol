// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {RevShareHook} from "../src/RevShareHook.sol";

/**
 * Deploys `RevShareHook` to a MAINNET chain.
 *
 * The only script here before this one was `ExerciseSepolia.s.sol`, which
 * deploys a hook AND drives a full revenue cycle through it. That is the right
 * shape for a testnet and the wrong one for mainnet: it creates pools, adds
 * liquidity and swaps, none of which should happen as a side effect of a
 * deployment.
 *
 * OWNERSHIP IS SET IN THE CONSTRUCTOR, not transferred afterwards. `RevShareHook`
 * passes `owner_` straight to `Ownable(owner_)`, so unlike every other contract
 * in this protocol there is no two-step dance and no window where the deployer
 * owns it. That is worth stating because the rest of the deployment taught the
 * opposite lesson.
 *
 * OWNER AND GUARDIAN MUST DIFFER, and the separation is the point:
 *
 *   owner    -> the Safe. Sets the guardian, pauses and unpauses. Everything
 *               that can restore or increase what the hook takes.
 *   guardian -> the ops key. Can ONLY pause, never unpause. A pause during an
 *               incident cannot wait for two signatures, and a guardian that
 *               could unpause would be an owner wearing a smaller name.
 *
 * The hook takes no fee until a pool owner calls `configure`, so deploying it
 * changes nothing on its own — it is infrastructure waiting to be pointed at.
 *
 * Usage:
 *   CL_POOL_MANAGER=0x...  REVSHARE_OWNER=0x...  REVSHARE_GUARDIAN=0x...
 *   forge script script/DeployRevShareHookMainnet.s.sol --rpc-url <chain> --broadcast --slow
 */
contract DeployRevShareHookMainnetScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address poolManager = vm.envAddress("CL_POOL_MANAGER");
        address owner = vm.envAddress("REVSHARE_OWNER");
        address guardian = vm.envAddress("REVSHARE_GUARDIAN");

        // A typo'd owner is almost always an EOA, and nothing downstream would
        // notice that the hook's pause switch answers to one key.
        require(owner.code.length > 0, "REVSHARE_OWNER has no code - not a contract");
        require(owner != deployer, "REVSHARE_OWNER must not be the deployer");
        require(owner != guardian, "REVSHARE_OWNER and REVSHARE_GUARDIAN must differ");
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code");

        vm.startBroadcast(pk);
        RevShareHook hook = new RevShareHook(ICLPoolManager(poolManager), owner, guardian);
        vm.stopBroadcast();

        /* Assert the deployed reality, not the intent. */
        require(hook.owner() == owner, "owner not set");
        require(hook.guardian() == guardian, "guardian not set");
        require(!hook.paused(), "should not deploy paused");
        require(address(hook.poolManager()) == poolManager, "pool manager mismatch");

        /* The permission bitmap is what core cross-checks at pool init. Printing
           it here means a mismatch is visible now rather than as an unexplained
           revert the first time somebody tries to create a pool. */
        uint16 bitmap = hook.getHooksRegistrationBitmap();

        console.log("RevShareHook          ", address(hook));
        console.log("  owner               ", hook.owner());
        console.log("  guardian            ", hook.guardian());
        console.log("  poolManager         ", address(hook.poolManager()));
        console.log("  vault               ", address(hook.vault()));
        console.log("  permission bitmap   ", bitmap);
        console.log("  MAX_FEE_PIPS        ", hook.MAX_FEE_PIPS());
        console.log("  MAX_BENEFICIARIES   ", hook.MAX_BENEFICIARIES());
        console.log("  CONFIG_DELAY_BLOCKS ", hook.CONFIG_DELAY_BLOCKS());
        console.log("");
        console.log("Takes nothing until a pool owner calls configure().");
    }
}

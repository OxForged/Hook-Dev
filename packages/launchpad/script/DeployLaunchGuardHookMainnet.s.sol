// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";

/**
 * STEP 1 OF 2. Deploys `LaunchGuardHook` to a MAINNET chain.
 *
 * `LaunchpadKit` binds a hook address as an IMMUTABLE and verifies it in its own
 * constructor, so the hook has to exist first. Run this, then feed the address
 * it prints to `DeployLaunchpadKitMainnet.s.sol` as `LAUNCH_GUARD_HOOK`.
 *
 * Two scripts rather than one for the reason the rest of this repo splits them:
 * a single script would either always deploy a fresh hook — silently orphaning
 * every launch already configured on the old one — or take a boolean saying
 * which world you are in, and that is a boolean somebody eventually gets wrong.
 * Deploying a hook is a decision; wiring a kit to one is a different decision.
 *
 * WHY THE HOOK IS DEPLOYED SEPARATELY AND SHARED. The hook is stateless per
 * deployment and holds one `Launch` record per pool id. Every kit and every
 * launch on this chain should point at ONE hook, because a pool key names the
 * hook by address: two hooks means two disjoint universes of pools and a
 * registry listing that describes only half of them.
 *
 * THIS CONTRACT HAS NO OWNER, NO GUARDIAN AND NO ADMIN. That is not an
 * oversight to be corrected by a follow-up transfer — it is the design.
 * `LaunchGuardHook` extends `BaseCLHook`, whose only access control is
 * `onlyPoolManager` on the callbacks. The one authority that exists is per-pool
 * `launchOwner`, established by first-claim through `configureLaunch`, and it is
 * deliberately neither transferable nor renounceable. There is consequently
 * nothing here for the CLAUDE.md ownership table to assign, and nothing for a
 * compromised key to reach. Do not add an owner to make it look more governed.
 *
 * BUILD PROFILE: THE DEFAULT ONE. Robinhood Chain supports EIP-1153 (verified
 * across its endpoints — see `packages/sdk/src/chains/endpoints.ts`), so this
 * deploys the cancun build. Neither contract deployed here uses transient
 * storage itself, but a cancun build emits MCOPY, and `FOUNDRY_PROFILE=legacy`
 * would produce shanghai bytecode that is merely less efficient rather than
 * wrong. Do NOT reach for the legacy profile on this chain: the live Vault and
 * position manager are the cancun build, and mixing backends is how
 * `TransientSlot.IS_EIP1153` stops meaning anything.

 * NO CREATE3. The kit reads the hook's address at construction and pins it, and
 * pool keys carry it explicitly, so there is no cross-chain address to keep
 * identical and nothing gained by a deterministic deployment. A plain `new`
 * also keeps the broadcast artifact honest: with CREATE3 the artifact's
 * `contractAddress` is the FACTORY, and the real address hides in the `CREATE`
 * entry of `additionalContracts`, which has cost this project time before.
 *
 * Usage (dry run first — no --broadcast):
 *   CL_POOL_MANAGER=0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66 \
 *   forge script script/DeployLaunchGuardHookMainnet.s.sol --rpc-url $ROBINHOOD_RPC
 *
 * Then, when a human has read the simulation:
 *   ... --broadcast --slow
 */
contract DeployLaunchGuardHookMainnetScript is Script {
    /// @dev `beforeInitialize` (bit 0) | `beforeSwap` (bit 6). Duplicated from
    /// `LaunchpadKit.EXPECTED_HOOK_BITMAP` on purpose: this script's job is to
    /// fail if the hook it just deployed is not the one the kit can drive, and
    /// an assertion that reads its expectation from the thing under test asserts
    /// nothing.
    uint16 internal constant EXPECTED_HOOK_BITMAP = 0x0041;

    /// @notice Entry point. Reads the environment and hands off to `runWith`.
    /// @dev The environment is read HERE AND NOWHERE ELSE, so `runWith` can be driven directly by
    /// `test/DeployScripts.t.sol`. That split is not cosmetic: forge runs test cases
    /// concurrently against one shared process environment, so a harness that configured a script
    /// through `vm.setEnv` would race with every other test in the file and go green or red by
    /// timing. Env in one function, logic in another, and the logic is what gets tested.
    /// @return hook The deployed hook. Returned so `forge script --json` reports the address
    /// without anyone having to parse a broadcast artifact for it.
    function run() public returns (LaunchGuardHook hook) {
        return runWith(vm.envUint("PRIVATE_KEY"), vm.envAddress("CL_POOL_MANAGER"));
    }

    /// @param pk Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
    /// @param poolManager The CL singleton this hook will serve, forever.
    function runWith(uint256 pk, address poolManager) public returns (LaunchGuardHook hook) {
        address deployer = vm.addr(pk);

        /* ---- pre-flight, before anything is broadcast ------------------- */

        // The pool manager is an immutable on the hook. A typo here produces a
        // hook that every `configureLaunch` rejects with `PoolManagerMismatch`,
        // which reads like a caller error rather than a deployment error.
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code - not a contract");
        require(poolManager != deployer, "CL_POOL_MANAGER is the deployer - wrong address");

        console.log("=== LaunchGuardHook ===");
        console.log("  chain id      ", block.chainid);
        console.log("  deployer      ", deployer);
        console.log("  poolManager   ", poolManager);
        console.log("");

        vm.startBroadcast(pk);
        hook = new LaunchGuardHook(ICLPoolManager(poolManager));
        vm.stopBroadcast();

        /* ---- assert the deployed reality, not the intent ----------------- */

        require(address(hook).code.length > 0, "hook has no code");
        require(address(hook.poolManager()) == poolManager, "hook serves a different pool manager");

        // What core cross-checks in `Hooks.validateHookConfig` at pool
        // initialization, and what the kit's constructor demands. A mismatch
        // here is a hook nothing can build a pool key for.
        uint16 bitmap = hook.getHooksRegistrationBitmap();
        require(bitmap == EXPECTED_HOOK_BITMAP, "unexpected permission bitmap");

        // The caps that bound a hostile launch owner. Read back rather than
        // assumed, because they are the entire reason a launcher can trust a
        // pool they did not configure.
        require(hook.MAX_INITIAL_FEE() == 500_000, "MAX_INITIAL_FEE moved");
        require(hook.MAX_FINAL_FEE() == 100_000, "MAX_FINAL_FEE moved");
        require(hook.MAX_DECAY_BLOCKS() == 1_000_000, "MAX_DECAY_BLOCKS moved");
        require(hook.MAX_START_DELAY() == 1_000_000, "MAX_START_DELAY moved");

        console.log("LaunchGuardHook       ", address(hook));
        console.log("  poolManager         ", address(hook.poolManager()));
        console.log("  permission bitmap   ", bitmap, "(beforeInitialize | beforeSwap)");
        console.log("  MAX_INITIAL_FEE     ", hook.MAX_INITIAL_FEE());
        console.log("  MAX_FINAL_FEE       ", hook.MAX_FINAL_FEE());
        console.log("  MAX_DECAY_BLOCKS    ", hook.MAX_DECAY_BLOCKS());
        console.log("  MAX_START_DELAY     ", hook.MAX_START_DELAY());
        console.log("");
        console.log("No owner, no guardian, no admin. Nothing to transfer, by design.");
        console.log("");
        console.log("NEXT: export LAUNCH_GUARD_HOOK=<the address above>");
        console.log("      then run script/DeployLaunchpadKitMainnet.s.sol");
    }
}

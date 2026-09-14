// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {LaunchGuardHook, ILaunchTokenOrigin} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {ContractClockProbe} from "latch-hooks/script/ContractClock.sol";
import {LatchRegistry} from "latch-registry/src/LatchRegistry.sol";
import {LatchMetadata} from "latch-registry/src/ILatchRegistry.sol";

/**
 * STEP 1 OF 2. Deploys `LaunchGuardHook` to a MAINNET chain AND lists it in the registry.
 *
 * `LaunchpadKit` binds a hook address as an IMMUTABLE and verifies it in its own
 * constructor, so the hook has to exist first. Run this, then feed the address
 * it prints to `DeployLaunchpadKitMainnet.s.sol` as `LAUNCH_GUARD_HOOK`.
 *
 * WHY THE LISTING IS IN THIS SCRIPT. CLAUDE.md's Ownership table: "list the hook in
 * the same session it is deployed, or a stranger can list the protocol's own hook
 * first, with hostile metadata." `LatchRegistry.register` is open to anyone. So the
 * registration is the very next broadcast after the deployment, and stewardship is
 * handed straight to the Ops steward (`LAUNCH_GUARD_STEWARD`). If a stranger does
 * win the race, the script refuses to report success, and `CURATOR_ROLE` (Ops) can
 * reassign the steward with `transferSteward` - metadata only, nothing custodial.
 *
 * WHY THE HOOK IS DEPLOYED SEPARATELY AND SHARED. The hook holds one `Launch` record
 * per pool id. Every kit and every launch on this chain should point at ONE hook,
 * because a pool key names the hook by address: two hooks means two disjoint
 * universes of pools and a registry listing that describes only half of them.
 *
 * THIS CONTRACT HAS NO OWNER, NO GUARDIAN AND NO ADMIN. That is not an
 * oversight to be corrected by a follow-up transfer — it is the design, and the
 * Ownership table records the absence as a decision. The one authority that exists
 * is per-pool `launchOwner`, established by first-claim, neither transferable nor
 * renounceable, and powerless from `startTime` onward. Do not add an owner.
 *
 * EVERY DURATION IS `block.timestamp` SECONDS (Option B, 2026-09-13). The retired
 * hook `0x8b4F…575c` took `blockTimeCentis = 10` and 26 000 000-block caps, which on
 * Robinhood's real ~12 s contract clock is ~9.9 years. This source has a single
 * constructor argument — the pool manager — and constant bounds: decay in
 * [60 s, 30 days], start at most 30 days ahead. Nothing about the chain's block
 * cadence is declared, so nothing can be declared wrong.
 *
 * POOL-ID RESERVATION (owner decision, 2026-09-14). The hook refuses a first claim on a
 * currency with no code, and gives a `LaunchTokenFactory` token's launch pools to that token's
 * creator (the kit, for kit-created tokens). `LAUNCH_TOKEN_FACTORY` is therefore IMMUTABLE on
 * the hook: deploy the factory FIRST and pass it here. `address(0)` is accepted only when typed
 * explicitly and means "no factory tokens get reserved pools on this hook, ever" - a hook is part
 * of every pool id, so fixing that later means another hook and another pool universe.
 *
 * THE CLOCK CHECK. `run()` probes the chain's `block.timestamp` via `eth_call` and
 * refuses unless it agrees with the RPC header (60 s) and this machine's wall
 * clock (300 s). A sequencer running ahead, or catching up from an outage, is the
 * wrong moment to deploy time-bounded contracts. No waiting is involved.
 *
 * BUILD PROFILE: THE DEFAULT ONE. Robinhood Chain supports EIP-1153, so this deploys
 * the cancun build. Do NOT reach for the legacy profile on this chain: the live Vault
 * and position manager are the cancun build.
 *
 * NO CREATE3. The kit pins the hook address and pool keys carry it explicitly, so
 * nothing depends on a deterministic address, and a plain `new` keeps the broadcast
 * artifact's `contractAddress` honest.
 *
 * Usage (dry run first — no --broadcast):
 *   CL_POOL_MANAGER=0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66 \
 *   LAUNCH_TOKEN_FACTORY=<deployed LaunchTokenFactory> \
 *   LAUNCH_GUARD_REGISTRY=0xb2c8BB7473A09b0906f192D69e30D7362fA988CC \
 *   LAUNCH_GUARD_STEWARD=<ops key> \
 *   forge script script/DeployLaunchGuardHookMainnet.s.sol --rpc-url $ROBINHOOD_RPC
 *
 * Then, when a human has read the simulation:
 *   ... --broadcast --slow
 */
contract DeployLaunchGuardHookMainnetScript is Script {
    /// @dev `beforeInitialize` (bit 0) | `beforeSwap` (bit 6). Duplicated from
    /// `LaunchpadKit.EXPECTED_HOOK_BITMAP` on purpose: an assertion that reads its
    /// expectation from the thing under test asserts nothing.
    uint16 internal constant EXPECTED_HOOK_BITMAP = 0x0041;

    string internal constant SOURCE_URI =
        "https://github.com/OxForged/Hook-Dev/blob/main/packages/hooks/src/launch/LaunchGuardHook.sol";

    /// @notice Entry point. Reads the environment and hands off to `runWith`.
    /// @dev The environment is read HERE AND NOWHERE ELSE, so `runWith` can be driven directly by
    /// `test/DeployScripts.t.sol` without `vm.setEnv` racing across concurrent test cases.
    function run() public returns (LaunchGuardHook hook) {
        ContractClockProbe.Reading memory clock = ContractClockProbe.check();
        console.log("chain clock: block.timestamp (EVM) ", clock.evmTimestamp);
        console.log("chain clock: header / wall clock   ", clock.headerTimestamp, clock.wallClockSeconds);
        return runWith(
            vm.envUint("PRIVATE_KEY"),
            vm.envAddress("CL_POOL_MANAGER"),
            vm.envAddress("LAUNCH_TOKEN_FACTORY"),
            vm.envAddress("LAUNCH_GUARD_REGISTRY"),
            vm.envAddress("LAUNCH_GUARD_STEWARD")
        );
    }

    /// @param pk Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
    /// @param poolManager The CL singleton this hook will serve, forever.
    /// @param factory The `LaunchTokenFactory` whose tokens get reserved launch pools, or zero.
    /// @param registry The LIVE `LatchRegistry`. Required: listing is part of this deployment.
    /// @param steward The Ops key that ends up holding the listing's metadata rights.
    function runWith(uint256 pk, address poolManager, address factory, address registry, address steward)
        public
        returns (LaunchGuardHook hook)
    {
        address deployer = vm.addr(pk);

        /* ---- pre-flight, before anything is broadcast ------------------- */

        // The pool manager is an immutable on the hook. A typo here produces a
        // hook that every `configureLaunch` rejects with `PoolManagerMismatch`,
        // which reads like a caller error rather than a deployment error.
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code - not a contract");
        require(poolManager != deployer, "CL_POOL_MANAGER is the deployer - wrong address");
        if (factory != address(0)) {
            require(factory.code.length > 0, "LAUNCH_TOKEN_FACTORY has no code - deploy the factory first");
            // A factory answers `deployerOf` (zero for an unknown token) and has an init-code hash.
            require(ILaunchTokenOrigin(factory).deployerOf(address(this)) == address(0), "LAUNCH_TOKEN_FACTORY is not a factory");
            (bool ok, bytes memory ret) = factory.staticcall(abi.encodeWithSignature("launchTokenInitCodeHash()"));
            require(ok && ret.length == 32 && bytes32(ret) != bytes32(0), "LAUNCH_TOKEN_FACTORY has no launchTokenInitCodeHash");
        }
        require(registry.code.length > 0, "LAUNCH_GUARD_REGISTRY has no code - list in the same session");
        require(steward != address(0), "LAUNCH_GUARD_STEWARD unset - the Ownership table assigns it to Ops");
        // Probing a view is free; a registry with the wrong ABI reverts here, not after deploying.
        LatchRegistry(registry).latchCount();

        console.log("=== LaunchGuardHook ===");
        console.log("  chain id      ", block.chainid);
        console.log("  deployer      ", deployer);
        console.log("  poolManager   ", poolManager);
        console.log("  token factory ", factory);
        console.log("  registry      ", registry);
        console.log("  steward (Ops) ", steward);
        console.log("");

        uint256[] memory chains = new uint256[](1);
        chains[0] = block.chainid;

        vm.startBroadcast(pk);
        hook = new LaunchGuardHook(ICLPoolManager(poolManager), ILaunchTokenOrigin(factory));
        // Same session, next transaction. See the header.
        LatchRegistry(registry).register(
            address(hook),
            LatchMetadata({
                name: "LaunchGuard",
                description: "Decaying sniper tax priced on block.timestamp, not identity. Requires a dynamic-fee pool.",
                sourceURI: SOURCE_URI,
                auditURI: "",
                chainIds: chains
            })
        );
        if (steward != deployer) LatchRegistry(registry).transferSteward(address(hook), steward);
        vm.stopBroadcast();

        _postflight(hook, poolManager, registry, steward, deployer);
        require(address(hook.LAUNCH_TOKEN_FACTORY()) == factory, "LAUNCH_TOKEN_FACTORY mismatch");
        console.log("  LAUNCH_TOKEN_FACTORY  ", address(hook.LAUNCH_TOKEN_FACTORY()));
    }

    /// @dev Assert the deployed reality, not the intent.
    function _postflight(LaunchGuardHook hook, address poolManager, address registry, address steward, address deployer)
        internal
        view
    {
        require(address(hook).code.length > 0, "hook has no code");
        require(address(hook.poolManager()) == poolManager, "hook serves a different pool manager");

        uint16 bitmap = hook.getHooksRegistrationBitmap();
        require(bitmap == EXPECTED_HOOK_BITMAP, "unexpected permission bitmap");

        // The bounds that keep a hostile launch owner inside a survivable envelope. Constants now,
        // and read back anyway: this is the bytecode a launcher will trust without reading it.
        require(keccak256(bytes(hook.CLOCK_MODE())) == keccak256("mode=timestamp"), "hook is not timestamp-clocked");
        require(hook.MAX_INITIAL_FEE() == 500_000, "MAX_INITIAL_FEE moved");
        require(hook.MAX_FINAL_FEE() == 100_000, "MAX_FINAL_FEE moved");
        require(hook.MIN_DECAY_SECONDS() == 60, "MIN_DECAY_SECONDS moved");
        require(hook.MAX_DECAY_SECONDS() == 30 days, "MAX_DECAY_SECONDS moved");
        require(hook.MAX_START_DELAY_SECONDS() == 30 days, "MAX_START_DELAY_SECONDS moved");
        require(
            uint256(hook.MAX_START_DELAY_SECONDS()) + hook.MAX_DECAY_SECONDS() <= hook.MAX_LAUNCH_WINDOW_SECONDS(),
            "a launch tax could outlive the 180-day ceiling"
        );

        LatchRegistry reg = LatchRegistry(registry);
        require(reg.isRegistered(address(hook)), "hook was not listed");
        require(reg.getLatch(address(hook)).steward == steward, "listing steward is not the Ops steward");
        require(reg.getLatch(address(hook)).submitter == deployer, "someone else listed this hook first");
        require(reg.getLatch(address(hook)).permissions == bitmap, "registry did not read the hook's bitmap");

        console.log("LaunchGuardHook         ", address(hook));
        console.log("  poolManager           ", address(hook.poolManager()));
        console.log("  permission bitmap     ", bitmap, "(beforeInitialize | beforeSwap)");
        console.log("  CLOCK_MODE            ", hook.CLOCK_MODE());
        console.log("  decay window, s       ", hook.MIN_DECAY_SECONDS(), hook.MAX_DECAY_SECONDS());
        console.log("  max start delay, s    ", hook.MAX_START_DELAY_SECONDS());
        console.log("  listed; steward      ", steward);
        console.log("");
        console.log("No owner, no guardian, no admin. Nothing to transfer, by design.");
        console.log("");
        console.log("NEXT: export LAUNCH_GUARD_HOOK=<the address above>");
        console.log("      then run script/DeployLaunchpadKitMainnet.s.sol");
    }
}

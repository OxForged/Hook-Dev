// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {ContractClockMath, ContractClockProbe} from "latch-hooks/script/ContractClock.sol";

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
 * THE BLOCK-TIME ARGUMENTS. `MAX_DECAY_BLOCKS` and `MAX_START_DELAY` used to be
 * `constant 1_000_000` — "about 139 days at 12s blocks". Both caps are now
 * arguments, validated by the hook against a wall-clock range of [3 days, 180 days].
 *
 * THE BLOCK TIME IS THE EVM's, NOT THE RPC's — AND IT IS MEASURED, NOT TYPED.
 * The first Robinhood deployment declared 10 centis because the chain's RPC shows a
 * block every 0.102 s. Robinhood is Arbitrum Nitro: inside the EVM `block.number`
 * is Ethereum's block number, ~12 s per block. So that hook (0x8b4F…575c) has a
 * MAX_DECAY_BLOCKS of 26 000 000 that really means ~9.9 YEARS, and every window a
 * kit resolves against it runs ~120x long. `run()` now measures NUMBER against
 * TIMESTAMP on the live chain over `CLOCK_PROBE_SECONDS` of real waiting (see
 * `latch-hooks/script/ContractClock.sol`) and refuses to broadcast unless
 * LAUNCH_BLOCK_TIME_CENTIS agrees with it. Expect the dry run to pause that long.
 *
 * Round the block time DOWN when it is not an integer: a smaller declared block time
 * makes each cap's computed duration shorter, so the hook demands MORE blocks.
 *
 * Usage (dry run first — no --broadcast):
 *   CL_POOL_MANAGER=0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66 \
 *   LAUNCH_BLOCK_TIME_CENTIS=1200 \
 *   LAUNCH_MAX_DECAY_BLOCKS=216000 \
 *   LAUNCH_MAX_START_DELAY_BLOCKS=216000 \
 *   forge script script/DeployLaunchGuardHookMainnet.s.sol --rpc-url $ROBINHOOD_RPC
 *
 * 216 000 blocks x 1200 centis = 2 592 000 s = 30 days on Robinhood.
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

    /// @notice Real seconds `run()` waits between its two reads of the contract clock.
    /// @dev 180 s is ~15 Ethereum blocks: one block of jitter is under 7%, inside the band
    /// `ContractClockMath.requireDeclaredMatches` allows.
    uint256 internal constant CLOCK_PROBE_SECONDS = 180;

    /// @notice Entry point. Reads the environment and hands off to `runWith`.
    /// @dev The environment is read HERE AND NOWHERE ELSE, so `runWith` can be driven directly by
    /// `test/DeployScripts.t.sol`. That split is not cosmetic: forge runs test cases
    /// concurrently against one shared process environment, so a harness that configured a script
    /// through `vm.setEnv` would race with every other test in the file and go green or red by
    /// timing. Env in one function, logic in another, and the logic is what gets tested.
    /// @return hook The deployed hook. Returned so `forge script --json` reports the address
    /// without anyone having to parse a broadcast artifact for it.
    function run() public returns (LaunchGuardHook hook) {
        // Measured BEFORE anything else, against the chain the script is forked from. This is the
        // one input that cannot come from the environment, because the environment is where the
        // wrong value came from last time.
        ContractClockProbe.Measurement memory clock = ContractClockProbe.measure(CLOCK_PROBE_SECONDS);
        console.log("contract clock: centis per block.number ", clock.centisPerBlock);
        console.log("contract clock: block.number / eth_blockNumber", clock.contractBlockNumber, clock.rpcBlockNumber);
        if (clock.clockDiffersFromRpc) {
            console.log("contract clock: the EVM's block.number is NOT the RPC block (parent-chain clock)");
        }
        return runWith(
            vm.envUint("PRIVATE_KEY"),
            vm.envAddress("CL_POOL_MANAGER"),
            vm.envUint("LAUNCH_BLOCK_TIME_CENTIS"),
            vm.envUint("LAUNCH_MAX_DECAY_BLOCKS"),
            vm.envUint("LAUNCH_MAX_START_DELAY_BLOCKS"),
            clock.centisPerBlock
        );
    }

    /// @param pk Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
    /// @param poolManager The CL singleton this hook will serve, forever.
    /// @param blockTimeCentis Contract block time in hundredths of a second. Round DOWN.
    /// @param maxDecayBlocks Ceiling on a launch's decay window, in blocks.
    /// @param maxStartDelayBlocks Ceiling on how far ahead a launch may be scheduled.
    /// @param measuredBlockTimeCentis The contract clock as `run()` MEASURED it on the live chain.
    function runWith(
        uint256 pk,
        address poolManager,
        uint256 blockTimeCentis,
        uint256 maxDecayBlocks,
        uint256 maxStartDelayBlocks,
        uint256 measuredBlockTimeCentis
    ) public returns (LaunchGuardHook hook) {
        address deployer = vm.addr(pk);

        /* ---- pre-flight, before anything is broadcast ------------------- */

        // THE CLOCK GUARD. Every cap below is converted to real time with `blockTimeCentis`, so if
        // that number is not the EVM's real cadence, every check below is checking fiction. On
        // Robinhood, declaring the RPC's 0.1 s against a measured ~12 s reverts here.
        ContractClockMath.requireDeclaredMatches(blockTimeCentis, measuredBlockTimeCentis);

        // The pool manager is an immutable on the hook. A typo here produces a
        // hook that every `configureLaunch` rejects with `PoolManagerMismatch`,
        // which reads like a caller error rather than a deployment error.
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code - not a contract");
        require(poolManager != deployer, "CL_POOL_MANAGER is the deployer - wrong address");

        /* The hook checks all of this too, and it must - a script is not a
           security boundary. It is repeated because the value a human approves
           should be printed in DAYS, not as a block count nobody can convert. */
        require(blockTimeCentis > 0, "LAUNCH_BLOCK_TIME_CENTIS not set - it has no safe default");
        require(blockTimeCentis <= 60_000, "LAUNCH_BLOCK_TIME_CENTIS above 600s per block");
        require(maxDecayBlocks <= type(uint32).max, "LAUNCH_MAX_DECAY_BLOCKS exceeds uint32");
        require(maxStartDelayBlocks <= type(uint48).max, "LAUNCH_MAX_START_DELAY_BLOCKS exceeds uint48");

        uint256 decaySeconds = (maxDecayBlocks * blockTimeCentis) / 100;
        uint256 startSeconds = (maxStartDelayBlocks * blockTimeCentis) / 100;
        require(decaySeconds >= 3 days, "MAX_DECAY_BLOCKS is under 3 days here - a fair launch would revert");
        require(decaySeconds <= 180 days, "MAX_DECAY_BLOCKS is over 180 days here - that is a permanent tax");
        require(startSeconds >= 3 days, "MAX_START_DELAY is under 3 days of real time here");
        require(startSeconds <= 180 days, "MAX_START_DELAY is over 180 days of real time here");

        console.log("=== LaunchGuardHook ===");
        console.log("  chain id      ", block.chainid);
        console.log("  deployer      ", deployer);
        console.log("  poolManager   ", poolManager);
        console.log("  blockTimeCentis          ", blockTimeCentis);
        console.log("  measured on chain        ", measuredBlockTimeCentis);
        console.log("  maxDecayBlocks           ", maxDecayBlocks);
        console.log("  => longest launch, days  ", decaySeconds / 1 days);
        console.log("  maxStartDelayBlocks      ", maxStartDelayBlocks);
        console.log("  => furthest start, days  ", startSeconds / 1 days);
        console.log("");

        vm.startBroadcast(pk);
        hook = new LaunchGuardHook(
            ICLPoolManager(poolManager),
            uint32(blockTimeCentis),
            uint32(maxDecayBlocks),
            uint48(maxStartDelayBlocks)
        );
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

        /* The two caps are per-chain arguments now, so asserting a literal here
           would just be asserting the environment against itself. Read them back
           and re-derive the WINDOW instead - the thing that was wrong before was
           never the number, it was the number's meaning on this chain. */
        require(hook.blockTimeCentis() == uint32(blockTimeCentis), "blockTimeCentis mismatch");
        require(hook.MAX_DECAY_BLOCKS() == uint32(maxDecayBlocks), "MAX_DECAY_BLOCKS mismatch");
        require(hook.MAX_START_DELAY() == uint48(maxStartDelayBlocks), "MAX_START_DELAY mismatch");
        require(
            (uint256(hook.MAX_DECAY_BLOCKS()) * hook.blockTimeCentis()) / 100 >= hook.MIN_LAUNCH_WINDOW_SECONDS(),
            "on-chain decay cap is under the wall-clock floor"
        );

        console.log("LaunchGuardHook       ", address(hook));
        console.log("  poolManager         ", address(hook.poolManager()));
        console.log("  permission bitmap   ", bitmap, "(beforeInitialize | beforeSwap)");
        console.log("  MAX_INITIAL_FEE     ", hook.MAX_INITIAL_FEE());
        console.log("  MAX_FINAL_FEE       ", hook.MAX_FINAL_FEE());
        console.log("  blockTimeCentis     ", hook.blockTimeCentis());
        console.log("  MAX_DECAY_BLOCKS    ", hook.MAX_DECAY_BLOCKS());
        console.log("  MAX_START_DELAY     ", hook.MAX_START_DELAY());
        console.log("");
        console.log("No owner, no guardian, no admin. Nothing to transfer, by design.");
        console.log("");
        console.log("NEXT: export LAUNCH_GUARD_HOOK=<the address above>");
        console.log("      then run script/DeployLaunchpadKitMainnet.s.sol");
    }
}

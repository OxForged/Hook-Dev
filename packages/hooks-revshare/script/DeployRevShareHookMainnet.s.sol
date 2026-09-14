// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {RevShareHook} from "../src/RevShareHook.sol";
import {ContractClockMath, ContractClockProbe} from "latch-hooks/script/ContractClock.sol";

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
 * ####################### THE BLOCK-TIME ARGUMENTS #######################
 *
 * `CONFIG_DELAY_BLOCKS` used to be a `constant 3600`, documented as "roughly 12
 * hours at 12s blocks". This header then claimed that on Robinhood Chain, "which
 * produces a block every 0.102s", it was six minutes. THAT WAS WRONG. 0.102 s is
 * Robinhood's L2 block as the RPC reports it; Robinhood is Arbitrum Nitro, and
 * inside the EVM `block.number` is Ethereum's, ~12 s. The retired hook's 3600 was
 * ~12 real hours all along, and the replacement (0xfC00…2aD2), built at 10 centis
 * with 432 000 blocks, has a ~60-DAY delay and a ~1-YEAR proposal expiry. The
 * script now measures the contract clock before it will broadcast.
 *
 * It is now a constructor argument in blocks PAIRED WITH THE CHAIN'S BLOCK TIME,
 * and the hook multiplies them out and refuses anything under
 * `MIN_CONFIG_DELAY_SECONDS` (12h) of real time. So the two variables below are
 * not independent: getting `REVSHARE_BLOCK_TIME_CENTIS` wrong changes what
 * `REVSHARE_CONFIG_DELAY_BLOCKS` is allowed to be, and the constructor reverts
 * rather than silently shipping a short window.
 *
 * ROUND THE BLOCK TIME DOWN when it is not an integer. A smaller declared block
 * time makes the computed delay shorter, so the constructor demands MORE blocks —
 * which errs long. The measured-clock guard allows 75%..105% of the measurement.
 *
 * Usage (dry run first — no --broadcast; it pauses ~3 minutes to measure the clock):
 *   CL_POOL_MANAGER=0x...  REVSHARE_OWNER=0x...  REVSHARE_GUARDIAN=0x...
 *   REVSHARE_CONFIG_DELAY_BLOCKS=3600  REVSHARE_BLOCK_TIME_CENTIS=1200
 *   REVSHARE_MAX_BENEFICIARIES=8
 *   forge script script/DeployRevShareHookMainnet.s.sol --rpc-url <chain>
 *
 * 3 600 blocks x 1200 centis = 43 200 s = 12h on Robinhood (CONFIG_PROPOSAL_TTL_BLOCKS
 * then derives to 21 600 = 3 days).
 */
contract DeployRevShareHookMainnetScript is Script {
    /// @notice Real seconds `run()` waits between its two reads of the contract clock.
    uint256 internal constant CLOCK_PROBE_SECONDS = 180;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address poolManager = vm.envAddress("CL_POOL_MANAGER");
        address owner = vm.envAddress("REVSHARE_OWNER");
        address guardian = vm.envAddress("REVSHARE_GUARDIAN");

        /* Every one of these has no safe default, which is why none is supplied.
           `vm.envUint` reverts on an unset variable and that is the desired
           behaviour: a deployment that forgot the block time must not fall back
           to somebody's guess about which chain this is. */
        uint256 configDelayBlocks = vm.envUint("REVSHARE_CONFIG_DELAY_BLOCKS");
        uint256 blockTimeCentis = vm.envUint("REVSHARE_BLOCK_TIME_CENTIS");
        uint256 maxBeneficiaries = vm.envUint("REVSHARE_MAX_BENEFICIARIES");

        // A typo'd owner is almost always an EOA, and nothing downstream would
        // notice that the hook's pause switch answers to one key.
        require(owner.code.length > 0, "REVSHARE_OWNER has no code - not a contract");
        require(owner != deployer, "REVSHARE_OWNER must not be the deployer");
        require(owner != guardian, "REVSHARE_OWNER and REVSHARE_GUARDIAN must differ");
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code");

        /* ---- the wall-clock pre-flight, computed here and not just delegated --
           The hook checks this too, and it must: a script is not a security
           boundary. It is repeated here so the number a human is about to approve
           is printed in seconds rather than left as a block count nobody can
           convert in their head. */
        require(blockTimeCentis > 0, "REVSHARE_BLOCK_TIME_CENTIS not set - it has no safe default");
        require(blockTimeCentis <= 60_000, "REVSHARE_BLOCK_TIME_CENTIS above 600s per block");

        /* THE CLOCK GUARD. The delay below is only a delay if `blockTimeCentis` is
           the EVM's real `block.number` cadence. Measured on the forked chain over a
           real wait, never taken from the environment — the environment is where the
           live hook's 10 (the RPC's L2 block time on an Arbitrum chain) came from,
           which turned a 12-hour delay into ~60 days and a 3-day expiry into ~1 year. */
        ContractClockProbe.Measurement memory clock = ContractClockProbe.measure(CLOCK_PROBE_SECONDS);
        console.log("contract clock: centis per block.number ", clock.centisPerBlock);
        console.log("contract clock: block.number / eth_blockNumber", clock.contractBlockNumber, clock.rpcBlockNumber);
        ContractClockMath.requireDeclaredMatches(blockTimeCentis, clock.centisPerBlock);
        require(configDelayBlocks <= type(uint48).max, "REVSHARE_CONFIG_DELAY_BLOCKS exceeds uint48");
        require(blockTimeCentis <= type(uint32).max, "REVSHARE_BLOCK_TIME_CENTIS exceeds uint32");

        uint256 delaySeconds = (configDelayBlocks * blockTimeCentis) / 100;
        require(delaySeconds >= 12 hours, "config delay is under 12h of real time on this chain");
        require(delaySeconds <= 14 days, "config delay is over 14 days of real time on this chain");
        require(maxBeneficiaries > 0 && maxBeneficiaries <= 32, "REVSHARE_MAX_BENEFICIARIES outside 1..32");

        console.log("=== RevShareHook ===");
        console.log("  chain id            ", block.chainid);
        console.log("  configDelayBlocks   ", configDelayBlocks);
        console.log("  blockTimeCentis     ", blockTimeCentis);
        console.log("  => delay, seconds   ", delaySeconds);
        console.log("  => delay, hours     ", delaySeconds / 3600);
        console.log("  maxBeneficiaries    ", maxBeneficiaries);
        console.log("");

        vm.startBroadcast(pk);
        RevShareHook hook = new RevShareHook(
            ICLPoolManager(poolManager),
            owner,
            guardian,
            uint48(configDelayBlocks),
            uint32(blockTimeCentis),
            maxBeneficiaries
        );
        vm.stopBroadcast();

        /* Assert the deployed reality, not the intent. */
        require(hook.owner() == owner, "owner not set");
        require(hook.guardian() == guardian, "guardian not set");
        require(!hook.paused(), "should not deploy paused");
        require(address(hook.poolManager()) == poolManager, "pool manager mismatch");

        /* Read the three new immutables back and re-derive the window from what is
           actually on chain. An argument that was silently truncated by a cast is
           invisible in the transaction and obvious here. */
        require(hook.CONFIG_DELAY_BLOCKS() == uint48(configDelayBlocks), "CONFIG_DELAY_BLOCKS mismatch");
        require(hook.blockTimeCentis() == uint32(blockTimeCentis), "blockTimeCentis mismatch");
        require(hook.MAX_BENEFICIARIES() == maxBeneficiaries, "MAX_BENEFICIARIES mismatch");
        require(
            (uint256(hook.CONFIG_DELAY_BLOCKS()) * hook.blockTimeCentis()) / 100 >= hook.MIN_CONFIG_DELAY_SECONDS(),
            "on-chain delay is under the floor"
        );
        require(hook.CONFIG_PROPOSAL_TTL_BLOCKS() > 0, "proposal TTL is zero");

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
        console.log("  blockTimeCentis     ", hook.blockTimeCentis());
        console.log("  => real delay, s    ", (uint256(hook.CONFIG_DELAY_BLOCKS()) * hook.blockTimeCentis()) / 100);
        console.log("  PROPOSAL_TTL_BLOCKS ", hook.CONFIG_PROPOSAL_TTL_BLOCKS());
        console.log(
            "  => real TTL, s      ", (uint256(hook.CONFIG_PROPOSAL_TTL_BLOCKS()) * hook.blockTimeCentis()) / 100
        );
        console.log("");
        console.log("Takes nothing until a pool owner calls configure().");
        console.log("A pool wanting a beneficiary share configures in TWO steps while uninitialised:");
        console.log("  1. configure(key, {lpDonateBps: 10000})   - claims the pool");
        console.log("  2. setBeneficiaries(key, roster)");
        console.log("  3. configure(key, {beneficiaryBps: ...})  - the roster now exists");
    }
}

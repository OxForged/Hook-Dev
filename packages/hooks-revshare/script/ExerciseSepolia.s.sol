// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {RevShareHook} from "../src/RevShareHook.sol";
import {IRevShareHook} from "../src/interfaces/IRevShareHook.sol";
import {SnapshotEpochDistributor} from "../src/distributors/SnapshotEpochDistributor.sol";
import {VotesToken} from "../test/mocks/Mocks.sol";

/**
 * Drives a COMPLETE revenue-share cycle on live Ethereum Sepolia.
 *
 * ############################ WHY THIS EXISTS ############################
 *
 * The four revenue screens in the dapp have every populated path unverified, because no
 * RevShareHook has ever existed on any chain. Their empty and not-configured states are
 * confirmed against Sepolia; their config card, roster table, epoch tables and every
 * simulate-then-send button are confirmed only by typecheck and ABI-selector comparison.
 * The same is true of `packages/keeper` — its jobs have never seen a live distributor.
 *
 * This script converts that block of "should work" into "does work" by putting a real
 * hook, a real distributor and a real closed epoch on chain.
 *
 * ############################ ORDERING IS LOAD-BEARING ############################
 *
 * Three constraints, each of which will revert if broken, and none of which are obvious:
 *
 *   1. The distributor's constructor requires `key.hooks == hook`, so the POOL KEY must be
 *      built (and therefore the hook deployed) before the distributor.
 *   2. `configure` names the distributor, so the distributor must exist before `configure`.
 *   3. `configure` must run BEFORE `initialize`. The hook reads its config in
 *      `beforeInitialize`; configuring afterwards leaves the pool permanently unconfigured.
 *
 * So: hook -> key -> distributor -> configure -> initialize. Not any other order.
 *
 * ############################ THE CLOCK ############################
 *
 * `closeEpoch` snapshots at `clock() - 1`, because ERC-5805 refuses a lookup at or after the
 * current timepoint. `VotesToken` clocks in BLOCK NUMBERS, so the delegation must be at least
 * one block behind the close or the holder snapshots with zero votes and can claim nothing.
 * Run with `--slow` so every transaction lands in its own block.
 *
 * ############################ RUN ############################
 *
 *   forge script script/ExerciseSepolia.s.sol:ExerciseRevShareSepolia \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast --slow -vv
 *
 * Then, once the claim window has elapsed, the second pass exercises rollover:
 *
 *   ROLLOVER_ONLY=true DISTRIBUTOR=0x... \
 *   forge script script/ExerciseSepolia.s.sol:ExerciseRevShareSepolia \
 *     --rpc-url ... --broadcast -vv
 *
 * Costs real Sepolia gas. Deploys four contracts and sends roughly a dozen transactions.
 */
contract ExerciseRevShareSepolia is Script {
    using PoolIdLibrary for PoolKey;

    // Live, verified Sepolia deployment.
    address constant CL_POOL_MANAGER = 0xb7C8a11E0B359616eD06256783aF57114841F738;
    address constant VAULT = 0xCe3d133eb486b448A53437A5073619FbE424d01B;

    uint24 constant LP_FEE = 3000; // 0.30%
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE_PIPS = 50_000; // 5% of the swap, so one swap clears dust
    uint160 constant SQRT_RATIO_1_1 = 79228162514264337593543950336;

    /// Short on purpose: the whole point is that a follow-up run can exercise `rollover`
    /// without waiting a month. Never use a window this short on a real offering.
    uint64 constant CLAIM_WINDOW = 1 hours;

    int24 constant TICK_LOWER = -600;
    int24 constant TICK_UPPER = 600;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        if (vm.envOr("ROLLOVER_ONLY", false)) {
            _rolloverPass(pk);
            return;
        }

        console.log("=== RevShare exercise on Sepolia ===");
        console.log("deployer", me);

        vm.startBroadcast(pk);

        /* ---------------------------------------------------------------- 1. tokens */

        // The governance token whose holders receive the share, and the pair it trades against.
        VotesToken votes = new VotesToken();
        votes.mint(me, 1_000_000 ether);
        MockERC20 pair = new MockERC20("Latch RevShare Pair", "ltRSP", 18);
        pair.mint(me, 1_000_000 ether);

        // Delegating to self is what gives the holder voting power at all. Without it the
        // snapshot reads zero and nothing is claimable — the single most common integration
        // mistake with ERC-5805, and the reason the distributor documents it so loudly.
        votes.delegate(me);

        /* ------------------------------------------------------- 2. hook and pool key */

        RevShareHook hook = new RevShareHook(ICLPoolManager(CL_POOL_MANAGER), me, me);

        (Currency c0, Currency c1) = address(votes) < address(pair)
            ? (Currency.wrap(address(votes)), Currency.wrap(address(pair)))
            : (Currency.wrap(address(pair)), Currency.wrap(address(votes)));

        // Infinity carries the permission bitmap in `parameters`, not in the hook ADDRESS, so
        // there is no CREATE2 salt to mine here. `validateHookConfig` checks that this bitmap
        // equals what the hook itself reports, and reverts on any mismatch.
        PoolKey memory key = PoolKey({
            currency0: c0,
            currency1: c1,
            hooks: IHooks(address(hook)),
            poolManager: ICLPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(hook.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });

        /* ------------------------------------------------- 3. distributor, then configure */

        SnapshotEpochDistributor distributor = new SnapshotEpochDistributor(
            IRevShareHook(address(hook)),
            key,
            IVotes(address(votes)),
            0, // minEpochDuration: 0 so the first close needs no wait
            CLAIM_WINDOW
        );

        // Whole cut to the distributor, so the epoch has something to hold.
        hook.configure(
            key,
            RevShareHook.ConfigParams({
                feePips: FEE_PIPS,
                lpDonateBps: 0,
                beneficiaryBps: 0,
                distributorBps: 10_000,
                distributor: address(distributor),
                enabled: true
            })
        );

        /* ------------------------------------------------------------ 4. initialize + seed */

        ICLPoolManager(CL_POOL_MANAGER).initialize(key, SQRT_RATIO_1_1);

        CLPoolManagerRouter router = new CLPoolManagerRouter(IVault(VAULT), ICLPoolManager(CL_POOL_MANAGER));
        IERC20(Currency.unwrap(c0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(c1)).approve(address(router), type(uint256).max);

        router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: TICK_LOWER,
                tickUpper: TICK_UPPER,
                liquidityDelta: 10_000 ether,
                salt: 0
            }),
            ""
        );

        /* ------------------------------------------------------------------- 5. swap */

        // Both directions, so fees accrue in BOTH currencies and the epoch is not single-sided.
        _swap(router, key, true, -1 ether);
        _swap(router, key, false, -1 ether);

        vm.stopBroadcast();

        PoolId poolId = key.toId();
        uint256 pending0 = hook.pendingDistributorShare(poolId, c0);
        uint256 pending1 = hook.pendingDistributorShare(poolId, c1);
        console.log("pending distributor share c0", pending0);
        console.log("pending distributor share c1", pending1);
        require(pending0 > 0 || pending1 > 0, "no fees accrued - nothing to distribute");

        /* ------------------------------------------------------------------ 6. report */

        console.log("");
        console.log("=== addresses, for the dapp and the keeper ===");
        console.log("hook        ", address(hook));
        console.log("distributor ", address(distributor));
        console.log("votes token ", address(votes));
        console.log("pair token  ", address(pair));
        console.log("currency0   ", Currency.unwrap(c0));
        console.log("currency1   ", Currency.unwrap(c1));
        console.log("poolId      ", vm.toString(PoolId.unwrap(poolId)));
        console.log("");
        console.log("NEXT: close the epoch and claim, in a LATER BLOCK:");
        console.log("  DISTRIBUTOR=<distributor> forge script script/ExerciseSepolia.s.sol:CloseAndClaimSepolia \\");
        console.log("    --rpc-url <rpc> --broadcast -vv");
    }

    /// Second pass: the claim window has to actually elapse, which no amount of scripting can
    /// hurry on a live chain. `rollover` is permissionless, so the keeper is the real intended
    /// caller — this exists to prove the path works before trusting the keeper to it.
    function _rolloverPass(uint256 pk) internal {
        // `payable` only because the distributor has a receive() that rejects stray native;
        // nothing here sends value.
        address payable dAddr = payable(vm.envAddress("DISTRIBUTOR"));
        SnapshotEpochDistributor d = SnapshotEpochDistributor(dAddr);

        uint256 count = d.epochCount();
        require(count > 0, "no epochs to roll");

        for (uint256 i = 0; i < count; i++) {
            SnapshotEpochDistributor.Epoch memory e = d.getEpoch(i);
            if (e.rolledOver) {
                console.log("epoch already rolled", i);
                continue;
            }
            if (block.timestamp < e.expiresAt) {
                console.log("epoch still claimable, expires at", i, e.expiresAt);
                continue;
            }
            vm.startBroadcast(pk);
            d.rollover(i);
            vm.stopBroadcast();
            console.log("rolled over epoch", i);
        }
        console.log("carryOver0", d.carryOver0());
        console.log("carryOver1", d.carryOver1());
    }

    function _swap(CLPoolManagerRouter router, PoolKey memory key, bool zeroForOne, int256 amount)
        internal
    {
        router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amount,
                sqrtPriceLimitX96: zeroForOne ? SQRT_RATIO_1_1 / 2 : SQRT_RATIO_1_1 * 2
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
    }
}

/**
 * Second invocation: close the epoch and claim.
 *
 * Split from the deploy script for a reason that only shows up on a live chain. `closeEpoch`
 * snapshots at `clock() - 1`, and `VotesToken` clocks in BLOCK NUMBERS. `forge script` simulates
 * every transaction of one run inside a SINGLE block, so a combined script always simulates
 * `getPastTotalSupply(mintBlock - 1)` — which is zero, because the token did not exist yet — and
 * reverts with `NoVotingSupplyAtSnapshot` before forge will broadcast anything.
 *
 * That is not a bug in the distributor. It is the ERC-5805 rule doing its job: you cannot snapshot
 * a timepoint that has not settled. The fix is to close the epoch in a genuinely later block,
 * which means a separate invocation.
 *
 *   DISTRIBUTOR=0x... forge script script/ExerciseSepolia.s.sol:CloseAndClaimSepolia  *     --rpc-url <rpc> --broadcast -vv
 */
contract CloseAndClaimSepolia is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address payable dAddr = payable(vm.envAddress("DISTRIBUTOR"));
        SnapshotEpochDistributor d = SnapshotEpochDistributor(dAddr);

        console.log("=== close + claim ===");
        console.log("distributor", dAddr);
        console.log("clock now  ", d.clock());
        console.log("block      ", block.number);

        vm.startBroadcast(pk);
        uint256 epochId = d.closeEpoch();
        vm.stopBroadcast();

        SnapshotEpochDistributor.Epoch memory e = d.getEpoch(epochId);
        console.log("epoch", epochId);
        console.log("  amount0          ", e.amount0);
        console.log("  amount1          ", e.amount1);
        console.log("  totalVotingSupply", e.totalVotingSupply);
        console.log("  timepoint        ", e.timepoint);
        console.log("  expiresAt        ", e.expiresAt);

        (uint256 c0, uint256 c1) = d.claimableAmounts(epochId, me);
        console.log("claimable c0", c0);
        console.log("claimable c1", c1);
        require(
            c0 > 0 || c1 > 0,
            "holder snapshotted with no votes - delegate() must be at least one block behind closeEpoch"
        );

        vm.startBroadcast(pk);
        (uint256 got0, uint256 got1) = d.claim(epochId, me);
        vm.stopBroadcast();

        console.log("claimed c0", got0);
        console.log("claimed c1", got1);
        console.log("");
        console.log("NEXT, once the claim window has elapsed:");
        console.log("  ROLLOVER_ONLY=true DISTRIBUTOR=<distributor> forge script ... :ExerciseRevShareSepolia");
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {RevShareHook} from "../src/RevShareHook.sol";
import {IRevShareHook} from "../src/interfaces/IRevShareHook.sol";
import {MerkleEpochDistributor} from "../src/distributors/MerkleEpochDistributor.sol";
import {SnapshotEpochDistributor} from "../src/distributors/SnapshotEpochDistributor.sol";
import {VotesToken, TimestampVotesToken, PlainToken} from "./mocks/Mocks.sol";

/// @dev Shared plumbing: a live pool whose whole revenue share is routed to route 3.
abstract contract DistributorFixture is Test, Deployers {
    Vault vault;
    CLPoolManager poolManager;
    RevShareHook hook;
    CLPoolManagerRouter router;

    PoolKey key;
    PoolId poolId;
    Currency currency0;
    Currency currency1;

    address constant GOVERNANCE = address(0x600E);
    address constant GUARDIAN = address(0x6A47);
    address constant HOLDER_A = address(0xA);
    address constant HOLDER_B = address(0xB);
    address constant HOLDER_C = address(0xC);

    uint24 constant LP_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE_PIPS = 50_000; // 5%, so an epoch pot is comfortably above dust
    int256 constant SWAP_AMOUNT = -10 ether;

    function _deployPool(address tokenA, address tokenB) internal {
        (vault, poolManager) = createFreshManager();
        hook = new RevShareHook(poolManager, GOVERNANCE, GUARDIAN);
        router = new CLPoolManagerRouter(vault, poolManager);

        (currency0, currency1) =
            tokenA < tokenB ? (Currency.wrap(tokenA), Currency.wrap(tokenB)) : (Currency.wrap(tokenB), Currency.wrap(tokenA));

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: hook,
            poolManager: poolManager,
            fee: LP_FEE,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(hook.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });
        poolId = key.toId();
    }

    function _configureAndSeed(address distributor) internal {
        hook.configure(
            key,
            RevShareHook.ConfigParams({
                feePips: FEE_PIPS,
                lpDonateBps: 0,
                beneficiaryBps: 0,
                distributorBps: 10_000,
                distributor: distributor,
                enabled: true
            })
        );
        poolManager.initialize(key, SQRT_RATIO_1_1);

        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router), type(uint256).max);
        router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: 100_000 ether,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _swap(int256 amount, bool zeroForOne) internal returns (BalanceDelta) {
        return router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amount,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ZERO_BYTES
        );
    }
}

/*//////////////////////////////////////////////////////////////
                     MERKLE EPOCH DISTRIBUTOR
//////////////////////////////////////////////////////////////*/

contract MerkleEpochDistributorTest is DistributorFixture {
    MerkleEpochDistributor distributor;

    uint64 constant MIN_EPOCH = 1 days;
    uint64 constant CHALLENGE = 2 hours;
    uint64 constant CLAIM_WINDOW = 30 days;

    function setUp() public {
        vm.warp(1_000_000);
        MockERC20 a = new MockERC20("A", "A", 18);
        MockERC20 b = new MockERC20("B", "B", 18);
        a.mint(address(this), 1_000_000 ether);
        b.mint(address(this), 1_000_000 ether);
        _deployPool(address(a), address(b));

        // The distributor address must be known before `configure`, and `configure` must happen
        // before `initialize`, so the distributor is deployed against the key first.
        distributor = new MerkleEpochDistributor(
            IRevShareHook(address(hook)), key, GOVERNANCE, GUARDIAN, MIN_EPOCH, CHALLENGE, CLAIM_WINDOW
        );
        _configureAndSeed(address(distributor));
    }

    /*//////////////////////// merkle helpers ////////////////////////*/

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _leaf(uint256 index, address account, uint256 amount0, uint256 amount1)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(index, account, amount0, amount1))));
    }

    function _proof(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    /*//////////////////////// tests ////////////////////////*/

    function test_closeEpoch_pullsTheAccruedPot() public {
        _swap(SWAP_AMOUNT, true);
        uint256 pot = hook.pendingDistributorShare(poolId, currency1);
        assertGt(pot, 0);

        vm.prank(HOLDER_A); // permissionless
        uint256 epochId = distributor.closeEpoch();

        assertEq(epochId, 0);
        assertEq(distributor.getEpoch(0).amount1, pot);
        assertEq(distributor.getEpoch(0).amount0, 0);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(address(distributor)), pot);
        assertEq(hook.pendingDistributorShare(poolId, currency1), 0);
    }

    function test_closeEpoch_revertsWithNothingToDistribute() public {
        vm.expectRevert(MerkleEpochDistributor.NothingToDistribute.selector);
        distributor.closeEpoch();
    }

    function test_closeEpoch_respectsMinimumDuration() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();

        _swap(SWAP_AMOUNT, true);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleEpochDistributor.EpochTooSoon.selector, uint64(block.timestamp) + MIN_EPOCH)
        );
        distributor.closeEpoch();

        vm.warp(block.timestamp + MIN_EPOCH);
        distributor.closeEpoch();
        assertEq(distributor.epochCount(), 2);
    }

    function test_fullLifecycle_twoHoldersClaim() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot = distributor.getEpoch(0).amount1;

        uint256 shareA = pot / 2;
        uint256 shareB = pot - shareA;
        bytes32 leafA = _leaf(0, HOLDER_A, 0, shareA);
        bytes32 leafB = _leaf(1, HOLDER_B, 0, shareB);
        bytes32 root = _hashPair(leafA, leafB);

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, root);

        // Claims are shut during the challenge window.
        vm.expectRevert(
            abi.encodeWithSelector(
                MerkleEpochDistributor.ClaimNotOpenYet.selector, uint256(0), distributor.getEpoch(0).claimableAt
            )
        );
        distributor.claim(0, 0, HOLDER_A, 0, shareA, _proof(leafB));

        vm.warp(block.timestamp + CHALLENGE);

        // Anyone may submit; the funds go to the address inside the proven leaf.
        vm.prank(HOLDER_C);
        distributor.claim(0, 0, HOLDER_A, 0, shareA, _proof(leafB));
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(HOLDER_A), shareA);
        assertTrue(distributor.isClaimed(0, 0));

        vm.expectRevert(abi.encodeWithSelector(MerkleEpochDistributor.AlreadyClaimed.selector, uint256(0), uint256(0)));
        distributor.claim(0, 0, HOLDER_A, 0, shareA, _proof(leafB));

        distributor.claim(0, 1, HOLDER_B, 0, shareB, _proof(leafA));
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(HOLDER_B), shareB);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(address(distributor)), 0, "epoch fully drained");
    }

    function test_claim_rejectsForgedProofsAndAmounts() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot = distributor.getEpoch(0).amount1;

        uint256 shareA = pot / 2;
        uint256 shareB = pot - shareA;
        bytes32 leafA = _leaf(0, HOLDER_A, 0, shareA);
        bytes32 leafB = _leaf(1, HOLDER_B, 0, shareB);

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, _hashPair(leafA, leafB));
        vm.warp(block.timestamp + CHALLENGE);

        // Right proof, inflated amount.
        vm.expectRevert(MerkleEpochDistributor.InvalidProof.selector);
        distributor.claim(0, 0, HOLDER_A, 0, shareA + 1, _proof(leafB));

        // Right amount, wrong claimant.
        vm.expectRevert(MerkleEpochDistributor.InvalidProof.selector);
        distributor.claim(0, 0, HOLDER_C, 0, shareA, _proof(leafB));

        // Right leaf, wrong index (which is what the double-claim bitmap keys on).
        vm.expectRevert(MerkleEpochDistributor.InvalidProof.selector);
        distributor.claim(0, 5, HOLDER_A, 0, shareA, _proof(leafB));
    }

    /// @dev The bound on a dishonest root. An over-allocating tree runs out at its own epoch's
    /// escrow instead of reaching the next epoch's money.
    function test_overAllocatingRoot_cannotReachAnotherEpoch() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot0 = distributor.getEpoch(0).amount1;

        vm.warp(block.timestamp + MIN_EPOCH);
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot1 = distributor.getEpoch(1).amount1;
        assertGt(pot1, 0);

        // A root for epoch 0 that allocates the whole balance of BOTH epochs.
        uint256 greedy = pot0 + pot1;
        bytes32 leafA = _leaf(0, HOLDER_A, 0, greedy);
        bytes32 leafB = _leaf(1, HOLDER_B, 0, 1);

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, _hashPair(leafA, leafB));
        vm.warp(block.timestamp + CHALLENGE);

        vm.expectRevert(abi.encodeWithSelector(MerkleEpochDistributor.EpochOverAllocated.selector, uint256(0)));
        distributor.claim(0, 0, HOLDER_A, 0, greedy, _proof(leafB));

        // Epoch 1 is untouched.
        assertEq(distributor.getEpoch(1).amount1, pot1);
        assertEq(distributor.getEpoch(1).claimed1, 0);
    }

    function test_postRoot_isOwnerOnlyAndSingleUse() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();

        vm.prank(HOLDER_A);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, HOLDER_A));
        distributor.postRoot(0, bytes32(uint256(1)));

        vm.prank(GOVERNANCE);
        vm.expectRevert(MerkleEpochDistributor.InvalidRoot.selector);
        distributor.postRoot(0, bytes32(0));

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, bytes32(uint256(1)));

        vm.prank(GOVERNANCE);
        vm.expectRevert(abi.encodeWithSelector(MerkleEpochDistributor.RootAlreadyPosted.selector, uint256(0)));
        distributor.postRoot(0, bytes32(uint256(2)));
    }

    function test_cancelRoot_onlyInsideTheChallengeWindow() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, bytes32(uint256(1)));

        vm.prank(HOLDER_A);
        vm.expectRevert(MerkleEpochDistributor.NotGuardianOrOwner.selector);
        distributor.cancelRoot(0);

        // The guardian exists so a wrong root can be pulled without waiting for a timelock.
        vm.prank(GUARDIAN);
        distributor.cancelRoot(0);
        assertEq(distributor.getEpoch(0).root, bytes32(0));

        vm.prank(GOVERNANCE);
        distributor.postRoot(0, bytes32(uint256(2)));
        vm.warp(block.timestamp + CHALLENGE);

        // Once claims open the allocation is final, even for the owner. Read `claimableAt` BEFORE
        // the prank: `vm.prank` applies to the next call, and an argument that is itself an
        // external call would consume it, leaving `cancelRoot` to run as this test contract and
        // revert on access control instead of on the window.
        uint64 claimableAt = distributor.getEpoch(0).claimableAt;
        vm.prank(GOVERNANCE);
        vm.expectRevert(
            abi.encodeWithSelector(MerkleEpochDistributor.ChallengeWindowClosed.selector, uint256(0), claimableAt)
        );
        distributor.cancelRoot(0);
    }

    function test_rollover_returnsUnclaimedValueToTheNextEpoch() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot0 = distributor.getEpoch(0).amount1;

        bytes32 leafA = _leaf(0, HOLDER_A, 0, pot0 / 2);
        bytes32 leafB = _leaf(1, HOLDER_B, 0, pot0 - pot0 / 2);
        vm.prank(GOVERNANCE);
        distributor.postRoot(0, _hashPair(leafA, leafB));
        vm.warp(block.timestamp + CHALLENGE);
        distributor.claim(0, 0, HOLDER_A, 0, pot0 / 2, _proof(leafB));

        uint256 unclaimed = pot0 - pot0 / 2;

        vm.expectRevert(
            abi.encodeWithSelector(
                MerkleEpochDistributor.NotExpiredYet.selector, uint256(0), distributor.getEpoch(0).expiresAt
            )
        );
        distributor.rollover(0);

        vm.warp(distributor.getEpoch(0).expiresAt);
        vm.expectRevert(
            abi.encodeWithSelector(
                MerkleEpochDistributor.ClaimWindowClosed.selector, uint256(0), distributor.getEpoch(0).expiresAt
            )
        );
        distributor.claim(0, 1, HOLDER_B, 0, unclaimed, _proof(leafA));

        distributor.rollover(0);
        assertEq(distributor.carryOver1(), unclaimed);

        vm.expectRevert(abi.encodeWithSelector(MerkleEpochDistributor.AlreadyRolledOver.selector, uint256(0)));
        distributor.rollover(0);

        // The carry-over is folded into the next epoch rather than being stranded or swept.
        _swap(SWAP_AMOUNT, true);
        uint256 fresh = hook.pendingDistributorShare(poolId, currency1);
        distributor.closeEpoch();
        assertEq(distributor.getEpoch(1).amount1, fresh + unclaimed);
        assertEq(distributor.carryOver1(), 0);
    }

    /// @dev A root poster who abandons the job cannot strand an epoch forever.
    function test_rollover_worksOnAnEpochThatNeverGotARoot() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot = distributor.getEpoch(0).amount1;

        vm.warp(block.timestamp + MIN_EPOCH + CLAIM_WINDOW);
        distributor.rollover(0);
        assertEq(distributor.carryOver1(), pot);
    }

    function test_constructor_rejectsAMismatchedKeyOrZeroWindows() public {
        PoolKey memory wrong = key;
        wrong.hooks = IHooks(address(0x1234));

        vm.expectRevert(MerkleEpochDistributor.InvalidWindows.selector);
        new MerkleEpochDistributor(IRevShareHook(address(hook)), key, GOVERNANCE, GUARDIAN, MIN_EPOCH, 0, CLAIM_WINDOW);

        vm.expectRevert(MerkleEpochDistributor.InvalidWindows.selector);
        new MerkleEpochDistributor(IRevShareHook(address(hook)), key, GOVERNANCE, GUARDIAN, MIN_EPOCH, CHALLENGE, 0);

        vm.expectRevert(MerkleEpochDistributor.InvalidPoolKey.selector);
        new MerkleEpochDistributor(
            IRevShareHook(address(hook)), wrong, GOVERNANCE, GUARDIAN, MIN_EPOCH, CHALLENGE, CLAIM_WINDOW
        );
    }
}

/*//////////////////////////////////////////////////////////////
                    SNAPSHOT EPOCH DISTRIBUTOR
//////////////////////////////////////////////////////////////*/

contract SnapshotEpochDistributorTest is DistributorFixture {
    SnapshotEpochDistributor distributor;
    VotesToken votes;

    uint64 constant MIN_EPOCH = 1 days;
    uint64 constant CLAIM_WINDOW = 30 days;

    function setUp() public {
        // Separate the two clock domains so the ERC-6372 probe has something to distinguish.
        vm.roll(1000);
        vm.warp(1_000_000);

        votes = new VotesToken();
        votes.mint(address(this), 1_000_000 ether);
        MockERC20 pair = new MockERC20("PAIR", "PAIR", 18);
        pair.mint(address(this), 1_000_000 ether);

        _deployPool(address(votes), address(pair));

        distributor = new SnapshotEpochDistributor(
            IRevShareHook(address(hook)), key, IVotes(address(votes)), MIN_EPOCH, CLAIM_WINDOW
        );
        _configureAndSeed(address(distributor));

        // Holders must delegate for their balances to be counted. This is the whole catch.
        votes.transfer(HOLDER_A, 600 ether);
        votes.transfer(HOLDER_B, 400 ether);
        vm.prank(HOLDER_A);
        votes.delegate(HOLDER_A);
        vm.prank(HOLDER_B);
        votes.delegate(HOLDER_B);
        vm.roll(block.number + 1);
    }

    function test_clockDetection_blockNumberToken() public view {
        assertTrue(distributor.clockIsBlockNumber());
        assertEq(distributor.clock(), uint48(block.number));
    }

    function test_clockDetection_timestampToken() public {
        TimestampVotesToken ts = new TimestampVotesToken();
        ts.mint(address(this), 1 ether);
        SnapshotEpochDistributor d = new SnapshotEpochDistributor(
            IRevShareHook(address(hook)), key, IVotes(address(ts)), MIN_EPOCH, CLAIM_WINDOW
        );
        assertFalse(d.clockIsBlockNumber(), "a timestamp clock must not be read as a block clock");
        assertEq(d.clock(), uint48(block.timestamp));
    }

    /// @dev Detect, do not assume. A token with no checkpoints fails at construction rather than
    /// silently paying everybody zero after the pot has already been pulled out of the hook.
    function test_clockDetection_rejectsANonSnapshotToken() public {
        PlainToken plain = new PlainToken();
        vm.expectRevert(
            abi.encodeWithSelector(SnapshotEpochDistributor.TokenNotSnapshotCapable.selector, address(plain))
        );
        new SnapshotEpochDistributor(
            IRevShareHook(address(hook)), key, IVotes(address(plain)), MIN_EPOCH, CLAIM_WINDOW
        );
    }

    function test_fullLifecycle_proRataByDelegatedVotes() public {
        _swap(SWAP_AMOUNT, true);
        _swap(SWAP_AMOUNT, false);

        uint256 pot0 = hook.pendingDistributorShare(poolId, currency0);
        uint256 pot1 = hook.pendingDistributorShare(poolId, currency1);
        assertGt(pot0, 0);
        assertGt(pot1, 0);

        vm.prank(HOLDER_C); // permissionless, admin-free
        distributor.closeEpoch();

        SnapshotEpochDistributor.Epoch memory epoch = distributor.getEpoch(0);
        // The numerator is DELEGATED votes; the denominator is ERC-5805's total supply of voting
        // units, which is the token's whole supply - including the 999_000 this contract minted to
        // itself and never delegated. The two do not measure the same thing, and the denominator
        // being the larger is exactly what keeps the epoch solvent. See the contract's NatSpec.
        assertEq(epoch.totalVotingSupply, votes.getPastTotalSupply(epoch.timepoint));
        assertEq(epoch.totalVotingSupply, 1_000_000 ether, "the denominator is total supply");
        assertEq(votes.getPastVotes(HOLDER_A, epoch.timepoint), 600 ether, "the numerator is delegated votes");

        uint256 supply = epoch.totalVotingSupply;
        (uint256 expect0, uint256 expect1) = distributor.claimableAmounts(0, HOLDER_A);
        assertEq(expect0, (pot0 * 600 ether) / supply);
        assertEq(expect1, (pot1 * 600 ether) / supply);
        assertGt(expect0, 0, "the fixture must not round A's share away to nothing");

        // currency0 IS the votes token here, so A necessarily already holds the 600 ether that
        // gives them voting power at all. Measure what the claim moved, not A's whole balance.
        uint256 before0 = IERC20(Currency.unwrap(currency0)).balanceOf(HOLDER_A);
        uint256 before1 = IERC20(Currency.unwrap(currency1)).balanceOf(HOLDER_A);

        vm.prank(HOLDER_C);
        (uint256 got0, uint256 got1) = distributor.claim(0, HOLDER_A);
        assertEq(got0, expect0);
        assertEq(got1, expect1);
        // The payout lands on the account named in the call, not on the permissionless caller.
        assertEq(IERC20(Currency.unwrap(currency0)).balanceOf(HOLDER_A) - before0, expect0);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(HOLDER_A) - before1, expect1);
        assertEq(IERC20(Currency.unwrap(currency0)).balanceOf(HOLDER_C), 0, "the caller is paid nothing");

        vm.expectRevert(
            abi.encodeWithSelector(SnapshotEpochDistributor.AlreadyClaimed.selector, uint256(0), HOLDER_A)
        );
        distributor.claim(0, HOLDER_A);

        distributor.claim(0, HOLDER_B);
        // Both claims together can never exceed the escrow.
        assertLe(distributor.getEpoch(0).claimed0, pot0);
        assertLe(distributor.getEpoch(0).claimed1, pot1);
    }

    /// @dev The documented catch, asserted rather than hand-waved: an undelegated holder gets
    /// nothing, and - because their balance is still in the denominator - nobody else gets more.
    /// Their share simply goes unclaimed and `rollover` hands it to the next epoch.
    function test_undelegatedHolderReceivesNothing() public {
        votes.transfer(HOLDER_C, 500 ether); // never delegates
        vm.roll(block.number + 1);

        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();

        SnapshotEpochDistributor.Epoch memory epoch = distributor.getEpoch(0);
        assertEq(votes.getPastVotes(HOLDER_C, epoch.timepoint), 0, "C delegated to nobody");
        // A transfer moves votes between delegates; it never touches `_totalCheckpoints`. So C's
        // balance stays in the denominator, and C being unpaid does not enlarge A's or B's share.
        assertEq(epoch.totalVotingSupply, votes.totalSupply(), "undelegated supply stays in the denominator");

        vm.expectRevert(
            abi.encodeWithSelector(SnapshotEpochDistributor.NothingToClaim.selector, uint256(0), HOLDER_C)
        );
        distributor.claim(0, HOLDER_C);

        // Nothing is destroyed by that: whatever nobody can claim returns to the next epoch.
        uint256 pot1 = epoch.amount1;
        assertGt(pot1, 0);
        vm.warp(block.timestamp + CLAIM_WINDOW);
        distributor.rollover(0);
        assertEq(distributor.carryOver1(), pot1, "the unclaimable share is escrowed, not burned");
    }

    function test_closeEpoch_revertsWhenNobodyHasDelegated() public {
        VotesToken lonely = new VotesToken();
        lonely.mint(address(this), 1 ether);
        SnapshotEpochDistributor d = new SnapshotEpochDistributor(
            IRevShareHook(address(hook)), key, IVotes(address(lonely)), MIN_EPOCH, CLAIM_WINDOW
        );

        _swap(SWAP_AMOUNT, true);
        vm.expectRevert(
            abi.encodeWithSelector(
                SnapshotEpochDistributor.NoVotingSupplyAtSnapshot.selector, uint48(block.number - 1)
            )
        );
        d.closeEpoch();

        // Nothing was pulled, so the value is still in the hook for a later epoch.
        assertGt(hook.pendingDistributorShare(poolId, currency1), 0);
    }

    function test_closeEpoch_respectsMinimumDuration() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();

        _swap(SWAP_AMOUNT, true);
        vm.roll(block.number + 1);
        vm.expectRevert(
            abi.encodeWithSelector(SnapshotEpochDistributor.EpochTooSoon.selector, uint64(block.timestamp) + MIN_EPOCH)
        );
        distributor.closeEpoch();

        vm.warp(block.timestamp + MIN_EPOCH);
        distributor.closeEpoch();
        assertEq(distributor.epochCount(), 2);
    }

    function test_rollover_returnsTheFloorRemainderAndUnclaimedShares() public {
        _swap(SWAP_AMOUNT, true);
        distributor.closeEpoch();
        uint256 pot = distributor.getEpoch(0).amount1;

        distributor.claim(0, HOLDER_A);
        uint256 unclaimed = pot - distributor.getEpoch(0).claimed1;
        assertGt(unclaimed, 0, "HOLDER_B has not claimed yet");

        vm.warp(block.timestamp + CLAIM_WINDOW);
        vm.expectRevert(
            abi.encodeWithSelector(
                SnapshotEpochDistributor.ClaimWindowClosed.selector, uint256(0), distributor.getEpoch(0).expiresAt
            )
        );
        distributor.claim(0, HOLDER_B);

        distributor.rollover(0);
        assertEq(distributor.carryOver1(), unclaimed);

        _swap(SWAP_AMOUNT, true);
        vm.roll(block.number + 1);
        uint256 fresh = hook.pendingDistributorShare(poolId, currency1);
        distributor.closeEpoch();
        assertEq(distributor.getEpoch(1).amount1, fresh + unclaimed);
    }

    /// @dev The distributor holds exactly what its epochs say it holds, at every point.
    function test_escrowAccountingIsExact() public {
        _swap(SWAP_AMOUNT, true);
        _swap(SWAP_AMOUNT, false);
        distributor.closeEpoch();

        distributor.claim(0, HOLDER_A);
        distributor.claim(0, HOLDER_B);

        SnapshotEpochDistributor.Epoch memory epoch = distributor.getEpoch(0);
        assertEq(
            IERC20(Currency.unwrap(currency1)).balanceOf(address(distributor)),
            epoch.amount1 - epoch.claimed1,
            "distributor balance must equal unclaimed escrow"
        );
        assertEq(
            IERC20(Currency.unwrap(currency0)).balanceOf(address(distributor)),
            epoch.amount0 - epoch.claimed0,
            "distributor balance must equal unclaimed escrow"
        );
    }
}

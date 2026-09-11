// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IERC6372} from "@openzeppelin/contracts/interfaces/IERC6372.sol";

import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";

import {IRevShareHook} from "../interfaces/IRevShareHook.sol";
import {IEpochDistributor, EpochDistributorKind} from "../interfaces/IEpochDistributor.sol";

/// @title SnapshotEpochDistributor
/// @notice Route 3 for a token that CAN prove its own history: pay holders their exact pro-rata
/// share of an epoch's fees, computed on-chain from ERC-5805 checkpoints, with no root, no
/// off-chain job, and no trusted party anywhere in the flow.
///
/// @dev ############################ WHY THIS ONE IS TRUSTLESS ############################
///
/// `MerkleEpochDistributor` exists because a plain ERC20 cannot answer "who held this at block N".
/// An ERC20Votes / ERC-5805 token can: `getPastVotes(account, t)` and `getPastTotalSupply(t)` are
/// binary searches over checkpoints the token itself wrote. So `closeEpoch` records a timepoint,
/// and every claim derives its own amount:
///
///     payout = pot * getPastVotes(account, timepoint) / getPastTotalSupply(timepoint)
///
/// There is no admin function on this contract at all. Nobody posts anything, nobody can cancel
/// anything, and nobody can move an epoch's funds anywhere except to a holder who proves their own
/// balance. Prefer this variant whenever the token supports it.
///
/// ------------------------------- THE CATCH, STATED PLAINLY -------------------------------
///
/// THE NUMERATOR AND THE DENOMINATOR DO NOT MEASURE THE SAME THING, and that asymmetry is the
/// single most important fact about this contract:
///
///   * `getPastVotes(account, t)` counts DELEGATED VOTING UNITS. In OpenZeppelin's `ERC20Votes` a
///     holder who has never called `delegate` has `getPastVotes == 0` however large their balance.
///   * `getPastTotalSupply(t)` counts the token's TOTAL supply of voting units. `Votes` pushes to
///     `_totalCheckpoints` on mint and burn only - delegation never touches it - so undelegated
///     balances ARE in the denominator. OpenZeppelin says as much on the function itself: "this is
///     not necessarily the sum of all delegated votes".
///
/// So the numerators sum to the denominator only when every unit of supply is delegated, and are
/// strictly smaller otherwise. That direction is deliberate and must not be inverted: a denominator
/// that is always at least the sum of the numerators is what makes the epoch solvent BY
/// CONSTRUCTION, before the flooring and the escrow ceiling in `claim` are considered at all.
///
/// There is no on-chain fix. ERC-5805 exposes no total-delegated figure, and having the caller
/// supply the delegate set instead would let an incomplete list shrink the denominator, over-draw
/// the epoch and turn `claim` into a first-come-first-served race. Total supply is the only
/// denominator this contract can trust.
///
/// Consequences a deployment must own:
///   * Undelegated holders receive NOTHING, and their share is NOT redistributed to delegated
///     holders - nobody can claim it, so it sits in the epoch until `rollover` returns it to the
///     next one. No value is lost, but only `delegatedSupply / totalSupply` of each pot is paid
///     out per epoch and the rest churns. "All holders share the fees" is FALSE unless every
///     holder has self-delegated. Say "delegated holders" in the marketing copy, or - much better
///     - ship a token whose `_update` auto-delegates, which collapses the two figures into one.
///   * Watch this especially when the votes token is one of the pool's own currencies: the
///     liquidity parked in the Vault is undelegated supply sitting in the denominator.
///   * A token can be delegated to an address that cannot receive the payout currency. That
///     strands one holder's share until `rollover`, and affects nobody else - `claim` is pull.
///
/// ------------------------------- CLOCK HANDLING -------------------------------
///
/// The timepoint domain is the token's, not ours. ERC-6372 lets a token be block-numbered or
/// timestamped, and reading `getPastVotes` with the wrong domain silently returns garbage - a
/// timestamp is a far-future block number, which reverts, and a block number is a 1970 timestamp,
/// which returns the token's genesis state. So the constructor PROBES `clock()` and records the
/// answer instead of assuming, and falls back to `block.number` per ERC-6372's default only when
/// the token does not implement it. This is the "detect, don't assume" requirement, and it is the
/// single most likely thing to get silently wrong when integrating a new token.
/// ###############################################################################
contract SnapshotEpochDistributor is IEpochDistributor, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidHook();
    error InvalidPoolKey();
    error InvalidWindows();

    /// @notice The token does not implement the ERC-5805 read surface this contract needs.
    error TokenNotSnapshotCapable(address token);

    error EpochTooSoon(uint64 earliest);
    error NothingToDistribute();
    error NoVotingSupplyAtSnapshot(uint48 timepoint);
    error UnknownEpoch(uint256 epochId);
    error AlreadyClaimed(uint256 epochId, address account);
    error NothingToClaim(uint256 epochId, address account);
    error ClaimWindowClosed(uint256 epochId, uint64 expiresAt);
    error NotExpiredYet(uint256 epochId, uint64 expiresAt);
    error AlreadyRolledOver(uint256 epochId);
    error NativeNotAccepted();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event EpochClosed(
        uint256 indexed epochId, uint48 timepoint, uint256 totalVotingSupply, uint256 amount0, uint256 amount1
    );
    event EpochClaimed(uint256 indexed epochId, address indexed account, uint256 amount0, uint256 amount1);
    event EpochRolledOver(uint256 indexed epochId, uint256 amount0, uint256 amount1);

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// @param timepoint The token-clock timepoint holders are measured at.
    /// @param totalVotingSupply `getPastTotalSupply(timepoint)`, cached so a claim needs one fewer
    /// external call and so the denominator can never change under an epoch.
    struct Epoch {
        uint256 amount0;
        uint256 amount1;
        uint256 claimed0;
        uint256 claimed1;
        uint256 totalVotingSupply;
        uint48 timepoint;
        uint64 closedAt;
        uint64 expiresAt;
        bool rolledOver;
    }

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    IRevShareHook public immutable hook;

    /// @notice The ERC-5805 token whose holders are paid.
    IVotes public immutable token;

    /// @notice True when the token's clock is block-numbered, false when it is timestamped.
    bool public immutable clockIsBlockNumber;

    uint64 public immutable minEpochDuration;
    uint64 public immutable claimWindow;

    PoolKey internal _key;

    uint256 public epochCount;
    uint64 public lastCloseAt;

    uint256 public carryOver0;
    uint256 public carryOver1;

    mapping(uint256 epochId => Epoch) internal _epochs;
    mapping(uint256 epochId => mapping(address account => bool)) public claimed;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @param token_ Must implement `getPastVotes` / `getPastTotalSupply`. Usually one of the
    /// pool's two currencies, but not required to be - a staked wrapper is a legitimate choice.
    constructor(
        IRevShareHook hook_,
        PoolKey memory key_,
        IVotes token_,
        uint64 minEpochDuration_,
        uint64 claimWindow_
    ) {
        if (address(hook_) == address(0)) revert InvalidHook();
        if (address(key_.hooks) != address(hook_)) revert InvalidPoolKey();
        if (claimWindow_ == 0) revert InvalidWindows();

        hook = hook_;
        _key = key_;
        token = token_;
        minEpochDuration = minEpochDuration_;
        claimWindow = claimWindow_;

        // DETECT, DO NOT ASSUME. ERC-6372 says a token without `clock()` is block-numbered.
        bool isBlockNumber = true;
        try IERC6372(address(token_)).clock() returns (uint48 clockValue) {
            // A clock within a block of `block.number` is a block clock; one within a block of
            // `block.timestamp` is a timestamp clock. On any live chain these two are separated by
            // orders of magnitude, so the test is unambiguous.
            isBlockNumber = _near(clockValue, block.number);
            if (!isBlockNumber && !_near(clockValue, block.timestamp)) {
                revert TokenNotSnapshotCapable(address(token_));
            }
        } catch {
            isBlockNumber = true;
        }
        clockIsBlockNumber = isBlockNumber;

        // Probe the read surface itself, so a token that is simply not an ERC20Votes fails here
        // rather than at the first `closeEpoch` with a pot already pulled out of the hook.
        uint256 probe = isBlockNumber ? block.number : block.timestamp;
        if (probe == 0) revert TokenNotSnapshotCapable(address(token_));
        try token_.getPastTotalSupply(probe - 1) returns (uint256) {}
        catch {
            revert TokenNotSnapshotCapable(address(token_));
        }
    }

    /// @notice Accepts native currency pulled from the hook. See `MerkleEpochDistributor`.
    receive() external payable {
        if (msg.sender != address(hook)) revert NativeNotAccepted();
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @inheritdoc IEpochDistributor
    /// @dev The `Epoch` returned by `getEpoch` below is nine all-static fields, and so is the
    /// merkle distributor's. Decoding one with the other's ABI therefore SUCCEEDS and hands back
    /// this contract's `totalVotingSupply` as a merkle root, or a root as a voting supply. This is
    /// the call that stops that happening; there is nothing further down this file that will.
    function kind() external pure returns (bytes32) {
        return EpochDistributorKind.SNAPSHOT;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    function poolId() public view returns (PoolId) {
        return _key.toId();
    }

    function getEpoch(uint256 epochId) external view returns (Epoch memory) {
        if (epochId >= epochCount) revert UnknownEpoch(epochId);
        return _epochs[epochId];
    }

    /// @notice The token clock's current value, in whichever domain the token uses.
    function clock() public view returns (uint48) {
        return clockIsBlockNumber ? uint48(block.number) : uint48(block.timestamp);
    }

    /// @notice What `account` would receive from `epochId`, ignoring whether it has claimed.
    function claimableAmounts(uint256 epochId, address account)
        public
        view
        returns (uint256 amount0, uint256 amount1)
    {
        if (epochId >= epochCount) revert UnknownEpoch(epochId);
        Epoch storage epoch = _epochs[epochId];
        uint256 votes = token.getPastVotes(account, epoch.timepoint);
        if (votes == 0) return (0, 0);
        amount0 = Math.mulDiv(epoch.amount0, votes, epoch.totalVotingSupply);
        amount1 = Math.mulDiv(epoch.amount1, votes, epoch.totalVotingSupply);
    }

    /*//////////////////////////////////////////////////////////////
                                 EPOCHS
    //////////////////////////////////////////////////////////////*/

    /// @notice Close the current epoch, snapshotting the token's voting supply one tick back.
    /// @dev Permissionless and admin-free. `timepoint = clock() - 1` because ERC-5805 rejects a
    /// lookup at or after the current timepoint: the current block is still mutable.
    ///
    /// The snapshot is taken at close, i.e. AFTER the fees accrued. Someone can therefore buy the
    /// token in the same block the epoch closes and collect a share of fees generated before they
    /// held anything. That is inherent to snapshot dividends, is bounded by `minEpochDuration`
    /// (which fixes how much value one snapshot can be worth relative to how long buyers must
    /// hold), and is the reason a short epoch is a bad idea on a thin token.
    function closeEpoch() external nonReentrant returns (uint256 epochId) {
        uint64 earliest = lastCloseAt + minEpochDuration;
        if (epochCount != 0 && block.timestamp < earliest) revert EpochTooSoon(earliest);

        uint48 timepoint = clock() - 1;
        // Total supply of voting units at the snapshot, NOT the delegated subset - see the notes at
        // the top of this file. It is an upper bound on the sum of every holder's `getPastVotes`,
        // which is what keeps the epoch solvent whatever the token's delegation state.
        uint256 supply = token.getPastTotalSupply(timepoint);
        // No supply at all, so there is no denominator and no honest way to split the pot.
        // Reverting leaves the value in the hook, where a later epoch can still distribute it.
        // Note this does NOT catch "supply exists but nobody delegated": that case closes an epoch
        // nobody can claim, which costs nothing because `rollover` returns the pot intact.
        if (supply == 0) revert NoVotingSupplyAtSnapshot(timepoint);

        // Carry-over is consumed before the external pull; see `MerkleEpochDistributor`.
        uint256 amount0 = carryOver0;
        uint256 amount1 = carryOver1;
        carryOver0 = 0;
        carryOver1 = 0;

        amount0 += hook.pullDistributorShare(_key, _key.currency0);
        amount1 += hook.pullDistributorShare(_key, _key.currency1);
        if (amount0 == 0 && amount1 == 0) revert NothingToDistribute();

        epochId = epochCount;
        epochCount = epochId + 1;
        lastCloseAt = uint64(block.timestamp);

        Epoch storage epoch = _epochs[epochId];
        epoch.amount0 = amount0;
        epoch.amount1 = amount1;
        epoch.totalVotingSupply = supply;
        epoch.timepoint = timepoint;
        epoch.closedAt = uint64(block.timestamp);
        epoch.expiresAt = uint64(block.timestamp) + claimWindow;

        emit EpochClosed(epochId, timepoint, supply, amount0, amount1);
    }

    /*//////////////////////////////////////////////////////////////
                                 CLAIMS
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim `account`'s pro-rata share of `epochId`. Anyone may submit; `account` is paid.
    /// @dev Rounding floors both amounts, so the sum of all claims is never more than the pot and
    /// the epoch cannot be over-drawn even before the escrow ceiling below. The floor remainder is
    /// picked up by `rollover`.
    function claim(uint256 epochId, address account) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (epochId >= epochCount) revert UnknownEpoch(epochId);
        Epoch storage epoch = _epochs[epochId];

        if (block.timestamp >= epoch.expiresAt) revert ClaimWindowClosed(epochId, epoch.expiresAt);
        if (claimed[epochId][account]) revert AlreadyClaimed(epochId, account);

        uint256 votes = token.getPastVotes(account, epoch.timepoint);
        if (votes == 0) revert NothingToClaim(epochId, account);

        amount0 = Math.mulDiv(epoch.amount0, votes, epoch.totalVotingSupply);
        amount1 = Math.mulDiv(epoch.amount1, votes, epoch.totalVotingSupply);
        if (amount0 == 0 && amount1 == 0) revert NothingToClaim(epochId, account);

        // ---- effects ----
        claimed[epochId][account] = true;
        uint256 newClaimed0 = epoch.claimed0 + amount0;
        uint256 newClaimed1 = epoch.claimed1 + amount1;
        // Belt and braces on top of the flooring above: an epoch can never pay out more than it
        // escrowed, whatever the token's checkpoints say.
        if (newClaimed0 > epoch.amount0) {
            amount0 = epoch.amount0 - epoch.claimed0;
            newClaimed0 = epoch.amount0;
        }
        if (newClaimed1 > epoch.amount1) {
            amount1 = epoch.amount1 - epoch.claimed1;
            newClaimed1 = epoch.amount1;
        }
        epoch.claimed0 = newClaimed0;
        epoch.claimed1 = newClaimed1;

        // ---- interactions ----
        if (amount0 != 0) _key.currency0.transfer(account, amount0);
        if (amount1 != 0) _key.currency1.transfer(account, amount1);

        emit EpochClaimed(epochId, account, amount0, amount1);
    }

    /// @notice Return an expired epoch's unclaimed remainder to the next epoch's holders.
    function rollover(uint256 epochId) external nonReentrant {
        if (epochId >= epochCount) revert UnknownEpoch(epochId);
        Epoch storage epoch = _epochs[epochId];
        if (epoch.rolledOver) revert AlreadyRolledOver(epochId);
        if (block.timestamp < epoch.expiresAt) revert NotExpiredYet(epochId, epoch.expiresAt);

        uint256 remainder0 = epoch.amount0 - epoch.claimed0;
        uint256 remainder1 = epoch.amount1 - epoch.claimed1;

        epoch.rolledOver = true;
        epoch.amount0 = epoch.claimed0;
        epoch.amount1 = epoch.claimed1;

        carryOver0 += remainder0;
        carryOver1 += remainder1;

        emit EpochRolledOver(epochId, remainder0, remainder1);
    }

    /// @dev True when `a` and `b` are within one unit of each other. Used only to tell a block
    /// clock from a timestamp clock, which differ by many orders of magnitude on any real chain.
    function _near(uint256 a, uint256 b) private pure returns (bool) {
        return a > b ? a - b <= 1 : b - a <= 1;
    }
}

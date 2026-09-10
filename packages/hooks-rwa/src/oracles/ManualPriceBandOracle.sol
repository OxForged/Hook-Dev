// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";

import {IPriceBandOracle} from "../interfaces/IPriceBandOracle.sol";

/// @title ManualPriceBandOracle
/// @notice A minimal, self-custodied `IPriceBandOracle`: a reference price per pool, published
/// on-chain by the issuer or by keepers the issuer designates.
///
/// @dev ############################ WHAT THIS IS FOR ############################
///
/// This is the REFERENCE implementation and the fallback for an issuer who already knows what the
/// asset is worth - because a transfer agent, a fund administrator, a primary venue or their own
/// market-making desk tells them - and simply needs somewhere to publish it. It is deliberately
/// the dumbest thing that can work: a mapping, an owner, a publisher set, and events.
///
/// It verifies nothing. It reports what its publishers wrote into it. An issuer with a real feed
/// should write a thin adapter that implements `IPriceBandOracle` over that feed instead - the
/// whole point of the interface is that this contract is replaceable.
///
/// Nothing here is legal advice, and a price published here is not a valuation, a NAV, a mark, an
/// official closing price, or a representation that any trade near it is fair or lawful. See
/// `IPriceBandOracle`.
///
/// ####################### THE UNIT. GET THIS WRONG AND THE BAND INVERTS. #######################
///
/// `sqrtPriceX96` is in the POOL's units:
///
///     sqrt(currency1 per 1 currency0, each in its own smallest unit) * 2**96
///
/// The same number `ICLPoolManager.getSlot0` returns. It is not a USD price and it depends on
/// which of the pair's two tokens sorted lower. A publisher converting from a human price must do
/// the decimals and the ordering itself; the safest way to confirm is to read the live pool's
/// `getSlot0` and check the published value is the same order of magnitude.
///
/// This contract cannot check that for you - it does not know the pool's tokens - so it applies
/// the only check it can: the value must be inside the range core can represent at all.
///
/// ############################ DESIGN NOTES ############################
///
///  * The whole read is ONE storage slot, deliberately. `MarketHoursModule` calls this inside a
///    Vault lock under a hard gas cap; an implementation that loops, or that calls out to
///    something that loops, gets denied by that cap and takes the pool's trading with it.
///
///  * `updatedAt` is stamped by this contract, not supplied by the publisher, so a stale price
///    cannot be re-dated without re-publishing it. The consumer enforces its own staleness window
///    against that stamp.
///
///  * `clearReference` publishes "no price", which the consumer reads as oracle-unavailable and
///    which therefore STOPS TRADING on any pool whose band is enabled. That is a halt lever
///    reachable from the feed side, and it should be understood as one: a publisher key is a key
///    that can stop the market. It cannot start one that the calendar or a halt has stopped, and
///    it can never block an LP exit.
///
///  * Ownership is `Ownable2Step`, and on a live chain the owner should be a timelock or multisig.
///    Publishers are deliberately NOT timelocked - a reference price that arrives six hours late
///    is not a reference price - which is why the publisher role can only write prices and cannot
///    appoint anyone.
contract ManualPriceBandOracle is IPriceBandOracle, Ownable2Step {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Caller is neither the owner nor a designated publisher
    error NotPublisher(address caller);

    /// @notice The zero address cannot be a publisher
    error ZeroAddress();

    /// @notice Batch arguments had mismatched lengths
    error LengthMismatch(uint256 poolIdsLength, uint256 pricesLength);

    /// @notice A price outside the range core can represent as a pool price.
    /// @dev Not a claim that the price is wrong, only that it is not a price this pool type could
    /// ever trade at, which is the one sanity check this contract is in a position to make.
    error PriceOutOfRange(uint160 sqrtPriceX96);

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted on every published reference, and on every clearing (`sqrtPriceX96 == 0`)
    event ReferencePriceSet(PoolId indexed poolId, address indexed by, uint160 sqrtPriceX96, uint64 updatedAt);

    /// @notice Emitted when a publisher is designated or removed
    event PublisherSet(address indexed publisher, bool allowed);

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @param sqrtPriceX96 The reference, in the pool's units. 0 means "no price".
    /// @param updatedAt Stamped by this contract when the price was written.
    struct Reference {
        uint160 sqrtPriceX96;
        uint64 updatedAt;
    }

    /// @notice The register. A pool that has never been published reads back as `(0, 0)`, which
    /// the consumer treats as unavailable.
    mapping(PoolId poolId => Reference) internal _references;

    /// @notice Accounts permitted to publish prices, and to do nothing else.
    mapping(address publisher => bool) public isPublisher;

    /// @param initialOwner Ownership seat. On a live chain this should be a timelock or multisig.
    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyPublisher() {
        if (msg.sender != owner() && !isPublisher[msg.sender]) revert NotPublisher(msg.sender);
        _;
    }

    /*//////////////////////////////////////////////////////////////
                             ADMINISTRATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Designate or remove a publisher. Owner only.
    function setPublisher(address publisher, bool allowed) external onlyOwner {
        if (publisher == address(0)) revert ZeroAddress();
        isPublisher[publisher] = allowed;
        emit PublisherSet(publisher, allowed);
    }

    /// @notice Publish the reference price for one pool.
    /// @param sqrtPriceX96 The reference in the pool's units. Must be in core's representable
    ///        range; use `clearReference` to withdraw a price rather than passing 0 here, so that
    ///        "no price" is always an explicit act.
    function setReferencePrice(PoolId poolId, uint160 sqrtPriceX96) external onlyPublisher {
        _setReference(poolId, sqrtPriceX96);
    }

    /// @notice Publish reference prices for several pools at once.
    /// @dev Bounded by the calldata arrays the caller pays for; no growable set is iterated.
    function setReferencePrices(PoolId[] calldata poolIds, uint160[] calldata sqrtPricesX96)
        external
        onlyPublisher
    {
        if (poolIds.length != sqrtPricesX96.length) {
            revert LengthMismatch(poolIds.length, sqrtPricesX96.length);
        }
        for (uint256 i = 0; i < poolIds.length; ++i) {
            _setReference(poolIds[i], sqrtPricesX96[i]);
        }
    }

    /// @notice Withdraw the reference price for a pool.
    /// @dev Understand what this does: on any pool with `bandEnabled`, the consumer reads a
    /// missing reference as oracle-unavailable and REJECTS EVERY SWAP. This is a market stop
    /// operated from the price side. It never blocks an LP exit.
    function clearReference(PoolId poolId) external onlyPublisher {
        // `uint64` seconds runs to the year 584 billion. The cast cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 clearedAt = uint64(block.timestamp);
        _references[poolId] = Reference({sqrtPriceX96: 0, updatedAt: clearedAt});
        emit ReferencePriceSet(poolId, msg.sender, 0, clearedAt);
    }

    function _setReference(PoolId poolId, uint160 sqrtPriceX96) private {
        if (sqrtPriceX96 < TickMath.MIN_SQRT_RATIO || sqrtPriceX96 > TickMath.MAX_SQRT_RATIO) {
            revert PriceOutOfRange(sqrtPriceX96);
        }
        // `uint64` seconds runs to the year 584 billion. The cast cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 updatedAt = uint64(block.timestamp);
        _references[poolId] = Reference({sqrtPriceX96: sqrtPriceX96, updatedAt: updatedAt});
        emit ReferencePriceSet(poolId, msg.sender, sqrtPriceX96, updatedAt);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The raw record for a pool
    function referenceRecord(PoolId poolId) external view returns (Reference memory) {
        return _references[poolId];
    }

    /// @inheritdoc IPriceBandOracle
    function referencePrice(PoolId poolId) external view override returns (uint160 sqrtPriceX96, uint64 updatedAt) {
        Reference storage r = _references[poolId];
        return (r.sqrtPriceX96, r.updatedAt);
    }
}

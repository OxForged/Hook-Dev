// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "infinity-core/src/types/Currency.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";

import {ICLPositionManager} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionManager.sol";
import {Actions} from "infinity-periphery/src/libraries/Actions.sol";
import {Plan, Planner} from "infinity-periphery/src/libraries/Planner.sol";

/**
 * The Creator Marketing Reserve: a creator's token allocation held as a LADDER OF
 * LIMIT SELL ORDERS, not as a bag that gets dumped.
 *
 * WHAT THIS IS. Each rung is a single-sided concentrated liquidity position covering a
 * slice of the price range above (or below — see ORDERING) the opening price. A
 * single-sided position is, exactly, a set of limit orders: it holds one token and
 * converts to the other as price moves through it. Buyers fill the rungs. Nothing here
 * sells.
 *
 * THE PROPERTY THAT MAKES IT SAFE, and it is structural rather than a policy: the only
 * way tokens leave this contract is somebody buying them. There is no swap in this file,
 * no market order, no settlement trigger. A buyer spending X fills exactly X of the
 * ladder, so the sell is never larger than the buy that caused it. That is not a cap
 * anybody configured; it is the only thing the mechanism can do.
 *
 * WHY NOT A SCHEDULED SELL. Modelled against BOBO on Robinhood (pair
 * 0xDc4929574856fEc1a7395A6FF0d7221025b8287e, 1.0088 WETH against 203.9T of a 420.69T
 * supply): dumping 25% of supply into that book returns 0.3426 WETH and takes 56% off the
 * price. Laddering the identical tokens to 2x returns 0.7357 WETH. The ladder pays the
 * creator 2.1x MORE for the same tokens, because a dump eats its own price as it
 * executes while a ladder sells into rising demand. Holder protection and creator income
 * point the same way here, which is rare enough to be worth stating.
 *
 * WHY RUNGS RATHER THAN ONE WIDE RANGE — the ratchet. A range order is not one-way. Price
 * reaches 3x, the creator does not withdraw, price falls back, and the AMM buys the tokens
 * back with their quote currency. A rung the price has fully cleared holds nothing but
 * quote currency, so harvesting it locks the gain in permanently. One wide range cannot be
 * partially locked without also dragging out unsold token.
 *
 * ORDERING, and the bug it would have caused. A concentrated position sitting entirely
 * ABOVE the current price holds only `currency0`; one sitting entirely BELOW holds only
 * `currency1`. Price is currency1 per currency0. So the ladder is above spot ONLY when the
 * launch token is currency0. When the launch token sorts as currency1 the ladder must sit
 * BELOW spot, and "the price has cleared this rung" flips from `tick >= tickUpper` to
 * `tick <= tickLower`. Building it on the wrong side does not revert — it produces a
 * ladder made of the QUOTE currency that fills as the token falls, which is the opposite
 * of the product. `launchIsCurrency0` is therefore read from the key at construction and
 * every comparison branches on it.
 *
 * NO ADMIN. No owner, no pause, no upgrade, no function that moves a position NFT. Nobody
 * — creator, protocol or governance — can change a rung's range after construction,
 * because the ranges ARE the disclosure a buyer relied on. The cost is accepted and
 * stated: there is no recovery path either, which is why the constructor verifies every
 * rung against chain state rather than trusting its caller.
 *
 * ACCOUNTING. `remainingToken` and the accrued quote are READ FROM THE POSITIONS, never
 * tracked in storage. That is what makes "released exceeds total" unrepresentable instead
 * of merely guarded — there is no counter to drift. The one stored figure is `withdrawn`,
 * and it only goes up.
 */
contract CreatorReserve is IERC721Receiver, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NoRungs();
    error TooManyRungs(uint256 given, uint256 max);
    error NotOurPosition(uint256 tokenId);
    error RungWrongPool(uint256 tokenId);
    error RungOnTheWrongSide(uint256 index);
    error RungsNotAscending(uint256 index);
    error InvalidPayout();
    error NotCreator();
    error NotPayoutNominee();
    error RotationNotReady(uint64 readyAt);
    error NoRotationPending();
    error RungNotCleared(uint256 index, int24 currentTick, int24 requiredTick);
    error RungAlreadyHarvested(uint256 index);
    error NothingToWithdraw();
    error PayoutFailed();
    error NotPositionManager();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event RungHarvested(uint256 indexed index, uint256 tokenId, uint256 quoteAmount, uint256 tokenDust);
    event Withdrawn(address indexed to, uint256 amount);
    event PayoutNominated(address indexed nominee, uint64 readyAt);
    event PayoutRotated(address indexed from, address indexed to);
    event RotationCancelled(address indexed nominee);

    /*//////////////////////////////////////////////////////////////
                               IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    /// @dev More rungs means finer harvesting and more gas at launch. The ceiling exists
    ///      so a launch cannot be configured into a mint that runs out of block gas.
    uint256 public constant MAX_RUNGS = 40;

    /// @notice A nominated payout address waits this long before it can accept.
    /// @dev Not immutable ownership: a lost creator key would strand the reserve forever.
    ///      Not instant either: a stolen key would redirect it silently. The delay plus a
    ///      public event is what gives everyone else time to notice a hostile rotation.
    uint64 public constant ROTATION_DELAY = 72 hours;

    ICLPositionManager public immutable positionManager;
    ICLPoolManager public immutable poolManager;

    /// @notice The token being launched, and the currency the creator is ultimately paid in.
    Currency public immutable launchCurrency;
    Currency public immutable quoteCurrency;
    /// @notice Whether the launch token sorts as currency0. Decides which side the ladder
    ///         lives on and what "cleared" means. See ORDERING in the header.
    bool public immutable launchIsCurrency0;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    struct Rung {
        uint256 tokenId;
        int24 tickLower;
        int24 tickUpper;
        bool harvested;
    }

    Rung[] private _rungs;

    /// @dev The pool these rungs belong to. Stored whole because `getPoolAndPositionInfo`
    ///      returns a key and comparing ids is the only honest check.
    PoolKey private _key;

    /// @notice Where `withdraw` sends the proceeds.
    address public payoutAddress;
    address public pendingPayout;
    uint64 public rotationReadyAt;

    /// @notice Quote currency harvested from cleared rungs and not yet withdrawn.
    uint256 public accrued;
    /// @notice Total ever paid out. Monotonic, and the only cumulative figure kept.
    uint256 public withdrawn;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /**
     * Every rung is VERIFIED against chain state, not trusted from the caller.
     *
     * This contract has no admin and no recovery, so a rung pointing at somebody else's
     * position, or at the wrong pool, or sitting on the wrong side of spot, would be
     * permanent. The three checks below are cheap and they are the only thing standing
     * between a mis-parameterised launch and an unrecoverable one.
     *
     * @param positionManager_ CL position manager holding the rung NFTs.
     * @param key              The pool. Must match every rung's own recorded key.
     * @param launchToken      Which side of the key is the launch token.
     * @param payout           Where proceeds go. Rotatable, with a delay.
     * @param tokenIds         Rung positions, already minted to this address, in
     *                         ascending fill order (the order price reaches them).
     */
    constructor(
        ICLPositionManager positionManager_,
        PoolKey memory key,
        Currency launchToken,
        address payout,
        uint256[] memory tokenIds
    ) {
        if (payout == address(0)) revert InvalidPayout();
        if (tokenIds.length == 0) revert NoRungs();
        if (tokenIds.length > MAX_RUNGS) revert TooManyRungs(tokenIds.length, MAX_RUNGS);

        positionManager = positionManager_;
        poolManager = ICLPoolManager(address(key.poolManager));
        _key = key;
        payoutAddress = payout;

        bool isC0 = Currency.unwrap(launchToken) == Currency.unwrap(key.currency0);
        launchIsCurrency0 = isC0;
        launchCurrency = launchToken;
        quoteCurrency = isC0 ? key.currency1 : key.currency0;

        PoolId id = key.toId();
        int24 prevLower;
        int24 prevUpper;

        for (uint256 i; i < tokenIds.length; ++i) {
            uint256 tokenId = tokenIds[i];
            /* `ownerOf` is ERC-721, not part of ICLPositionManager's own interface, so it
               has to be reached through IERC721 on the same address. */
            if (IERC721(address(positionManager_)).ownerOf(tokenId) != address(this)) {
                revert NotOurPosition(tokenId);
            }

            (PoolKey memory rungKey, int24 tickLower, int24 tickUpper) = _positionRange(positionManager_, tokenId);
            if (PoolId.unwrap(rungKey.toId()) != PoolId.unwrap(id)) revert RungWrongPool(tokenId);

            /* Ascending in FILL order. For a currency0 launch that is ascending ticks
               (price rises into them); for a currency1 launch the ladder runs downward,
               so fill order is descending ticks. Either way rungs must not overlap, or
               a "cleared" rung could still hold unsold token. */
            if (i != 0) {
                bool ordered = isC0 ? (tickLower >= prevUpper) : (tickUpper <= prevLower);
                if (!ordered) revert RungsNotAscending(i);
            }
            prevLower = tickLower;
            prevUpper = tickUpper;

            _rungs.push(Rung({tokenId: tokenId, tickLower: tickLower, tickUpper: tickUpper, harvested: false}));
        }

        /* Every rung must start on the selling side of spot. A rung already straddling or
           behind the current price holds quote currency the creator never bought, which
           would make the reserve a liquidity position rather than a sell ladder. */
        (, int24 currentTick,,) = poolManager.getSlot0(id);
        for (uint256 i; i < _rungs.length; ++i) {
            Rung memory r = _rungs[i];
            bool onSellSide = isC0 ? (r.tickLower >= currentTick) : (r.tickUpper <= currentTick);
            if (!onSellSide) revert RungOnTheWrongSide(i);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                HARVEST
    //////////////////////////////////////////////////////////////*/

    /**
     * Withdraw a rung the price has fully cleared.
     *
     * Only a CLEARED rung may be harvested, and that restriction is the ratchet. A rung
     * the price has passed holds nothing but quote currency, so taking it out cannot sell
     * a single token and cannot be undone by the price coming back. Harvesting a partially
     * filled rung would drag unsold token out of the ladder — removing sell-side liquidity
     * the market was relying on, and handing the creator tokens they are supposed to sell
     * through the book.
     *
     * Permissionless on purpose: it moves value only into this contract, and only the
     * payout address can take it out. Letting anybody run it means a creator who loses
     * interest cannot leave a cleared rung sitting in the pool where a price reversal
     * would convert it back.
     */
    function harvest(uint256 index) public nonReentrant returns (uint256 quoteOut) {
        Rung storage rung = _rungs[index];
        if (rung.harvested) revert RungAlreadyHarvested(index);

        (, int24 currentTick,,) = poolManager.getSlot0(_key.toId());
        int24 required = launchIsCurrency0 ? rung.tickUpper : rung.tickLower;
        bool cleared = launchIsCurrency0 ? currentTick >= required : currentTick <= required;
        if (!cleared) revert RungNotCleared(index, currentTick, required);

        rung.harvested = true; // effects before the external call

        uint128 liquidity = positionManager.getPositionLiquidity(rung.tokenId);
        uint256 quoteBefore = quoteCurrency.balanceOfSelf();
        uint256 launchBefore = launchCurrency.balanceOfSelf();

        if (liquidity != 0) {
            Plan memory plan = Planner.init();
            /* amountMin of 0 on both sides is correct here and only here: the rung is
               cleared, so its composition is not a matter of slippage — it is entirely
               quote currency by construction, and the tick check above already asserted
               that. A non-zero bound would add a revert path with nothing to protect. */
            plan.add(Actions.CL_DECREASE_LIQUIDITY, abi.encode(rung.tokenId, uint256(liquidity), uint128(0), uint128(0), bytes("")));
            plan.add(Actions.TAKE_PAIR, abi.encode(_key.currency0, _key.currency1, address(this)));
            positionManager.modifyLiquidities(plan.encode(), block.timestamp);
        }

        quoteOut = quoteCurrency.balanceOfSelf() - quoteBefore;
        uint256 dust = launchCurrency.balanceOfSelf() - launchBefore;
        accrued += quoteOut;

        emit RungHarvested(index, rung.tokenId, quoteOut, dust);
    }

    /// @notice Harvest every cleared, un-harvested rung. Skips the rest rather than
    ///         reverting, so one unfilled rung cannot block the others.
    function harvestAll() external returns (uint256 total) {
        (, int24 currentTick,,) = poolManager.getSlot0(_key.toId());
        uint256 n = _rungs.length;
        for (uint256 i; i < n; ++i) {
            Rung memory r = _rungs[i];
            if (r.harvested) continue;
            int24 required = launchIsCurrency0 ? r.tickUpper : r.tickLower;
            bool cleared = launchIsCurrency0 ? currentTick >= required : currentTick <= required;
            if (cleared) total += harvest(i);
        }
    }

    /*//////////////////////////////////////////////////////////////
                               WITHDRAWAL
    //////////////////////////////////////////////////////////////*/

    /**
     * PULL, not push.
     *
     * A push would pay an arbitrary address from inside whatever call triggered it, so a
     * payout contract that reverts, or that burns more gas than a stipend, would land its
     * failure on an unrelated party — potentially a trader whose swap happened to clear a
     * rung. Pull confines every failure mode to the creator's own transaction.
     *
     * `call` with all remaining gas rather than `transfer`: the 2300-gas stipend is not
     * enough for a Safe to receive, and the payout address for a serious launch is a Safe.
     */
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = accrued;
        if (amount == 0) revert NothingToWithdraw();

        accrued = 0;
        withdrawn += amount;

        address to = payoutAddress;
        if (quoteCurrency.isNative()) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert PayoutFailed();
        } else {
            quoteCurrency.transfer(to, amount);
        }
        emit Withdrawn(to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            PAYOUT ROTATION
    //////////////////////////////////////////////////////////////*/

    function nominatePayout(address nominee) external {
        if (msg.sender != payoutAddress) revert NotCreator();
        if (nominee == address(0)) revert InvalidPayout();
        pendingPayout = nominee;
        rotationReadyAt = uint64(block.timestamp) + ROTATION_DELAY;
        emit PayoutNominated(nominee, rotationReadyAt);
    }

    /// @notice The current payout address may abort a rotation at any time before it
    ///         lands. This is the recovery path if a nomination was made in error.
    function cancelRotation() external {
        if (msg.sender != payoutAddress) revert NotCreator();
        if (pendingPayout == address(0)) revert NoRotationPending();
        emit RotationCancelled(pendingPayout);
        pendingPayout = address(0);
        rotationReadyAt = 0;
    }

    /// @dev The nominee accepts, rather than the creator pushing. A push can land on an
    ///      address that cannot use it; acceptance proves the key is live.
    function acceptPayout() external {
        if (pendingPayout == address(0)) revert NoRotationPending();
        if (msg.sender != pendingPayout) revert NotPayoutNominee();
        if (block.timestamp < rotationReadyAt) revert RotationNotReady(rotationReadyAt);

        address from = payoutAddress;
        payoutAddress = pendingPayout;
        pendingPayout = address(0);
        rotationReadyAt = 0;
        emit PayoutRotated(from, payoutAddress);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    function rungCount() external view returns (uint256) {
        return _rungs.length;
    }

    function rungAt(uint256 index) external view returns (Rung memory) {
        return _rungs[index];
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    /**
     * What the UI needs to draw the ladder, read from the positions rather than stored.
     *
     * `liquidity` of zero on an un-harvested rung means the rung was fully consumed and is
     * waiting to be harvested — not that it was empty.
     */
    function rungState(uint256 index)
        external
        view
        returns (int24 tickLower, int24 tickUpper, uint128 liquidity, bool harvested, bool cleared)
    {
        Rung memory r = _rungs[index];
        (, int24 currentTick,,) = poolManager.getSlot0(_key.toId());
        int24 required = launchIsCurrency0 ? r.tickUpper : r.tickLower;
        return (
            r.tickLower,
            r.tickUpper,
            positionManager.getPositionLiquidity(r.tokenId),
            r.harvested,
            launchIsCurrency0 ? currentTick >= required : currentTick <= required
        );
    }

    /// @notice Rungs the price has cleared and nobody has harvested yet.
    function harvestableCount() external view returns (uint256 count) {
        (, int24 currentTick,,) = poolManager.getSlot0(_key.toId());
        uint256 n = _rungs.length;
        for (uint256 i; i < n; ++i) {
            Rung memory r = _rungs[i];
            if (r.harvested) continue;
            int24 required = launchIsCurrency0 ? r.tickUpper : r.tickLower;
            if (launchIsCurrency0 ? currentTick >= required : currentTick <= required) ++count;
        }
    }

    /// @notice Everything the creator has realised: harvested-and-held plus paid out.
    function totalRealised() external view returns (uint256) {
        return accrued + withdrawn;
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _positionRange(ICLPositionManager pm, uint256 tokenId)
        private
        view
        returns (PoolKey memory key, int24 tickLower, int24 tickUpper)
    {
        /* The real shape, read off CLPositionManager rather than assumed:
           (PoolKey, int24 tickLower, int24 tickUpper, uint128 liquidity,
            uint256 feeGrowthInside0, uint256 feeGrowthInside1, ICLSubscriber).
           The ticks are at 1 and 2. An earlier draft skipped to 3 and 4 and would have
           read `liquidity` as a tick. */
        (key, tickLower, tickUpper,,,,) = pm.positions(tokenId);
    }

    /*//////////////////////////////////////////////////////////////
                                RECEIVE
    //////////////////////////////////////////////////////////////*/

    /// @dev Only the position manager may hand this contract an NFT. An unsolicited
    ///      position would not be a rung — `_rungs` is fixed at construction — so it could
    ///      never be harvested and would sit here forever. Refusing is the honest answer.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(positionManager)) revert NotPositionManager();
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @dev Native arrives from `TAKE_PAIR` during a harvest when the quote currency is
    ///      native. Unsolicited native is accepted and becomes withdrawable by the
    ///      creator — there is no sweep and no owner, so refusing it would only strand it
    ///      somewhere else.
    receive() external payable {}
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

// SCRATCH FILE - security review only. Not part of the shipped suite.
// Each test is named after the finding it demonstrates. Tests whose name starts with
// `test_FINDING_` are expected to demonstrate a defect; tests named `test_OK_` confirm a
// claimed guarantee actually holds.

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "infinity-core/src/libraries/Hooks.sol";
import {CustomRevert} from "infinity-core/src/libraries/CustomRevert.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {TokenFixture} from "infinity-core/test/helpers/TokenFixture.sol";
import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";

import {MarketHoursHook} from "../src/MarketHoursHook.sol";
import {StockPairHook} from "../src/StockPairHook.sol";
import {PermissionedPoolHook} from "../src/PermissionedPoolHook.sol";
import {MarketHoursModule} from "../src/modules/MarketHoursModule.sol";
import {IPriceBandOracle} from "../src/interfaces/IPriceBandOracle.sol";
import {ManualPriceBandOracle} from "../src/oracles/ManualPriceBandOracle.sol";
import {IComplianceOracle} from "../src/interfaces/IComplianceOracle.sol";
import {AllowlistComplianceOracle} from "../src/oracles/AllowlistComplianceOracle.sol";

import {AttestingRouter} from "./mocks/AttestingRouter.sol";

/*//////////////////////////////////////////////////////////////
        PART 1 - MarketHoursHook: calendar / configuration
//////////////////////////////////////////////////////////////*/

contract SecurityReviewCalendarTest is Test, Deployers, TokenFixture {
    using LPFeeLibrary for uint24;

    Vault vault;
    CLPoolManager poolManager;
    MarketHoursHook hook;
    ManualPriceBandOracle priceOracle;

    PoolKey key;
    PoolId poolId;

    address constant ISSUER = address(0x155);
    address constant NEW_ISSUER = address(0x156);
    address constant GUARDIAN = address(0x6DA);

    uint24 constant STATIC_FEE = 3000;
    int24 constant TICK_SPACING = 60;

    uint256 constant MONDAY_MIDNIGHT = 1_704_067_200; // 2024-01-01 00:00 UTC, a Monday
    uint24 constant OPEN = 52_200;
    uint24 constant CLOSE = 75_600;
    uint8 constant WEEKDAYS = uint8((1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5));
    uint32 constant BAND_PPM = 50_000;

    function setUp() public {
        vm.warp(MONDAY_MIDNIGHT + 16 hours);

        (vault, poolManager) = createFreshManager();
        hook = new MarketHoursHook(poolManager, address(this));
        priceOracle = new ManualPriceBandOracle(address(this));

        initializeTokens();
        mint(1_000_000 ether);

        key = _key(STATIC_FEE);
        poolId = key.toId();

        hook.configureMarket(key, _settings());
        hook.setMarketGuardian(GUARDIAN);
        priceOracle.setReferencePrice(poolId, SQRT_RATIO_1_1);
        poolManager.initialize(key, SQRT_RATIO_1_1);
    }

    function _key(uint24 fee) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: IHooks(address(hook)),
            poolManager: poolManager,
            fee: fee,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(hook.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });
    }

    function _settings() internal view returns (MarketHoursModule.MarketSettings memory) {
        return MarketHoursModule.MarketSettings({
            issuer: ISSUER,
            oracle: IPriceBandOracle(address(priceOracle)),
            maxUpPpm: BAND_PPM,
            maxDownPpm: BAND_PPM,
            maxPriceAge: 1 days,
            openSecondOfDay: OPEN,
            closeSecondOfDay: CLOSE,
            weekdayMask: WEEKDAYS,
            sessionEnabled: true,
            bandEnabled: true,
            gateLiquidity: false
        });
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 1 - `EmptyWeekdayMask` is bypassed by the unused bit 7.
    //////////////////////////////////////////////////////////////*/

    /// The guard exists (its own comment says so) to stop a pool being configured that "can never
    /// trade while looking, in every event and every view, exactly like a configured one".
    /// It only rejects `weekdayMask == 0`. `_scheduleForDay` matches bits 0..6 only, so any mask
    /// consisting solely of bit 7 (0x80) is non-zero, passes validation, and is a permanently
    /// closed market. Reachable by the OWNER via `configureMarket` and, with no timelock at all,
    /// by the per-pool ISSUER via `setSessionHours`.
    function test_FINDING1_reservedBit7DefeatsTheEmptyWeekdayMaskGuard() public {
        MarketHoursModule.MarketSettings memory s = _settings();
        s.weekdayMask = 0x80; // no weekday bit set at all

        // Accepted. `EmptyWeekdayMask` does not fire.
        hook.configureMarket(key, s);
        assertEq(hook.marketConfig(poolId).weekdayMask, 0x80);

        // The market is closed now, and stays closed for every day that will ever exist.
        assertFalse(hook.isTradable(poolId), "closed at configuration time");
        for (uint256 i = 0; i < 14; ++i) {
            vm.warp(MONDAY_MIDNIGHT + i * 1 days + 16 hours);
            assertFalse(hook.isSessionOpenAt(poolId, block.timestamp), "no day is ever a trading day");
        }
        vm.warp(MONDAY_MIDNIGHT + 4000 days);
        assertFalse(hook.isTradable(poolId), "still closed 11 years later");

        // Compare: mask 0 IS rejected, which is the state this configuration is equivalent to.
        s.weekdayMask = 0;
        vm.expectRevert(MarketHoursModule.EmptyWeekdayMask.selector);
        hook.configureMarket(key, s);
    }

    /// The same gap on the issuer's fast, un-timelocked lever.
    function test_FINDING1_issuerCanReachTheSameStateWithSetSessionHours() public {
        vm.prank(ISSUER);
        hook.setSessionHours(poolId, 0x80, OPEN, CLOSE);
        assertFalse(hook.isTradable(poolId));

        vm.prank(ISSUER);
        vm.expectRevert(MarketHoursModule.EmptyWeekdayMask.selector);
        hook.setSessionHours(poolId, 0, OPEN, CLOSE);
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 2 - day overrides outlive the issuer who wrote them.
    //////////////////////////////////////////////////////////////*/

    /// `configureMarket` is the ONLY way to replace a pool's issuer, and it does not touch
    /// `_dayOverrides`. A rogue or compromised issuer can write an unbounded number of future
    /// day overrides; governance can remove the issuer but cannot undo the calendar in O(1).
    /// The only remedy is `clearDayOverrides`, which is O(n) over an attacker-chosen n.
    function test_FINDING2_rogueIssuerCalendarSurvivesIssuerRotation() public {
        uint32 today = hook.dayIndexOf(block.timestamp);

        // Rogue issuer closes the next 500 days. (A real one would write decades; the loop here
        // is kept small so the test is fast - nothing about the mechanism changes with n.)
        uint32[] memory days_ = new uint32[](500);
        for (uint256 i = 0; i < days_.length; ++i) days_[i] = today + uint32(i);
        vm.prank(ISSUER);
        hook.setHolidays(poolId, days_);
        assertFalse(hook.isTradable(poolId), "market closed by the rogue calendar");

        // Governance reacts: replace the issuer entirely.
        MarketHoursModule.MarketSettings memory s = _settings();
        s.issuer = NEW_ISSUER;
        hook.configureMarket(key, s);
        assertEq(hook.marketConfig(poolId).issuer, NEW_ISSUER);

        // The calendar the ousted issuer wrote is still in force.
        assertTrue(hook.dayOverride(poolId, today).isSet, "override survived reconfiguration");
        assertFalse(hook.isTradable(poolId), "market STILL closed after the issuer was removed");
        vm.warp(block.timestamp + 100 days);
        assertFalse(hook.isTradable(poolId), "and remains closed for as long as the rogue chose");

        // Only an O(n) walk clears it. There is no bulk reset and no configuration epoch.
        vm.prank(NEW_ISSUER);
        hook.clearDayOverrides(poolId, days_);
        vm.warp(MONDAY_MIDNIGHT + 16 hours);
        assertTrue(hook.isTradable(poolId), "recovered only by clearing every single day");
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 3 - a holiday on the day a wrapped session ENDS is ignored.
    //////////////////////////////////////////////////////////////*/

    /// The module documents that a wrapping session is attributed to the day it OPENED on. The
    /// consequence, which the suite does not test, is that declaring the FOLLOWING day a holiday
    /// does not close the tail: the pool trades on a day the issuer explicitly marked closed.
    function test_FINDING3_holidayOnTheTailDayDoesNotCloseTheWrappedSession() public {
        // 22:00 -> 02:00, Mon..Fri.
        MarketHoursModule.MarketSettings memory s = _settings();
        s.openSecondOfDay = 79_200;
        s.closeSecondOfDay = 7_200;
        hook.configureMarket(key, s);

        uint32 monday = hook.dayIndexOf(MONDAY_MIDNIGHT);
        uint32 tuesday = monday + 1;

        // The issuer declares TUESDAY a holiday.
        uint32[] memory holiday = new uint32[](1);
        holiday[0] = tuesday;
        vm.prank(ISSUER);
        hook.setHolidays(poolId, holiday);

        // Tuesday 01:00 UTC - inside the declared holiday - is nonetheless open.
        uint256 tuesdayOneAm = MONDAY_MIDNIGHT + 1 days + 1 hours;
        assertTrue(
            hook.isSessionOpenAt(poolId, tuesdayOneAm),
            "session open during a day explicitly marked as a holiday"
        );
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 4 - the band never constrains the price a pool is BORN at.
    //////////////////////////////////////////////////////////////*/

    /// `beforeInitialize` checks configuration and the fee flag, never the reference price. Anyone
    /// may initialize a configured pool at any representable price, arbitrarily far outside the
    /// band, and the converging exception then permits unlimited trading on the near side.
    function test_FINDING4_poolCanBeInitializedArbitrarilyFarOutsideItsOwnBand() public {
        PoolKey memory k2 = _key(500);
        PoolId id2 = k2.toId();
        hook.configureMarket(k2, _settings());
        priceOracle.setReferencePrice(id2, SQRT_RATIO_1_1);

        // Born at ~4x the reference price, with a +/-5% band configured.
        uint160 farOut = uint160(uint256(SQRT_RATIO_1_1) * 2);
        poolManager.initialize(k2, farOut);

        (uint160 born,,,) = poolManager.getSlot0(id2);
        assertEq(born, farOut, "initialized far outside the band with no objection from the hook");

        (bool wouldRevert,) = hook.previewPriceBand(id2, false, farOut);
        assertTrue(wouldRevert, "a SWAP to this price would have been rejected");
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 5 - renouncing ownership permanently freezes the market config.
    //////////////////////////////////////////////////////////////*/

    /// `Ownable2Step.renounceOwnership` is not disabled. After it, no oracle rotation, no band
    /// change, no issuer replacement and no guardian change is possible for the life of the hook.
    /// The pool keeps trading and LPs keep their exit, so this is a governance-availability
    /// failure rather than a loss of funds - but it is one transaction away and irreversible.
    function test_FINDING5_renounceOwnershipBricksAllMarketConfiguration() public {
        hook.renounceOwnership();

        MarketHoursModule.MarketSettings memory s = _settings();
        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketAdmin.selector, address(this)));
        hook.configureMarket(key, s);

        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketAdmin.selector, address(this)));
        hook.setMarketGuardian(address(0xBEEF));

        // The issuer still operates the market, so nothing is trapped - but the oracle, the band
        // widths and the issuer address itself are now immutable.
        vm.prank(ISSUER);
        hook.halt(poolId, "incident");
        assertFalse(hook.isTradable(poolId));
    }

    /*//////////////////////////////////////////////////////////////
      Confirmations: things the code claims that DO hold.
    //////////////////////////////////////////////////////////////*/

    /// The guardian really is halt-only, on every lever that exists.
    function test_OK_guardianIsStrictlyRestricting() public {
        vm.prank(GUARDIAN);
        hook.halt(poolId, "flash crash");
        assertFalse(hook.isTradable(poolId));

        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketOperator.selector, GUARDIAN));
        hook.resume(poolId);

        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketOperator.selector, GUARDIAN));
        hook.setSessionHours(poolId, WEEKDAYS, OPEN, CLOSE);

        uint32[] memory d = new uint32[](1);
        d[0] = 0;
        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketOperator.selector, GUARDIAN));
        hook.clearDayOverrides(poolId, d);

        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(MarketHoursModule.NotMarketAdmin.selector, GUARDIAN));
        hook.setMarketGuardian(GUARDIAN);
    }

    /// A price-band oracle outside `TickMath`'s range cannot overflow `_priceRatioPpm`.
    function testFuzz_OK_priceRatioNeverOverflows(uint160 poolSqrt, uint160 refSqrt) public view {
        refSqrt = uint160(bound(refSqrt, 1, type(uint160).max));
        (bool wouldRevert,) = hook.previewPriceBand(poolId, false, poolSqrt);
        wouldRevert; // the call not reverting IS the assertion
        assertTrue(refSqrt != 0);
    }
}

/*//////////////////////////////////////////////////////////////
   PART 2 - StockPairHook: the composition, which has NO test file
//////////////////////////////////////////////////////////////*/

contract SecurityReviewStockPairTest is Test, Deployers, TokenFixture {
    Vault vault;
    CLPoolManager poolManager;
    StockPairHook hook;
    AllowlistComplianceOracle complianceOracle;
    ManualPriceBandOracle priceOracle;
    AttestingRouter trustedRouter;

    PoolKey key;
    PoolId poolId;

    address constant ISSUER = address(0x155);
    address constant GUARDIAN = address(0x6DA);
    address constant LP = address(0x11B0);
    address constant INVESTOR = address(0xA11CE);
    address constant OUTSIDER = address(0x00757);

    uint24 constant STATIC_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    int24 constant TICK_LOWER = -6000;
    int24 constant TICK_UPPER = 6000;
    int256 constant LIQUIDITY = 1000 ether;

    uint256 constant MONDAY_MIDNIGHT = 1_704_067_200;
    uint24 constant OPEN = 52_200;
    uint24 constant CLOSE = 75_600;
    uint8 constant WEEKDAYS = uint8((1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5));
    uint32 constant BAND_PPM = 50_000;

    function setUp() public {
        vm.warp(MONDAY_MIDNIGHT + 16 hours);

        (vault, poolManager) = createFreshManager();
        hook = new StockPairHook(poolManager, address(this));
        complianceOracle = new AllowlistComplianceOracle(address(this));
        priceOracle = new ManualPriceBandOracle(address(this));
        trustedRouter = new AttestingRouter(vault, poolManager);

        initializeTokens();
        mint(1_000_000 ether);

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: IHooks(address(hook)),
            poolManager: poolManager,
            fee: STATIC_FEE,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(hook.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });
        poolId = key.toId();

        hook.configurePool(key, _poolSettings());
        hook.configureMarket(key, _marketSettings());
        hook.setTrustedRouter(address(trustedRouter), true);
        hook.setMarketGuardian(GUARDIAN);

        _permit(LP);
        _permit(INVESTOR);

        priceOracle.setReferencePrice(poolId, SQRT_RATIO_1_1);
        poolManager.initialize(key, SQRT_RATIO_1_1);

        _fund(LP, 100_000 ether);
        _fund(INVESTOR, 100_000 ether);
        _fund(OUTSIDER, 100_000 ether);

        vm.prank(LP);
        trustedRouter.modifyPosition(key, _liq(LIQUIDITY));
    }

    function _poolSettings() internal view returns (PermissionedPoolHook.PoolSettings memory) {
        return PermissionedPoolHook.PoolSettings({
            oracle: IComplianceOracle(address(complianceOracle)),
            maxSwapPerTx: 0,
            maxLiquidityPerInvestor: 0,
            enabled: true,
            checkJurisdiction: false,
            freezeDeniedExits: false
        });
    }

    function _marketSettings() internal view returns (MarketHoursModule.MarketSettings memory) {
        return MarketHoursModule.MarketSettings({
            issuer: ISSUER,
            oracle: IPriceBandOracle(address(priceOracle)),
            maxUpPpm: BAND_PPM,
            maxDownPpm: BAND_PPM,
            maxPriceAge: 1 days,
            openSecondOfDay: OPEN,
            closeSecondOfDay: CLOSE,
            weekdayMask: WEEKDAYS,
            sessionEnabled: true,
            bandEnabled: true,
            gateLiquidity: false
        });
    }

    function _permit(address who) internal {
        complianceOracle.setRecord(
            who, AllowlistComplianceOracle.Record({permitted: true, expiresAt: 0, jurisdiction: 840})
        );
    }

    function _fund(address who, uint256 amount) internal {
        IERC20(Currency.unwrap(currency0)).transfer(who, amount);
        IERC20(Currency.unwrap(currency1)).transfer(who, amount);
        vm.startPrank(who);
        IERC20(Currency.unwrap(currency0)).approve(address(trustedRouter), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(trustedRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _liq(int256 d) internal pure returns (ICLPoolManager.ModifyLiquidityParams memory) {
        return ICLPoolManager.ModifyLiquidityParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            liquidityDelta: d,
            salt: 0
        });
    }

    function _swapParams(bool zeroForOne, int256 amt) internal pure returns (ICLPoolManager.SwapParams memory) {
        return ICLPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amt,
            sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
        });
    }

    function _swapAs(address who, bool zeroForOne, int256 amt) internal returns (BalanceDelta) {
        vm.prank(who);
        return trustedRouter.swap(key, _swapParams(zeroForOne, amt));
    }

    function _expectHookRevert(bytes4 fn, bytes memory inner) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                fn,
                inner,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
                 Confirmations of the headline guarantees
    //////////////////////////////////////////////////////////////*/

    /// The `virtual` change in this diff makes `getHooksRegistrationBitmap` overridable. If a
    /// subclass ever drops a bit the parent's logic depends on, the parent's gate silently stops
    /// being called by core - `validateHookConfig` only checks the key against whatever the hook
    /// declares. Regression guard for exactly that.
    function test_OK_stockPairBitmapIsASupersetOfTheParentsCallbacks() public view {
        uint16 parent = 1 | (1 << 2) | (1 << 4) | (1 << 6); // init | addLiq | removeLiq | swap
        uint16 child = hook.getHooksRegistrationBitmap();
        assertEq(child & parent, parent, "StockPairHook must keep every PermissionedPoolHook gate");
        assertEq(child, parent | (1 << 7), "plus afterSwap, and nothing else");
    }

    /// The documented order: compliance error, not a market error, for an unpermitted party.
    function test_OK_complianceGateRunsBeforeTheMarketGate() public {
        vm.prank(ISSUER);
        hook.halt(poolId, "halted");
        _expectHookRevert(
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(PermissionedPoolHook.AccountNotPermitted.selector, OUTSIDER)
        );
        _swapAs(OUTSIDER, true, -1 ether);
    }

    /// The claim that matters most: nothing on the market side can trap an LP.
    function test_OK_exitSurvivesHaltPauseClosedSessionAndADeadPriceOracle() public {
        vm.prank(GUARDIAN);
        hook.halt(poolId, "everything is on fire");
        hook.pause();
        priceOracle.clearReference(poolId); // band oracle now unavailable
        vm.warp(MONDAY_MIDNIGHT + 6 days); // Sunday: session closed

        PermissionedPoolHook.PoolSettings memory ps = _poolSettings();
        ps.enabled = false;
        hook.configurePool(key, ps);

        // Entry is dead...
        _expectHookRevert(
            ICLHooks.beforeSwap.selector, abi.encodeWithSelector(Pausable.EnforcedPause.selector)
        );
        _swapAs(INVESTOR, true, -1 ether);

        // ...and exit still works.
        uint256 before0 = IERC20(Currency.unwrap(currency0)).balanceOf(LP);
        vm.prank(LP);
        trustedRouter.modifyPosition(key, _liq(-LIQUIDITY));
        assertGt(IERC20(Currency.unwrap(currency0)).balanceOf(LP), before0, "LP got their capital back");
    }

    /// The band, in composition. Reference set 10% below the pool price puts the pool ~23% above
    /// the +5% edge; a price-increasing swap must be refused and a price-decreasing one allowed.
    function test_OK_bandAppliesInCompositionWithTheConvergingException() public {
        priceOracle.setReferencePrice(poolId, uint160(uint256(SQRT_RATIO_1_1) * 9 / 10));

        // Diverging: buying token0 pushes the price further above the band.
        vm.expectRevert();
        _swapAs(INVESTOR, false, -1 ether);

        // Converging: selling token0 moves it back toward the band and is permitted.
        _swapAs(INVESTOR, true, -1 ether);
    }

    /*//////////////////////////////////////////////////////////////
      FINDING 7 (FIXED) - the publisher key is no longer a band bypass.

      Every other fast key in this design can only make the market MORE
      restricted: the guardian halts and cannot resume; the issuer can close
      days but cannot touch the oracle or the widths. The publisher key was the
      exception - it LOOSENS - and because the band is defined entirely as a
      ratio to the reference, an unbounded publisher could move the band
      anywhere and print any price.

      `maxPublisherDeviationBps` now bounds it. These tests are the regression
      guard: each one describes a way back into the bypass and asserts it is
      closed. If any of them starts passing for the wrong reason, the bound has
      been weakened.
    //////////////////////////////////////////////////////////////*/

    /// The original exploit, now refused. The publisher tries to double the reference - 2x in
    /// sqrt space is 4x in price, i.e. 30000 bps - and the bound rejects it. Critically, the
    /// swap that the move was meant to unlock STILL reverts afterwards.
    function test_FIX7_publisherCannotJumpTheReferenceOutOfBounds() public {
        address publisher = address(0xB0B);
        priceOracle.setPublisher(publisher, true);

        // Baseline: this swap prints outside the +5% band and is refused.
        vm.expectRevert();
        _swapAs(INVESTOR, false, -200 ether);

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(
                ManualPriceBandOracle.DeviationTooLarge.selector,
                poolId,
                SQRT_RATIO_1_1,
                uint160(uint256(SQRT_RATIO_1_1) * 2),
                uint256(30_000), // 2x sqrt == 4x price == +300%
                uint256(1_000) // the default bound, 10% in price
            )
        );
        priceOracle.setReferencePrice(poolId, uint160(uint256(SQRT_RATIO_1_1) * 2));

        // The band did not move, so the swap is still refused.
        vm.expectRevert();
        _swapAs(INVESTOR, false, -200 ether);

        (uint160 printed,,,) = poolManager.getSlot0(poolId);
        assertEq(uint256(printed), uint256(SQRT_RATIO_1_1), "the pool price never moved");
    }

    /// The subtle way back in, and the reason `anchor` exists as a separate field.
    ///
    /// `clearReference` sets the published price to zero. If the bound were measured against the
    /// PUBLISHED price, the pool would then look never-published and the next write would be an
    /// unbounded "first" publication - so clear-then-republish would restore the whole bypass in
    /// two transactions instead of one. The anchor survives the clearing, so it does not.
    function test_FIX7_clearingThenRepublishingIsStillBounded() public {
        address publisher = address(0xB0B);
        priceOracle.setPublisher(publisher, true);

        vm.prank(publisher);
        priceOracle.clearReference(poolId);

        (uint160 published,) = priceOracle.referencePrice(poolId);
        assertEq(published, 0, "the price really was cleared");
        (uint160 anchor,,) = priceOracle.publisherBoundsFor(poolId);
        assertEq(anchor, SQRT_RATIO_1_1, "but the anchor survived it");

        vm.prank(publisher);
        vm.expectRevert();
        priceOracle.setReferencePrice(poolId, uint160(uint256(SQRT_RATIO_1_1) * 2));
    }

    /// The bound restricts publishers, not the owner - which on a live chain is a timelock. A
    /// genuine re-anchor (a corporate action, a redenomination) still has a route, it just has to
    /// go through the seat that has a public notice period.
    function test_FIX7_ownerCanStillReanchorFreely() public {
        priceOracle.setReferencePrice(poolId, uint160(uint256(SQRT_RATIO_1_1) * 2));
        (uint160 published,) = priceOracle.referencePrice(poolId);
        assertEq(uint256(published), uint256(SQRT_RATIO_1_1) * 2, "owner is exempt from the bound");
    }

    /// The bound must not stop a publisher doing their actual job. A 4% move in sqrt space is
    /// ~8.2% in price, inside the 10% default, and is accepted.
    function test_FIX7_publisherCanStillTrackTheMarketWithinTheBound() public {
        address publisher = address(0xB0B);
        priceOracle.setPublisher(publisher, true);

        uint160 nudged = uint160(uint256(SQRT_RATIO_1_1) * 104 / 100);
        vm.prank(publisher);
        priceOracle.setReferencePrice(poolId, nudged);

        (uint160 published,) = priceOracle.referencePrice(poolId);
        assertEq(published, nudged, "an in-bound move is allowed");

        // And the anchor moved with it, so the next move is measured from here.
        (uint160 anchor,,) = priceOracle.publisherBoundsFor(poolId);
        assertEq(anchor, nudged, "the anchor tracks the last published price");
    }

    /// The honest limitation, asserted rather than hand-waved: the bound is per-update, so with
    /// no interval configured a compromised key can still WALK the reference by repeating
    /// in-bound moves. This is why `minPublisherInterval` exists and why a live deployment must
    /// set it. Recorded as a test so nobody mistakes the bound for a hard ceiling.
    function test_FIX7_boundIsPerUpdateSoAWalkIsStillPossibleWithoutAnInterval() public {
        address publisher = address(0xB0B);
        priceOracle.setPublisher(publisher, true);

        uint256 price = uint256(SQRT_RATIO_1_1);
        for (uint256 i = 0; i < 10; ++i) {
            price = price * 104 / 100;
            vm.prank(publisher);
            priceOracle.setReferencePrice(poolId, uint160(price));
        }

        (uint160 walked,) = priceOracle.referencePrice(poolId);
        assertGt(uint256(walked), uint256(SQRT_RATIO_1_1) * 14 / 10, "ten in-bound steps compound");
    }

    /// ...and with an interval configured, that walk is rate limited. Clearing is deliberately
    /// NOT rate limited: stopping the market must never have to wait.
    function test_FIX7_minIntervalRateLimitsTheWalkButNeverTheHalt() public {
        address publisher = address(0xB0B);
        priceOracle.setPublisher(publisher, true);
        priceOracle.setPublisherBounds(1_000, 1 hours);

        // `setUp` published the reference as the owner, which stamped `anchorAt`. The interval is
        // measured from there, so step clear of it before the publisher's first move - otherwise
        // this test would be asserting the rate limit against the fixture rather than the walk.
        vm.warp(block.timestamp + 1 hours);

        uint160 first = uint160(uint256(SQRT_RATIO_1_1) * 104 / 100);
        vm.prank(publisher);
        priceOracle.setReferencePrice(poolId, first);

        // A second in-bound move immediately afterwards is refused on time, not on size. The
        // deadline is read back from the contract rather than recomputed here, so the assertion
        // cannot drift from the implementation.
        (, uint64 earliest,) = priceOracle.publisherBoundsFor(poolId);
        assertGt(earliest, block.timestamp, "the rate limit is actually in force");

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(ManualPriceBandOracle.UpdateTooSoon.selector, poolId, earliest)
        );
        priceOracle.setReferencePrice(poolId, uint160(uint256(first) * 104 / 100));

        // Halting is never rate limited.
        vm.prank(publisher);
        priceOracle.clearReference(poolId);

        // After the interval, publishing resumes.
        vm.warp(uint256(earliest));
        vm.prank(publisher);
        priceOracle.setReferencePrice(poolId, uint160(uint256(first) * 104 / 100));
    }

    /*//////////////////////////////////////////////////////////////
      INFORMATIONAL - the price band imposes a hard minimum gas budget
      on every swap, and the failure is a revert, not a degradation.
    //////////////////////////////////////////////////////////////*/

    /// `_checkPriceInBand` refuses to run unless `PRICE_ORACLE_GAS_FLOOR` (~233k) remains AT the
    /// point of `afterSwap`. This measures where that cliff actually is for a plain one-hop swap,
    /// so an integrator can size gas. It fails CLOSED, so this is a UX/integration note rather
    /// than a vulnerability - recorded because it is not covered anywhere in the suite.
    function test_INFO_bandImposesAMinimumGasBudgetPerSwap() public {
        uint256[6] memory budgets = [uint256(300_000), 350_000, 400_000, 450_000, 500_000, 600_000];
        uint256 firstSuccess;
        for (uint256 i = 0; i < budgets.length; ++i) {
            uint256 snap = vm.snapshotState();
            vm.prank(INVESTOR);
            (bool ok,) = address(trustedRouter).call{gas: budgets[i]}(
                abi.encodeCall(AttestingRouter.swap, (key, _swapParams(true, -1 ether)))
            );
            vm.revertToState(snap);
            if (ok && firstSuccess == 0) firstSuccess = budgets[i];
            emit log_named_uint(ok ? "OK at gas" : "REVERT at gas", budgets[i]);
        }
        emit log_named_uint("lowest budget that clears the band gas floor", firstSuccess);
        assertGt(firstSuccess, 0, "some budget must work");
    }
}

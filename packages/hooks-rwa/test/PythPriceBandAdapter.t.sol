// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";

import {IPyth} from "../src/interfaces/IPyth.sol";
import {PythPriceBandAdapter} from "../src/oracles/PythPriceBandAdapter.sol";

/// @dev A Pyth stand-in. Only `getPriceUnsafe` matters; the adapter calls nothing else.
contract MockPyth is IPyth {
    IPyth.Price internal _p;
    bool public reverts;

    function set(int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        _p = IPyth.Price({price: price, conf: conf, expo: expo, publishTime: publishTime});
    }

    function setReverts(bool v) external {
        reverts = v;
    }

    function getPriceUnsafe(bytes32) external view override returns (IPyth.Price memory) {
        require(!reverts, "pyth down");
        return _p;
    }

    function getUpdateFee(bytes[] calldata) external pure override returns (uint256) {
        return 1;
    }
}

contract PythPriceBandAdapterTest is Test {
    MockPyth pyth;
    PythPriceBandAdapter adapter;

    PoolId constant POOL = PoolId.wrap(bytes32(uint256(1)));
    bytes32 constant AAPL_USD = bytes32(uint256(0xAAAA));
    address constant KEEPER = address(uint160(0xBEEF));

    uint256 constant NOW = 1_800_000_000;

    function setUp() public {
        vm.warp(NOW);
        pyth = new MockPyth();
        adapter = new PythPriceBandAdapter(IPyth(address(pyth)), address(this));
    }

    /// 18-decimal RWA token as currency0, 6-decimal USDC as currency1. AAPL at $189.50.
    function _configureAaplBase() internal {
        adapter.configureFeed(
            POOL,
            PythPriceBandAdapter.Feed({
                priceId: AAPL_USD,
                baseIsCurrency0: true,
                baseDecimals: 18,
                quoteDecimals: 6,
                maxConfBps: 100, // 1%
                maxPublishAge: 300
            })
        );
    }

    function _publishAapl() internal {
        // $189.50 with Pyth's usual 8-decimal exponent, and a tight 0.05% confidence.
        pyth.set(18_950_000_000, 9_475_000, -8, NOW);
    }

    /*//////////////////////////////////////////////////////////////
      THE CONVERSION. The interface warns this is what goes wrong.
    //////////////////////////////////////////////////////////////*/

    /// The number the adapter produces must be the number core would store in `slot0` for a pool
    /// genuinely trading at $189.50, derived here independently rather than copied from the
    /// implementation.
    function test_conversion_matchesAPoolTradingAtThatPrice() public {
        _configureAaplBase();
        _publishAapl();

        (uint160 got,) = adapter.refresh(POOL);

        // Independent derivation. One whole RWA token (1e18 base units) is worth 189.50 USDC,
        // i.e. 189_500_000 quote base units. So currency1-per-currency0 = 189.5e6 / 1e18.
        uint256 expected = Math.sqrt(Math.mulDiv(189_500_000, 1 << 192, 1e18));

        assertEq(uint256(got), expected, "sqrtPriceX96 must match an independent derivation");
        assertGt(uint256(got), TickMath.MIN_SQRT_RATIO);
        assertLt(uint256(got), TickMath.MAX_SQRT_RATIO);
    }

    /// The whole point of `baseIsCurrency0`. Flipping it must produce the RECIPROCAL price, not
    /// the same number — if these two ever agree, the band inverts for one of the orderings and
    /// the pool rejects every swap in one direction.
    function test_conversion_tokenOrderingInvertsTheRatio() public {
        _configureAaplBase();
        _publishAapl();
        (uint160 baseIs0,) = adapter.refresh(POOL);

        adapter.configureFeed(
            POOL,
            PythPriceBandAdapter.Feed({
                priceId: AAPL_USD,
                baseIsCurrency0: false, // the stablecoin sorted lower
                baseDecimals: 18,
                quoteDecimals: 6,
                maxConfBps: 100,
                maxPublishAge: 300
            })
        );
        (uint160 baseIs1,) = adapter.refresh(POOL);

        assertTrue(baseIs0 != baseIs1, "ordering must change the answer");

        // sqrt(R) * sqrt(1/R) == 1, so the product of the two X96 values is 2**192 up to the
        // rounding of two integer square roots.
        uint256 product = Math.mulDiv(uint256(baseIs0), uint256(baseIs1), 1 << 96);
        uint256 unity = 1 << 96;
        uint256 diff = product > unity ? product - unity : unity - product;
        assertLt(diff, unity / 1_000_000, "the two orderings must be reciprocals");
    }

    /// Decimals matter as much as ordering: the same human price against a 18-decimal quote is a
    /// different pool ratio than against a 6-decimal one.
    function test_conversion_quoteDecimalsChangeTheRatio() public {
        _configureAaplBase();
        _publishAapl();
        (uint160 sixDp,) = adapter.refresh(POOL);

        adapter.configureFeed(
            POOL,
            PythPriceBandAdapter.Feed({
                priceId: AAPL_USD,
                baseIsCurrency0: true,
                baseDecimals: 18,
                quoteDecimals: 18,
                maxConfBps: 100,
                maxPublishAge: 300
            })
        );
        (uint160 eighteenDp,) = adapter.refresh(POOL);

        // 1e12 more quote units per base unit is 1e6 more in sqrt space.
        assertApproxEqRel(uint256(eighteenDp), uint256(sixDp) * 1e6, 1e12);
    }

    /*//////////////////////////////////////////////////////////////
                        FAIL CLOSED, EVERY TIME
    //////////////////////////////////////////////////////////////*/

    /// Never refreshed reads as unavailable, which halts the pool rather than skipping the band.
    function test_failClosed_unrefreshedReadsAsZero() public {
        _configureAaplBase();
        (uint160 p, uint64 t) = adapter.referencePrice(POOL);
        assertEq(p, 0);
        assertEq(t, 0);
    }

    function test_failClosed_unconfiguredPoolCannotRefresh() public {
        vm.expectRevert(
            abi.encodeWithSelector(PythPriceBandAdapter.FeedNotConfigured.selector, POOL)
        );
        adapter.refresh(POOL);
    }

    function test_failClosed_nonPositivePriceRejected() public {
        _configureAaplBase();
        pyth.set(-1, 1, -8, NOW);
        vm.expectRevert(abi.encodeWithSelector(PythPriceBandAdapter.NonPositivePrice.selector, int64(-1)));
        adapter.refresh(POOL);
    }

    function test_failClosed_stalePythPriceRejected() public {
        _configureAaplBase();
        pyth.set(18_950_000_000, 1, -8, NOW - 301);
        vm.expectRevert();
        adapter.refresh(POOL);
    }

    /// A wide confidence interval is Pyth saying its publishers disagree. Trading through that is
    /// exactly when a circuit breaker should not be quiet.
    function test_failClosed_wideConfidenceRejected() public {
        _configureAaplBase();
        // 2% confidence against a 1% bound.
        pyth.set(18_950_000_000, 379_000_000, -8, NOW);
        vm.expectRevert();
        adapter.refresh(POOL);
    }

    /// A reverting Pyth must not be swallowed into a zero or a stale success.
    function test_failClosed_pythRevertPropagates() public {
        _configureAaplBase();
        pyth.setReverts(true);
        vm.expectRevert();
        adapter.refresh(POOL);
    }

    /// A failed refresh leaves the PREVIOUS cache untouched — it does not zero it. Staleness is
    /// then the consumer's call, via the publish time this adapter reports.
    function test_failedRefreshLeavesThePreviousCacheIntact() public {
        _configureAaplBase();
        _publishAapl();
        (uint160 good,) = adapter.refresh(POOL);

        pyth.setReverts(true);
        vm.expectRevert();
        adapter.refresh(POOL);

        (uint160 still,) = adapter.referencePrice(POOL);
        assertEq(still, good, "a failed refresh must not corrupt the cache");
    }

    /// Removing a feed must clear the cache too. A pool still quoting a price whose source has
    /// been withdrawn is the one state that would let trading continue against nothing.
    function test_removeFeed_clearsTheCachedPrice() public {
        _configureAaplBase();
        _publishAapl();
        adapter.refresh(POOL);

        adapter.removeFeed(POOL);

        (uint160 p, uint64 t) = adapter.referencePrice(POOL);
        assertEq(p, 0, "cache must be cleared with the feed");
        assertEq(t, 0);
    }

    /*//////////////////////////////////////////////////////////////
                            ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    /// Choosing the feed is the trust decision and is owner-only.
    function test_access_onlyOwnerConfigures() public {
        vm.prank(KEEPER);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, KEEPER));
        adapter.configureFeed(
            POOL,
            PythPriceBandAdapter.Feed({
                priceId: AAPL_USD,
                baseIsCurrency0: true,
                baseDecimals: 18,
                quoteDecimals: 6,
                maxConfBps: 100,
                maxPublishAge: 300
            })
        );
    }

    /// Executing it is not. Anyone may refresh, and cannot influence the outcome.
    function test_access_refreshIsPermissionless() public {
        _configureAaplBase();
        _publishAapl();

        vm.prank(KEEPER);
        (uint160 byKeeper,) = adapter.refresh(POOL);

        (uint160 byOwner,) = adapter.refresh(POOL);
        assertEq(byKeeper, byOwner, "the caller cannot change the answer");
    }

    function test_config_rejectsNonsense() public {
        PythPriceBandAdapter.Feed memory f = PythPriceBandAdapter.Feed({
            priceId: AAPL_USD,
            baseIsCurrency0: true,
            baseDecimals: 18,
            quoteDecimals: 6,
            maxConfBps: 0,
            maxPublishAge: 300
        });
        vm.expectRevert();
        adapter.configureFeed(POOL, f);

        f.maxConfBps = 10_000; // 100% is not a bound
        vm.expectRevert();
        adapter.configureFeed(POOL, f);

        f.maxConfBps = 100;
        f.maxPublishAge = 0;
        vm.expectRevert();
        adapter.configureFeed(POOL, f);
    }

    /*//////////////////////////////////////////////////////////////
                              GAS BUDGET
    //////////////////////////////////////////////////////////////*/

    /// `referencePrice` runs inside a Vault lock, reached by `staticcall` under
    /// `MarketHoursModule.PRICE_ORACLE_GAS_LIMIT` (200,000). Exceeding that budget makes the
    /// oracle read as unavailable and halts the pool, so its cost is a correctness property, not
    /// an optimisation.
    ///
    /// This measures the WHOLE external call — dispatch, calldata, the SLOAD and ABI-encoding the
    /// return — because that is what the module actually pays. The bound is a fraction of the real
    /// budget rather than a round number: what matters is the enormous margin, since the storage
    /// layout puts `sqrtPriceX96` and `publishTime` in one slot and there is nothing else to read.
    function test_referencePrice_fitsTheModulesGasBudget() public {
        _configureAaplBase();
        _publishAapl();
        adapter.refresh(POOL);

        adapter.referencePrice(POOL); // warm the slot, as a real second swap would find it
        uint256 before = gasleft();
        adapter.referencePrice(POOL);
        uint256 warm = before - gasleft();

        emit log_named_uint("referencePrice gas, warm slot", warm);
        emit log_named_uint("PRICE_ORACLE_GAS_LIMIT", 200_000);

        // Two orders of magnitude of headroom. A regression that added a loop or an external call
        // would blow through this long before it reached the module's real cap.
        assertLt(warm, 20_000, "must stay far inside PRICE_ORACLE_GAS_LIMIT");
    }

    /// The cold case is the one the module actually hits on the first swap of a block.
    function test_referencePrice_coldReadAlsoFits() public {
        _configureAaplBase();
        _publishAapl();
        adapter.refresh(POOL);

        uint256 before = gasleft();
        adapter.referencePrice(POOL);
        uint256 cold = before - gasleft();

        emit log_named_uint("referencePrice gas, cold slot", cold);
        assertLt(cold, 30_000, "a cold read must still fit the budget with room to spare");
    }

    /// The reported timestamp is Pyth's, not the refresh time. A cache written now from an old
    /// price is an old price, and the consumer's staleness window must see that.
    function test_reportsPythPublishTimeNotRefreshTime() public {
        _configureAaplBase();
        uint256 published = NOW - 120;
        pyth.set(18_950_000_000, 1, -8, published);

        vm.warp(NOW + 30);
        adapter.refresh(POOL);

        (, uint64 reported) = adapter.referencePrice(POOL);
        assertEq(uint256(reported), published, "must report Pyth's publish time");
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IProtocolFees} from "infinity-core/src/interfaces/IProtocolFees.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";
import {FullMath} from "infinity-core/src/pool-cl/libraries/FullMath.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {IPriceBandOracle} from "../src/interfaces/IPriceBandOracle.sol";
import {AggregatorV3Interface, ChainlinkPriceBandAdapter} from "../src/oracles/ChainlinkPriceBandAdapter.sol";
import {MarketHoursHook} from "../src/MarketHoursHook.sol";
import {MarketHoursModule} from "../src/modules/MarketHoursModule.sol";

/// `typeAndVersion()` is on the underlying Chainlink aggregator, not on the proxy.
interface ITypeAndVersion {
    function typeAndVersion() external view returns (string memory);
}

/// The proxy-side getter that distinguishes a real Chainlink proxy from a contract that merely
/// implements the read shape.
interface IAggregatorProxy {
    function aggregator() external view returns (address);
}

/**
 * ############################ STOCKS REHEARSAL: ChainlinkPriceBandAdapter + MarketHoursHook ############################
 *
 * ------------------------------- WHY THIS RUNS AGAINST 4663, NOT 46630 -------------------------------
 *
 * Robinhood Chain TESTNET (46630, `https://rpc.testnet.chain.robinhood.com`, chain id confirmed with
 * `cast chain-id`) has NO Chainlink data feeds. Chainlink's docs list exactly one Robinhood network,
 * `robinhood-mainnet` (`src/features/data/chains.ts` in smartcontractkit/documentation); every
 * testnet reference-data filename probed 404s; and the mainnet proxy addresses have no code on 46630.
 * No Latch core is deployed on 46630 either. A "testnet" rehearsal would therefore have to price a
 * pool off a mock aggregator, which is exactly the thing a rehearsal exists to not trust.
 *
 * So the rehearsal is a FORK of Robinhood mainnet (4663): the real Vault, the real CLPoolManager and
 * a real Chainlink equity feed, with two throwaway mock tokens so nothing real is priced or at risk.
 *
 * ------------------------------- THE FEED -------------------------------
 *
 * `Robinhood AAPL / USD`, proxy 0x6B22A786…2cD0. From Chainlink's reference data
 * (feeds-robinhood-mainnet.json): heartbeat 86400 s, deviation threshold 0.5 %, marketHours
 * `us_equities_24/5`. Verified on chain 2026-09-13 and re-verified by `_verifyFeed` on every run:
 * `description()`, `decimals() == 8`, `aggregator()` equals the reference data's `contractAddress`,
 * and that aggregator reports `typeAndVersion() == "DualAggregator 1.0.0"` - a Chainlink OCR
 * aggregator, not a contract implementing the read shape. That last check is the decoy guard; this
 * chain carries a verified "SequencerUptimeRouter" whose answer is hardcoded to UP.
 *
 * MEASURED BEHAVIOUR THAT SHAPES THE PARAMETERS (packages/keeper `latch-feed-watch`, block 61950000,
 * Sunday 12:16 UTC): all four equity feeds sampled were 40-47 h stale, last rounds Friday 12:56-20:03
 * UTC, all resumed Monday 00:00 UTC. In-session, SPY went 17 h between rounds (Thu 13:52 -> Fri 06:48).
 *
 * ------------------------------- PARAMETERS, ALL WALL-CLOCK -------------------------------
 *
 *   adapter    sequencerUptimeFeed = address(0), grace = 0. No uptime feed exists on 4663 (see the
 *              adapter header); the three contracts that advertise one are decoys.
 *   feed       heartbeat = 86400 s, the PUBLISHED heartbeat. Raising it is the fail-open direction.
 *   market     weekdayMask Mon-Fri (0x3E), session 00:00:00-23:59:59 UTC. That is Chainlink's
 *              `us_equities_24/5` (Sun 20:00 ET -> Fri 20:00 ET) under EDT, minus one second a day.
 *              THE CALENDAR IS WHAT CLOSES SATURDAY: with a 24 h heartbeat the adapter alone keeps
 *              serving Friday's last round until ~Saturday 13:00-20:00 UTC. Proven below.
 *              DST: from 2026-11-01 (EST) the 24/5 window is Mon 01:00 -> Sat 01:00 UTC; the issuer
 *              must `setSessionHours(poolId, 0x3E, 3600, 3599)` (a wrapping session). US market
 *              holidays need `setHolidays`. Neither is automated here.
 *   maxPriceAge = 86400 s. Tighter halts ordinary quiet sessions (the 17 h SPY gap); looser adds
 *              nothing because the adapter already refuses a round older than the heartbeat.
 *   band       +/- 5 % (50_000 ppm). The reference itself may lag by the 0.5 % deviation threshold,
 *              and the band must admit that lag plus ordinary intraday movement between rounds.
 *   pool       lpFee 3000, tickSpacing 60, static fee (the hook refuses dynamic).
 *
 * ------------------------------- ROLES (CLAUDE.md "Ownership") -------------------------------
 *
 *   ChainlinkPriceBandAdapter.owner  -> Safe 0x715a6176…3432. `configureFeed` repoints a pool's price
 *                                       source in one transaction and is NOT deviation-bounded, so it
 *                                       must never sit on a hot key; matches the PythPriceBandAdapter
 *                                       row. (CLAUDE.md still needs this row added.)
 *   MarketHoursHook.owner            -> Safe. Table row "MarketHoursHook | owner | Safe".
 *   MarketHoursModule per-pool issuer-> Safe, for THIS rehearsal pool only. The issuer is a pool-level
 *                                       role; for a pool Latch itself operates the Safe is the
 *                                       party with standing to `resume` and re-cut hours.
 *   MarketHoursModule.marketGuardian -> Ops 0x304b0cc0…c9a9. Halt-only; "delay never sits on privilege
 *                                       reduction". Proven below that it cannot resume.
 *   deployer / trader                -> any EOA. Deploys contracts it never owns (owners are set in
 *                                       the constructors, so there is no transfer window), mints mock
 *                                       tokens, LPs and swaps. Holds no role on anything.
 *
 * For the simulation the Safe's calls are `vm.prank`ed from the Safe's real address, so the
 * rehearsal exercises the production ownership rather than a stand-in EOA.
 *
 * Both contracts' `renounceOwnership` overrides are asserted to revert `RenounceDisabled`.
 *
 * ------------------------------- COMMANDS -------------------------------
 *
 *   RPC=https://rpc-robinhood.blockmachine.io    (public, keyless; forks cleanly as of 2026-09-13)
 *
 *   Not `robinhood.rpc.blxrbdn.com`: it load-balances across nodes that do not all hold recent state,
 *   and forge's pinned-block fork failed with "historical state … is not available". Not nodeflare:
 *   one request per ten seconds keyless.
 *
 *   NO BLOCK NUMBERS ARE USED ANYWHERE IN THIS FILE, and on this chain that matters twice over:
 *   Robinhood Chain is Arbitrum Nitro, where the EVM's `block.number` is the ETHEREUM L1 block number
 *   (~12 s), not the 0.102 s L2 block `eth_blockNumber` reports. Measured 2026-09-13: an `eth_call` of
 *   `NUMBER` returned 25,972,137, equal to the header's `l1BlockNumber` and to Ethereum's head, while
 *   `eth_blockNumber` read 62,386,617.
 *
 *   Full rehearsal on a fork. Refuses --broadcast. Runs at any hour: if the market is closed at the
 *   fork block it warps to one minute after the feed's latest round, which is in session by definition.
 *     forge script script/RehearseStocksRobinhood.s.sol:RehearseStocksRobinhood \
 *       --rpc-url $RPC --sender 0x000000000000000000000000000000000000dEaD -vv
 *
 *   OPTIONAL live run on 4663 (mainnet; mock tokens only). Three parties, in order:
 *     1. any funded EOA:  BROADCAST_WITH_ENV_KEY=true forge script \
 *          script/RehearseStocksRobinhood.s.sol:DeployStocksRehearsal --rpc-url $RPC --broadcast --slow -vv
 *     2. the Safe:        execute the three calls step 1 prints (configureFeed, configureMarket,
 *                         setMarketGuardian). No timelock: both owners are Safe-tier.
 *     3. any funded EOA, in session: ADAPTER=… HOOK=… RWA_TOKEN=… USD_TOKEN=… ROUTER=… \
 *          BROADCAST_WITH_ENV_KEY=true forge script \
 *          script/RehearseStocksRobinhood.s.sol:TradeStocksRehearsal --rpc-url $RPC --broadcast --slow -vv
 */
abstract contract StocksRehearsalBase is Script {
    using CLPoolParametersHelper for bytes32;

    /* ------------------------------------------------------------------ live Robinhood Chain (4663) */

    address internal constant VAULT = 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c;
    address internal constant CL_POOL_MANAGER = 0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66;

    /// Governance Safe, 2-of-3, same address on 4663 and Sepolia.
    address internal constant SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;
    /// Ops key: deployer/keeper/guardian/publisher per CLAUDE.md "One wallet, four roles".
    address internal constant OPS = 0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9;

    address internal constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    /// Reference data `contractAddress` for the feed above. A proxy repointed away from it fails the run.
    address internal constant AAPL_AGGREGATOR = 0xBb11A21267cFDb63d4935d99a499133DD1744ACb;
    string internal constant AAPL_DESCRIPTION = "Robinhood AAPL / USD";
    string internal constant AGGREGATOR_TYPE = "DualAggregator 1.0.0";
    uint8 internal constant FEED_DECIMALS = 8;

    /* ------------------------------------------------------------------ parameters (see header) */

    uint32 internal constant HEARTBEAT = 86_400;
    uint32 internal constant MAX_PRICE_AGE = 86_400;
    uint32 internal constant BAND_PPM = 50_000;
    uint8 internal constant WEEKDAYS_MON_FRI = 0x3E;
    uint24 internal constant SESSION_OPEN = 0;
    uint24 internal constant SESSION_CLOSE = 86_399;

    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant RANGE_TICKS = 6000; // ~ +/-45 % around the reference
    int256 internal constant LIQUIDITY = 1e17;

    uint8 internal constant RWA_DECIMALS = 18;
    uint8 internal constant USD_DECIMALS = 6;
    uint256 internal constant MINT = 1e30;

    uint16 internal constant EXPECTED_BITMAP = (1 << 0) | (1 << 2) | (1 << 6) | (1 << 7); // 197

    struct Deployment {
        ChainlinkPriceBandAdapter adapter;
        MarketHoursHook hook;
        MockERC20 rwa;
        MockERC20 usd;
        CLPoolManagerRouter router;
    }

    /// True in the fork rehearsal: actors are pranked and nothing is recorded for broadcast.
    bool internal simulate;

    /* ------------------------------------------------------------------ actor plumbing */

    function _begin(address actor) internal {
        if (simulate) {
            vm.startPrank(actor);
        } else if (vm.envOr("BROADCAST_WITH_ENV_KEY", false)) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        } else {
            // No key read. Sender comes from --sender or a forge wallet flag.
            vm.startBroadcast();
        }
    }

    function _end() internal {
        if (simulate) vm.stopPrank();
        else vm.stopBroadcast();
    }

    /* ------------------------------------------------------------------ preflight */

    function _requireRobinhood() internal view {
        if (block.chainid == 46630) {
            revert("46630 has no Chainlink feeds and no Latch core - rehearse against a 4663 fork (see header)");
        }
        require(block.chainid == 4663, "not Robinhood Chain 4663");
        require(CL_POOL_MANAGER.code.length > 0 && VAULT.code.length > 0, "core not deployed here");
        require(address(IProtocolFees(CL_POOL_MANAGER).vault()) == VAULT, "CLPoolManager is not wired to the Vault");
        require(SAFE.code.length > 0, "Safe has no code");
        require(OPS.code.length == 0, "Ops key unexpectedly a contract");
    }

    function _verifyFeed() internal view returns (int256 answer, uint256 updatedAt) {
        AggregatorV3Interface feed = AggregatorV3Interface(AAPL_FEED);
        require(keccak256(bytes(feed.description())) == keccak256(bytes(AAPL_DESCRIPTION)), "feed description mismatch");
        require(feed.decimals() == FEED_DECIMALS, "feed decimals mismatch");
        address agg = IAggregatorProxy(AAPL_FEED).aggregator();
        require(agg == AAPL_AGGREGATOR, "proxy points at an aggregator the reference data does not list");
        require(
            keccak256(bytes(ITypeAndVersion(agg).typeAndVersion())) == keccak256(bytes(AGGREGATOR_TYPE)),
            "underlying aggregator is not a Chainlink DualAggregator"
        );
        uint80 roundId;
        (roundId, answer,, updatedAt,) = feed.latestRoundData();
        require(answer > 0 && updatedAt != 0, "feed has no valid round");
        console.log("  feed           ", AAPL_FEED, AAPL_DESCRIPTION);
        console.log("  aggregator     ", agg, AGGREGATOR_TYPE);
        console.log("  latest answer  ", uint256(answer), "(8 decimals)");
        console.log("  updatedAt      ", updatedAt, "age s", block.timestamp - updatedAt);
    }

    /* ------------------------------------------------------------------ step 1: deploy (no roles) */

    function _deploy(address deployer) internal returns (Deployment memory d) {
        _begin(deployer);
        d.adapter = new ChainlinkPriceBandAdapter(address(0), 0, SAFE);
        d.hook = new MarketHoursHook(ICLPoolManager(CL_POOL_MANAGER), SAFE);
        d.rwa = new MockERC20("Latch Rehearsal AAPL (mock, worthless)", "lrAAPL", RWA_DECIMALS);
        d.usd = new MockERC20("Latch Rehearsal USD (mock, worthless)", "lrUSD", USD_DECIMALS);
        d.router = new CLPoolManagerRouter(IVault(VAULT), ICLPoolManager(CL_POOL_MANAGER));
        _end();
        _assertDeployment(d);
    }

    /// Every constructor argument and every role, read back from chain.
    function _assertDeployment(Deployment memory d) internal {
        ChainlinkPriceBandAdapter a = d.adapter;
        require(a.owner() == SAFE, "adapter owner != Safe");
        require(a.pendingOwner() == address(0), "adapter has a pending owner");
        require(a.sequencerUptimeFeed() == address(0), "adapter uptime feed not zero");
        require(a.sequencerGracePeriod() == 0, "adapter grace not zero");
        require(!a.sequencerCheckEnabled(), "adapter claims a sequencer check");
        (bool enabled, bool ok, uint256 upSince) = a.sequencerStatus();
        require(!enabled && ok && upSince == 0, "adapter sequencerStatus shape");
        _expectRevertSelector(address(a), abi.encodeWithSignature("renounceOwnership()"), ChainlinkPriceBandAdapter.RenounceDisabled.selector, "adapter renounceOwnership");

        MarketHoursHook h = d.hook;
        require(h.owner() == SAFE, "hook owner != Safe");
        require(h.pendingOwner() == address(0), "hook has a pending owner");
        require(address(h.poolManager()) == CL_POOL_MANAGER, "hook poolManager");
        require(h.getHooksRegistrationBitmap() == EXPECTED_BITMAP, "hook bitmap");
        require(h.marketGuardian() == address(0), "hook guardian set at deploy");
        _expectRevertSelector(address(h), abi.encodeWithSignature("renounceOwnership()"), MarketHoursHook.RenounceDisabled.selector, "hook renounceOwnership");

        require(d.rwa.decimals() == RWA_DECIMALS && d.usd.decimals() == USD_DECIMALS, "mock decimals");
        require(address(d.router.vault()) == VAULT && address(d.router.poolManager()) == CL_POOL_MANAGER, "router wiring");

        console.log("  [ok] adapter  ", address(a), "owner Safe, no uptime feed, renounce disabled");
        console.log("  [ok] hook     ", address(h), "owner Safe, bitmap 197, renounce disabled");
        console.log("  [ok] lrAAPL   ", address(d.rwa));
        console.log("  [ok] lrUSD    ", address(d.usd));
        console.log("  [ok] router   ", address(d.router));
    }

    /* ------------------------------------------------------------------ pool shape */

    function _key(Deployment memory d) internal pure returns (PoolKey memory key, bool baseIsCurrency0) {
        baseIsCurrency0 = address(d.rwa) < address(d.usd);
        (address c0, address c1) = baseIsCurrency0 ? (address(d.rwa), address(d.usd)) : (address(d.usd), address(d.rwa));
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            hooks: IHooks(address(d.hook)),
            poolManager: ICLPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: bytes32(uint256(EXPECTED_BITMAP)).setTickSpacing(TICK_SPACING)
        });
    }

    function _feedConfig(bool baseIsCurrency0) internal pure returns (ChainlinkPriceBandAdapter.Feed memory) {
        return ChainlinkPriceBandAdapter.Feed({
            aggregator: AAPL_FEED,
            baseIsCurrency0: baseIsCurrency0,
            baseDecimals: RWA_DECIMALS,
            quoteDecimals: USD_DECIMALS,
            feedDecimals: FEED_DECIMALS,
            heartbeat: HEARTBEAT
        });
    }

    function _marketSettings(Deployment memory d) internal pure returns (MarketHoursModule.MarketSettings memory) {
        return MarketHoursModule.MarketSettings({
            issuer: SAFE,
            oracle: IPriceBandOracle(address(d.adapter)),
            maxUpPpm: BAND_PPM,
            maxDownPpm: BAND_PPM,
            maxPriceAge: MAX_PRICE_AGE,
            openSecondOfDay: SESSION_OPEN,
            closeSecondOfDay: SESSION_CLOSE,
            weekdayMask: WEEKDAYS_MON_FRI,
            sessionEnabled: true,
            bandEnabled: true,
            gateLiquidity: false
        });
    }

    /// Asserts the Safe's step-2 configuration landed exactly as intended.
    function _assertConfigured(Deployment memory d) internal view {
        (PoolKey memory key, bool baseIsCurrency0) = _key(d);
        PoolId id = key.toId();
        ChainlinkPriceBandAdapter.Feed memory f = d.adapter.feedFor(id);
        require(f.aggregator == AAPL_FEED && f.baseIsCurrency0 == baseIsCurrency0, "feed aggregator/orientation");
        require(f.baseDecimals == RWA_DECIMALS && f.quoteDecimals == USD_DECIMALS, "feed token decimals");
        require(f.feedDecimals == FEED_DECIMALS && f.heartbeat == HEARTBEAT, "feed decimals/heartbeat");

        MarketHoursModule.MarketConfig memory m = d.hook.marketConfig(id);
        require(m.configured && !m.halted, "market not configured, or halted");
        require(m.issuer == SAFE && address(m.oracle) == address(d.adapter), "issuer/oracle");
        require(m.maxUpPpm == BAND_PPM && m.maxDownPpm == BAND_PPM && m.maxPriceAge == MAX_PRICE_AGE, "band/age");
        require(m.weekdayMask == WEEKDAYS_MON_FRI && m.openSecondOfDay == SESSION_OPEN && m.closeSecondOfDay == SESSION_CLOSE, "calendar");
        require(m.sessionEnabled && m.bandEnabled && !m.gateLiquidity, "flags");
        require(d.hook.marketGuardian() == OPS, "guardian != Ops");
        console.log("  [ok] feed, market, issuer Safe, guardian Ops, band 5%, calendar Mon-Fri UTC");
    }

    /* ------------------------------------------------------------------ step 3: trade (no roles) */

    function _seedAndTrade(Deployment memory d, address trader) internal returns (PoolKey memory key, bool baseIsCurrency0) {
        (key, baseIsCurrency0) = _key(d);
        PoolId id = key.toId();

        _begin(trader);
        (uint160 ref,) = d.adapter.refresh(id);
        ICLPoolManager(CL_POOL_MANAGER).initialize(key, ref);
        d.rwa.mint(trader, MINT);
        d.usd.mint(trader, MINT);
        d.rwa.approve(address(d.router), type(uint256).max);
        d.usd.approve(address(d.router), type(uint256).max);
        int24 tick = TickMath.getTickAtSqrtRatio(ref);
        d.router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: ((tick - RANGE_TICKS) / TICK_SPACING) * TICK_SPACING,
                tickUpper: ((tick + RANGE_TICKS) / TICK_SPACING) * TICK_SPACING,
                liquidityDelta: LIQUIDITY,
                salt: bytes32(0)
            }),
            ""
        );
        // Buy the RWA with 1,000 lrUSD, then sell 1 lrAAPL.
        _swap(d, key, !baseIsCurrency0, -int256(1_000 * 10 ** USD_DECIMALS));
        _swap(d, key, baseIsCurrency0, -int256(10 ** RWA_DECIMALS));
        _end();

        (uint160 post,,,) = ICLPoolManager(CL_POOL_MANAGER).getSlot0(id);
        (bool wouldRevert,) = d.hook.previewPriceBand(id, true, post);
        require(!wouldRevert, "post-trade price is outside the band");
        console.log("  [ok] refreshed, initialised at the reference, LP'd, swapped both directions in session");
    }

    function _swap(Deployment memory d, PoolKey memory key, bool zeroForOne, int256 amountSpecified) internal {
        d.router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
    }

    /// Invert the pool's sqrt price back into Chainlink's 8-decimal human price, independently of the
    /// adapter. If `baseIsCurrency0` were wrong, the result would be off by ~12 orders of magnitude.
    function _impliedAnswer(uint160 sqrtP, bool baseIsCurrency0) internal pure returns (uint256) {
        // human * 1e8 == raw * 10**(rwaDec - usdDec + 8) == raw * 1e20 (base currency0), or its reciprocal.
        if (baseIsCurrency0) {
            uint256 x = FullMath.mulDiv(sqrtP, sqrtP, 1 << 96);
            return FullMath.mulDiv(x, 1e20, 1 << 96);
        }
        uint256 y = FullMath.mulDiv(1 << 96, 1 << 96, sqrtP);
        return FullMath.mulDiv(y, 1e20, sqrtP);
    }

    /* ------------------------------------------------------------------ revert helpers */

    function _expectRevertSelector(address target, bytes memory data, bytes4 selector, string memory label) internal {
        (bool ok, bytes memory ret) = target.call(data);
        require(!ok, string.concat("expected revert: ", label));
        require(_hasSelector(ret, selector), string.concat("wrong revert reason: ", label));
    }

    /// Hook reverts reach the router wrapped in core's ERC-7751 `WrappedError`, so the inner custom
    /// error's selector is searched for anywhere in the return data rather than at offset zero.
    function _hasSelector(bytes memory data, bytes4 sel) internal pure returns (bool) {
        if (data.length < 4) return false;
        for (uint256 i = 0; i + 4 <= data.length; i++) {
            if (data[i] == sel[0] && data[i + 1] == sel[1] && data[i + 2] == sel[2] && data[i + 3] == sel[3]) {
                return true;
            }
        }
        return false;
    }
}

/* ============================================================================================= */

/// Step 1 of the optional live run. Any funded EOA. Deploys; assigns every owner in the constructor;
/// prints the Safe's step-2 calls. The deployer holds no role on anything it deploys.
contract DeployStocksRehearsal is StocksRehearsalBase {
    function run() external {
        _requireRobinhood();
        console.log("=== stocks rehearsal, step 1: deploy (owners = Safe from construction) ===");
        _verifyFeed();
        Deployment memory d = _deploy(msg.sender);
        require(d.adapter.owner() != msg.sender && d.hook.owner() != msg.sender, "deployer must own nothing");

        (PoolKey memory key, bool baseIsCurrency0) = _key(d);
        console.log("");
        console.log("poolId", vm.toString(PoolId.unwrap(key.toId())));
        console.log("baseIsCurrency0", baseIsCurrency0);
        console.log("");
        console.log("=== step 2: the SAFE executes, in this order ===");
        console.log("to adapter", address(d.adapter));
        console.logBytes(abi.encodeCall(ChainlinkPriceBandAdapter.configureFeed, (key.toId(), _feedConfig(baseIsCurrency0))));
        console.log("to hook", address(d.hook));
        console.logBytes(abi.encodeCall(MarketHoursModule.configureMarket, (key, _marketSettings(d))));
        console.log("to hook", address(d.hook));
        console.logBytes(abi.encodeCall(MarketHoursModule.setMarketGuardian, (OPS)));
        console.log("");
        console.log("step 3 env: ADAPTER HOOK RWA_TOKEN USD_TOKEN ROUTER = the five addresses above");
    }
}

/// Step 3 of the optional live run. Any funded EOA, during the session, after the Safe's step 2.
contract TradeStocksRehearsal is StocksRehearsalBase {
    function run() external {
        _requireRobinhood();
        Deployment memory d = Deployment({
            adapter: ChainlinkPriceBandAdapter(vm.envAddress("ADAPTER")),
            hook: MarketHoursHook(vm.envAddress("HOOK")),
            rwa: MockERC20(vm.envAddress("RWA_TOKEN")),
            usd: MockERC20(vm.envAddress("USD_TOKEN")),
            router: CLPoolManagerRouter(payable(vm.envAddress("ROUTER")))
        });
        console.log("=== stocks rehearsal, step 3: refresh, initialise, LP, swap ===");
        _verifyFeed();
        _assertDeployment(d);
        _assertConfigured(d);
        (PoolKey memory key,) = _key(d);
        require(d.hook.isTradable(key.toId()), "market closed now - run inside the Mon-Fri UTC session");
        _seedAndTrade(d, msg.sender);
    }
}

/* ============================================================================================= */

/// The full rehearsal on a 4663 fork. Pranks the Safe from its real address; refuses --broadcast.
contract RehearseStocksRobinhood is StocksRehearsalBase {
    uint256 internal checks;

    function run() external {
        require(!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast), "rehearsal only: refuses --broadcast");
        require(!vm.isContext(VmSafe.ForgeContext.ScriptResume), "rehearsal only: refuses --resume");
        simulate = true;
        _requireRobinhood();

        address deployer = makeAddr("latch-rehearsal-deployer");
        address trader = makeAddr("latch-rehearsal-trader");
        address stranger = makeAddr("latch-rehearsal-stranger");

        console.log("=== STOCKS REHEARSAL on a Robinhood Chain (4663) fork ===");
        console.log("  fork block", block.number, "timestamp", block.timestamp);
        (int256 answer, uint256 updatedAt) = _verifyFeed();
        checks += 4;

        /* ---------------------------------------------------------------- 1. deploy */
        console.log("");
        console.log("--- 1. deploy (constructor owners = Safe)");
        uint256 g = gasleft();
        Deployment memory d = _deploy(deployer);
        console.log("  gas: five deployments ~", g - gasleft());
        checks += 12;
        (PoolKey memory key, bool baseIsCurrency0) = _key(d);
        PoolId id = key.toId();

        /* ---------------------------------------------------------------- 2. Safe configures */
        console.log("");
        console.log("--- 2. configure, as the Safe");
        _expectRevertSelector(
            address(d.adapter),
            abi.encodeCall(ChainlinkPriceBandAdapter.configureFeed, (id, _feedConfig(baseIsCurrency0))),
            Ownable.OwnableUnauthorizedAccount.selector,
            "non-owner configureFeed"
        );
        _expectRevertSelector(
            address(d.hook),
            abi.encodeCall(MarketHoursModule.configureMarket, (key, _marketSettings(d))),
            MarketHoursModule.NotMarketAdmin.selector,
            "non-owner configureMarket"
        );
        console.log("  [ok] configureFeed / configureMarket refuse a non-owner");
        checks += 2;

        vm.startPrank(SAFE);
        g = gasleft();
        d.adapter.configureFeed(id, _feedConfig(baseIsCurrency0));
        console.log("  gas: configureFeed      ~", g - gasleft());
        g = gasleft();
        d.hook.configureMarket(key, _marketSettings(d));
        console.log("  gas: configureMarket    ~", g - gasleft());
        g = gasleft();
        d.hook.setMarketGuardian(OPS);
        console.log("  gas: setMarketGuardian  ~", g - gasleft());
        vm.stopPrank();
        _assertConfigured(d);
        checks++;

        /* ---------------------------------------------------------------- 3. pick an in-session moment */
        console.log("");
        console.log("--- 3. in session");
        uint256 inSession = block.timestamp;
        if (!d.hook.isSessionOpenAt(id, inSession) || updatedAt + HEARTBEAT < inSession) {
            // Closed or stale at the fork block. One minute after the feed's latest round is, by
            // construction, a moment the feed was live - and it must also be inside the calendar.
            inSession = updatedAt + 60;
            console.log("  fork block is out of hours; warping to latest round + 60 s:", inSession);
            vm.warp(inSession);
        }
        require(d.hook.isSessionOpenAt(id, inSession), "the feed's latest round falls outside the calendar - DST or holiday?");
        require(d.hook.isTradable(id), "not tradable in session");
        (uint160 preview,) = d.adapter.previewRefresh(id);
        (uint160 empty, uint64 emptyAt) = d.adapter.referencePrice(id);
        require(empty == 0 && emptyAt == 0, "reference served before any refresh");
        console.log("  [ok] referencePrice is (0,0) before the first refresh - fail closed");
        checks++;

        g = gasleft();
        _seedAndTrade(d, trader);
        console.log("  gas: refresh+init+mint+approve+LP+2 swaps ~", g - gasleft());
        checks++;

        (uint160 cached, uint64 cachedAt) = d.adapter.referencePrice(id);
        require(cached == preview && uint256(cachedAt) == updatedAt, "cache != preview, or not the feed's own timestamp");
        uint256 implied = _impliedAnswer(cached, baseIsCurrency0);
        uint256 diff = implied > uint256(answer) ? implied - uint256(answer) : uint256(answer) - implied;
        require(diff * 1_000_000 <= uint256(answer), "reference does not invert back to the Chainlink answer (orientation?)");
        console.log("  [ok] reference inverts to Chainlink answer within 1 ppm:", implied, uint256(answer));
        console.log("  [ok] referencePrice reports the FEED's updatedAt, not the refresh time");
        checks += 2;

        g = gasleft();
        d.adapter.referencePrice(id);
        console.log("  gas: referencePrice (hot view) ~", g - gasleft());

        // The band is live: a swap dragging the price 19% down must be refused.
        _expectSwapRevert(d, key, baseIsCurrency0, cached, trader, MarketHoursModule.PriceBandBreached.selector, "divergent swap past the band");
        console.log("  [ok] a swap ending 19% below the reference reverts PriceBandBreached");
        checks++;

        /* ---------------------------------------------------------------- 4. guardian asymmetry */
        console.log("");
        console.log("--- 4. halt authority");
        vm.prank(OPS);
        d.hook.halt(id, bytes32("rehearsal"));
        _expectSmallSwapRevert(d, key, baseIsCurrency0, trader, MarketHoursModule.TradingHalted.selector, "halted swap");
        vm.prank(OPS);
        (bool resumed, bytes memory why) = address(d.hook).call(abi.encodeCall(MarketHoursModule.resume, (id)));
        require(!resumed && _hasSelector(why, MarketHoursModule.NotMarketOperator.selector), "Ops guardian was able to resume");
        vm.prank(stranger);
        (bool halted,) = address(d.hook).call(abi.encodeCall(MarketHoursModule.halt, (id, bytes32("x"))));
        require(!halted, "a stranger was able to halt");
        vm.prank(SAFE);
        d.hook.resume(id);
        require(d.hook.isTradable(id), "not tradable after Safe resume");
        console.log("  [ok] Ops halts; halted swap reverts; Ops cannot resume; stranger cannot halt; Safe resumes");
        checks += 4;

        /* ---------------------------------------------------------------- 5. Saturday: the calendar */
        console.log("");
        console.log("--- 5. out of hours: Saturday 12:00 UTC");
        uint256 saturday = _next(inSession, 6, 12 hours);
        vm.warp(saturday);
        console.log("  warped to", saturday, "feed round age s", saturday - updatedAt);
        require(!d.hook.isTradable(id), "tradable on a Saturday");
        (uint160 satRef,) = d.adapter.referencePrice(id);
        if (satRef != 0) {
            console.log("  NOTE: the adapter is STILL serving the last round (age < heartbeat).");
            console.log("        Only the calendar is closing this pool right now.");
        } else {
            console.log("  adapter already refuses the round; calendar and staleness both closed");
        }
        _expectSmallSwapRevert(d, key, baseIsCurrency0, trader, MarketHoursModule.MarketClosed.selector, "Saturday swap");
        console.log("  [ok] swap reverts MarketClosed");
        checks += 2;

        // LPs can always leave.
        _removeHalf(d, key, cached, trader);
        console.log("  [ok] removing liquidity works while the market is closed");
        checks++;

        /* ---------------------------------------------------------------- 5b. the heartbeat boundary */
        // The exposure the calendar has to cover, measured exactly: the adapter serves a round for
        // precisely `heartbeat` seconds after the FEED published it, whatever the weekday.
        console.log("");
        console.log("--- 5b. heartbeat boundary");
        vm.warp(updatedAt + HEARTBEAT);
        (uint160 edge,) = d.adapter.referencePrice(id);
        require(edge == cached, "adapter stopped serving before the heartbeat elapsed");
        vm.warp(updatedAt + HEARTBEAT + 1);
        (uint160 past,) = d.adapter.referencePrice(id);
        require(past == 0, "adapter served a round one second past its heartbeat");
        console.log("  [ok] served at updatedAt + 86400 s, refused at + 86401 s");
        console.log("       i.e. a Friday 20:00 UTC round would be served until Saturday 20:00 UTC");
        checks += 2;

        /* ---------------------------------------------------------------- 6. Wednesday: the oracle */
        console.log("");
        console.log("--- 6. feed stopped: next Wednesday 15:00 UTC, calendar open, round > heartbeat");
        uint256 wednesday = _next(saturday, 3, 15 hours);
        vm.warp(wednesday);
        require(wednesday - updatedAt > HEARTBEAT, "not stale enough to test the oracle gate");
        require(d.hook.isTradable(id), "calendar should be open on a Wednesday");
        (uint160 staleRef, uint64 staleAt) = d.adapter.referencePrice(id);
        require(staleRef == 0 && staleAt == 0, "adapter served a round older than its heartbeat");
        _expectRevertSelector(
            address(d.adapter),
            abi.encodeCall(ChainlinkPriceBandAdapter.previewRefresh, (id)),
            ChainlinkPriceBandAdapter.AnswerTooOld.selector,
            "stale previewRefresh"
        );
        _expectRevertSelector(
            address(d.adapter),
            abi.encodeCall(ChainlinkPriceBandAdapter.refresh, (id)),
            ChainlinkPriceBandAdapter.AnswerTooOld.selector,
            "stale refresh"
        );
        _expectSmallSwapRevert(d, key, baseIsCurrency0, trader, MarketHoursModule.PriceOracleUnavailable.selector, "stale-oracle swap");
        console.log("  [ok] referencePrice (0,0); refresh reverts AnswerTooOld; swap reverts PriceOracleUnavailable");
        checks += 4;

        console.log("");
        console.log("=== stocks rehearsal passed:", checks, "checks ===");
        console.log("adapter", address(d.adapter));
        console.log("hook   ", address(d.hook));
        console.log("poolId ", vm.toString(PoolId.unwrap(id)));
    }

    /// The next moment strictly after `from` that is `weekday` (0 = Sunday) at `secondOfDay` UTC.
    function _next(uint256 from, uint256 weekday, uint256 secondOfDay) internal pure returns (uint256 t) {
        uint256 day = from / 1 days;
        uint256 today = (day + 4) % 7;
        uint256 ahead = (weekday + 7 - today) % 7;
        t = (day + ahead) * 1 days + secondOfDay;
        if (t <= from) t += 7 days;
    }

    function _expectSmallSwapRevert(
        Deployment memory d,
        PoolKey memory key,
        bool baseIsCurrency0,
        address trader,
        bytes4 selector,
        string memory label
    ) internal {
        bytes memory call_ = abi.encodeCall(
            CLPoolManagerRouter.swap,
            (
                key,
                ICLPoolManager.SwapParams({
                    zeroForOne: !baseIsCurrency0,
                    amountSpecified: -int256(10 * 10 ** USD_DECIMALS),
                    sqrtPriceLimitX96: !baseIsCurrency0 ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1
                }),
                CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
                bytes("")
            )
        );
        vm.prank(trader);
        (bool ok, bytes memory ret) = address(d.router).call(call_);
        require(!ok, string.concat("expected revert: ", label));
        require(_hasSelector(ret, selector), string.concat("wrong revert reason: ", label));
    }

    /// Sell the RWA with a price limit 10% below the reference in sqrt terms (19% in price).
    function _expectSwapRevert(
        Deployment memory d,
        PoolKey memory key,
        bool baseIsCurrency0,
        uint160 ref,
        address trader,
        bytes4 selector,
        string memory label
    ) internal {
        // Selling the RWA moves the pool price toward "less USD per RWA". In sqrtPriceX96 terms that is
        // DOWN when the RWA is currency0 and UP when it is currency1.
        bool zeroForOne = baseIsCurrency0;
        uint160 limit = zeroForOne ? uint160(uint256(ref) * 9 / 10) : uint160(uint256(ref) * 10 / 9);
        bytes memory call_ = abi.encodeCall(
            CLPoolManagerRouter.swap,
            (
                key,
                ICLPoolManager.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(1e27), sqrtPriceLimitX96: limit}),
                CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
                bytes("")
            )
        );
        vm.prank(trader);
        (bool ok, bytes memory ret) = address(d.router).call(call_);
        require(!ok, string.concat("expected revert: ", label));
        require(_hasSelector(ret, selector), string.concat("wrong revert reason: ", label));
    }

    function _removeHalf(Deployment memory d, PoolKey memory key, uint160 ref, address trader) internal {
        int24 tick = TickMath.getTickAtSqrtRatio(ref);
        vm.prank(trader);
        d.router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: ((tick - RANGE_TICKS) / TICK_SPACING) * TICK_SPACING,
                tickUpper: ((tick + RANGE_TICKS) / TICK_SPACING) * TICK_SPACING,
                liquidityDelta: -LIQUIDITY / 2,
                salt: bytes32(0)
            }),
            ""
        );
    }
}

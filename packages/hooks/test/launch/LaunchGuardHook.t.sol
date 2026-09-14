// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "infinity-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {Hooks} from "infinity-core/src/libraries/Hooks.sol";
import {CustomRevert} from "infinity-core/src/libraries/CustomRevert.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {TokenFixture} from "infinity-core/test/helpers/TokenFixture.sol";
import {SortTokens} from "infinity-core/test/helpers/SortTokens.sol";
import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {BaseCLHook} from "../../src/base/BaseCLHook.sol";
import {LaunchGuardHook, ILaunchTokenOrigin} from "../../src/launch/LaunchGuardHook.sol";

/// @dev A `LaunchGuardHook` that records the `sender` argument core hands to `beforeSwap`.
/// Used only by `test_sender_isTheLockerNotTheBuyer` to pin the constraint the whole design rests
/// on. Behaviour is otherwise identical to the production hook.
contract SenderRecordingLaunchGuardHook is LaunchGuardHook {
    address public lastSwapSender;
    uint256 public swapCount;

    constructor(ICLPoolManager _pm) LaunchGuardHook(_pm, ILaunchTokenOrigin(address(0))) {}

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        lastSwapSender = sender;
        swapCount++;
        return super._beforeSwap(sender, key, params, hookData);
    }
}

/// @dev Stands in for `LaunchTokenFactory.deployerOf`.
contract MockLaunchTokenOrigin {
    mapping(address token => address deployer) public deployerOf;

    function set(address token, address deployer) external {
        deployerOf[token] = deployer;
    }
}

contract LaunchGuardHookTest is Test, Deployers, TokenFixture {
    using LPFeeLibrary for uint24;

    Vault vault;
    CLPoolManager poolManager;
    LaunchGuardHook hook;
    CLPoolManagerRouter router;

    PoolKey key;
    PoolId poolId;

    /// @dev Foundry starts tests at timestamp 1; the default launch opens 100 seconds later.
    uint40 constant START_TIME = 101;
    uint32 constant DECAY_SECONDS = 100;
    uint24 constant INITIAL_FEE = 300_000; // 30%
    uint24 constant FINAL_FEE = 3_000; // 0.30%

    int256 constant SWAP_AMOUNT = -10_000; // exact input, tiny relative to liquidity

    // Mirrors of the hook's events, so `vm.expectEmit` can match them.
    event LaunchClaimed(PoolId indexed poolId, address indexed owner);
    event LaunchConfigured(
        PoolId indexed poolId,
        address indexed owner,
        uint40 startTime,
        uint32 decaySeconds,
        uint24 initialFeeBips,
        uint24 finalFeeBips,
        uint128 maxBuyPerTx,
        bool launchTokenIsCurrency0,
        bool enabled
    );
    event LaunchStarted(PoolId indexed poolId, uint256 timestamp);


    function setUp() public {
        (vault, poolManager) = createFreshManager();
        hook = new LaunchGuardHook(poolManager, ILaunchTokenOrigin(address(0)));
        router = new CLPoolManagerRouter(vault, poolManager);

        initializeTokens();
        key = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 1);
        poolId = key.toId();

        hook.configureLaunch(key, _defaultConfig());
        poolManager.initialize(key, SQRT_RATIO_1_1);

        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router), type(uint256).max);
        router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({tickLower: -10, tickUpper: 10, liquidityDelta: 10_000 ether, salt: 0}),
            ZERO_BYTES
        );
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _key(IHooks _hook, uint24 fee, int24 tickSpacing) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: _hook,
            poolManager: poolManager,
            fee: fee,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(_hook.getHooksRegistrationBitmap())), tickSpacing
            )
        });
    }

    function _defaultConfig() internal pure returns (LaunchGuardHook.LaunchConfig memory) {
        return LaunchGuardHook.LaunchConfig({
            startTime: START_TIME,
            decaySeconds: DECAY_SECONDS,
            initialFeeBips: INITIAL_FEE,
            finalFeeBips: FINAL_FEE,
            maxBuyPerTx: 0,
            launchTokenIsCurrency0: false, // currency1 is the launched token => a buy is zeroForOne
            enabled: true
        });
    }

    /// @dev Core wraps a reverting hook in ERC-7751 `WrappedError`. Rebuild that envelope so tests
    /// can assert on the hook's own error rather than a generic failure.
    function _expectHookRevert(address hookAddr, bytes4 hookFn, bytes memory inner) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                hookAddr,
                hookFn,
                inner,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _swapParams(bool zeroForOne, int256 amountSpecified)
        internal
        pure
        returns (ICLPoolManager.SwapParams memory)
    {
        return ICLPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne ? SQRT_RATIO_1_2 : SQRT_RATIO_4_1
        });
    }

    function _swap(PoolKey memory k, bool zeroForOne, int256 amountSpecified) internal returns (BalanceDelta) {
        return router.swap(
            k,
            _swapParams(zeroForOne, amountSpecified),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ZERO_BYTES
        );
    }

    /// @dev Executes a swap and returns the fee the POOL actually charged, read out of core's own
    /// `Swap` event. This is the ground truth: it proves the override reached `CLPool.swap`,
    /// rather than merely proving the hook returned a number.
    function _swapAndReadAppliedFee(bool zeroForOne, int256 amountSpecified) internal returns (uint24 appliedFee) {
        vm.recordLogs();
        _swap(key, zeroForOne, amountSpecified);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(poolManager) && logs[i].topics[0] == ICLPoolManager.Swap.selector) {
                // Swap(PoolId indexed, address indexed, int128, int128, uint160, uint128, int24, uint24, uint16)
                (,,,,, uint24 fee,) =
                    abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24, uint16));
                return fee;
            }
        }
        revert("Swap event not found");
    }

    function _expectedFee(uint256 elapsed) internal pure returns (uint24) {
        if (elapsed >= DECAY_SECONDS) return FINAL_FEE;
        uint256 spread = INITIAL_FEE - FINAL_FEE;
        return uint24(INITIAL_FEE - (spread * elapsed) / DECAY_SECONDS);
    }

    /*//////////////////////////////////////////////////////////////
                             REGISTRATION
    //////////////////////////////////////////////////////////////*/

    function test_bitmap_declaresOnlyWhatIsImplemented() public view {
        // bit 0 (beforeInitialize) | bit 6 (beforeSwap) == 65. No returns-delta bit: core parses
        // the fee from beforeSwap unconditionally and only needs the delta flag for the delta.
        assertEq(hook.getHooksRegistrationBitmap(), uint16(65));
    }

    function test_feeCaps_stayWithinWhatCoreAccepts() public view {
        // Core reverts with LPFeeTooLarge above 1_000_000 for a CL pool. The hook's own caps are
        // strictly tighter, so a configured schedule can never produce a fee core would reject.
        assertLe(hook.MAX_INITIAL_FEE(), LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE);
        assertLe(hook.MAX_FINAL_FEE(), hook.MAX_INITIAL_FEE());
    }

    /*//////////////////////////////////////////////////////////////
                             CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_configure_claimsOwnershipAndStoresConfig() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        PoolId id = k.toId();
        address launcher = makeAddr("launcher");

        assertEq(hook.launchOwner(id), address(0));

        vm.expectEmit(true, true, false, true, address(hook));
        emit LaunchClaimed(id, launcher);
        vm.expectEmit(true, true, false, true, address(hook));
        emit LaunchConfigured(id, launcher, START_TIME, DECAY_SECONDS, INITIAL_FEE, FINAL_FEE, 0, false, true);

        vm.prank(launcher);
        hook.configureLaunch(k, _defaultConfig());

        LaunchGuardHook.Launch memory l = hook.getLaunch(id);
        assertEq(l.owner, launcher);
        assertEq(l.startTime, START_TIME);
        assertEq(l.decaySeconds, DECAY_SECONDS);
        assertEq(l.initialFeeBips, INITIAL_FEE);
        assertEq(l.finalFeeBips, FINAL_FEE);
        assertEq(l.maxBuyPerTx, 0);
        assertTrue(l.enabled);
        assertFalse(l.launched);
    }

    function test_configure_revertsOnForeignHookAddress() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        k.hooks = IHooks(makeAddr("someOtherHook"));
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.HookMismatch.selector, address(k.hooks)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_revertsOnForeignPoolManager() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        k.poolManager = IPoolManager(makeAddr("someOtherManager"));
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.PoolManagerMismatch.selector, address(k.poolManager)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_revertsOnStaticFeePool() public {
        PoolKey memory k = _key(hook, 3000, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.PoolMustUseDynamicFee.selector, uint24(3000)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_unauthorizedCallerCannotReconfigure() public {
        address attacker = makeAddr("attacker");
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 1_000;

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.NotLaunchOwner.selector, poolId, attacker));
        hook.configureLaunch(key, cfg);

        // untouched
        assertEq(hook.getLaunch(poolId).initialFeeBips, INITIAL_FEE);
    }

    function test_configure_ownerMayUpdateBeforeStartTime() public {
        vm.warp(START_TIME - 1);

        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 200_000;
        cfg.finalFeeBips = 1_000;
        cfg.maxBuyPerTx = 12345;
        hook.configureLaunch(key, cfg);

        LaunchGuardHook.Launch memory l = hook.getLaunch(poolId);
        assertEq(l.initialFeeBips, 200_000);
        assertEq(l.finalFeeBips, 1_000);
        assertEq(l.maxBuyPerTx, 12345);
        assertEq(l.owner, address(this)); // ownership unchanged by an update
    }

    function test_configure_frozenAtExactStartTime() public {
        vm.warp(START_TIME);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_TIME))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_frozenAfterStartTime() public {
        vm.warp(START_TIME + 1);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = uint40(START_TIME + 500);
        cfg.initialFeeBips = 500_000; // the rug attempt: spike the fee mid-launch

        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_TIME))
        );
        hook.configureLaunch(key, cfg);
    }

    function test_configure_frozenEvenLongAfterTheDecayWindow() public {
        vm.warp(START_TIME + DECAY_SECONDS + 1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_TIME))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_rejectsStartTimeInThePast() public {
        vm.warp(1000);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = 999;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidStartTime.selector, uint256(999), uint256(1000)));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_acceptsStartTimeEqualToNow() public {
        vm.warp(1000);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = 1000;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        hook.configureLaunch(k, cfg);
        assertEq(hook.getLaunch(k.toId()).startTime, 1000);

        // ...and it is immediately frozen, because the launch is already open.
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, k.toId(), uint256(1000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsStartTimeTooFarAhead() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = uint40(block.timestamp + hook.MAX_START_DELAY_SECONDS() + 1);
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.InvalidStartTime.selector, uint256(cfg.startTime), block.timestamp)
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsZeroDecaySeconds() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = 0;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecaySeconds.selector, uint32(0)));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsOversizedDecayWindow() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = hook.MAX_DECAY_SECONDS() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecaySeconds.selector, cfg.decaySeconds));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsRisingFeeSchedule() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 1_000;
        cfg.finalFeeBips = 2_000;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.InvalidFeeSchedule.selector, uint24(1_000), uint24(2_000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsInitialFeeAboveCap() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = hook.MAX_INITIAL_FEE() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.InvalidFeeSchedule.selector, cfg.initialFeeBips, FINAL_FEE)
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsFinalFeeAboveCap() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.finalFeeBips = hook.MAX_FINAL_FEE() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.InvalidFeeSchedule.selector, INITIAL_FEE, cfg.finalFeeBips)
        );
        hook.configureLaunch(k, cfg);
    }

    /// @dev RESIDUAL RISK, DELIBERATELY CAPTURED. Ownership is established by first-claim, so a
    /// front-runner can squat an unclaimed pool id and make that exact PoolKey unusable. The blast
    /// radius is bounded - the squatter gets no funds, and the launcher can move to another
    /// tickSpacing (a different pool id) or claim atomically in the same transaction that
    /// initializes and seeds the pool - but the race itself cannot be removed at this layer,
    /// because a PoolKey carries no field that could bind it to an intended owner. (Core rejects
    /// non-zero bits above `OFFSET_MOST_SIGNIFICANT_UNUSED_BITS` in `parameters`, so the owner
    /// cannot be smuggled into the key either.)
    function test_risk_unclaimedPoolIdCanBeSquattedByAFrontRunner() public {
        PoolKey memory victimKey = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        PoolId victimId = victimKey.toId();

        address squatter = makeAddr("squatter");
        LaunchGuardHook.LaunchConfig memory hostile = _defaultConfig();
        hostile.startTime = uint40(block.timestamp + hook.MAX_START_DELAY_SECONDS()); // never opens in practice
        vm.prank(squatter);
        hook.configureLaunch(victimKey, hostile);

        // The real launcher is now locked out of this exact PoolKey.
        address launcher = makeAddr("launcher");
        vm.prank(launcher);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.NotLaunchOwner.selector, victimId, launcher));
        hook.configureLaunch(victimKey, _defaultConfig());

        // ...but only that key. A different tickSpacing is a different pool id, still free.
        PoolKey memory escapeKey = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 61);
        vm.prank(launcher);
        hook.configureLaunch(escapeKey, _defaultConfig());
        assertEq(hook.launchOwner(escapeKey.toId()), launcher);

        // And the squatter never gains custody of anything: the pool was never initialized and
        // the hook holds no funds at any point.
        assertEq(MockERC20(Currency.unwrap(currency0)).balanceOf(address(hook)), 0);
        assertEq(MockERC20(Currency.unwrap(currency1)).balanceOf(address(hook)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                              INITIALIZE
    //////////////////////////////////////////////////////////////*/

    function test_initialize_revertsWhenPoolIsNotConfigured() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeInitialize.selector,
            abi.encodeWithSelector(LaunchGuardHook.LaunchNotConfigured.selector, k.toId())
        );
        poolManager.initialize(k, SQRT_RATIO_1_1);
    }

    /// @dev The single most important negative test. On a static-fee pool `CLHooks.beforeSwap`
    /// silently DISCARDS the fee the hook returns, so the launch tax would be a no-op that nobody
    /// notices until after the snipe. The hook refuses to let such a pool exist.
    function test_initialize_revertsOnStaticFeePool() public {
        LaunchGuardHook openHook = new LaunchGuardHook(poolManager, ILaunchTokenOrigin(address(0)));
        PoolKey memory k = _key(openHook, 3000, 60);

        // Prove the static-fee pool is otherwise perfectly valid to core: same bitmap, same shape.
        assertEq(openHook.getHooksRegistrationBitmap(), hook.getHooksRegistrationBitmap());

        _expectHookRevert(
            address(openHook),
            ICLHooks.beforeInitialize.selector,
            abi.encodeWithSelector(LaunchGuardHook.PoolMustUseDynamicFee.selector, uint24(3000))
        );
        poolManager.initialize(k, SQRT_RATIO_1_1);
    }

    /*//////////////////////////////////////////////////////////////
                            THE LAUNCH GATE
    //////////////////////////////////////////////////////////////*/

    function test_swap_revertsBeforeStartTime() public {
        vm.warp(START_TIME - 1);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                LaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_TIME), uint256(START_TIME - 1)
            )
        );
        _swap(key, true, SWAP_AMOUNT);
    }

    function test_swap_revertsBeforeStartTime_inBothDirections() public {
        vm.warp(START_TIME - 1);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                LaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_TIME), uint256(START_TIME - 1)
            )
        );
        _swap(key, false, SWAP_AMOUNT);
    }

    function test_swap_succeedsAtExactStartTime() public {
        vm.warp(START_TIME);
        uint24 applied = _swapAndReadAppliedFee(true, SWAP_AMOUNT);
        assertEq(applied, INITIAL_FEE);
    }

    function test_launchStarted_emittedOnceOnFirstSwap() public {
        vm.warp(START_TIME);

        vm.expectEmit(true, false, false, true, address(hook));
        emit LaunchStarted(poolId, START_TIME);
        _swap(key, true, SWAP_AMOUNT);
        assertTrue(hook.getLaunch(poolId).launched);

        // A second swap must NOT re-emit.
        vm.warp(START_TIME + 5);
        vm.recordLogs();
        _swap(key, true, SWAP_AMOUNT);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(hook)) {
                assertTrue(logs[i].topics[0] != LaunchStarted.selector, "LaunchStarted re-emitted");
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                          FEE DECAY BOUNDARIES
    //////////////////////////////////////////////////////////////*/

    function test_decay_second0IsExactlyInitialFee() public {
        vm.warp(START_TIME);
        assertEq(hook.currentFee(poolId), INITIAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), INITIAL_FEE);
    }

    function test_decay_midWindow() public {
        vm.warp(START_TIME + 50);
        uint24 expected = _expectedFee(50);
        assertEq(expected, 151_500);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_decay_lastSecondOfWindowIsStillTaxed() public {
        // The window is half-open: [startTime, startTime + decaySeconds). The final block inside
        // it must still charge strictly more than the post-launch fee.
        vm.warp(START_TIME + DECAY_SECONDS - 1);
        uint24 expected = _expectedFee(DECAY_SECONDS - 1);
        assertEq(expected, 5_970);
        assertGt(expected, FINAL_FEE);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_decay_exactEndOfWindowIsFinalFee() public {
        vm.warp(START_TIME + DECAY_SECONDS);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_decay_longAfterWindowIsFinalFee() public {
        vm.warp(START_TIME + DECAY_SECONDS + 5_000_000);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_decay_appliesToSellsToo() public {
        vm.warp(START_TIME);
        assertEq(_swapAndReadAppliedFee(false, SWAP_AMOUNT), INITIAL_FEE);
    }

    /// @dev Ties the returned fee to real economics, not just to the emitted number: a ~1:1 pool
    /// must return output reduced by exactly the decayed fee.
    function test_decay_isEconomicallyRealNotJustReported() public {
        vm.warp(START_TIME + 50);
        uint256 expectedFee = _expectedFee(50);
        BalanceDelta delta = _swap(key, true, SWAP_AMOUNT);

        assertEq(delta.amount0(), SWAP_AMOUNT);
        uint256 amountIn = uint256(-SWAP_AMOUNT);
        assertApproxEqAbs(uint256(int256(delta.amount1())), amountIn * (1e6 - expectedFee) / 1e6, 1);
    }

    function test_decay_feeIsNeverWrittenToPoolStorage() public {
        vm.warp(START_TIME);
        _swap(key, true, SWAP_AMOUNT);
        (,,, uint24 storedLpFee) = poolManager.getSlot0(poolId);
        // Dynamic-fee pools store 0 and the hook never calls updateDynamicLPFee: the override is
        // per-swap only. This is why EVERY beforeSwap path must return an override.
        assertEq(storedLpFee, 0);
    }

    function test_feeAt_revertsForUnconfiguredPool() public {
        PoolId unknown = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60).toId();
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchNotConfigured.selector, unknown));
        hook.feeAt(unknown, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                            DISABLED LAUNCH
    //////////////////////////////////////////////////////////////*/

    function test_disabled_appliesFinalFeeAndNoGate() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        hook.configureLaunch(key, cfg);

        // Before startTime, and yet tradeable: the gate is part of the protection, not the pool.
        vm.warp(START_TIME - 1);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_disabled_stillOverridesSoThePoolIsNeverFeeFree() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        cfg.finalFeeBips = 500;
        hook.configureLaunch(key, cfg);

        vm.warp(START_TIME - 1);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), 500);
    }

    /*//////////////////////////////////////////////////////////////
                       PER-TRANSACTION BUY CAP

        NOTE: this is a per-TRANSACTION cap and nothing more. See
        `test_maxBuy_doesNotStopSplittingAcrossTransactions`.
    //////////////////////////////////////////////////////////////*/

    function _configureWithCap(uint128 cap) internal {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.maxBuyPerTx = cap;
        hook.configureLaunch(key, cfg);
    }

    function test_maxBuy_allowsBuyAtExactlyTheCap() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);
        _swap(key, true, -5_000); // exactly at the cap
    }

    function test_maxBuy_rejectsBuyOneWeiOverTheCap() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(5_001), uint128(5_000))
        );
        _swap(key, true, -5_001);
    }

    function test_maxBuy_doesNotConstrainSells() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);
        // currency1 is the launch token, so oneForZero is a SELL and is uncapped by design.
        _swap(key, false, -50_000);
    }

    function test_maxBuy_directionFollowsLaunchTokenSide() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.maxBuyPerTx = 5_000;
        cfg.launchTokenIsCurrency0 = true; // now oneForZero is the buy
        hook.configureLaunch(key, cfg);
        vm.warp(START_TIME);

        _swap(key, true, -50_000); // zeroForOne is now a sell: uncapped

        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(5_001), uint128(5_000))
        );
        _swap(key, false, -5_001);
    }

    function test_maxBuy_blocksExactOutputBuysWhileCapIsLive() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.ExactOutputBuyBlockedDuringLaunch.selector)
        );
        _swap(key, true, 1_000); // positive == exact output; input amount is unknowable here
    }

    function test_maxBuy_exactOutputSellsAreUnaffected() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);
        _swap(key, false, 1_000);
    }

    function test_maxBuy_liftsAfterTheDecayWindow() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME + DECAY_SECONDS);
        _swap(key, true, -500_000); // far above the cap, but the window has closed
        _swap(key, true, 1_000); // exact-output buys are permitted again too
    }

    function test_maxBuy_zeroMeansDisabled() public {
        _configureWithCap(0);
        vm.warp(START_TIME);
        _swap(key, true, -500_000);
        _swap(key, true, 1_000);
    }

    /// @dev Documents the limit of the cap: it is per-transaction, so an entity that wants more
    /// than the cap simply sends more transactions. This is not a bug to be fixed at this layer.
    function test_maxBuy_doesNotStopSplittingAcrossTransactions() public {
        _configureWithCap(5_000);
        vm.warp(START_TIME);

        // Ten separate buys in the SAME block, each at the cap, from ten different addresses.
        // Total acquired is 10x the "max buy". The hook cannot tell them apart and does not try.
        for (uint256 i = 0; i < 10; i++) {
            address buyer = address(uint160(0xB0B0000 + i));
            MockERC20(Currency.unwrap(currency0)).mint(buyer, 1 ether);
            vm.startPrank(buyer);
            MockERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
            _swap(key, true, -5_000);
            vm.stopPrank();
        }
        assertEq(block.timestamp, START_TIME); // all in one block
    }

    /*//////////////////////////////////////////////////////////////
                          onlyPoolManager GUARD
    //////////////////////////////////////////////////////////////*/

    function test_onlyPoolManager_beforeSwapIsUnreachableDirectly() public {
        vm.warp(START_TIME);
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, _swapParams(true, SWAP_AMOUNT), ZERO_BYTES);
    }

    function test_onlyPoolManager_beforeInitializeIsUnreachableDirectly() public {
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), key, SQRT_RATIO_1_1);
    }

    function test_onlyPoolManager_alsoBlocksTheLaunchOwner() public {
        // The gate is on the caller, not on privilege: even the launch owner cannot fake a swap
        // and flip the `launched` flag or drive the hook's accounting.
        vm.warp(START_TIME);
        assertEq(hook.launchOwner(poolId), address(this));
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, _swapParams(true, SWAP_AMOUNT), ZERO_BYTES);
        assertFalse(hook.getLaunch(poolId).launched);
    }

    function test_onlyPoolManager_unimplementedCallbacksStillRevertForOutsiders() public {
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, SQRT_RATIO_1_1, 0);
    }

    /*//////////////////////////////////////////////////////////////
        THE `sender` CONSTRAINT — CAPTURED IN THE SUITE ON PURPOSE

        `CLHooks.beforeSwap` calls the hook with `msg.sender` of `CLPoolManager.swap`, which is
        whoever locked the Vault: the ROUTER. It is never the buyer. Any per-wallet rule keyed on
        this argument would be consumed by the first buyer on everyone's behalf, which is why this
        hook taxes time instead of identity.
    //////////////////////////////////////////////////////////////*/

    function test_sender_isTheLockerNotTheBuyer() public {
        SenderRecordingLaunchGuardHook spy = new SenderRecordingLaunchGuardHook(poolManager);
        PoolKey memory k = _key(spy, LPFeeLibrary.DYNAMIC_FEE_FLAG, 1);
        spy.configureLaunch(k, _defaultConfig());
        poolManager.initialize(k, SQRT_RATIO_1_1);

        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router), type(uint256).max);
        router.modifyPosition(
            k,
            ICLPoolManager.ModifyLiquidityParams({tickLower: -10, tickUpper: 10, liquidityDelta: 10_000 ether, salt: 0}),
            ZERO_BYTES
        );

        vm.warp(START_TIME);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        MockERC20(Currency.unwrap(currency0)).mint(alice, 1 ether);
        MockERC20(Currency.unwrap(currency0)).mint(bob, 1 ether);

        vm.startPrank(alice);
        MockERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        _swap(k, true, SWAP_AMOUNT);
        vm.stopPrank();
        address senderSeenForAlice = spy.lastSwapSender();

        vm.startPrank(bob);
        MockERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        _swap(k, true, SWAP_AMOUNT);
        vm.stopPrank();
        address senderSeenForBob = spy.lastSwapSender();

        assertEq(spy.swapCount(), 2);

        // The hook saw the router both times, never the buyer.
        assertEq(senderSeenForAlice, address(router));
        assertEq(senderSeenForBob, address(router));
        assertEq(senderSeenForAlice, senderSeenForBob);
        assertTrue(senderSeenForAlice != alice);
        assertTrue(senderSeenForBob != bob);
    }

    /// @dev Second half of the same constraint: a caller who bypasses the router and locks the
    /// Vault himself presents whatever `sender` he likes (his own contract) and whatever
    /// `hookData` he likes. Neither can be used as an identity.
    function test_sender_aSecondRouterPresentsADifferentSenderEntirely() public {
        SenderRecordingLaunchGuardHook spy = new SenderRecordingLaunchGuardHook(poolManager);
        PoolKey memory k = _key(spy, LPFeeLibrary.DYNAMIC_FEE_FLAG, 1);
        spy.configureLaunch(k, _defaultConfig());
        poolManager.initialize(k, SQRT_RATIO_1_1);

        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router), type(uint256).max);
        router.modifyPosition(
            k,
            ICLPoolManager.ModifyLiquidityParams({tickLower: -10, tickUpper: 10, liquidityDelta: 10_000 ether, salt: 0}),
            ZERO_BYTES
        );

        CLPoolManagerRouter rogue = new CLPoolManagerRouter(vault, poolManager);
        IERC20(Currency.unwrap(currency0)).approve(address(rogue), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(rogue), type(uint256).max);

        vm.warp(START_TIME);

        _swap(k, true, SWAP_AMOUNT);
        assertEq(spy.lastSwapSender(), address(router));

        rogue.swap(
            k,
            _swapParams(true, SWAP_AMOUNT),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            // arbitrary attacker-chosen hookData naming a victim: unverifiable, hence unused
            abi.encode(makeAddr("someVictim"))
        );
        assertEq(spy.lastSwapSender(), address(rogue));
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @dev Reconfigures the pool's schedule and returns the (frozen) start time. Safe to call
    /// repeatedly because the fuzz tests never roll past `START_TIME`.
    function _fuzzConfigure(uint24 initialFee, uint24 finalFee, uint32 decaySeconds)
        internal
        returns (uint24, uint24, uint32)
    {
        finalFee = uint24(bound(finalFee, 0, hook.MAX_FINAL_FEE()));
        initialFee = uint24(bound(initialFee, finalFee, hook.MAX_INITIAL_FEE()));
        decaySeconds = uint32(bound(decaySeconds, hook.MIN_DECAY_SECONDS(), hook.MAX_DECAY_SECONDS()));

        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = initialFee;
        cfg.finalFeeBips = finalFee;
        cfg.decaySeconds = decaySeconds;
        hook.configureLaunch(key, cfg);

        return (initialFee, finalFee, decaySeconds);
    }

    function testFuzz_decay_alwaysInRangeAndMonotonicNonIncreasing(
        uint24 initialFee,
        uint24 finalFee,
        uint32 decaySeconds
    ) public {
        (initialFee, finalFee, decaySeconds) = _fuzzConfigure(initialFee, finalFee, decaySeconds);

        // Boundary anchors.
        assertEq(hook.feeAt(poolId, START_TIME), initialFee, "block 0 != initialFee");
        assertEq(hook.feeAt(poolId, uint256(START_TIME) + decaySeconds), finalFee, "end of window != finalFee");
        assertEq(hook.feeAt(poolId, uint256(START_TIME) + decaySeconds + 1), finalFee, "after window != finalFee");
        assertEq(
            hook.feeAt(poolId, uint256(START_TIME) + uint256(decaySeconds) * 1000), finalFee, "far future != finalFee"
        );

        // Sweep the window on an ascending ladder of offsets and check range + monotonicity.
        uint24 previous = type(uint24).max;
        for (uint256 i = 0; i <= 34; i++) {
            uint256 offset = i <= 32 ? (uint256(decaySeconds) * i) / 32 : (i == 33 ? decaySeconds : decaySeconds + 1);
            uint24 fee = hook.feeAt(poolId, uint256(START_TIME) + offset);

            assertLe(fee, initialFee, "fee above initialFee");
            assertGe(fee, finalFee, "fee below finalFee");
            // Never exceeds what core will accept for a CL pool.
            assertLe(fee, LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE, "fee above core max");
            assertLe(fee, previous, "fee increased");
            previous = fee;
        }
    }

    function testFuzz_decay_pairwiseMonotonic(
        uint24 initialFee,
        uint24 finalFee,
        uint32 decaySeconds,
        uint32 offsetA,
        uint32 offsetB
    ) public {
        (initialFee, finalFee, decaySeconds) = _fuzzConfigure(initialFee, finalFee, decaySeconds);

        uint256 lo = bound(offsetA, 0, uint256(decaySeconds) * 2);
        uint256 hi = bound(offsetB, lo, uint256(decaySeconds) * 2 + 1);

        uint24 feeLo = hook.feeAt(poolId, uint256(START_TIME) + lo);
        uint24 feeHi = hook.feeAt(poolId, uint256(START_TIME) + hi);

        assertGe(feeLo, feeHi, "later block charged more");
        assertLe(feeLo, initialFee);
        assertGe(feeHi, finalFee);
    }

    /// @dev The fee the hook hands to core must always carry the override flag and must always
    /// survive core's own `removeOverrideAndValidate`.
    function testFuzz_decay_appliedFeeMatchesSchedule(uint24 initialFee, uint24 finalFee, uint32 decaySeconds, uint16 elapsed)
        public
    {
        decaySeconds = uint32(bound(decaySeconds, hook.MIN_DECAY_SECONDS(), 5_000));
        (initialFee, finalFee, decaySeconds) = _fuzzConfigure(initialFee, finalFee, decaySeconds);

        uint256 offset = bound(elapsed, 0, uint256(decaySeconds) + 10);
        vm.warp(uint256(START_TIME) + offset);

        uint24 expected = hook.currentFee(poolId);
        uint24 applied = _swapAndReadAppliedFee(true, SWAP_AMOUNT);
        assertEq(applied, expected);
        assertLe(applied, LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE);
    }

    /*//////////////////////////////////////////////////////////////
       THE CLOCK IS block.timestamp NOW, AND ONLY block.timestamp

       The retired hook measured everything in `block.timestamp`, sized through a
       `blockTimeCentis` argument. On Robinhood (Arbitrum Nitro) the EVM's
       `block.timestamp` is Ethereum's ~12 s block while the RPC shows ~0.1 s L2
       blocks, the deployment was built for the wrong one, and every window ran
       ~120x long - a 30-day cap became ~9.9 years. These tests pin the new clock:
       rolling blocks without moving time must change nothing, and moving time
       without rolling blocks must change everything.

       FAILING-FIRST: every `test_CLOCK_*` below fails against the block-numbered
       source, where `vm.roll` opened trading and `vm.warp` did nothing.
    //////////////////////////////////////////////////////////////*/

    function test_CLOCK_modeIsTimestamp() public {
        assertEq(hook.CLOCK_MODE(), "mode=timestamp");
        vm.warp(1_790_000_000);
        assertEq(hook.clock(), 1_790_000_000);
    }

    function test_CLOCK_blocksAloneNeverOpenTrading() public {
        // A hundred million blocks later, but not one second: the gate must still hold.
        vm.roll(block.number + 100_000_000);
        assertLt(block.timestamp, START_TIME);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_TIME), block.timestamp)
        );
        _swap(key, true, SWAP_AMOUNT);
    }

    function test_CLOCK_timeAloneOpensTradingAndDrivesTheDecay() public {
        uint256 blockBefore = block.number;
        vm.warp(START_TIME + DECAY_SECONDS / 2);
        assertEq(block.number, blockBefore, "no block was rolled");
        uint24 expected = INITIAL_FEE - uint24((uint256(INITIAL_FEE - FINAL_FEE) * (DECAY_SECONDS / 2)) / DECAY_SECONDS);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_CLOCK_blocksDoNotAdvanceTheDecay() public {
        vm.warp(START_TIME);
        uint24 atOpen = hook.currentFee(poolId);
        vm.roll(block.number + 50_000_000);
        assertEq(hook.currentFee(poolId), atOpen, "rolling blocks moved the fee");
        assertEq(atOpen, INITIAL_FEE);
    }

    /*//////////////////////////////////////////////////////////////
       MINIMUM WINDOW - a sequencer skew must not erase the tax for free
    //////////////////////////////////////////////////////////////*/

    /// @dev The numbers the floor is justified by, pinned so a later edit has to argue with them.
    function test_MINWINDOW_floorIsSixtySecondsAndBelowEveryPreset() public view {
        assertEq(hook.MIN_DECAY_SECONDS(), 60);
        // At least 4x the ~15 s resync granularity of the block-number clock it replaces.
        assertGe(uint256(hook.MIN_DECAY_SECONDS()), 4 * 15);
        // Never above the shortest owner-decided preset (Stealth, 120 s).
        assertLe(uint256(hook.MIN_DECAY_SECONDS()), 120);
    }

    /// @dev MUTATION-CHECKED: replacing `cfg.decaySeconds < MIN_DECAY_SECONDS` with `== 0` makes
    /// this fail at 59 s.
    function test_MINWINDOW_rejectsOneSecondBelowTheFloor() public {
        vm.warp(START_TIME - 10);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = hook.MIN_DECAY_SECONDS() - 1;
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecaySeconds.selector, uint32(59)));
        hook.configureLaunch(key, cfg);
    }

    function test_MINWINDOW_acceptsExactlyTheFloor() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = hook.MIN_DECAY_SECONDS();
        hook.configureLaunch(key, cfg);
        assertEq(hook.getLaunch(poolId).decaySeconds, 60);
    }

    /// @dev The floor is not waived for a disabled launch: a later write could re-enable it.
    function test_MINWINDOW_appliesToDisabledLaunchesToo() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        cfg.decaySeconds = 1;
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecaySeconds.selector, uint32(1)));
        hook.configureLaunch(key, cfg);
    }

    function testFuzz_MINWINDOW_acceptedIffInsideBounds(uint32 decaySeconds) public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = decaySeconds;
        if (decaySeconds < hook.MIN_DECAY_SECONDS() || decaySeconds > hook.MAX_DECAY_SECONDS()) {
            vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecaySeconds.selector, decaySeconds));
            hook.configureLaunch(key, cfg);
        } else {
            hook.configureLaunch(key, cfg);
            assertEq(hook.getLaunch(poolId).decaySeconds, decaySeconds);
        }
    }

    /// @dev THE RESIDUAL RISK, asserted rather than papered over. A Nitro sequencer may stamp a
    /// block up to one hour ahead of real time. A 120 s window is then over in the first block
    /// after the jump. The floor does not and cannot stop this; the trust assumption is on the
    /// chain operator, as the contract-level CLOCK note says.
    function test_SKEW_aOneHourForwardJumpErasesAShortWindow() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = 120;
        hook.configureLaunch(key, cfg);
        vm.warp(START_TIME + 1 hours);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
    }

    /// @dev The honest-skew case the floor IS sized for: a 6 s jump on the minimum window leaves
    /// at least 90% of the spread still being charged at the moment of the jump.
    function test_SKEW_aSixSecondJumpOnTheFloorLeavesNinetyPercentOfTheTax() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = hook.MIN_DECAY_SECONDS();
        hook.configureLaunch(key, cfg);
        vm.warp(START_TIME + 6);
        uint256 remaining = uint256(hook.currentFee(poolId) - FINAL_FEE);
        assertGe(remaining * 10, uint256(INITIAL_FEE - FINAL_FEE) * 9);
    }

    /*//////////////////////////////////////////////////////////////
       THE "NO PERMANENT TAX" ENVELOPE
    //////////////////////////////////////////////////////////////*/

    function test_ENVELOPE_capsSitInsideTheDesignBounds() public view {
        assertEq(uint256(hook.MAX_DECAY_SECONDS()), 30 days);
        assertEq(uint256(hook.MAX_START_DELAY_SECONDS()), 30 days);
        assertGe(uint256(hook.MAX_DECAY_SECONDS()), hook.MIN_LAUNCH_WINDOW_SECONDS(), "a 3-day launch must fit");
        assertLe(
            uint256(hook.MAX_START_DELAY_SECONDS()) + hook.MAX_DECAY_SECONDS(),
            hook.MAX_LAUNCH_WINDOW_SECONDS(),
            "start + decay must end inside 180 days"
        );
    }

    /// @dev The worst a hostile launch owner can configure: the latest start and the longest
    /// decay. Sixty days after that write, the fee is `finalFeeBips` and can never move again.
    function test_ENVELOPE_worstCaseTaxIsGoneWithinSixtyDays() public {
        uint256 t = block.timestamp;
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = uint40(t + hook.MAX_START_DELAY_SECONDS());
        cfg.decaySeconds = hook.MAX_DECAY_SECONDS();
        hook.configureLaunch(key, cfg);

        vm.warp(t + 60 days - 1);
        assertGt(hook.currentFee(poolId), FINAL_FEE, "still inside the window one second before");
        vm.warp(t + 60 days);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
    }

    function test_ENVELOPE_aThreeDayFairLaunchConfigures() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decaySeconds = 3 days;
        hook.configureLaunch(key, cfg);
        assertEq(hook.getLaunch(poolId).decaySeconds, 3 days);
    }

    function test_ENVELOPE_startExactlyAtTheCapIsAccepted() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startTime = uint40(block.timestamp + hook.MAX_START_DELAY_SECONDS());
        hook.configureLaunch(key, cfg);
        assertEq(hook.getLaunch(poolId).startTime, cfg.startTime);
    }

    /*//////////////////////////////////////////////////////////////
       POOL-ID RESERVATION (owner decision 2026-09-14, Kit v2 #4)

       FAILING-FIRST: against the pre-reservation hook, every front-runner
       below claimed the pool and the kit's own claim reverted NotLaunchOwner.
       MUTATION-CHECKED: deleting the two `_requireMayClaim` calls in
       `configureLaunch` turns test_RESERVE_frontRunnerCannotClaimAFactoryTokenPool
       and test_RESERVE_noClaimOnACurrencyWithoutCode red.
    //////////////////////////////////////////////////////////////*/

    address constant KIT = address(0x6B17);
    address constant CREATOR = address(0xC4EA);
    address constant FRONT_RUNNER = address(0xF4A7);

    function _reservingHook() internal returns (LaunchGuardHook rh, MockLaunchTokenOrigin origin, PoolKey memory k) {
        origin = new MockLaunchTokenOrigin();
        rh = new LaunchGuardHook(poolManager, ILaunchTokenOrigin(address(origin)));
        k = _key(rh, LPFeeLibrary.DYNAMIC_FEE_FLAG, 1);
    }

    function test_RESERVE_frontRunnerCannotClaimAFactoryTokenPool() public {
        (LaunchGuardHook rh, MockLaunchTokenOrigin origin, PoolKey memory k) = _reservingHook();
        address token = Currency.unwrap(k.currency1);
        origin.set(token, KIT); // the kit created the launch token

        vm.prank(FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchPoolReserved.selector, token, KIT, FRONT_RUNNER));
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), address(0), "nobody claimed it");

        // ...and without a claim nobody can initialize it either.
        _expectHookRevert(
            address(rh),
            ICLHooks.beforeInitialize.selector,
            abi.encodeWithSelector(LaunchGuardHook.LaunchNotConfigured.selector, k.toId())
        );
        vm.prank(FRONT_RUNNER);
        poolManager.initialize(k, SQRT_RATIO_1_1);

        // The kit path succeeds.
        vm.prank(KIT);
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), KIT);
        poolManager.initialize(k, SQRT_RATIO_1_1);
    }

    function test_RESERVE_creatorMayDelegateTheClaimToAKit() public {
        (LaunchGuardHook rh, MockLaunchTokenOrigin origin, PoolKey memory k) = _reservingHook();
        address token = Currency.unwrap(k.currency0);
        origin.set(token, CREATOR);

        vm.prank(KIT);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchPoolReserved.selector, token, CREATOR, KIT));
        rh.configureLaunch(k, _defaultConfig());

        vm.prank(FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.NotTokenCreator.selector, token, FRONT_RUNNER));
        rh.setLaunchClaimer(token, FRONT_RUNNER);

        vm.prank(CREATOR);
        rh.setLaunchClaimer(token, KIT);
        assertEq(rh.launchClaimerOf(token), KIT);

        vm.prank(FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchPoolReserved.selector, token, CREATOR, FRONT_RUNNER));
        rh.configureLaunch(k, _defaultConfig());

        vm.prank(KIT);
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), KIT);
    }

    function test_RESERVE_creatorItselfMayClaim() public {
        (LaunchGuardHook rh, MockLaunchTokenOrigin origin, PoolKey memory k) = _reservingHook();
        origin.set(Currency.unwrap(k.currency1), CREATOR);
        vm.prank(CREATOR);
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), CREATOR);
    }

    /// @dev Rule 1: a token that does not exist YET cannot have its pool squatted.
    function test_RESERVE_noClaimOnACurrencyWithoutCode() public {
        (LaunchGuardHook rh,, PoolKey memory k) = _reservingHook();
        address notYetDeployed = address(uint160(0xDEAD0001));
        k.currency1 = Currency.wrap(notYetDeployed);
        vm.prank(FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.CurrencyHasNoCode.selector, notYetDeployed));
        rh.configureLaunch(k, _defaultConfig());
    }

    /// @dev Non-factory tokens: first claim, exactly as before - including on the hook with no factory.
    function test_RESERVE_nonFactoryPoolsAreUnaffected() public {
        (LaunchGuardHook rh,, PoolKey memory k) = _reservingHook();
        vm.prank(FRONT_RUNNER);
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), FRONT_RUNNER, "first claim, as before");

        LaunchGuardHook plain = new LaunchGuardHook(poolManager, ILaunchTokenOrigin(address(0)));
        PoolKey memory pk = _key(plain, LPFeeLibrary.DYNAMIC_FEE_FLAG, 1);
        vm.prank(FRONT_RUNNER);
        plain.configureLaunch(pk, _defaultConfig());
        assertEq(plain.launchOwner(pk.toId()), FRONT_RUNNER);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.NotTokenCreator.selector, address(1), address(this)));
        plain.setLaunchClaimer(address(1), KIT);
    }

    /// @dev The native asset is never "a currency without code".
    function test_RESERVE_nativeQuoteIsAllowed() public {
        (LaunchGuardHook rh,, PoolKey memory k) = _reservingHook();
        k.currency0 = Currency.wrap(address(0));
        rh.configureLaunch(k, _defaultConfig());
        assertEq(rh.launchOwner(k.toId()), address(this));
    }
}

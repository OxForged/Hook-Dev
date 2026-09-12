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
import {LaunchGuardHook} from "../../src/launch/LaunchGuardHook.sol";

/// @dev A `LaunchGuardHook` that records the `sender` argument core hands to `beforeSwap`.
/// Used only by `test_sender_isTheLockerNotTheBuyer` to pin the constraint the whole design rests
/// on. Behaviour is otherwise identical to the production hook.
contract SenderRecordingLaunchGuardHook is LaunchGuardHook {
    address public lastSwapSender;
    uint256 public swapCount;

    constructor(ICLPoolManager _pm, uint32 centis, uint32 maxDecay, uint48 maxStart)
        LaunchGuardHook(_pm, centis, maxDecay, maxStart)
    {}

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

contract LaunchGuardHookTest is Test, Deployers, TokenFixture {
    using LPFeeLibrary for uint24;

    Vault vault;
    CLPoolManager poolManager;
    LaunchGuardHook hook;
    CLPoolManagerRouter router;

    PoolKey key;
    PoolId poolId;

    /// @dev Foundry starts tests at block 1; the default launch opens 100 blocks later.
    uint48 constant START_BLOCK = 101;
    uint32 constant DECAY_BLOCKS = 100;
    uint24 constant INITIAL_FEE = 300_000; // 30%
    uint24 constant FINAL_FEE = 3_000; // 0.30%

    int256 constant SWAP_AMOUNT = -10_000; // exact input, tiny relative to liquidity

    // Mirrors of the hook's events, so `vm.expectEmit` can match them.
    event LaunchClaimed(PoolId indexed poolId, address indexed owner);
    event LaunchConfigured(
        PoolId indexed poolId,
        address indexed owner,
        uint48 startBlock,
        uint32 decayBlocks,
        uint24 initialFeeBips,
        uint24 finalFeeBips,
        uint128 maxBuyPerTx,
        bool launchTokenIsCurrency0,
        bool enabled
    );
    event LaunchStarted(PoolId indexed poolId, uint256 blockNumber);


    /* ------------------------------------------------------------------
       ROBINHOOD-LIKE PARAMETERS, on purpose.

       `MAX_DECAY_BLOCKS` and `MAX_START_DELAY` used to be `constant 1_000_000`,
       sized as "~139 days at 12s blocks". On Robinhood Chain (0.102s blocks)
       that is 28 HOURS, so a three-day fair launch reverted. Testing against 12s
       numbers is exactly what let that ship. 10 centis is Robinhood's block time
       rounded down; 26 000 000 blocks is ~30 days there.
       ------------------------------------------------------------------ */
    uint32 constant BLOCK_TIME_CENTIS = 10;
    uint32 constant MAX_DECAY = 26_000_000;
    uint48 constant MAX_START = 26_000_000;

    function setUp() public {
        (vault, poolManager) = createFreshManager();
        hook = new LaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
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
            startBlock: START_BLOCK,
            decayBlocks: DECAY_BLOCKS,
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
        if (elapsed >= DECAY_BLOCKS) return FINAL_FEE;
        uint256 spread = INITIAL_FEE - FINAL_FEE;
        return uint24(INITIAL_FEE - (spread * elapsed) / DECAY_BLOCKS);
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
        emit LaunchConfigured(id, launcher, START_BLOCK, DECAY_BLOCKS, INITIAL_FEE, FINAL_FEE, 0, false, true);

        vm.prank(launcher);
        hook.configureLaunch(k, _defaultConfig());

        LaunchGuardHook.Launch memory l = hook.getLaunch(id);
        assertEq(l.owner, launcher);
        assertEq(l.startBlock, START_BLOCK);
        assertEq(l.decayBlocks, DECAY_BLOCKS);
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

    function test_configure_ownerMayUpdateBeforeStartBlock() public {
        vm.roll(START_BLOCK - 1);

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

    function test_configure_frozenAtExactStartBlock() public {
        vm.roll(START_BLOCK);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_frozenAfterStartBlock() public {
        vm.roll(START_BLOCK + 1);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = uint48(START_BLOCK + 500);
        cfg.initialFeeBips = 500_000; // the rug attempt: spike the fee mid-launch

        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, cfg);
    }

    function test_configure_frozenEvenLongAfterTheDecayWindow() public {
        vm.roll(START_BLOCK + DECAY_BLOCKS + 1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_rejectsStartBlockInThePast() public {
        vm.roll(1000);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = 999;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidStartBlock.selector, uint256(999), uint256(1000)));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_acceptsStartBlockEqualToNow() public {
        vm.roll(1000);
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = 1000;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        hook.configureLaunch(k, cfg);
        assertEq(hook.getLaunch(k.toId()).startBlock, 1000);

        // ...and it is immediately frozen, because the launch is already open.
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, k.toId(), uint256(1000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsStartBlockTooFarAhead() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = uint48(block.number + hook.MAX_START_DELAY() + 1);
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.InvalidStartBlock.selector, uint256(cfg.startBlock), block.number)
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsZeroDecayBlocks() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decayBlocks = 0;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecayBlocks.selector, uint32(0)));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsOversizedDecayWindow() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decayBlocks = hook.MAX_DECAY_BLOCKS() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidDecayBlocks.selector, cfg.decayBlocks));
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
        hostile.startBlock = uint48(block.number + hook.MAX_START_DELAY()); // never opens in practice
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
        LaunchGuardHook openHook = new LaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
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

    function test_swap_revertsBeforeStartBlock() public {
        vm.roll(START_BLOCK - 1);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                LaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(key, true, SWAP_AMOUNT);
    }

    function test_swap_revertsBeforeStartBlock_inBothDirections() public {
        vm.roll(START_BLOCK - 1);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                LaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(key, false, SWAP_AMOUNT);
    }

    function test_swap_succeedsAtExactStartBlock() public {
        vm.roll(START_BLOCK);
        uint24 applied = _swapAndReadAppliedFee(true, SWAP_AMOUNT);
        assertEq(applied, INITIAL_FEE);
    }

    function test_launchStarted_emittedOnceOnFirstSwap() public {
        vm.roll(START_BLOCK);

        vm.expectEmit(true, false, false, true, address(hook));
        emit LaunchStarted(poolId, START_BLOCK);
        _swap(key, true, SWAP_AMOUNT);
        assertTrue(hook.getLaunch(poolId).launched);

        // A second swap must NOT re-emit.
        vm.roll(START_BLOCK + 5);
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

    function test_decay_block0IsExactlyInitialFee() public {
        vm.roll(START_BLOCK);
        assertEq(hook.currentFee(poolId), INITIAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), INITIAL_FEE);
    }

    function test_decay_midWindow() public {
        vm.roll(START_BLOCK + 50);
        uint24 expected = _expectedFee(50);
        assertEq(expected, 151_500);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_decay_lastBlockOfWindowIsStillTaxed() public {
        // The window is half-open: [startBlock, startBlock + decayBlocks). The final block inside
        // it must still charge strictly more than the post-launch fee.
        vm.roll(START_BLOCK + DECAY_BLOCKS - 1);
        uint24 expected = _expectedFee(DECAY_BLOCKS - 1);
        assertEq(expected, 5_970);
        assertGt(expected, FINAL_FEE);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_decay_exactEndOfWindowIsFinalFee() public {
        vm.roll(START_BLOCK + DECAY_BLOCKS);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_decay_longAfterWindowIsFinalFee() public {
        vm.roll(START_BLOCK + DECAY_BLOCKS + 5_000_000);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_decay_appliesToSellsToo() public {
        vm.roll(START_BLOCK);
        assertEq(_swapAndReadAppliedFee(false, SWAP_AMOUNT), INITIAL_FEE);
    }

    /// @dev Ties the returned fee to real economics, not just to the emitted number: a ~1:1 pool
    /// must return output reduced by exactly the decayed fee.
    function test_decay_isEconomicallyRealNotJustReported() public {
        vm.roll(START_BLOCK + 50);
        uint256 expectedFee = _expectedFee(50);
        BalanceDelta delta = _swap(key, true, SWAP_AMOUNT);

        assertEq(delta.amount0(), SWAP_AMOUNT);
        uint256 amountIn = uint256(-SWAP_AMOUNT);
        assertApproxEqAbs(uint256(int256(delta.amount1())), amountIn * (1e6 - expectedFee) / 1e6, 1);
    }

    function test_decay_feeIsNeverWrittenToPoolStorage() public {
        vm.roll(START_BLOCK);
        _swap(key, true, SWAP_AMOUNT);
        (,,, uint24 storedLpFee) = poolManager.getSlot0(poolId);
        // Dynamic-fee pools store 0 and the hook never calls updateDynamicLPFee: the override is
        // per-swap only. This is why EVERY beforeSwap path must return an override.
        assertEq(storedLpFee, 0);
    }

    function test_feeAt_revertsForUnconfiguredPool() public {
        PoolId unknown = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60).toId();
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.LaunchNotConfigured.selector, unknown));
        hook.feeAt(unknown, block.number);
    }

    /*//////////////////////////////////////////////////////////////
                            DISABLED LAUNCH
    //////////////////////////////////////////////////////////////*/

    function test_disabled_appliesFinalFeeAndNoGate() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        hook.configureLaunch(key, cfg);

        // Before startBlock, and yet tradeable: the gate is part of the protection, not the pool.
        vm.roll(START_BLOCK - 1);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_disabled_stillOverridesSoThePoolIsNeverFeeFree() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        cfg.finalFeeBips = 500;
        hook.configureLaunch(key, cfg);

        vm.roll(START_BLOCK - 1);
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
        vm.roll(START_BLOCK);
        _swap(key, true, -5_000); // exactly at the cap
    }

    function test_maxBuy_rejectsBuyOneWeiOverTheCap() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(5_001), uint128(5_000))
        );
        _swap(key, true, -5_001);
    }

    function test_maxBuy_doesNotConstrainSells() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);
        // currency1 is the launch token, so oneForZero is a SELL and is uncapped by design.
        _swap(key, false, -50_000);
    }

    function test_maxBuy_directionFollowsLaunchTokenSide() public {
        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.maxBuyPerTx = 5_000;
        cfg.launchTokenIsCurrency0 = true; // now oneForZero is the buy
        hook.configureLaunch(key, cfg);
        vm.roll(START_BLOCK);

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
        vm.roll(START_BLOCK);
        _expectHookRevert(
            address(hook),
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.ExactOutputBuyBlockedDuringLaunch.selector)
        );
        _swap(key, true, 1_000); // positive == exact output; input amount is unknowable here
    }

    function test_maxBuy_exactOutputSellsAreUnaffected() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);
        _swap(key, false, 1_000);
    }

    function test_maxBuy_liftsAfterTheDecayWindow() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK + DECAY_BLOCKS);
        _swap(key, true, -500_000); // far above the cap, but the window has closed
        _swap(key, true, 1_000); // exact-output buys are permitted again too
    }

    function test_maxBuy_zeroMeansDisabled() public {
        _configureWithCap(0);
        vm.roll(START_BLOCK);
        _swap(key, true, -500_000);
        _swap(key, true, 1_000);
    }

    /// @dev Documents the limit of the cap: it is per-transaction, so an entity that wants more
    /// than the cap simply sends more transactions. This is not a bug to be fixed at this layer.
    function test_maxBuy_doesNotStopSplittingAcrossTransactions() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);

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
        assertEq(block.number, START_BLOCK); // all in one block
    }

    /*//////////////////////////////////////////////////////////////
                          onlyPoolManager GUARD
    //////////////////////////////////////////////////////////////*/

    function test_onlyPoolManager_beforeSwapIsUnreachableDirectly() public {
        vm.roll(START_BLOCK);
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
        vm.roll(START_BLOCK);
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
        SenderRecordingLaunchGuardHook spy = new SenderRecordingLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
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

        vm.roll(START_BLOCK);

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
        SenderRecordingLaunchGuardHook spy = new SenderRecordingLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
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

        vm.roll(START_BLOCK);

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

    /// @dev Reconfigures the pool's schedule and returns the (frozen) start block. Safe to call
    /// repeatedly because the fuzz tests never roll past `START_BLOCK`.
    function _fuzzConfigure(uint24 initialFee, uint24 finalFee, uint32 decayBlocks)
        internal
        returns (uint24, uint24, uint32)
    {
        finalFee = uint24(bound(finalFee, 0, hook.MAX_FINAL_FEE()));
        initialFee = uint24(bound(initialFee, finalFee, hook.MAX_INITIAL_FEE()));
        decayBlocks = uint32(bound(decayBlocks, 1, hook.MAX_DECAY_BLOCKS()));

        LaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = initialFee;
        cfg.finalFeeBips = finalFee;
        cfg.decayBlocks = decayBlocks;
        hook.configureLaunch(key, cfg);

        return (initialFee, finalFee, decayBlocks);
    }

    function testFuzz_decay_alwaysInRangeAndMonotonicNonIncreasing(
        uint24 initialFee,
        uint24 finalFee,
        uint32 decayBlocks
    ) public {
        (initialFee, finalFee, decayBlocks) = _fuzzConfigure(initialFee, finalFee, decayBlocks);

        // Boundary anchors.
        assertEq(hook.feeAt(poolId, START_BLOCK), initialFee, "block 0 != initialFee");
        assertEq(hook.feeAt(poolId, uint256(START_BLOCK) + decayBlocks), finalFee, "end of window != finalFee");
        assertEq(hook.feeAt(poolId, uint256(START_BLOCK) + decayBlocks + 1), finalFee, "after window != finalFee");
        assertEq(
            hook.feeAt(poolId, uint256(START_BLOCK) + uint256(decayBlocks) * 1000), finalFee, "far future != finalFee"
        );

        // Sweep the window on an ascending ladder of offsets and check range + monotonicity.
        uint24 previous = type(uint24).max;
        for (uint256 i = 0; i <= 34; i++) {
            uint256 offset = i <= 32 ? (uint256(decayBlocks) * i) / 32 : (i == 33 ? decayBlocks : decayBlocks + 1);
            uint24 fee = hook.feeAt(poolId, uint256(START_BLOCK) + offset);

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
        uint32 decayBlocks,
        uint32 offsetA,
        uint32 offsetB
    ) public {
        (initialFee, finalFee, decayBlocks) = _fuzzConfigure(initialFee, finalFee, decayBlocks);

        uint256 lo = bound(offsetA, 0, uint256(decayBlocks) * 2);
        uint256 hi = bound(offsetB, lo, uint256(decayBlocks) * 2 + 1);

        uint24 feeLo = hook.feeAt(poolId, uint256(START_BLOCK) + lo);
        uint24 feeHi = hook.feeAt(poolId, uint256(START_BLOCK) + hi);

        assertGe(feeLo, feeHi, "later block charged more");
        assertLe(feeLo, initialFee);
        assertGe(feeHi, finalFee);
    }

    /// @dev The fee the hook hands to core must always carry the override flag and must always
    /// survive core's own `removeOverrideAndValidate`.
    function testFuzz_decay_appliedFeeMatchesSchedule(uint24 initialFee, uint24 finalFee, uint32 decayBlocks, uint16 elapsed)
        public
    {
        decayBlocks = uint32(bound(decayBlocks, 1, 5_000));
        (initialFee, finalFee, decayBlocks) = _fuzzConfigure(initialFee, finalFee, decayBlocks);

        uint256 offset = bound(elapsed, 0, uint256(decayBlocks) + 10);
        vm.roll(uint256(START_BLOCK) + offset);

        uint24 expected = hook.currentFee(poolId);
        uint24 applied = _swapAndReadAppliedFee(true, SWAP_AMOUNT);
        assertEq(applied, expected);
        assertLe(applied, LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE);
    }

    /*//////////////////////////////////////////////////////////////
       THE TWO BLOCK CAPS ARE WALL-CLOCK BOUNDED NOW

       `MAX_DECAY_BLOCKS` and `MAX_START_DELAY` were `constant 1_000_000`, sized
       as "~139 days at 12s blocks". Robinhood Chain produces a block every
       0.102s, so on the chain this hook was built for the same number is 28
       HOURS - and a three-day fair launch, the single most common shape a
       launchpad sells, reverts with `InvalidDecayBlocks` and blames the caller.
    //////////////////////////////////////////////////////////////*/

    /// @dev THE REGRESSION GUARD. The old constant, on the real chain. It has to be refused,
    /// because 28 hours is not a cap on a launch tax - it is a cap on launches.
    ///
    /// FAILS AGAINST THE PRE-FIX CODE: there was no argument to reject.
    function test_FIX_theOldConstantIsRejectedAtRobinhoodBlockTime() public {
        // 1 000 000 blocks x 10 centis = 100 000 s = 27.8 hours.
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchWindowOutOfRange.selector, 100_000, 3 days, 180 days)
        );
        new LaunchGuardHook(poolManager, 10, 1_000_000, 1_000_000);

        // The same literal is fine on a 12s chain, where it always meant 139 days.
        LaunchGuardHook slow = new LaunchGuardHook(poolManager, 1200, 1_000_000, 1_000_000);
        assertEq((uint256(slow.MAX_DECAY_BLOCKS()) * slow.blockTimeCentis()) / 100, 12_000_000);
    }

    /// @dev The product this was blocking. A three-day launch has to actually configure at
    /// Robinhood's block time.
    function test_FIX_aThreeDayFairLaunchConfiguresAtRobinhoodBlockTime() public {
        LaunchGuardHook fast = new LaunchGuardHook(poolManager, 10, MAX_DECAY, MAX_START);

        // Three days at 0.1s blocks.
        uint32 threeDays = 3 * 24 * 3600 * 10;
        assertLe(threeDays, fast.MAX_DECAY_BLOCKS(), "the cap must admit a three-day launch");

        PoolKey memory k = _key(fast, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60);
        LaunchGuardHook.LaunchConfig memory cfg = LaunchGuardHook.LaunchConfig({
            startBlock: uint48(block.number + 1),
            decayBlocks: threeDays,
            initialFeeBips: 300_000,
            finalFeeBips: 10_000,
            maxBuyPerTx: 0,
            launchTokenIsCurrency0: true,
            enabled: true
        });
        fast.configureLaunch(k, cfg);
        assertEq(fast.getLaunch(k.toId()).decayBlocks, threeDays);
    }

    function test_FIX_rejectsAZeroOrAbsurdBlockTime() public {
        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidBlockTime.selector, uint32(0)));
        new LaunchGuardHook(poolManager, 0, MAX_DECAY, MAX_START);

        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.InvalidBlockTime.selector, uint32(60_001)));
        new LaunchGuardHook(poolManager, 60_001, MAX_DECAY, MAX_START);
    }

    /// @dev The ceiling matters as much as the floor: past 180 days a "launch tax" is a tax, and
    /// the configuration is immutable from `startBlock` onwards.
    function test_FIX_rejectsACapThatWouldMakeTheTaxPermanent() public {
        uint32 tooLong = 181 * 24 * 3600 * 10; // 181 days at 0.1s blocks
        vm.expectRevert(
            abi.encodeWithSelector(
                LaunchGuardHook.LaunchWindowOutOfRange.selector,
                (uint256(tooLong) * 10) / 100,
                3 days,
                180 days
            )
        );
        new LaunchGuardHook(poolManager, 10, tooLong, MAX_START);
    }

    /// @dev Both caps are checked, not just the first. An early draft validated `maxDecayBlocks`
    /// and passed `maxStartDelayBlocks` straight through.
    function test_FIX_theStartDelayCapIsBoundedToo() public {
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchWindowOutOfRange.selector, 100_000, 3 days, 180 days)
        );
        new LaunchGuardHook(poolManager, 10, MAX_DECAY, 1_000_000);
    }

    /// @dev No block time buys a window outside the bounds, in either direction. Understating the
    /// block time forces MORE blocks for the same window; overstating it is caught by the ceiling.
    function testFuzz_FIX_everyAcceptedCapIsAtLeastThreeRealDays(uint32 centis, uint32 decayBlocks) public {
        centis = uint32(bound(centis, 1, 60_000));
        decayBlocks = uint32(bound(decayBlocks, 1, type(uint32).max));

        uint256 realSeconds = (uint256(decayBlocks) * centis) / 100;
        if (realSeconds < 3 days || realSeconds > 180 days) {
            vm.expectRevert();
            new LaunchGuardHook(poolManager, centis, decayBlocks, decayBlocks);
        } else {
            LaunchGuardHook h = new LaunchGuardHook(poolManager, centis, decayBlocks, decayBlocks);
            assertGe(
                (uint256(h.MAX_DECAY_BLOCKS()) * h.blockTimeCentis()) / 100,
                h.MIN_LAUNCH_WINDOW_SECONDS(),
                "every accepted cap admits a three-day launch"
            );
        }
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {BinPoolManager} from "infinity-core/src/pool-bin/BinPoolManager.sol";
import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
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
import {BinPoolParametersHelper} from "infinity-core/src/pool-bin/libraries/BinPoolParametersHelper.sol";
import {PackedUint128Math} from "infinity-core/src/pool-bin/libraries/math/PackedUint128Math.sol";

import {
    IBinHooks,
    HOOKS_BEFORE_INITIALIZE_OFFSET,
    HOOKS_AFTER_INITIALIZE_OFFSET,
    HOOKS_BEFORE_MINT_OFFSET,
    HOOKS_AFTER_MINT_OFFSET,
    HOOKS_BEFORE_BURN_OFFSET,
    HOOKS_AFTER_BURN_OFFSET,
    HOOKS_BEFORE_SWAP_OFFSET,
    HOOKS_AFTER_SWAP_OFFSET,
    HOOKS_BEFORE_DONATE_OFFSET,
    HOOKS_AFTER_DONATE_OFFSET,
    HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET,
    HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET,
    HOOKS_AFTER_MINT_RETURNS_DELTA_OFFSET,
    HOOKS_AFTER_BURN_RETURNS_DELTA_OFFSET
} from "infinity-core/src/pool-bin/interfaces/IBinHooks.sol";

import {BinTestHelper} from "infinity-core/test/pool-bin/helpers/BinTestHelper.sol";
import {BinSwapHelper} from "infinity-core/test/pool-bin/helpers/BinSwapHelper.sol";
import {BinLiquidityHelper} from "infinity-core/test/pool-bin/helpers/BinLiquidityHelper.sol";

import {BaseBinHook} from "../../src/base/BaseBinHook.sol";
import {BinLaunchGuardHook} from "../../src/launch/BinLaunchGuardHook.sol";

/*//////////////////////////////////////////////////////////////
                        TEST-ONLY HOOKS
//////////////////////////////////////////////////////////////*/

/// @dev A minimal `BaseBinHook` used to exercise the base contract's deploy-time permission
/// validation and its reverting default callbacks.
/// @dev `getHooksRegistrationBitmap` must be `pure`, so it cannot read a constructor argument. The
/// bitmap under test is therefore handed straight to `_validatePermissions` — the same internal
/// function the base constructor calls — which is what these tests are actually asserting on.
contract ConfigurableBinHook is BaseBinHook {
    constructor(IBinPoolManager _pm, uint16 bitmap_) BaseBinHook(_pm) {
        _validatePermissions(bitmap_);
    }

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return 0;
    }

    /// @dev Re-expose the constants so tests can assert them against core's own offsets.
    function beforeInitializeBit() external pure returns (uint16) {
        return BEFORE_INITIALIZE;
    }

    function afterInitializeBit() external pure returns (uint16) {
        return AFTER_INITIALIZE;
    }

    function beforeMintBit() external pure returns (uint16) {
        return BEFORE_MINT;
    }

    function afterMintBit() external pure returns (uint16) {
        return AFTER_MINT;
    }

    function beforeBurnBit() external pure returns (uint16) {
        return BEFORE_BURN;
    }

    function afterBurnBit() external pure returns (uint16) {
        return AFTER_BURN;
    }

    function beforeSwapBit() external pure returns (uint16) {
        return BEFORE_SWAP;
    }

    function afterSwapBit() external pure returns (uint16) {
        return AFTER_SWAP;
    }

    function beforeDonateBit() external pure returns (uint16) {
        return BEFORE_DONATE;
    }

    function afterDonateBit() external pure returns (uint16) {
        return AFTER_DONATE;
    }

    function beforeSwapReturnsDeltaBit() external pure returns (uint16) {
        return BEFORE_SWAP_RETURNS_DELTA;
    }

    function afterSwapReturnsDeltaBit() external pure returns (uint16) {
        return AFTER_SWAP_RETURNS_DELTA;
    }

    function afterMintReturnsDeltaBit() external pure returns (uint16) {
        return AFTER_MINT_RETURNS_DELTA;
    }

    function afterBurnReturnsDeltaBit() external pure returns (uint16) {
        return AFTER_BURN_RETURNS_DELTA;
    }

    function maxLpFee() external pure returns (uint24) {
        return MAX_LP_FEE;
    }
}

/// @dev A `BinLaunchGuardHook` that records the `sender` argument core hands to `beforeSwap` and
/// `beforeMint`. Used only by the `sender` tests to pin the constraint the whole design rests on.
contract SenderRecordingBinLaunchGuardHook is BinLaunchGuardHook {
    address public lastSwapSender;
    address public lastMintSender;
    uint256 public swapCount;

    constructor(IBinPoolManager _pm, uint32 centis, uint32 maxDecay, uint48 maxStart)
        BinLaunchGuardHook(_pm, centis, maxDecay, maxStart)
    {}

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        bool swapForY,
        int128 amountSpecified,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        lastSwapSender = sender;
        swapCount++;
        return super._beforeSwap(sender, key, swapForY, amountSpecified, hookData);
    }

    function _beforeMint(
        address sender,
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, uint24) {
        lastMintSender = sender;
        return super._beforeMint(sender, key, params, hookData);
    }
}

/// @dev The naive port: exactly the CL hook's permission set (`beforeInitialize | beforeSwap`),
/// with `beforeMint` left unregistered. Used to DEMONSTRATE the bin-only hole that motivates the
/// real hook's extra permission bit. It is not a hook anybody should deploy.
contract NaiveBinLaunchGuardHook is BinLaunchGuardHook {
    constructor(IBinPoolManager _pm, uint32 centis, uint32 maxDecay, uint48 maxStart)
        BinLaunchGuardHook(_pm, centis, maxDecay, maxStart)
    {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }
}

/*//////////////////////////////////////////////////////////////
                              TESTS
//////////////////////////////////////////////////////////////*/

contract BinLaunchGuardHookTest is Test, BinTestHelper {
    using LPFeeLibrary for uint24;
    using BinPoolParametersHelper for bytes32;
    using PackedUint128Math for bytes32;

    Vault vault;
    BinPoolManager poolManager;
    BinLaunchGuardHook hook;
    BinSwapHelper swapHelper;
    BinLiquidityHelper liquidityHelper;

    MockERC20 token0;
    MockERC20 token1;
    Currency currency0;
    Currency currency1;

    PoolKey key;
    PoolId poolId;

    /// @dev binId at which token0 and token1 trade 1:1.
    uint24 constant ACTIVE_ID = 2 ** 23;
    uint16 constant BIN_STEP = 10;

    /// @dev Foundry starts tests at block 1; the default launch opens 100 blocks later.
    uint48 constant START_BLOCK = 101;
    uint32 constant DECAY_BLOCKS = 100;

    /// @dev 8%. The CL suite's default opening tax is 30% and its ceiling is 50%; BOTH are simply
    /// unreachable on a bin pool, whose ceiling is 10% (`test_feeCap_binCeilingIsOneTenthOfCL`).
    uint24 constant INITIAL_FEE = 80_000;
    uint24 constant FINAL_FEE = 3_000; // 0.30%

    int128 constant SWAP_AMOUNT = -10_000; // exact input, tiny relative to liquidity

    bytes constant ZERO_BYTES = "";

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
        vault = new Vault();
        poolManager = new BinPoolManager(IVault(address(vault)));
        vault.registerApp(address(poolManager));

        token0 = new MockERC20("TestA", "A", 18);
        token1 = new MockERC20("TestB", "B", 18);
        (token0, token1) = address(token0) < address(token1) ? (token0, token1) : (token1, token0);
        currency0 = Currency.wrap(address(token0));
        currency1 = Currency.wrap(address(token1));
        token0.mint(address(this), 1000 ether);
        token1.mint(address(this), 1000 ether);

        swapHelper = new BinSwapHelper(poolManager, vault);
        liquidityHelper = new BinLiquidityHelper(poolManager, vault);
        _approveAll(address(this));

        hook = new BinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        key = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, BIN_STEP);
        poolId = key.toId();

        hook.configureLaunch(key, _defaultConfig());
        poolManager.initialize(key, ACTIVE_ID);

        // Seed the pool. A ratio-matched mint into a fresh bin incurs no composition fee, so the
        // hook's mint tax does not penalise seeding (see `test_mint_balancedSeedingIsUntaxed`).
        liquidityHelper.mint(key, _getSingleBinMintParams(ACTIVE_ID, 100 ether, 100 ether), ZERO_BYTES);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _approveAll(address who) internal {
        vm.startPrank(who);
        token0.approve(address(swapHelper), type(uint256).max);
        token1.approve(address(swapHelper), type(uint256).max);
        token0.approve(address(liquidityHelper), type(uint256).max);
        token1.approve(address(liquidityHelper), type(uint256).max);
        vm.stopPrank();
    }

    function _key(IHooks _hook, uint24 fee, uint16 binStep) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: _hook,
            poolManager: poolManager,
            fee: fee,
            parameters: bytes32(uint256(_hook.getHooksRegistrationBitmap())).setBinStep(binStep)
        });
    }

    function _defaultConfig() internal pure returns (BinLaunchGuardHook.LaunchConfig memory) {
        return BinLaunchGuardHook.LaunchConfig({
            startBlock: START_BLOCK,
            decayBlocks: DECAY_BLOCKS,
            initialFeeBips: INITIAL_FEE,
            finalFeeBips: FINAL_FEE,
            maxBuyPerTx: 0,
            launchTokenIsCurrency0: false, // currency1 (Y) is the launched token => a buy is swapForY
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

    function _swap(PoolKey memory k, bool swapForY, int128 amountSpecified) internal returns (BalanceDelta) {
        return swapHelper.swap(k, swapForY, amountSpecified, BinSwapHelper.TestSettings(true, true), ZERO_BYTES);
    }

    /// @dev Executes a swap and returns the fee the POOL actually charged, read out of core's own
    /// `Swap` event. This is the ground truth: it proves the override reached `BinPool.swap`,
    /// rather than merely proving the hook returned a number. With no protocol fee controller set,
    /// the event's `fee` field is the LP fee exactly.
    function _swapAndReadAppliedFee(bool swapForY, int128 amountSpecified) internal returns (uint24 appliedFee) {
        vm.recordLogs();
        _swap(key, swapForY, amountSpecified);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(poolManager) && logs[i].topics[0] == IBinPoolManager.Swap.selector) {
                // Swap(PoolId indexed, address indexed, int128, int128, uint24 activeId, uint24 fee, uint16)
                (,,, uint24 fee,) = abi.decode(logs[i].data, (int128, int128, uint24, uint24, uint16));
                return fee;
            }
        }
        revert("Swap event not found");
    }

    /// @dev Mints single-sided X into the ACTIVE bin — a lopsided add, which core turns into an
    /// implicit swap — and returns the composition fee it charged, read out of core's `Mint` event.
    /// This is the bin-only route around a swap tax; see the contract's "THE MINT HOLE" note.
    function _lopsidedMintAndReadCompositionFee(PoolKey memory k, uint256 amountX)
        internal
        returns (uint128 feeX, uint128 feeY)
    {
        vm.recordLogs();
        liquidityHelper.mint(k, _getCustomSingleSidedBinMintParam(ACTIVE_ID, amountX, false), ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(poolManager) && logs[i].topics[0] == IBinPoolManager.Mint.selector) {
                // Mint(PoolId indexed, address indexed, uint256[] ids, bytes32 salt, bytes32[] amounts,
                //      bytes32 compositionFeeAmount, bytes32 feeAmountToProtocol)
                (,,, bytes32 compositionFee,) =
                    abi.decode(logs[i].data, (uint256[], bytes32, bytes32[], bytes32, bytes32));
                return (compositionFee.decodeX(), compositionFee.decodeY());
            }
        }
        revert("Mint event not found");
    }

    /// @dev A second pool on the SAME hook instance, distinguished only by its binStep, configured
    /// with the default schedule, initialized and seeded identically to `key`.
    function _freshGuardedPool(uint16 binStep) internal returns (PoolKey memory k) {
        k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, binStep);
        hook.configureLaunch(k, _defaultConfig());
        poolManager.initialize(k, ACTIVE_ID);
        liquidityHelper.mint(k, _getSingleBinMintParams(ACTIVE_ID, 100 ether, 100 ether), ZERO_BYTES);
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
        // bit 0 (beforeInitialize) | bit 2 (beforeMint) | bit 6 (beforeSwap) == 69.
        // beforeMint is the bin-only addition: without it the composition-fee route is untaxed.
        assertEq(hook.getHooksRegistrationBitmap(), uint16(69));
    }

    /// @dev Pins BaseBinHook's constants against core's own offsets. Bits 0-13 are the same layout
    /// as CL; only bits 2-5, 12 and 13 are RENAMED (mint/burn instead of add/remove-liquidity).
    function test_bitmap_offsetsMatchCoreExactly() public {
        ConfigurableBinHook probe = new ConfigurableBinHook(poolManager, 0);

        assertEq(probe.beforeInitializeBit(), uint16(1) << HOOKS_BEFORE_INITIALIZE_OFFSET);
        assertEq(probe.afterInitializeBit(), uint16(1) << HOOKS_AFTER_INITIALIZE_OFFSET);
        assertEq(probe.beforeMintBit(), uint16(1) << HOOKS_BEFORE_MINT_OFFSET);
        assertEq(probe.afterMintBit(), uint16(1) << HOOKS_AFTER_MINT_OFFSET);
        assertEq(probe.beforeBurnBit(), uint16(1) << HOOKS_BEFORE_BURN_OFFSET);
        assertEq(probe.afterBurnBit(), uint16(1) << HOOKS_AFTER_BURN_OFFSET);
        assertEq(probe.beforeSwapBit(), uint16(1) << HOOKS_BEFORE_SWAP_OFFSET);
        assertEq(probe.afterSwapBit(), uint16(1) << HOOKS_AFTER_SWAP_OFFSET);
        assertEq(probe.beforeDonateBit(), uint16(1) << HOOKS_BEFORE_DONATE_OFFSET);
        assertEq(probe.afterDonateBit(), uint16(1) << HOOKS_AFTER_DONATE_OFFSET);
        assertEq(probe.beforeSwapReturnsDeltaBit(), uint16(1) << HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET);
        assertEq(probe.afterSwapReturnsDeltaBit(), uint16(1) << HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET);
        assertEq(probe.afterMintReturnsDeltaBit(), uint16(1) << HOOKS_AFTER_MINT_RETURNS_DELTA_OFFSET);
        assertEq(probe.afterBurnReturnsDeltaBit(), uint16(1) << HOOKS_AFTER_BURN_RETURNS_DELTA_OFFSET);

        // Bits 14-15 are unassigned on bin exactly as on CL, and binStep begins at offset 16.
        assertEq(BinPoolParametersHelper.OFFSET_BIN_STEP, 16);
    }

    function test_feeCaps_stayWithinWhatCoreAccepts() public view {
        // Core reverts with LPFeeTooLarge above 100_000 for a BIN pool. The hook's cap IS that
        // ceiling, so a configured schedule can never produce a fee core would reject.
        assertEq(hook.MAX_INITIAL_FEE(), LPFeeLibrary.TEN_PERCENT_FEE);
        assertLe(hook.MAX_FINAL_FEE(), hook.MAX_INITIAL_FEE());
    }

    /// @dev The headline difference from the CL hook, asserted rather than merely commented.
    function test_feeCap_binCeilingIsOneTenthOfCL() public {
        assertEq(LPFeeLibrary.TEN_PERCENT_FEE * 10, LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE);
        assertLt(hook.MAX_INITIAL_FEE(), LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE);

        ConfigurableBinHook probe = new ConfigurableBinHook(poolManager, 0);
        assertEq(probe.maxLpFee(), LPFeeLibrary.TEN_PERCENT_FEE);
    }

    /*//////////////////////////////////////////////////////////////
                     BaseBinHook PERMISSION VALIDATION
    //////////////////////////////////////////////////////////////*/

    function test_base_acceptsEveryReturnsDeltaFlagWithItsBaseCallback() public {
        uint16 full = uint16(1) << HOOKS_BEFORE_SWAP_OFFSET | uint16(1) << HOOKS_AFTER_SWAP_OFFSET | uint16(1)
            << HOOKS_AFTER_MINT_OFFSET | uint16(1) << HOOKS_AFTER_BURN_OFFSET | uint16(1)
            << HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET | uint16(1) << HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET | uint16(1)
            << HOOKS_AFTER_MINT_RETURNS_DELTA_OFFSET | uint16(1) << HOOKS_AFTER_BURN_RETURNS_DELTA_OFFSET;
        // Does not revert.
        new ConfigurableBinHook(poolManager, full);
    }

    function test_base_rejectsBeforeSwapReturnsDeltaWithoutBeforeSwap() public {
        uint16 bad = uint16(1) << HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET;
        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.PermissionDependencyMissing.selector, bad));
        new ConfigurableBinHook(poolManager, bad);
    }

    function test_base_rejectsAfterSwapReturnsDeltaWithoutAfterSwap() public {
        uint16 bad = uint16(1) << HOOKS_AFTER_SWAP_RETURNS_DELTA_OFFSET;
        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.PermissionDependencyMissing.selector, bad));
        new ConfigurableBinHook(poolManager, bad);
    }

    /// @dev The bin-renamed bit. Core's own `BinHooks.validatePermissionsConflict` checks the same
    /// pair; this catches it a whole pool-creation earlier.
    function test_base_rejectsAfterMintReturnsDeltaWithoutAfterMint() public {
        uint16 bad = uint16(1) << HOOKS_AFTER_MINT_RETURNS_DELTA_OFFSET;
        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.PermissionDependencyMissing.selector, bad));
        new ConfigurableBinHook(poolManager, bad);
    }

    function test_base_rejectsAfterBurnReturnsDeltaWithoutAfterBurn() public {
        uint16 bad = uint16(1) << HOOKS_AFTER_BURN_RETURNS_DELTA_OFFSET;
        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.PermissionDependencyMissing.selector, bad));
        new ConfigurableBinHook(poolManager, bad);
    }

    /// @dev Bit 16 upwards is `binStep`, so the reserved bits are not merely decorative: a hook
    /// that set bit 15 would be one bit away from silently changing a pool's bin step.
    function test_base_rejectsReservedBits() public {
        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.ReservedBitsSet.selector, uint16(0x4000)));
        new ConfigurableBinHook(poolManager, uint16(0x4000));

        vm.expectRevert(abi.encodeWithSelector(BaseBinHook.ReservedBitsSet.selector, uint16(0x8000)));
        new ConfigurableBinHook(poolManager, uint16(0x8000));
    }

    /// @dev Every callback a subclass has not overridden must revert loudly when core reaches it,
    /// so a bitmap that over-declares fails on the first call rather than corrupting accounting.
    function test_base_unimplementedCallbacksRevertHookNotImplemented() public {
        ConfigurableBinHook bare = new ConfigurableBinHook(poolManager, 0);
        IBinPoolManager.MintParams memory mp = _getSingleBinMintParams(ACTIVE_ID, 1 ether, 1 ether);
        IBinPoolManager.BurnParams memory bp =
            _getSingleBinBurnLiquidityParams(key, poolManager, ACTIVE_ID, address(this), 100);

        vm.startPrank(address(poolManager));

        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.beforeInitialize(address(this), key, ACTIVE_ID);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.afterInitialize(address(this), key, ACTIVE_ID);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.beforeMint(address(this), key, mp, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.afterMint(address(this), key, mp, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.beforeBurn(address(this), key, bp, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.afterBurn(address(this), key, bp, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.beforeSwap(address(this), key, true, SWAP_AMOUNT, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.afterSwap(address(this), key, true, SWAP_AMOUNT, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.beforeDonate(address(this), key, 1, 1, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.HookNotImplemented.selector);
        bare.afterDonate(address(this), key, 1, 1, ZERO_BYTES);

        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                             CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_configure_claimsOwnershipAndStoresConfig() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        PoolId id = k.toId();
        address launcher = makeAddr("launcher");

        assertEq(hook.launchOwner(id), address(0));

        vm.expectEmit(true, true, false, true, address(hook));
        emit LaunchClaimed(id, launcher);
        vm.expectEmit(true, true, false, true, address(hook));
        emit LaunchConfigured(id, launcher, START_BLOCK, DECAY_BLOCKS, INITIAL_FEE, FINAL_FEE, 0, false, true);

        vm.prank(launcher);
        hook.configureLaunch(k, _defaultConfig());

        BinLaunchGuardHook.Launch memory l = hook.getLaunch(id);
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
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        k.hooks = IHooks(makeAddr("someOtherHook"));
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.HookMismatch.selector, address(k.hooks)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_revertsOnForeignPoolManager() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        k.poolManager = IPoolManager(makeAddr("someOtherManager"));
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.PoolManagerMismatch.selector, address(k.poolManager)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_revertsOnStaticFeePool() public {
        PoolKey memory k = _key(hook, 3000, 20);
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.PoolMustUseDynamicFee.selector, uint24(3000)));
        hook.configureLaunch(k, _defaultConfig());
    }

    function test_configure_unauthorizedCallerCannotReconfigure() public {
        address attacker = makeAddr("attacker");
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 1_000;

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.NotLaunchOwner.selector, poolId, attacker));
        hook.configureLaunch(key, cfg);

        assertEq(hook.getLaunch(poolId).initialFeeBips, INITIAL_FEE);
    }

    function test_configure_ownerMayUpdateBeforeStartBlock() public {
        vm.roll(START_BLOCK - 1);

        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 50_000;
        cfg.finalFeeBips = 1_000;
        cfg.maxBuyPerTx = 12345;
        hook.configureLaunch(key, cfg);

        BinLaunchGuardHook.Launch memory l = hook.getLaunch(poolId);
        assertEq(l.initialFeeBips, 50_000);
        assertEq(l.finalFeeBips, 1_000);
        assertEq(l.maxBuyPerTx, 12345);
        assertEq(l.owner, address(this)); // ownership unchanged by an update
    }

    function test_configure_frozenAtExactStartBlock() public {
        vm.roll(START_BLOCK);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_frozenAfterStartBlock() public {
        vm.roll(START_BLOCK + 1);
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = uint48(START_BLOCK + 500);
        cfg.initialFeeBips = 100_000; // the rug attempt: spike the fee mid-launch

        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, cfg);
    }

    function test_configure_frozenEvenLongAfterTheDecayWindow() public {
        vm.roll(START_BLOCK + DECAY_BLOCKS + 1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchAlreadyStarted.selector, poolId, uint256(START_BLOCK))
        );
        hook.configureLaunch(key, _defaultConfig());
    }

    function test_configure_rejectsStartBlockInThePast() public {
        vm.roll(1000);
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = 999;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidStartBlock.selector, uint256(999), uint256(1000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_acceptsStartBlockEqualToNow() public {
        vm.roll(1000);
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = 1000;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        hook.configureLaunch(k, cfg);
        assertEq(hook.getLaunch(k.toId()).startBlock, 1000);

        // ...and it is immediately frozen, because the launch is already open.
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchAlreadyStarted.selector, k.toId(), uint256(1000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsStartBlockTooFarAhead() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.startBlock = uint48(block.number + hook.MAX_START_DELAY() + 1);
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidStartBlock.selector, uint256(cfg.startBlock), block.number)
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsZeroDecayBlocks() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decayBlocks = 0;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.InvalidDecayBlocks.selector, uint32(0)));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsOversizedDecayWindow() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.decayBlocks = hook.MAX_DECAY_BLOCKS() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.InvalidDecayBlocks.selector, cfg.decayBlocks));
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsRisingFeeSchedule() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 1_000;
        cfg.finalFeeBips = 2_000;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidFeeSchedule.selector, uint24(1_000), uint24(2_000))
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsInitialFeeAboveBinCeiling() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = hook.MAX_INITIAL_FEE() + 1; // 100_001
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidFeeSchedule.selector, cfg.initialFeeBips, FINAL_FEE)
        );
        hook.configureLaunch(k, cfg);
    }

    /// @dev The CL hook's own suite launches at 30% and caps at 50%. Both are simply illegal on a
    /// bin pool: core would revert the very first swap with `LPFeeTooLarge`, so the hook refuses
    /// the configuration instead of letting a launch brick itself.
    function test_configure_rejectsACLGradeOpeningTax() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = 300_000; // perfectly legal on CL
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidFeeSchedule.selector, uint24(300_000), FINAL_FEE)
        );
        hook.configureLaunch(k, cfg);
    }

    function test_configure_rejectsFinalFeeAboveCap() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.finalFeeBips = hook.MAX_FINAL_FEE() + 1;
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.InvalidFeeSchedule.selector, INITIAL_FEE, cfg.finalFeeBips)
        );
        hook.configureLaunch(k, cfg);
    }

    /// @dev RESIDUAL RISK, DELIBERATELY CAPTURED. Ownership is established by first-claim, so a
    /// front-runner can squat an unclaimed pool id and make that exact PoolKey unusable. The blast
    /// radius is bounded - the squatter gets no funds, and the launcher can move to another binStep
    /// (a different pool id) or claim atomically in the same transaction that initializes and seeds
    /// the pool - but the race itself cannot be removed at this layer, because a PoolKey carries no
    /// field that could bind it to an intended owner. On bin the free bits of `parameters` are
    /// binStep and then zeroes core rejects, so the owner cannot be smuggled into the key either.
    function test_risk_unclaimedPoolIdCanBeSquattedByAFrontRunner() public {
        PoolKey memory victimKey = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        PoolId victimId = victimKey.toId();

        address squatter = makeAddr("squatter");
        BinLaunchGuardHook.LaunchConfig memory hostile = _defaultConfig();
        hostile.startBlock = uint48(block.number + hook.MAX_START_DELAY()); // never opens in practice
        vm.prank(squatter);
        hook.configureLaunch(victimKey, hostile);

        address launcher = makeAddr("launcher");
        vm.prank(launcher);
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.NotLaunchOwner.selector, victimId, launcher));
        hook.configureLaunch(victimKey, _defaultConfig());

        // ...but only that key. A different binStep is a different pool id, still free.
        PoolKey memory escapeKey = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 21);
        vm.prank(launcher);
        hook.configureLaunch(escapeKey, _defaultConfig());
        assertEq(hook.launchOwner(escapeKey.toId()), launcher);

        // And the squatter never gains custody of anything: the pool was never initialized and
        // the hook holds no funds at any point.
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                              INITIALIZE
    //////////////////////////////////////////////////////////////*/

    function test_initialize_revertsWhenPoolIsNotConfigured() public {
        PoolKey memory k = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20);
        _expectHookRevert(
            address(hook),
            IBinHooks.beforeInitialize.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchNotConfigured.selector, k.toId())
        );
        poolManager.initialize(k, ACTIVE_ID);
    }

    /// @dev The single most important negative test. On a static-fee pool `BinHooks.beforeSwap`
    /// (and `BinHooks.beforeMint`) silently DISCARD the fee the hook returns - the decode is
    /// guarded by `if (key.fee.isDynamicLPFee())`, which is `fee == 0x800000` EXACTLY - so the
    /// launch tax would be a no-op that nobody notices until after the snipe.
    function test_initialize_revertsOnStaticFeePool() public {
        BinLaunchGuardHook openHook = new BinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        PoolKey memory k = _key(openHook, 3000, 20);

        // Prove the static-fee pool is otherwise perfectly valid to core: same bitmap, same shape.
        assertEq(openHook.getHooksRegistrationBitmap(), hook.getHooksRegistrationBitmap());

        _expectHookRevert(
            address(openHook),
            IBinHooks.beforeInitialize.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.PoolMustUseDynamicFee.selector, uint24(3000))
        );
        poolManager.initialize(k, ACTIVE_ID);
    }

    /// @dev `isDynamicLPFee` is an exact equality (`fee == 0x800000`), not a mask test: a fee that
    /// merely has the dynamic BIT set is still static, and any fee this hook returned for it would
    /// be discarded.
    ///
    /// On a bin pool such a near-miss never reaches the hook at all, and the ordering is worth
    /// knowing: `BinPoolManager.initialize` runs `getInitialLPFee(...).validate(TEN_PERCENT_FEE)`
    /// BEFORE `BinHooks.beforeInitialize`. Once the exact-equality test fails, 0x800001 is read as
    /// a static fee of 8_388_609 — eighty times the bin ceiling — so core rejects it first.
    /// The hook's own `PoolMustUseDynamicFee` guard is therefore the backstop for the static fees
    /// that DO clear core's ceiling, which is exactly the dangerous case
    /// (`test_initialize_revertsOnStaticFeePool`).
    function test_initialize_nearMissDynamicFeeFlagIsRejectedByCoreFirst() public {
        BinLaunchGuardHook openHook = new BinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        uint24 nearMiss = LPFeeLibrary.DYNAMIC_FEE_FLAG | uint24(1); // 0x800001
        assertFalse(nearMiss.isDynamicLPFee());
        assertGt(nearMiss, LPFeeLibrary.TEN_PERCENT_FEE);

        PoolKey memory k = _key(openHook, nearMiss, 20);
        vm.expectRevert(abi.encodeWithSelector(LPFeeLibrary.LPFeeTooLarge.selector, nearMiss));
        poolManager.initialize(k, ACTIVE_ID);
    }

    /// @dev And the hook's guard is genuinely load-bearing for a fee core is happy with: 100_000 is
    /// exactly the bin ceiling, so core accepts it, and only the hook stops the pool being created
    /// with a launch tax that would be silently discarded on every swap.
    function test_initialize_rejectsStaticFeeAtCoresCeiling() public {
        BinLaunchGuardHook openHook = new BinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        uint24 staticMax = LPFeeLibrary.TEN_PERCENT_FEE;
        assertFalse(staticMax.isDynamicLPFee());

        PoolKey memory k = _key(openHook, staticMax, 20);
        _expectHookRevert(
            address(openHook),
            IBinHooks.beforeInitialize.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.PoolMustUseDynamicFee.selector, staticMax)
        );
        poolManager.initialize(k, ACTIVE_ID);
    }

    /*//////////////////////////////////////////////////////////////
                            THE LAUNCH GATE
    //////////////////////////////////////////////////////////////*/

    function test_swap_revertsBeforeStartBlock() public {
        vm.roll(START_BLOCK - 1);
        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                BinLaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(key, true, SWAP_AMOUNT);
    }

    function test_swap_revertsBeforeStartBlock_inBothDirections() public {
        vm.roll(START_BLOCK - 1);
        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                BinLaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(key, false, SWAP_AMOUNT);
    }

    function test_swap_succeedsAtExactStartBlock() public {
        vm.roll(START_BLOCK);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), INITIAL_FEE);
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
        assertEq(expected, 41_500);
        assertEq(hook.currentFee(poolId), expected);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), expected);
    }

    function test_decay_lastBlockOfWindowIsStillTaxed() public {
        // The window is half-open: [startBlock, startBlock + decayBlocks). The final block inside
        // it must still charge strictly more than the post-launch fee.
        vm.roll(START_BLOCK + DECAY_BLOCKS - 1);
        uint24 expected = _expectedFee(DECAY_BLOCKS - 1);
        assertEq(expected, 3_770);
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

    /// @dev Ties the returned fee to real economics, not just to the emitted number. At
    /// `activeId == 2**23` the bin price is exactly 1:1 whatever the binStep, and core takes the
    /// fee out of the exact-input amount, so the output is the input less exactly the decayed fee.
    function test_decay_isEconomicallyRealNotJustReported() public {
        vm.roll(START_BLOCK + 50);
        uint256 expectedFee = _expectedFee(50);
        BalanceDelta delta = _swap(key, true, SWAP_AMOUNT);

        assertEq(delta.amount0(), SWAP_AMOUNT);
        uint256 amountIn = uint256(uint128(-SWAP_AMOUNT));
        assertApproxEqAbs(uint256(int256(delta.amount1())), amountIn * (1e6 - expectedFee) / 1e6, 2);
    }

    /// @dev And the harshest opening tax this hook can possibly impose is an order of magnitude
    /// weaker than the CL hook's. Configured at the ceiling, a block-0 buyer still keeps 90% of the
    /// trade; the CL hook's 50% cap would leave 50%. This is a property of the pool type, not of
    /// the configuration, and no bin hook can improve on it.
    function test_decay_harshestPossibleOpeningTaxIsTenPercent() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.initialFeeBips = hook.MAX_INITIAL_FEE(); // 100_000 == 10%, core's bin ceiling
        hook.configureLaunch(key, cfg);

        vm.roll(START_BLOCK);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), LPFeeLibrary.TEN_PERCENT_FEE);

        BalanceDelta delta = _swap(key, true, SWAP_AMOUNT);
        uint256 amountIn = uint256(uint128(-SWAP_AMOUNT));
        assertApproxEqAbs(uint256(int256(delta.amount1())), amountIn * 9 / 10, 3);
    }

    function test_decay_feeIsNeverWrittenToPoolStorage() public {
        vm.roll(START_BLOCK);
        _swap(key, true, SWAP_AMOUNT);
        (,, uint24 storedLpFee) = poolManager.getSlot0(poolId);
        // Dynamic-fee pools store 0 and the hook never calls updateDynamicLPFee: the override is
        // per-call only. This is why EVERY beforeSwap AND beforeMint path must return an override.
        assertEq(storedLpFee, 0);
    }

    function test_feeAt_revertsForUnconfiguredPool() public {
        PoolId unknown = _key(hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, 20).toId();
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.LaunchNotConfigured.selector, unknown));
        hook.feeAt(unknown, block.number);
    }

    /*//////////////////////////////////////////////////////////////
                            DISABLED LAUNCH
    //////////////////////////////////////////////////////////////*/

    function test_disabled_appliesFinalFeeAndNoGate() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        hook.configureLaunch(key, cfg);

        // Before startBlock, and yet tradeable: the gate is part of the protection, not the pool.
        vm.roll(START_BLOCK - 1);
        assertEq(hook.currentFee(poolId), FINAL_FEE);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), FINAL_FEE);
    }

    function test_disabled_stillOverridesSoThePoolIsNeverFeeFree() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        cfg.finalFeeBips = 500;
        hook.configureLaunch(key, cfg);

        vm.roll(START_BLOCK - 1);
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), 500);
    }

    /*//////////////////////////////////////////////////////////////
             THE MINT ROUTE — BIN ONLY, AND THE REASON THIS
             HOOK IS NOT A LINE-FOR-LINE PORT OF THE CL ONE

        Adding liquidity to the ACTIVE bin at a ratio other than the
        bin's own is an implicit swap inside core, priced at the
        composition fee. If the hook does not override that fee, a
        dynamic-fee pool charges its STORED fee, which is zero.
    //////////////////////////////////////////////////////////////*/

    /// @dev The hole, demonstrated. Same hook code, same configuration, the ONLY difference is that
    /// the naive variant declares the CL permission set and therefore never gets asked for a fee on
    /// mint. Its composition fee is zero: a completely free swap around the launch tax, available
    /// even before `startBlock`, when its own `beforeSwap` still reverts.
    function test_mint_naivePortWithoutBeforeMintLeavesAFreeSwapRoute() public {
        NaiveBinLaunchGuardHook naive = new NaiveBinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        assertEq(naive.getHooksRegistrationBitmap(), uint16(65)); // exactly the CL hook's bitmap

        PoolKey memory k = _key(naive, LPFeeLibrary.DYNAMIC_FEE_FLAG, BIN_STEP);
        naive.configureLaunch(k, _defaultConfig());
        poolManager.initialize(k, ACTIVE_ID);
        liquidityHelper.mint(k, _getSingleBinMintParams(ACTIVE_ID, 100 ether, 100 ether), ZERO_BYTES);

        // Trading is shut...
        vm.roll(START_BLOCK - 1);
        _expectHookRevert(
            address(naive),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                BinLaunchGuardHook.TradingNotOpen.selector, k.toId(), uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(k, true, SWAP_AMOUNT);

        // ...but the mint route is wide open AND free.
        (uint128 feeX, uint128 feeY) = _lopsidedMintAndReadCompositionFee(k, 1 ether);
        assertEq(feeX, 0, "naive port charged a composition fee");
        assertEq(feeY, 0, "naive port charged a composition fee");
    }

    /// @dev The fix. Same scenario against the real hook: the composition fee is non-zero, and it
    /// is the decayed fee from the schedule.
    function test_mint_compositionSwapIsTaxed() public {
        vm.roll(START_BLOCK);
        (uint128 feeX, uint128 feeY) = _lopsidedMintAndReadCompositionFee(key, 1 ether);
        assertGt(feeX, 0, "composition swap went untaxed");
        assertEq(feeY, 0, "fee should be charged on the X side that was implicitly swapped");
    }

    /// @dev The mint tax follows the same schedule as the swap tax, so neither route is cheaper.
    /// @dev Two IDENTICAL pools are used rather than two mints into one, because the first lopsided
    /// mint rebalances the active bin and would change the size of the second implicit swap. The
    /// only difference between the measurements is therefore the block, i.e. the schedule.
    function test_mint_compositionFeeDecaysWithTheSchedule() public {
        PoolKey memory poolA = _freshGuardedPool(30);
        PoolKey memory poolB = _freshGuardedPool(31);

        vm.roll(START_BLOCK);
        (uint128 feeAtOpen,) = _lopsidedMintAndReadCompositionFee(poolA, 1 ether);

        vm.roll(START_BLOCK + DECAY_BLOCKS);
        (uint128 feeAfterWindow,) = _lopsidedMintAndReadCompositionFee(poolB, 1 ether);

        assertGt(feeAtOpen, feeAfterWindow, "mint tax did not decay");
        // The composition fee is monotonic in the LP fee, and the schedule falls from 8% to 0.3%,
        // so the opening charge must be many times the settled one.
        assertGt(feeAtOpen, feeAfterWindow * 10, "mint tax decayed by the wrong amount");
    }

    /// @dev Seeding is not penalised: a ratio-matched add charges no composition fee at all, so the
    /// launcher can seed the pool at any block despite the mint tax being live from block one.
    function test_mint_balancedSeedingIsUntaxed() public {
        vm.roll(START_BLOCK); // tax at its maximum
        vm.recordLogs();
        liquidityHelper.mint(key, _getSingleBinMintParams(ACTIVE_ID, 10 ether, 10 ether), ZERO_BYTES);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(poolManager) && logs[i].topics[0] == IBinPoolManager.Mint.selector) {
                (,,, bytes32 compositionFee,) =
                    abi.decode(logs[i].data, (uint256[], bytes32, bytes32[], bytes32, bytes32));
                assertEq(compositionFee.decodeX(), 0);
                assertEq(compositionFee.decodeY(), 0);
                return;
            }
        }
        revert("Mint event not found");
    }

    /// @dev RESIDUAL RISK, DELIBERATELY CAPTURED AND NOT FIXED. Mints are taxed, not gated. They
    /// have to be: `sender` is the router, so the hook cannot tell the launcher seeding the pool
    /// from a sniper extracting from it. A sniper can therefore acquire the launch token before
    /// `startBlock` by minting lopsided and burning - paying `initialFeeBips` on the way, but
    /// bypassing the trading gate that stops ordinary swaps in the same block.
    function test_mint_isTaxedButNotGatedBeforeStartBlock_residualRisk() public {
        vm.roll(START_BLOCK - 1);

        // A swap in this block is impossible.
        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                BinLaunchGuardHook.TradingNotOpen.selector, poolId, uint256(START_BLOCK), uint256(START_BLOCK - 1)
            )
        );
        _swap(key, true, SWAP_AMOUNT);

        // A composition swap in the same block is not, but it is charged the OPENING rate.
        assertEq(hook.currentFee(poolId), INITIAL_FEE);
        (uint128 feeX,) = _lopsidedMintAndReadCompositionFee(key, 1 ether);
        assertGt(feeX, 0, "pre-launch mint route was free");
    }

    function test_mint_disabledLaunchStillOverridesCompositionFee() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.enabled = false;
        hook.configureLaunch(key, cfg);

        vm.roll(START_BLOCK - 1);
        (uint128 feeX,) = _lopsidedMintAndReadCompositionFee(key, 1 ether);
        assertGt(feeX, 0, "disabled launch left the mint route fee-free");
    }

    /*//////////////////////////////////////////////////////////////
                       PER-TRANSACTION BUY CAP

        NOTE: this is a per-TRANSACTION cap on the SWAP path and
        nothing more. See `test_maxBuy_doesNotStopSplittingAcross-
        Transactions` and `test_maxBuy_doesNotConstrainTheMintRoute`.
    //////////////////////////////////////////////////////////////*/

    function _configureWithCap(uint128 cap) internal {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
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
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(5_001), uint128(5_000))
        );
        _swap(key, true, -5_001);
    }

    function test_maxBuy_doesNotConstrainSells() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);
        // currency1 (Y) is the launch token, so a Y-for-X swap is a SELL and is uncapped by design.
        _swap(key, false, -50_000);
    }

    function test_maxBuy_directionFollowsLaunchTokenSide() public {
        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
        cfg.maxBuyPerTx = 5_000;
        cfg.launchTokenIsCurrency0 = true; // now the Y-for-X direction is the buy
        hook.configureLaunch(key, cfg);
        vm.roll(START_BLOCK);

        _swap(key, true, -50_000); // swapForY is now a sell: uncapped

        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(5_001), uint128(5_000))
        );
        _swap(key, false, -5_001);
    }

    function test_maxBuy_blocksExactOutputBuysWhileCapIsLive() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);
        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.ExactOutputBuyBlockedDuringLaunch.selector)
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
            token0.mint(buyer, 1 ether);
            _approveAll(buyer);
            vm.prank(buyer);
            _swap(key, true, -5_000);
        }
        assertEq(block.number, START_BLOCK); // all in one block
    }

    /// @dev And the cap does not reach the mint route at all: `beforeMint` sees `liquidityConfigs`
    /// and a packed `amountIn`, not the size of the implicit swap core will compute from the bin's
    /// live reserves. A capped buyer can move far more than the cap through mint+burn, paying only
    /// the composition fee. Bin-specific, and not removable at this layer.
    function test_maxBuy_doesNotConstrainTheMintRoute() public {
        _configureWithCap(5_000);
        vm.roll(START_BLOCK);

        _expectHookRevert(
            address(hook),
            IBinHooks.beforeSwap.selector,
            abi.encodeWithSelector(BinLaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(1 ether), uint128(5_000))
        );
        _swap(key, true, -1 ether);

        // The same size goes through the mint route without touching the cap.
        (uint128 feeX,) = _lopsidedMintAndReadCompositionFee(key, 1 ether);
        assertGt(feeX, 0); // taxed, but not capped
    }

    /*//////////////////////////////////////////////////////////////
                          onlyPoolManager GUARD
    //////////////////////////////////////////////////////////////*/

    function test_onlyPoolManager_beforeSwapIsUnreachableDirectly() public {
        vm.roll(START_BLOCK);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, true, SWAP_AMOUNT, ZERO_BYTES);
    }

    function test_onlyPoolManager_beforeMintIsUnreachableDirectly() public {
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeMint(address(this), key, _getSingleBinMintParams(ACTIVE_ID, 1 ether, 1 ether), ZERO_BYTES);
    }

    function test_onlyPoolManager_beforeInitializeIsUnreachableDirectly() public {
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), key, ACTIVE_ID);
    }

    function test_onlyPoolManager_alsoBlocksTheLaunchOwner() public {
        // The gate is on the caller, not on privilege: even the launch owner cannot fake a swap
        // and flip the `launched` flag or drive the hook's accounting.
        vm.roll(START_BLOCK);
        assertEq(hook.launchOwner(poolId), address(this));
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, true, SWAP_AMOUNT, ZERO_BYTES);
        assertFalse(hook.getLaunch(poolId).launched);
    }

    /// @dev The guard runs BEFORE the not-implemented check, so an outsider learns nothing about
    /// which callbacks a hook implements, and cannot reach unimplemented ones either.
    function test_onlyPoolManager_unimplementedCallbacksStillRevertForOutsiders() public {
        IBinPoolManager.BurnParams memory bp =
            _getSingleBinBurnLiquidityParams(key, poolManager, ACTIVE_ID, address(this), 100);

        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, ACTIVE_ID);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeBurn(address(this), key, bp, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.afterBurn(address(this), key, bp, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, true, SWAP_AMOUNT, BalanceDelta.wrap(0), ZERO_BYTES);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.beforeDonate(address(this), key, 1, 1, ZERO_BYTES);
        vm.expectRevert(BaseBinHook.NotPoolManager.selector);
        hook.afterDonate(address(this), key, 1, 1, ZERO_BYTES);
    }

    /*//////////////////////////////////////////////////////////////
        THE `sender` CONSTRAINT — CAPTURED IN THE SUITE ON PURPOSE

        `BinHooks.beforeSwap` calls the hook with `msg.sender` of `BinPoolManager.swap`, which is
        whoever locked the Vault: the ROUTER. It is never the buyer. Any per-wallet rule keyed on
        this argument would be consumed by the first buyer on everyone's behalf, which is why this
        hook taxes time instead of identity. `BinHooks.beforeMint` behaves identically.
    //////////////////////////////////////////////////////////////*/

    function _deploySpyPool() internal returns (SenderRecordingBinLaunchGuardHook spy, PoolKey memory k) {
        spy = new SenderRecordingBinLaunchGuardHook(poolManager, BLOCK_TIME_CENTIS, MAX_DECAY, MAX_START);
        k = _key(spy, LPFeeLibrary.DYNAMIC_FEE_FLAG, BIN_STEP);
        spy.configureLaunch(k, _defaultConfig());
        poolManager.initialize(k, ACTIVE_ID);
        liquidityHelper.mint(k, _getSingleBinMintParams(ACTIVE_ID, 100 ether, 100 ether), ZERO_BYTES);
    }

    function test_sender_isTheLockerNotTheBuyer() public {
        (SenderRecordingBinLaunchGuardHook spy, PoolKey memory k) = _deploySpyPool();

        vm.roll(START_BLOCK);

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        token0.mint(alice, 1 ether);
        token0.mint(bob, 1 ether);
        _approveAll(alice);
        _approveAll(bob);

        vm.prank(alice);
        _swap(k, true, SWAP_AMOUNT);
        address senderSeenForAlice = spy.lastSwapSender();

        vm.prank(bob);
        _swap(k, true, SWAP_AMOUNT);
        address senderSeenForBob = spy.lastSwapSender();

        assertEq(spy.swapCount(), 2);

        // The hook saw the router both times, never the buyer.
        assertEq(senderSeenForAlice, address(swapHelper));
        assertEq(senderSeenForBob, address(swapHelper));
        assertEq(senderSeenForAlice, senderSeenForBob);
        assertTrue(senderSeenForAlice != alice);
        assertTrue(senderSeenForBob != bob);
    }

    /// @dev Second half of the same constraint: a caller who bypasses the router and locks the
    /// Vault himself presents whatever `sender` he likes (his own contract) and whatever
    /// `hookData` he likes. Neither can be used as an identity.
    function test_sender_aSecondRouterPresentsADifferentSenderEntirely() public {
        (SenderRecordingBinLaunchGuardHook spy, PoolKey memory k) = _deploySpyPool();

        BinSwapHelper rogue = new BinSwapHelper(poolManager, vault);
        token0.approve(address(rogue), type(uint256).max);
        token1.approve(address(rogue), type(uint256).max);

        vm.roll(START_BLOCK);

        _swap(k, true, SWAP_AMOUNT);
        assertEq(spy.lastSwapSender(), address(swapHelper));

        rogue.swap(
            k,
            true,
            SWAP_AMOUNT,
            BinSwapHelper.TestSettings(true, true),
            // arbitrary attacker-chosen hookData naming a victim: unverifiable, hence unused
            abi.encode(makeAddr("someVictim"))
        );
        assertEq(spy.lastSwapSender(), address(rogue));
    }

    /// @dev The bin-specific half: the mint callback has the same blindness, which is precisely why
    /// mints cannot be gated to the launcher and must be taxed instead.
    function test_sender_mintCallbackAlsoSeesTheLockerNotTheMinter() public {
        (SenderRecordingBinLaunchGuardHook spy, PoolKey memory k) = _deploySpyPool();

        address carol = makeAddr("carol");
        token0.mint(carol, 10 ether);
        token1.mint(carol, 10 ether);
        _approveAll(carol);

        vm.prank(carol);
        liquidityHelper.mint(k, _getSingleBinMintParams(ACTIVE_ID, 1 ether, 1 ether), ZERO_BYTES);

        assertEq(spy.lastMintSender(), address(liquidityHelper));
        assertTrue(spy.lastMintSender() != carol);
    }

    /*//////////////////////////////////////////////////////////////
                                 FUZZ
    //////////////////////////////////////////////////////////////*/

    /// @dev Reconfigures the pool's schedule and returns the (frozen) start block. Safe to call
    /// repeatedly because the fuzz tests never roll past `START_BLOCK` before configuring.
    function _fuzzConfigure(uint24 initialFee, uint24 finalFee, uint32 decayBlocks)
        internal
        returns (uint24, uint24, uint32)
    {
        finalFee = uint24(bound(finalFee, 0, hook.MAX_FINAL_FEE()));
        initialFee = uint24(bound(initialFee, finalFee, hook.MAX_INITIAL_FEE()));
        decayBlocks = uint32(bound(decayBlocks, 1, hook.MAX_DECAY_BLOCKS()));

        BinLaunchGuardHook.LaunchConfig memory cfg = _defaultConfig();
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
            // Never exceeds what core will accept for a BIN pool - one tenth of the CL ceiling.
            assertLe(fee, LPFeeLibrary.TEN_PERCENT_FEE, "fee above core's bin max");
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
    /// survive core's own `removeOverrideAndValidate(TEN_PERCENT_FEE)`. A schedule this hook
    /// accepts can never make a swap revert with `LPFeeTooLarge`.
    function testFuzz_decay_appliedFeeMatchesSchedule(
        uint24 initialFee,
        uint24 finalFee,
        uint32 decayBlocks,
        uint16 elapsed
    ) public {
        decayBlocks = uint32(bound(decayBlocks, 1, 5_000));
        (initialFee, finalFee, decayBlocks) = _fuzzConfigure(initialFee, finalFee, decayBlocks);

        uint256 offset = bound(elapsed, 0, uint256(decayBlocks) + 10);
        vm.roll(uint256(START_BLOCK) + offset);

        uint24 expected = hook.currentFee(poolId);
        uint24 applied = _swapAndReadAppliedFee(true, SWAP_AMOUNT);
        assertEq(applied, expected);
        assertLe(applied, LPFeeLibrary.TEN_PERCENT_FEE);
    }

    /// @dev The mint route reads the SAME schedule as the swap route at every block, so there is
    /// never a block in which minting is the cheaper way through the tax.
    function testFuzz_mintAndSwapReadTheSameSchedule(
        uint24 initialFee,
        uint24 finalFee,
        uint32 decayBlocks,
        uint16 elapsed
    ) public {
        decayBlocks = uint32(bound(decayBlocks, 1, 5_000));
        (initialFee, finalFee, decayBlocks) = _fuzzConfigure(initialFee, finalFee, decayBlocks);

        uint256 offset = bound(elapsed, 0, uint256(decayBlocks) + 10);
        vm.roll(uint256(START_BLOCK) + offset);

        uint24 scheduled = hook.currentFee(poolId);

        // The swap path applies exactly `scheduled`...
        assertEq(_swapAndReadAppliedFee(true, SWAP_AMOUNT), scheduled);

        // ...and the mint path is non-zero whenever `scheduled` is, i.e. the composition route is
        // never free while swaps are taxed.
        (uint128 feeX,) = _lopsidedMintAndReadCompositionFee(key, 1 ether);
        if (scheduled > 0) assertGt(feeX, 0, "mint route free while swaps are taxed");
        assertLe(scheduled, LPFeeLibrary.TEN_PERCENT_FEE);
        assertLe(initialFee, LPFeeLibrary.TEN_PERCENT_FEE);
        assertLe(finalFee, scheduled);
    }

    /*//////////////////////////////////////////////////////////////
       THE TWO BLOCK CAPS ARE WALL-CLOCK BOUNDED NOW

       Same finding as `LaunchGuardHook`, in the hook that was never deployed and
       could therefore be fixed for free. `MAX_DECAY_BLOCKS` and `MAX_START_DELAY`
       were `constant 1_000_000` - "~139 days at 12s blocks", and 28 HOURS on
       Robinhood Chain, where a three-day fair launch reverts.
    //////////////////////////////////////////////////////////////*/

    /// FAILS AGAINST THE PRE-FIX CODE: there was no argument to reject.
    function test_FIX_theOldConstantIsRejectedAtRobinhoodBlockTime() public {
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchWindowOutOfRange.selector, 100_000, 3 days, 180 days)
        );
        new BinLaunchGuardHook(poolManager, 10, 1_000_000, 1_000_000);

        BinLaunchGuardHook slow = new BinLaunchGuardHook(poolManager, 1200, 1_000_000, 1_000_000);
        assertEq((uint256(slow.MAX_DECAY_BLOCKS()) * slow.blockTimeCentis()) / 100, 12_000_000);
    }

    function test_FIX_aThreeDayWindowFitsAtRobinhoodBlockTime() public {
        BinLaunchGuardHook fast = new BinLaunchGuardHook(poolManager, 10, MAX_DECAY, MAX_START);
        assertLe(uint32(3 * 24 * 3600 * 10), fast.MAX_DECAY_BLOCKS(), "a three-day launch must fit");
        assertGe((uint256(fast.MAX_DECAY_BLOCKS()) * 10) / 100, fast.MIN_LAUNCH_WINDOW_SECONDS());
    }

    function test_FIX_rejectsAZeroOrAbsurdBlockTime() public {
        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.InvalidBlockTime.selector, uint32(0)));
        new BinLaunchGuardHook(poolManager, 0, MAX_DECAY, MAX_START);

        vm.expectRevert(abi.encodeWithSelector(BinLaunchGuardHook.InvalidBlockTime.selector, uint32(60_001)));
        new BinLaunchGuardHook(poolManager, 60_001, MAX_DECAY, MAX_START);
    }

    /// @dev Both caps, not just the first.
    function test_FIX_theStartDelayCapIsBoundedToo() public {
        vm.expectRevert(
            abi.encodeWithSelector(BinLaunchGuardHook.LaunchWindowOutOfRange.selector, 100_000, 3 days, 180 days)
        );
        new BinLaunchGuardHook(poolManager, 10, MAX_DECAY, 1_000_000);
    }
}

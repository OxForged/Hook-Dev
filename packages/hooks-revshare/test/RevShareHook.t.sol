// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "infinity-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {CustomRevert} from "infinity-core/src/libraries/CustomRevert.sol";
import {Hooks} from "infinity-core/src/libraries/Hooks.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {TokenFixture} from "infinity-core/test/helpers/TokenFixture.sol";
import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {BaseCLHook} from "latch-hooks/src/base/BaseCLHook.sol";
import {RevShareHook} from "../src/RevShareHook.sol";
import {BlacklistERC20} from "./mocks/Mocks.sol";

/// @dev Records the `sender` core hands to `afterSwap`, so the test suite can pin the fact the
/// whole design rests on: it is the vault locker, never the trader.
contract SenderRecordingHook is RevShareHook {
    address public lastAfterSwapSender;

    constructor(ICLPoolManager pm, address owner_, address guardian_) RevShareHook(pm, owner_, guardian_) {}

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        lastAfterSwapSender = sender;
        return super._afterSwap(sender, key, params, delta, hookData);
    }
}

contract RevShareHookTest is Test, Deployers, TokenFixture {
    using LPFeeLibrary for uint24;

    Vault vault;
    CLPoolManager poolManager;
    RevShareHook hook;
    CLPoolManagerRouter router;

    PoolKey key;
    PoolId poolId;

    /// @dev A hookless pool with identical currencies, fee, spacing and liquidity. Swapping the
    /// same amount through it yields the GROSS output, which is what the revenue share is a
    /// percentage of - so fee arithmetic can be asserted exactly instead of approximately.
    PoolKey controlKey;

    address constant GOVERNANCE = address(0x600E);
    address constant GUARDIAN = address(0x6A47);
    address constant TREASURY = address(0x7EEA);
    address constant CHARITY = address(0xC4A1);
    address constant DISTRIBUTOR = address(0xD157);
    address constant ALICE = address(0xA11CE);

    uint24 constant LP_FEE = 3000; // 0.30%, static
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE_PIPS = 10_000; // 1% of the unspecified amount
    int256 constant SWAP_AMOUNT = -1 ether;

    function setUp() public {
        (vault, poolManager) = createFreshManager();
        hook = new RevShareHook(poolManager, GOVERNANCE, GUARDIAN);
        router = new CLPoolManagerRouter(vault, poolManager);

        initializeTokens();
        mint(1_000_000 ether);

        key = _key(hook);
        poolId = key.toId();
        controlKey = _key(IHooks(address(0)));

        hook.configure(key, _params(FEE_PIPS, 0, 10_000, 0, address(0)));
        poolManager.initialize(key, SQRT_RATIO_1_1);
        poolManager.initialize(controlKey, SQRT_RATIO_1_1);

        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        IERC20(Currency.unwrap(currency1)).approve(address(router), type(uint256).max);
        _addLiquidity(key);
        _addLiquidity(controlKey);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _key(IHooks h) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: currency0,
            currency1: currency1,
            hooks: h,
            poolManager: poolManager,
            fee: LP_FEE,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(address(h) == address(0) ? 0 : h.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });
    }

    function _params(uint24 feePips, uint16 lpBps, uint16 benBps, uint16 distBps, address distributor)
        internal
        pure
        returns (RevShareHook.ConfigParams memory)
    {
        return RevShareHook.ConfigParams({
            feePips: feePips,
            lpDonateBps: lpBps,
            beneficiaryBps: benBps,
            distributorBps: distBps,
            distributor: distributor,
            enabled: true
        });
    }

    function _addLiquidity(PoolKey memory k) internal {
        router.modifyPosition(
            k,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: 100_000 ether,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _swap(PoolKey memory k, int256 amountSpecified, bool zeroForOne) internal returns (BalanceDelta) {
        return router.swap(
            k,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ZERO_BYTES
        );
    }

    function _roster(address a, uint96 wa) internal pure returns (RevShareHook.Beneficiary[] memory r) {
        r = new RevShareHook.Beneficiary[](1);
        r[0] = RevShareHook.Beneficiary({recipient: a, weight: wa});
    }

    function _roster(address a, uint96 wa, address b, uint96 wb)
        internal
        pure
        returns (RevShareHook.Beneficiary[] memory r)
    {
        r = new RevShareHook.Beneficiary[](2);
        r[0] = RevShareHook.Beneficiary({recipient: a, weight: wa});
        r[1] = RevShareHook.Beneficiary({recipient: b, weight: wb});
    }

    /// @dev Core wraps a reverting hook in an ERC-7751 `WrappedError`. Rebuild the envelope so the
    /// tests assert on the hook's own error rather than on a generic failure. The `details` field
    /// is `Hooks.HookCallFailed()`, which is what `Hooks.callHook` passes to
    /// `CustomRevert.bubbleUpAndRevertWith` - not empty bytes.
    function _wrapped(bytes4 selector, bytes memory inner) internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            address(hook),
            selector,
            inner,
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    /*//////////////////////////////////////////////////////////////
        THE SOLVENCY INVARIANT

        Two statements, checked after every state-changing test action.

        (1) The vault is not short. Every ERC20 the vault holds is accounted for by exactly two
            claimants: the pool manager's app reserve, and outstanding ERC-6909 claims. If the
            hook could ever settle without paying, this equality would break in the vault's
            favour first - a drain shows up here before it shows up as a stolen token.

        (2) The hook is not short. Everything it has promised (`totalOwed`) is covered by what it
            can actually deliver (tokens held plus redeemable claims). A hook that credits more
            than it took would break this.
    //////////////////////////////////////////////////////////////*/

    function _assertSolvent() internal view {
        _assertSolventFor(currency0);
        _assertSolventFor(currency1);
    }

    function _assertSolventFor(Currency c) internal view {
        uint256 vaultBalance = IERC20(Currency.unwrap(c)).balanceOf(address(vault));
        uint256 accounted = vault.reservesOfApp(address(poolManager), c) + vault.balanceOf(address(hook), c)
            + vault.balanceOf(address(router), c) + vault.balanceOf(address(this), c);
        assertEq(vaultBalance, accounted, "vault holds tokens nobody has a claim on, or is short");

        assertGe(hook.backing(c), hook.totalOwed(c), "hook owes more than it can pay");
    }

    /*//////////////////////////////////////////////////////////////
                          PERMISSIONS AND WIRING
    //////////////////////////////////////////////////////////////*/

    function test_bitmap_isBeforeInitializePlusAfterSwapWithDelta() public view {
        uint16 bitmap = hook.getHooksRegistrationBitmap();
        assertEq(bitmap, uint16(1) | uint16(1 << 7) | uint16(1 << 11));
        // bit 11 (afterSwapReturnsDelta) requires bit 7 (afterSwap); assert the dependency holds.
        assertTrue(bitmap & (1 << 11) == 0 || bitmap & (1 << 7) != 0);
        // and that neither reserved bit is set
        assertEq(bitmap & 0xC000, 0);
    }

    function test_callbacks_onlyPoolManager() public {
        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), key, SQRT_RATIO_1_1);

        vm.expectRevert(BaseCLHook.NotPoolManager.selector);
        hook.afterSwap(
            address(this),
            key,
            ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            BalanceDelta.wrap(0),
            ZERO_BYTES
        );
    }

    function test_unimplementedCallbacks_revert() public {
        // Declared-but-unimplemented permissions must fail loudly; these are not declared at all,
        // so the base class's reverting defaults are what an attacker would reach.
        vm.prank(address(poolManager));
        vm.expectRevert(BaseCLHook.HookNotImplemented.selector);
        hook.beforeSwap(
            address(this),
            key,
            ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: MIN_PRICE_LIMIT}),
            ZERO_BYTES
        );
    }

    function test_beforeInitialize_rejectsDynamicFeePool() public {
        PoolKey memory dyn = _key(hook);
        dyn.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;

        vm.expectRevert(RevShareHook.PoolMustUseStaticFee.selector);
        hook.configure(dyn, _params(FEE_PIPS, 10_000, 0, 0, address(0)));

        vm.expectRevert(
            _wrapped(ICLHooks.beforeInitialize.selector, abi.encodeWithSelector(RevShareHook.PoolMustUseStaticFee.selector))
        );
        poolManager.initialize(dyn, SQRT_RATIO_1_1);
    }

    function test_beforeInitialize_rejectsUnconfiguredPool() public {
        PoolKey memory fresh = _key(hook);
        fresh.fee = 500;
        fresh.parameters = CLPoolParametersHelper.setTickSpacing(
            bytes32(uint256(hook.getHooksRegistrationBitmap())), int24(10)
        );

        vm.expectRevert(
            _wrapped(
                ICLHooks.beforeInitialize.selector,
                abi.encodeWithSelector(RevShareHook.PoolNotConfigured.selector, fresh.toId())
            )
        );
        poolManager.initialize(fresh, SQRT_RATIO_1_1);
    }

    function test_lockAcquired_notCallableDirectly() public {
        vm.expectRevert(RevShareHook.UnexpectedLockCallback.selector);
        hook.lockAcquired(abi.encode(currency0, uint256(1)));

        // Even impersonating the vault fails, because the hook only ever expects the callback
        // inside its own `redeem`.
        vm.prank(address(vault));
        vm.expectRevert(RevShareHook.UnexpectedLockCallback.selector);
        hook.lockAcquired(abi.encode(currency0, uint256(1)));
    }

    function test_receive_rejectsStrayNative() public {
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (bool ok,) = address(hook).call{value: 1 ether}("");
        assertFalse(ok);
    }

    /// @dev The constraint that shapes the whole design. If this ever fails, every per-wallet idea
    /// that was rejected on its account becomes worth revisiting - and every one that was shipped
    /// on the assumption becomes suspect.
    function test_sender_isTheLockerNotTheTrader() public {
        SenderRecordingHook recorder = new SenderRecordingHook(poolManager, GOVERNANCE, GUARDIAN);
        PoolKey memory k = _key(recorder);
        k.fee = 500;
        k.parameters =
            CLPoolParametersHelper.setTickSpacing(bytes32(uint256(recorder.getHooksRegistrationBitmap())), int24(10));

        recorder.configure(k, _params(FEE_PIPS, 0, 10_000, 0, address(0)));
        poolManager.initialize(k, SQRT_RATIO_1_1);
        _addLiquidity(k);

        MockERC20(Currency.unwrap(currency0)).transfer(ALICE, 10 ether);
        vm.startPrank(ALICE);
        IERC20(Currency.unwrap(currency0)).approve(address(router), type(uint256).max);
        _swap(k, SWAP_AMOUNT, true);
        vm.stopPrank();

        assertEq(recorder.lastAfterSwapSender(), address(router), "sender must be the locker");
        assertTrue(recorder.lastAfterSwapSender() != ALICE, "sender must NOT be the trader");
    }

    /*//////////////////////////////////////////////////////////////
                             CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_configure_firstCallerClaimsPool() public {
        assertEq(hook.poolOwner(poolId), address(this));

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NotPoolOwner.selector, poolId, ALICE));
        hook.configure(key, _params(0, 10_000, 0, 0, address(0)));
    }

    function test_configure_rejectsBadSplitAndFee() public {
        PoolKey memory fresh = _key(hook);
        fresh.fee = 500;
        fresh.parameters =
            CLPoolParametersHelper.setTickSpacing(bytes32(uint256(hook.getHooksRegistrationBitmap())), int24(10));

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.FeeTooHigh.selector, uint24(100_001)));
        hook.configure(fresh, _params(100_001, 10_000, 0, 0, address(0)));

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.SplitMustSumToDenominator.selector, uint256(9_999)));
        hook.configure(fresh, _params(1000, 9_999, 0, 0, address(0)));

        vm.expectRevert(RevShareHook.DistributorRequired.selector);
        hook.configure(fresh, _params(1000, 0, 0, 10_000, address(0)));
    }

    function test_configure_immediateBeforeInitializeThenDelayedAfter() public {
        PoolKey memory fresh = _key(hook);
        fresh.fee = 500;
        fresh.parameters =
            CLPoolParametersHelper.setTickSpacing(bytes32(uint256(hook.getHooksRegistrationBitmap())), int24(10));
        PoolId freshId = fresh.toId();

        hook.configure(fresh, _params(1000, 10_000, 0, 0, address(0)));
        // Still uninitialised: reconfiguration is free, nobody has traded.
        hook.configure(fresh, _params(2000, 10_000, 0, 0, address(0)));
        assertEq(hook.getConfig(freshId).feePips, 2000);

        poolManager.initialize(fresh, SQRT_RATIO_1_1);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.PoolAlreadyConfigured.selector, freshId));
        hook.configure(fresh, _params(3000, 10_000, 0, 0, address(0)));
    }

    function test_proposeConfig_cannotRaiseFeeWithoutTheDelay() public {
        hook.proposeConfig(key, _params(50_000, 0, 10_000, 0, address(0)));
        assertEq(hook.getConfig(poolId).feePips, FEE_PIPS, "live config must not move on propose");

        uint48 due = hook.getPendingConfig(poolId).effectiveBlock;
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.PendingConfigNotDue.selector, poolId, due));
        hook.applyPendingConfig(key);

        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        // Permissionless: the delay is the protection, not the caller.
        vm.prank(ALICE);
        hook.applyPendingConfig(key);
        assertEq(hook.getConfig(poolId).feePips, 50_000);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NoPendingConfig.selector, poolId));
        hook.applyPendingConfig(key);
    }

    function test_reduceFee_isImmediateAndCannotRaise() public {
        hook.reduceFee(key, 100);
        assertEq(hook.getConfig(poolId).feePips, 100);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.FeeNotReduced.selector, uint24(100), uint24(200)));
        hook.reduceFee(key, 200);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.FeeNotReduced.selector, uint24(100), uint24(100)));
        hook.reduceFee(key, 100);
    }

    function test_disable_stopsTheCutImmediately() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        hook.disable(key);

        _swap(key, SWAP_AMOUNT, true);
        assertEq(hook.pendingBeneficiary(poolId, currency1), 0);
        _assertSolvent();
    }

    function test_freezeConfig_isPermanentAndDiscardsProposals() public {
        hook.proposeConfig(key, _params(50_000, 0, 10_000, 0, address(0)));
        hook.freezeConfig(key);

        assertEq(hook.getPendingConfig(poolId).effectiveBlock, 0, "freeze must discard the proposal");

        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NoPendingConfig.selector, poolId));
        hook.applyPendingConfig(key);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.reduceFee(key, 1);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.proposeConfig(key, _params(1, 10_000, 0, 0, address(0)));
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.setBeneficiaries(key, _roster(ALICE, 1));
    }

    function test_poolOwnership_isTwoStep() public {
        hook.transferPoolOwnership(key, ALICE);
        assertEq(hook.poolOwner(poolId), address(this), "ownership must not move on propose");

        vm.prank(TREASURY);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NotPoolOwner.selector, poolId, TREASURY));
        hook.acceptPoolOwnership(key);

        vm.prank(ALICE);
        hook.acceptPoolOwnership(key);
        assertEq(hook.poolOwner(poolId), ALICE);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NotPoolOwner.selector, poolId, address(this)));
        hook.reduceFee(key, 1);
    }

    function test_globalPause_guardianCanOnlyPause() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        vm.prank(GUARDIAN);
        hook.setPaused(true);
        _swap(key, SWAP_AMOUNT, true);
        assertEq(hook.pendingBeneficiary(poolId, currency1), 0, "paused hook must take nothing");

        vm.prank(GUARDIAN);
        vm.expectRevert(RevShareHook.NotGuardianOrOwner.selector);
        hook.setPaused(false);

        vm.prank(ALICE);
        vm.expectRevert(RevShareHook.NotGuardianOrOwner.selector);
        hook.setPaused(true);

        vm.prank(GOVERNANCE);
        hook.setPaused(false);
        _swap(key, SWAP_AMOUNT, true);
        assertGt(hook.pendingBeneficiary(poolId, currency1), 0);
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                             FEE ARITHMETIC
    //////////////////////////////////////////////////////////////*/

    /// @dev Exact against a hookless control pool: the cut is exactly `feePips` of the OUTPUT the
    /// same swap would have produced without the hook, and the trader receives the rest.
    function test_exactInput_cutIsAPercentageOfGrossOutput() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        BalanceDelta control = _swap(controlKey, SWAP_AMOUNT, true);
        uint256 grossOut = uint256(int256(control.amount1()));

        BalanceDelta live = _swap(key, SWAP_AMOUNT, true);
        uint256 netOut = uint256(int256(live.amount1()));

        uint256 expectedCut = (grossOut * FEE_PIPS) / 1_000_000;
        assertEq(hook.pendingBeneficiary(poolId, currency1), expectedCut, "accrual must equal the stated percentage");
        assertEq(grossOut - netOut, expectedCut, "trader must lose exactly the cut, not a wei more");
        assertEq(uint256(-int256(live.amount0())), uint256(-int256(control.amount0())), "input side untouched");
        _assertSolvent();
    }

    /// @dev On an exact-OUTPUT swap the unspecified currency is the INPUT, so the cut is charged
    /// on what the trader pays rather than what they receive. Both are legitimate; the point is
    /// that the code handles the flip and does not silently charge the wrong side.
    function test_exactOutput_cutIsChargedOnTheInputSide() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        BalanceDelta control = _swap(controlKey, 1 ether, true);
        uint256 grossIn = uint256(-int256(control.amount0()));

        BalanceDelta live = _swap(key, 1 ether, true);
        uint256 netIn = uint256(-int256(live.amount0()));

        uint256 expectedCut = (grossIn * FEE_PIPS) / 1_000_000;
        assertEq(hook.pendingBeneficiary(poolId, currency0), expectedCut, "cut accrues in the INPUT currency");
        assertEq(netIn - grossIn, expectedCut, "trader pays exactly the cut extra");
        assertEq(uint256(int256(live.amount1())), uint256(int256(control.amount1())), "output side untouched");
        _assertSolvent();
    }

    function test_oneForZero_accruesInCurrency0() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, false);

        assertGt(hook.pendingBeneficiary(poolId, currency0), 0);
        assertEq(hook.pendingBeneficiary(poolId, currency1), 0);
        _assertSolvent();
    }

    function test_zeroFee_takesNothing() public {
        hook.reduceFee(key, 0);
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        BalanceDelta control = _swap(controlKey, SWAP_AMOUNT, true);
        BalanceDelta live = _swap(key, SWAP_AMOUNT, true);

        assertEq(live.amount1(), control.amount1(), "a zero fee must be indistinguishable from no hook");
        assertEq(hook.totalOwed(currency1), 0);
        _assertSolvent();
    }

    function test_dustSwap_roundsToZeroAndTakesNothing() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        // 1% of an output of a few wei floors to zero. It must not revert, and must not take 1 wei
        // it has not earned.
        _swap(key, -50, true);
        assertEq(hook.totalOwed(currency1), 0);
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                         ROUTE 1 - DONATE TO LPs
    //////////////////////////////////////////////////////////////*/

    function test_route1_donationReachesLiquidityProviders() public {
        hook.proposeConfig(key, _params(FEE_PIPS, 10_000, 0, 0, address(0)));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        hook.applyPendingConfig(key);

        BalanceDelta control = _swap(controlKey, SWAP_AMOUNT, true);
        uint256 grossOut = uint256(int256(control.amount1()));
        uint256 expectedDonation = (grossOut * FEE_PIPS) / 1_000_000;

        _swap(key, SWAP_AMOUNT, true);

        // Nothing is retained: the whole cut went straight to in-range liquidity.
        assertEq(hook.totalOwed(currency1), 0, "route 1 must retain nothing");
        assertEq(vault.balanceOf(address(hook), currency1), 0, "route 1 must mint no claims");

        // Withdrawing the position now returns the donated fees on top of the swap fees. Compare
        // against the control pool's position, which earned swap fees only.
        (BalanceDelta live,) = router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: -100_000 ether,
                salt: 0
            }),
            ZERO_BYTES
        );
        (BalanceDelta ctrl,) = router.modifyPosition(
            controlKey,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: -100_000 ether,
                salt: 0
            }),
            ZERO_BYTES
        );

        uint256 liveOut1 = uint256(int256(live.amount1()));
        uint256 ctrlOut1 = uint256(int256(ctrl.amount1()));
        assertGt(liveOut1, ctrlOut1, "LPs must be better off by the donation");
        // Allow one wei of rounding through `feeGrowthGlobal`'s Q128 fixed point.
        assertApproxEqAbs(liveOut1 - ctrlOut1, expectedDonation, 1, "donation must be the configured share");
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                    ROUTE 2 - WEIGHTED BENEFICIARIES
    //////////////////////////////////////////////////////////////*/

    function test_route2_accrueSettleClaim() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 3, CHARITY, 1));
        _swap(key, SWAP_AMOUNT, true);

        uint256 pot = hook.pendingBeneficiary(poolId, currency1);
        assertGt(pot, 0);
        // Nothing is claimable until somebody settles: the swap path writes one integer, no more.
        assertEq(hook.claimable(TREASURY, currency1), 0);

        // Permissionless.
        vm.prank(ALICE);
        hook.settleBeneficiaries(key, currency1);

        assertEq(hook.claimable(TREASURY, currency1), (pot * 3) / 4);
        assertEq(hook.claimable(CHARITY, currency1), pot / 4);
        assertEq(
            hook.claimable(TREASURY, currency1) + hook.claimable(CHARITY, currency1)
                + hook.pendingBeneficiary(poolId, currency1),
            pot,
            "settlement must conserve value"
        );

        uint256 owed = hook.claimable(TREASURY, currency1);
        vm.prank(TREASURY);
        hook.claim(currency1, TREASURY);

        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(TREASURY), owed);
        assertEq(hook.claimable(TREASURY, currency1), 0);
        _assertSolvent();
    }

    function test_route2_claimRedeemsVaultClaimsOnDemand() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);
        hook.settleBeneficiaries(key, currency1);

        // The hook holds ERC-6909 claims, not tokens, until somebody needs real tokens.
        assertGt(vault.balanceOf(address(hook), currency1), 0);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(address(hook)), 0);

        vm.prank(TREASURY);
        hook.claim(currency1, TREASURY);

        assertEq(vault.balanceOf(address(hook), currency1), 0, "claims must be redeemed, not stranded");
        _assertSolvent();
    }

    function test_route2_claimToADifferentAddress() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);
        hook.settleBeneficiaries(key, currency1);

        uint256 owed = hook.claimable(TREASURY, currency1);
        vm.prank(TREASURY);
        hook.claim(currency1, ALICE);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(ALICE), owed);

        vm.prank(TREASURY);
        vm.expectRevert(RevShareHook.NothingToClaim.selector);
        hook.claim(currency1, ALICE);

        vm.prank(TREASURY);
        vm.expectRevert(RevShareHook.InvalidRecipient.selector);
        hook.claim(currency0, address(0));
    }

    function test_route2_nonBeneficiaryCannotClaim() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);
        hook.settleBeneficiaries(key, currency1);

        vm.prank(ALICE);
        vm.expectRevert(RevShareHook.NothingToClaim.selector);
        hook.claim(currency1, ALICE);
    }

    function test_route2_rosterChangeSettlesTheOldRosterFirst() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);
        uint256 pot = hook.pendingBeneficiary(poolId, currency1);
        assertGt(pot, 0);

        // Swapping the roster must not hand the old roster's earnings to the new one.
        hook.setBeneficiaries(key, _roster(CHARITY, 1));
        assertEq(hook.claimable(TREASURY, currency1), pot, "old roster keeps what it earned");
        assertEq(hook.claimable(CHARITY, currency1), 0, "new roster starts empty");
        _assertSolvent();
    }

    function test_route2_emptyRosterHoldsThePotRatherThanLosingIt() public {
        _swap(key, SWAP_AMOUNT, true);
        uint256 pot = hook.pendingBeneficiary(poolId, currency1);
        assertGt(pot, 0);

        hook.settleBeneficiaries(key, currency1); // no-op, no roster
        assertEq(hook.pendingBeneficiary(poolId, currency1), pot);

        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        hook.settleBeneficiaries(key, currency1);
        assertEq(hook.claimable(TREASURY, currency1), pot, "the waiting pot is recoverable");
        _assertSolvent();
    }

    function test_route2_rosterValidation() public {
        vm.expectRevert(RevShareHook.InvalidBeneficiaries.selector);
        hook.setBeneficiaries(key, _roster(address(0), 1));

        vm.expectRevert(RevShareHook.InvalidBeneficiaries.selector);
        hook.setBeneficiaries(key, _roster(TREASURY, 0));

        RevShareHook.Beneficiary[] memory tooMany = new RevShareHook.Beneficiary[](9);
        for (uint256 i = 0; i < 9; ++i) {
            tooMany[i] = RevShareHook.Beneficiary({recipient: address(uint160(i + 1)), weight: 1});
        }
        vm.expectRevert(RevShareHook.InvalidBeneficiaries.selector);
        hook.setBeneficiaries(key, tooMany);

        vm.expectRevert(RevShareHook.InvalidBeneficiaries.selector);
        hook.setBeneficiaries(key, _roster(TREASURY, uint96(1e18), CHARITY, 1));
    }

    function test_route2_settlementRoundingLosesNothing() public {
        // Three co-prime weights guarantee a non-zero floor remainder.
        RevShareHook.Beneficiary[] memory roster = new RevShareHook.Beneficiary[](3);
        roster[0] = RevShareHook.Beneficiary({recipient: TREASURY, weight: 1});
        roster[1] = RevShareHook.Beneficiary({recipient: CHARITY, weight: 1});
        roster[2] = RevShareHook.Beneficiary({recipient: ALICE, weight: 1});
        hook.setBeneficiaries(key, roster);

        _swap(key, SWAP_AMOUNT, true);
        uint256 pot = hook.pendingBeneficiary(poolId, currency1);
        hook.settleBeneficiaries(key, currency1);

        uint256 total = hook.claimable(TREASURY, currency1) + hook.claimable(CHARITY, currency1)
            + hook.claimable(ALICE, currency1) + hook.pendingBeneficiary(poolId, currency1);
        assertEq(total, pot, "the remainder must stay in the pot, not evaporate");
        assertLt(hook.pendingBeneficiary(poolId, currency1), 3, "the remainder is at most one wei per beneficiary");
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                       ROUTE 3 - EPOCH DISTRIBUTOR
    //////////////////////////////////////////////////////////////*/

    function test_route3_onlyTheDistributorCanPull() public {
        hook.proposeConfig(key, _params(FEE_PIPS, 0, 0, 10_000, DISTRIBUTOR));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        hook.applyPendingConfig(key);

        _swap(key, SWAP_AMOUNT, true);
        uint256 pot = hook.pendingDistributorShare(poolId, currency1);
        assertGt(pot, 0);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.NotDistributor.selector, poolId, ALICE));
        hook.pullDistributorShare(key, currency1);

        vm.prank(DISTRIBUTOR);
        uint256 pulled = hook.pullDistributorShare(key, currency1);
        assertEq(pulled, pot);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(DISTRIBUTOR), pot);
        assertEq(hook.pendingDistributorShare(poolId, currency1), 0);

        // A second pull is a no-op, not a revert: an epoch closer should not have to pre-check.
        vm.prank(DISTRIBUTOR);
        assertEq(hook.pullDistributorShare(key, currency1), 0);
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                            THREE-WAY SPLIT
    //////////////////////////////////////////////////////////////*/

    function test_threeWaySplit_conservesTheCut() public {
        hook.proposeConfig(key, _params(FEE_PIPS, 5_000, 3_000, 2_000, DISTRIBUTOR));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        hook.applyPendingConfig(key);
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        BalanceDelta control = _swap(controlKey, SWAP_AMOUNT, true);
        uint256 grossOut = uint256(int256(control.amount1()));

        BalanceDelta live = _swap(key, SWAP_AMOUNT, true);
        uint256 netOut = uint256(int256(live.amount1()));

        uint256 taken = grossOut - netOut;
        uint256 ben = hook.pendingBeneficiary(poolId, currency1);
        uint256 dist = hook.pendingDistributorShare(poolId, currency1);

        assertEq(ben, (grossOut * FEE_PIPS * 3_000) / (1_000_000 * 10_000));
        assertEq(dist, (grossOut * FEE_PIPS * 2_000) / (1_000_000 * 10_000));
        uint256 lp = (grossOut * FEE_PIPS * 5_000) / (1_000_000 * 10_000);
        assertEq(taken, lp + ben + dist, "the trader loses exactly what the three sinks receive");
        assertEq(hook.totalOwed(currency1), ben + dist, "only the retained portion is owed");
        _assertSolvent();
    }

    /*//////////////////////////////////////////////////////////////
                   HOSTILE RECIPIENTS CANNOT TOUCH SWAPS
    //////////////////////////////////////////////////////////////*/

    /// @dev The reason every route is pull-based. A beneficiary that cannot be paid strands its
    /// own balance and nothing else: swaps keep working and other beneficiaries keep claiming.
    function test_hostileBeneficiary_cannotBlockSwapsOrOtherClaims() public {
        // Build a pool whose currency1 refuses transfers to CHARITY.
        BlacklistERC20 hostile = new BlacklistERC20();
        hostile.mint(address(this), 1_000_000 ether);
        MockERC20 other = new MockERC20("Other", "OTH", 18);
        other.mint(address(this), 1_000_000 ether);

        (Currency c0, Currency c1) = address(hostile) < address(other)
            ? (Currency.wrap(address(hostile)), Currency.wrap(address(other)))
            : (Currency.wrap(address(other)), Currency.wrap(address(hostile)));

        PoolKey memory k = PoolKey({
            currency0: c0,
            currency1: c1,
            hooks: hook,
            poolManager: poolManager,
            fee: LP_FEE,
            parameters: CLPoolParametersHelper.setTickSpacing(
                bytes32(uint256(hook.getHooksRegistrationBitmap())), TICK_SPACING
            )
        });

        hook.configure(k, _params(FEE_PIPS, 0, 10_000, 0, address(0)));
        poolManager.initialize(k, SQRT_RATIO_1_1);
        hook.setBeneficiaries(k, _roster(CHARITY, 1, TREASURY, 1));

        IERC20(address(hostile)).approve(address(router), type(uint256).max);
        IERC20(address(other)).approve(address(router), type(uint256).max);
        _addLiquidity(k);

        hostile.setBlocked(CHARITY);

        // Swaps in both directions still work with a beneficiary that cannot be paid.
        _swap(k, SWAP_AMOUNT, true);
        _swap(k, SWAP_AMOUNT, false);

        hook.settleBeneficiaries(k, c0);
        hook.settleBeneficiaries(k, c1);

        Currency hostileCurrency = Currency.wrap(address(hostile));
        assertGt(hook.claimable(CHARITY, hostileCurrency), 0);

        // Only the blacklisted recipient is affected.
        vm.prank(CHARITY);
        vm.expectRevert();
        hook.claim(hostileCurrency, CHARITY);

        vm.prank(TREASURY);
        hook.claim(hostileCurrency, TREASURY);
        assertGt(hostile.balanceOf(TREASURY), 0);

        // And the blacklisted recipient can still route around it.
        vm.prank(CHARITY);
        hook.claim(hostileCurrency, ALICE);
        assertGt(hostile.balanceOf(ALICE), 0);
    }

    /*//////////////////////////////////////////////////////////////
                        THE DRAIN TEST, EXPLICITLY

        `Vault._settle` computes `paid = balanceOfSelf() - reservesBefore`, so anything that lets
        a party settle without paying drains the difference. These check the two ways this hook
        could have created one: an unbacked credit, and a vault balance that stops matching the
        claims on it.
    //////////////////////////////////////////////////////////////*/

    function test_drain_hookNeverCreditsMoreThanItTook() public {
        hook.proposeConfig(key, _params(hook.MAX_FEE_PIPS(), 3_400, 3_300, 3_300, DISTRIBUTOR));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        hook.applyPendingConfig(key);
        hook.setBeneficiaries(key, _roster(TREASURY, 2, CHARITY, 1));

        for (uint256 i = 0; i < 10; ++i) {
            _swap(key, SWAP_AMOUNT, i % 2 == 0);
            _assertSolvent();
        }

        hook.settleBeneficiaries(key, currency0);
        hook.settleBeneficiaries(key, currency1);
        _assertSolvent();

        vm.prank(TREASURY);
        hook.claim(currency0, TREASURY);
        vm.prank(TREASURY);
        hook.claim(currency1, TREASURY);
        vm.prank(CHARITY);
        hook.claim(currency0, CHARITY);
        vm.prank(CHARITY);
        hook.claim(currency1, CHARITY);
        vm.prank(DISTRIBUTOR);
        hook.pullDistributorShare(key, currency0);
        vm.prank(DISTRIBUTOR);
        hook.pullDistributorShare(key, currency1);

        _assertSolvent();

        // Everything that was taken has now left, except the roster's flooring remainder. A
        // weighted split of a pot that is not a multiple of `totalWeight` leaves under one wei per
        // unit of weight behind, which `settleBeneficiaries` deliberately parks in
        // `pendingBeneficiary` for the next settlement rather than crediting to anyone.
        //
        // That remainder is the strict form of the property this test is named for: the hook holds
        // EXACTLY what it still owes and not a wei more, so nothing was ever credited that the hook
        // had not first taken as a hook delta. `assertEq(backing, owed)` is the two-sided version -
        // `_assertSolvent` only checks `backing >= owed`.
        for (uint256 i = 0; i < 2; ++i) {
            Currency c = i == 0 ? currency0 : currency1;
            uint256 remainder = hook.pendingBeneficiary(poolId, c);
            assertLt(remainder, hook.totalWeight(poolId), "split remainder must be bounded by the roster weight");
            assertEq(hook.totalOwed(c), remainder, "nothing is owed beyond the un-splittable remainder");
            assertEq(hook.backing(c), remainder, "and the hook holds exactly that, no more and no less");
            assertEq(vault.balanceOf(address(hook), c), 0, "the claims were all redeemed on the way out");
        }

        // Nor is the remainder stranded: it joins the next pot instead of accumulating.
        _swap(key, SWAP_AMOUNT, true);
        hook.settleBeneficiaries(key, currency1);
        assertLt(
            hook.pendingBeneficiary(poolId, currency1),
            hook.totalWeight(poolId),
            "the remainder is carried into the next settlement, never accumulated"
        );
        _assertSolvent();
    }

    function test_drain_redeemIsIdempotentAndCannotOverDraw() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);

        uint256 claims = vault.balanceOf(address(hook), currency1);
        assertGt(claims, 0);

        hook.redeem(currency1);
        assertEq(vault.balanceOf(address(hook), currency1), 0);
        assertEq(IERC20(Currency.unwrap(currency1)).balanceOf(address(hook)), claims);

        // A second redeem finds nothing and must not manufacture a delta.
        assertEq(hook.redeem(currency1), 0);
        _assertSolvent();
    }

    /// @dev Fuzzes swap size and direction over a long run, asserting the two solvency statements
    /// after every step. This is the property that a settlement bug would break.
    function testFuzz_drain_solventUnderArbitrarySwapSequences(uint96[8] calldata amounts, uint8 directions) public {
        hook.proposeConfig(key, _params(hook.MAX_FEE_PIPS(), 3_400, 3_300, 3_300, DISTRIBUTOR));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        hook.applyPendingConfig(key);
        hook.setBeneficiaries(key, _roster(TREASURY, 7, CHARITY, 3));

        for (uint256 i = 0; i < 8; ++i) {
            uint256 amount = uint256(amounts[i]) % 5 ether;
            if (amount < 1000) continue; // below this the pool itself rejects the swap as dust
            _swap(key, -int256(amount), (directions >> i) & 1 == 1);
            _assertSolvent();
        }

        hook.settleBeneficiaries(key, currency0);
        hook.settleBeneficiaries(key, currency1);
        _assertSolvent();

        if (hook.claimable(TREASURY, currency0) > 0) {
            vm.prank(TREASURY);
            hook.claim(currency0, TREASURY);
        }
        if (hook.claimable(CHARITY, currency1) > 0) {
            vm.prank(CHARITY);
            hook.claim(currency1, CHARITY);
        }
        _assertSolvent();
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {ParametersHelper} from "infinity-core/src/libraries/math/ParametersHelper.sol";
import {Hooks} from "infinity-core/src/libraries/Hooks.sol";
import {CustomRevert} from "infinity-core/src/libraries/CustomRevert.sol";

import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {CLPositionManager} from "infinity-periphery/src/pool-cl/CLPositionManager.sol";
import {CLPositionDescriptorOffChain} from "infinity-periphery/src/pool-cl/CLPositionDescriptorOffChain.sol";
import {ICLPositionDescriptor} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionDescriptor.sol";
import {IWETH9} from "infinity-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {BaseCLHook} from "latch-hooks/src/base/BaseCLHook.sol";
import {LatchHookRegistry} from "latch-registry/src/LatchHookRegistry.sol";
import {HookMetadata, Verification, Listing} from "latch-registry/src/ILatchHookRegistry.sol";

import {LaunchpadKit} from "../src/LaunchpadKit.sol";
import {IHookRegistryListing} from "../src/interfaces/IHookRegistryListing.sol";
import {
    ILaunchpadKit,
    LaunchParams,
    LaunchResult,
    LaunchRecord,
    SeedParams,
    HookListingParams
} from "../src/interfaces/ILaunchpadKit.sol";
import {LaunchPresets, Preset, PresetParams} from "../src/libraries/LaunchPresets.sol";

/// @dev A token that taxes 1% of every `transferFrom`, with an exemption list - the shape almost
/// every real "tax token" ships with, because the pool and the router have to be exempt for the
/// token to trade at all.
contract TaxedToken is MockERC20 {
    mapping(address => bool) public exempt;

    constructor() MockERC20("Taxed", "TAX", 18) {}

    function setExempt(address who, bool value) external {
        exempt[who] = value;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (exempt[from] || exempt[to]) return super.transferFrom(from, to, amount);
        uint256 fee = amount / 100;
        super.transferFrom(from, address(this), fee);
        return super.transferFrom(from, to, amount - fee);
    }
}

/// @dev Same permissions as `LaunchGuardHook` minus `beforeSwap`, so the kit's constructor check
/// has something concrete to reject.
contract WrongBitmapHook is BaseCLHook {
    constructor(ICLPoolManager _pm) BaseCLHook(_pm) {}

    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE;
    }

    function _beforeInitialize(address, PoolKey calldata, uint160) internal pure override returns (bytes4) {
        return ICLHooks.beforeInitialize.selector;
    }
}

contract LaunchpadKitTest is Test, Deployers, DeployPermit2 {
    using CLPoolParametersHelper for bytes32;
    using ParametersHelper for bytes32;
    using LPFeeLibrary for uint24;

    Vault vault;
    CLPoolManager poolManager;
    CLPositionManager posm;
    IAllowanceTransfer permit2;
    LaunchGuardHook hook;
    LatchHookRegistry registry;
    LaunchpadKit kit;
    CLPoolManagerRouter router;
    WETH weth;

    MockERC20 launchToken;
    MockERC20 quoteToken;

    address constant LAUNCHER = address(0xA11CE);
    address constant OPERATOR = address(0xB0B);
    address constant REGISTRY_ADMIN = address(0xAD3111);

    /// @dev 12s blocks, expressed in hundredths of a second.
    uint32 constant BLOCK_TIME_CENTIS = 1200;

    int24 constant TICK_SPACING = 60;
    int24 constant TICK_LOWER = -60_000;
    int24 constant TICK_UPPER = 60_000;

    uint128 constant SEED_LAUNCH = 100 ether;
    uint128 constant SEED_QUOTE = 100 ether;

    function setUp() public {
        (vault, poolManager) = createFreshManager();
        router = new CLPoolManagerRouter(vault, poolManager);

        permit2 = IAllowanceTransfer(deployPermit2());
        weth = new WETH();
        ICLPositionDescriptor descriptor = new CLPositionDescriptorOffChain("https://latch.example/positions/");
        posm = new CLPositionManager(vault, poolManager, permit2, 100_000, descriptor, IWETH9(address(weth)));

        hook = new LaunchGuardHook(poolManager);

        address[] memory none = new address[](0);
        registry = new LatchHookRegistry(REGISTRY_ADMIN, none, none);

        kit = new LaunchpadKit(
            poolManager, hook, posm, permit2, IHookRegistryListing(address(registry)), BLOCK_TIME_CENTIS
        );

        // Deployed until the launch token sorts BELOW the quote token, so the default case in these
        // tests is `launchTokenIsCurrency0 == true` and the opposite order is set up explicitly.
        (launchToken, quoteToken) = _deploySortedPair(true);

        launchToken.mint(LAUNCHER, 1_000_000 ether);
        quoteToken.mint(LAUNCHER, 1_000_000 ether);
        vm.deal(LAUNCHER, 1_000_000 ether);

        vm.startPrank(LAUNCHER);
        launchToken.approve(address(kit), type(uint256).max);
        quoteToken.approve(address(kit), type(uint256).max);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Mines two mock tokens until their addresses sort the way the test wants.
    function _deploySortedPair(bool launchFirst) internal returns (MockERC20 launch, MockERC20 quote) {
        launch = new MockERC20("Launch", "LNCH", 18);
        quote = new MockERC20("Quote", "QUOT", 18);
        while ((address(launch) < address(quote)) != launchFirst) {
            quote = new MockERC20("Quote", "QUOT", 18);
        }
    }

    function _params() internal view returns (LaunchParams memory p) {
        p.launchToken = address(launchToken);
        p.quoteToken = address(quoteToken);
        p.tickSpacing = TICK_SPACING;
        p.sqrtPriceX96 = SQRT_RATIO_1_1;
        p.preset = Preset.FairLaunch;
        p.startDelaySeconds = 120; // 10 blocks at 12s
        p.launchOperator = OPERATOR;
        p.seed = SeedParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            launchTokenAmount: SEED_LAUNCH,
            quoteTokenAmount: SEED_QUOTE,
            positionRecipient: address(0),
            deadline: 0
        });
    }

    function _noSeed(LaunchParams memory p) internal pure returns (LaunchParams memory) {
        p.seed = SeedParams({
            tickLower: 0,
            tickUpper: 0,
            launchTokenAmount: 0,
            quoteTokenAmount: 0,
            positionRecipient: address(0),
            deadline: 0
        });
        return p;
    }

    function _create(LaunchParams memory p) internal returns (LaunchResult memory) {
        vm.prank(LAUNCHER);
        return kit.createLaunch(p);
    }

    function _createWithValue(LaunchParams memory p, uint256 value) internal returns (LaunchResult memory) {
        vm.prank(LAUNCHER);
        return kit.createLaunch{value: value}(p);
    }

    function _metadata() internal pure returns (HookMetadata memory m) {
        m.name = "LaunchGuardHook";
        m.description = "Decaying sniper tax for token launches.";
        m.sourceURI = "https://example.invalid/latch/hooks";
        m.auditURI = "";
        m.chainIds = new uint256[](0);
    }

    /// @dev Core wraps a reverting hook in ERC-7751 `WrappedError`; rebuild the envelope.
    function _expectHookRevert(bytes4 hookFn, bytes memory inner) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookFn,
                inner,
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified) internal returns (BalanceDelta) {
        return router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ZERO_BYTES
        );
    }

    /// @dev The fee the POOL actually charged, read out of core's own `Swap` event. This is the
    /// ground truth: it proves the override reached `CLPool.swap` rather than merely proving the
    /// hook computed a number and had it thrown away.
    function _swapAndReadAppliedFee(PoolKey memory key, bool zeroForOne, int256 amountSpecified)
        internal
        returns (uint24 appliedFee)
    {
        vm.recordLogs();
        _swap(key, zeroForOne, amountSpecified);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(poolManager) && logs[i].topics[0] == ICLPoolManager.Swap.selector) {
                (,,,,, uint24 fee,) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24, uint16));
                return fee;
            }
        }
        revert("no Swap event");
    }

    function _fundSwapper() internal {
        launchToken.mint(address(this), 10_000 ether);
        quoteToken.mint(address(this), 10_000 ether);
        IERC20(address(launchToken)).approve(address(router), type(uint256).max);
        IERC20(address(quoteToken)).approve(address(router), type(uint256).max);
    }

    /*//////////////////////////////////////////////////////////////
        THE POINT OF THE WHOLE PACKAGE: A POOL THAT CANNOT BE
        MISCONFIGURED IN THE FOUR WAYS THAT FAIL SILENTLY.
    //////////////////////////////////////////////////////////////*/

    function test_createLaunch_alwaysUsesTheDynamicFeeMarker() public {
        LaunchResult memory r = _create(_params());
        // Exactly 0x800000, not "has the flag set". `isDynamicLPFee` is an equality test, and a
        // near-miss produces a static-fee pool on which the launch tax is silently discarded.
        assertEq(r.key.fee, uint24(0x800000), "fee must be the dynamic marker");
        assertTrue(r.key.fee.isDynamicLPFee(), "core must agree it is dynamic");
    }

    /// @dev The negative control for the test above. Same hook, same pair, static fee: core's
    /// `beforeInitialize` refuses it. Without the hook's own guard this pool would initialize
    /// happily and the tax would evaporate, which is the bug the kit exists to make unreachable.
    function test_staticFeePoolWithTheSameHookIsRejected() public {
        (,, bool launchIsC0) = kit.computePoolKey(address(launchToken), address(quoteToken), TICK_SPACING);
        (address c0, address c1) = launchIsC0
            ? (address(launchToken), address(quoteToken))
            : (address(quoteToken), address(launchToken));

        PoolKey memory staticKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            hooks: IHooks(address(hook)),
            poolManager: poolManager,
            fee: 3000, // a perfectly ordinary static fee
            parameters: bytes32(uint256(hook.getHooksRegistrationBitmap())).setTickSpacing(TICK_SPACING)
        });

        vm.expectRevert(abi.encodeWithSelector(LaunchGuardHook.PoolMustUseDynamicFee.selector, uint24(3000)));
        hook.configureLaunch(staticKey, _config(uint48(block.number + 1)));
    }

    function _config(uint48 startBlock) internal pure returns (LaunchGuardHook.LaunchConfig memory) {
        return LaunchGuardHook.LaunchConfig({
            startBlock: startBlock,
            decayBlocks: 25,
            initialFeeBips: 100_000,
            finalFeeBips: 3_000,
            maxBuyPerTx: 0,
            launchTokenIsCurrency0: true,
            enabled: true
        });
    }

    function test_createLaunch_parametersCarryTheHooksOwnBitmap() public {
        LaunchResult memory r = _create(_params());
        assertEq(r.key.parameters.getHooksRegistrationBitmap(), hook.getHooksRegistrationBitmap());
        assertEq(r.key.parameters.getHooksRegistrationBitmap(), uint16(0x0041), "beforeInitialize | beforeSwap");
        assertEq(r.key.parameters.getTickSpacing(), TICK_SPACING);
        // No CREATE2 mining anywhere: the hook lives at an ordinary address and the permissions
        // travel in the key.
        assertEq(address(r.key.hooks), address(hook));
    }

    function test_createLaunch_initializesThePool() public {
        LaunchResult memory r = _create(_params());
        (uint160 sqrtPriceX96,,, uint24 lpFee) = poolManager.getSlot0(r.poolId);
        assertEq(sqrtPriceX96, SQRT_RATIO_1_1);
        // A dynamic-fee pool stores 0 and relies on the hook to supply a fee on every swap.
        assertEq(lpFee, 0);
    }

    function test_createLaunch_derivesLaunchTokenIsCurrency0() public {
        LaunchResult memory r = _create(_params());
        assertTrue(r.launchTokenIsCurrency0);
        assertEq(Currency.unwrap(r.key.currency0), address(launchToken));

        // And the other way round, with a pair deployed in the opposite order.
        (MockERC20 l2, MockERC20 q2) = _deploySortedPair(false);
        l2.mint(LAUNCHER, 1_000 ether);
        q2.mint(LAUNCHER, 1_000 ether);
        vm.startPrank(LAUNCHER);
        l2.approve(address(kit), type(uint256).max);
        q2.approve(address(kit), type(uint256).max);
        vm.stopPrank();

        LaunchParams memory p = _params();
        p.launchToken = address(l2);
        p.quoteToken = address(q2);
        LaunchResult memory r2 = _create(p);
        assertFalse(r2.launchTokenIsCurrency0);
        assertEq(Currency.unwrap(r2.key.currency1), address(l2));
    }

    /// @dev The kit is the hook's registered launch owner. That is what makes reconfiguration
    /// possible at all, and it is why the kit has to expose a delegated route to it.
    function test_createLaunch_kitBecomesTheHooksLaunchOwner() public {
        LaunchResult memory r = _create(_params());
        assertEq(hook.launchOwner(r.poolId), address(kit));
        assertEq(kit.getLaunchRecord(r.poolId).operator, OPERATOR);
    }

    function test_computePoolKey_matchesWhatCreateLaunchBuilds() public {
        (PoolKey memory expectedKey, PoolId expectedId, bool expectedSort) =
            kit.computePoolKey(address(launchToken), address(quoteToken), TICK_SPACING);
        LaunchResult memory r = _create(_params());
        assertEq(PoolId.unwrap(r.poolId), PoolId.unwrap(expectedId));
        assertEq(r.key.fee, expectedKey.fee);
        assertEq(r.key.parameters, expectedKey.parameters);
        assertEq(r.launchTokenIsCurrency0, expectedSort);
    }

    /*//////////////////////////////////////////////////////////////
                            END-TO-END BEHAVIOUR
    //////////////////////////////////////////////////////////////*/

    function test_tradingIsClosedUntilTheStartBlock() public {
        LaunchResult memory r = _create(_params());
        _fundSwapper();

        _expectHookRevert(
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(
                LaunchGuardHook.TradingNotOpen.selector, r.poolId, uint256(r.startBlock), block.number
            )
        );
        _swap(r.key, false, -1 ether);
    }

    /// @dev The single most important assertion in this file: the tax the kit configured is the
    /// tax core actually charges. Everything else is plumbing around this fact.
    function test_theConfiguredTaxIsTheFeeCoreCharges() public {
        LaunchResult memory r = _create(_params());
        _fundSwapper();

        vm.roll(r.startBlock);
        assertEq(_swapAndReadAppliedFee(r.key, false, -1 ether), 100_000, "opening block pays the full 10%");

        // Half way through the window the fee is half way down the schedule.
        vm.roll(uint256(r.startBlock) + r.decayBlocks / 2);
        uint24 mid = _swapAndReadAppliedFee(r.key, false, -1 ether);
        assertLt(mid, 100_000);
        assertGt(mid, 3_000);

        vm.roll(uint256(r.startBlock) + r.decayBlocks);
        assertEq(_swapAndReadAppliedFee(r.key, false, -1 ether), 3_000, "window closed, normal fee");
    }

    function test_maxBuyPerTx_capsBuysAndLeavesSellsAlone() public {
        LaunchParams memory p = _params();
        p.preset = Preset.AntiSniperAggressive;
        p.maxBuyPerTx = 1 ether;
        LaunchResult memory r = _create(p);
        _fundSwapper();
        vm.roll(r.startBlock);

        // launchToken is currency0, so buying it means selling currency1: oneForZero.
        _expectHookRevert(
            ICLHooks.beforeSwap.selector,
            abi.encodeWithSelector(LaunchGuardHook.BuyExceedsMaxPerTx.selector, uint256(2 ether), uint128(1 ether))
        );
        _swap(r.key, false, -2 ether);

        // The same size in the other direction is a sell and is not capped.
        _swap(r.key, true, -2 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                SEEDING
    //////////////////////////////////////////////////////////////*/

    function test_seed_mintsAPositionNftToTheLauncher() public {
        uint256 balBefore0 = launchToken.balanceOf(LAUNCHER);
        uint256 balBefore1 = quoteToken.balanceOf(LAUNCHER);

        LaunchResult memory r = _create(_params());

        assertGt(r.positionTokenId, 0);
        assertGt(r.liquiditySeeded, 0);
        assertEq(posm.ownerOf(r.positionTokenId), LAUNCHER);
        assertEq(posm.getPositionLiquidity(r.positionTokenId), r.liquiditySeeded);

        // The launcher paid something, and no more than they offered.
        uint256 spent0 = balBefore0 - launchToken.balanceOf(LAUNCHER);
        uint256 spent1 = balBefore1 - quoteToken.balanceOf(LAUNCHER);
        assertGt(spent0, 0);
        assertGt(spent1, 0);
        assertLe(spent0, SEED_LAUNCH);
        assertLe(spent1, SEED_QUOTE);

        // The kit keeps nothing.
        assertEq(launchToken.balanceOf(address(kit)), 0);
        assertEq(quoteToken.balanceOf(address(kit)), 0);
        assertEq(address(kit).balance, 0);
    }

    function test_seed_sendsThePositionToAnExplicitRecipient() public {
        LaunchParams memory p = _params();
        p.seed.positionRecipient = OPERATOR;
        LaunchResult memory r = _create(p);
        assertEq(posm.ownerOf(r.positionTokenId), OPERATOR);
    }

    function test_seed_isSkippedWhenBothAmountsAreZero() public {
        LaunchResult memory r = _create(_noSeed(_params()));
        assertEq(r.positionTokenId, 0);
        assertEq(r.liquiditySeeded, 0);
        // The pool still exists and is still guarded.
        assertEq(hook.launchOwner(r.poolId), address(kit));
    }

    function test_seed_withNativeQuoteRefundsTheUnusedValue() public {
        (MockERC20 lt,) = _deploySortedPair(true);
        lt.mint(LAUNCHER, 1_000 ether);
        vm.prank(LAUNCHER);
        lt.approve(address(kit), type(uint256).max);

        LaunchParams memory p = _params();
        p.launchToken = address(lt);
        p.quoteToken = address(0); // native
        // Native sorts to currency0, so the range has to straddle a price where both sides are used.
        p.seed.launchTokenAmount = 100 ether;
        p.seed.quoteTokenAmount = 100 ether;

        uint256 ethBefore = LAUNCHER.balance;
        LaunchResult memory r = _createWithValue(p, 100 ether);

        assertEq(Currency.unwrap(r.key.currency0), address(0), "native is always currency0");
        assertFalse(r.launchTokenIsCurrency0);
        assertGt(r.liquiditySeeded, 0);

        uint256 spent = ethBefore - LAUNCHER.balance;
        assertGt(spent, 0);
        assertLe(spent, 100 ether);
        // Nothing stranded on the kit or on the position manager.
        assertEq(address(kit).balance, 0);
        assertEq(address(posm).balance, 0);
    }

    function test_seed_nativeValueMustMatchTheDeclaredAmount() public {
        LaunchParams memory p = _params();
        p.quoteToken = address(0);

        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.NativeValueMismatch.selector, SEED_QUOTE, uint256(1 wei)));
        vm.prank(LAUNCHER);
        kit.createLaunch{value: 1 wei}(p);
    }

    function test_seed_rejectsNativeValueOnAnErc20OnlyLaunch() public {
        LaunchParams memory p = _noSeed(_params());
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.UnexpectedNativeValue.selector, uint256(1 wei)));
        vm.prank(LAUNCHER);
        kit.createLaunch{value: 1 wei}(p);
    }

    /// @dev A taxed launch token delivers less than the kit asked for on the way in. Measuring
    /// the arrival, rather than trusting the request, is what keeps the settle solvent: the mint
    /// is sized from what actually turned up.
    ///
    /// The kit is exempt here, which is how a real tax token is configured - the pool, the router
    /// and the liquidity path have to be exempt or the token cannot be traded at all.
    function test_seed_handlesATaxedLaunchTokenWhenTheKitIsExempt() public {
        TaxedToken taxed = new TaxedToken();
        MockERC20 quote = new MockERC20("Quote", "QUOT", 18);
        taxed.mint(LAUNCHER, 1_000 ether);
        quote.mint(LAUNCHER, 1_000 ether);
        vm.startPrank(LAUNCHER);
        taxed.approve(address(kit), type(uint256).max);
        quote.approve(address(kit), type(uint256).max);
        vm.stopPrank();

        // Taxed on the way IN (launcher -> kit), untaxed on the way OUT (kit -> vault).
        taxed.setExempt(address(kit), true);

        LaunchParams memory p = _params();
        p.launchToken = address(taxed);
        p.quoteToken = address(quote);

        LaunchResult memory r = _create(p);
        assertGt(r.liquiditySeeded, 0);
        assertEq(taxed.balanceOf(address(kit)), 0, "kit keeps no dust");
        assertEq(quote.balanceOf(address(kit)), 0);
    }

    /// @dev The honest limit. A token that taxes EVERY transfer, including the one from the payer
    /// into the Vault, cannot be settled at all: `Vault._settle` credits `balanceOfSelf() -
    /// reservesBefore`, so a token that shaves the transfer always credits less than the debt and
    /// core rejects the lock with `CurrencyNotSettled`.
    ///
    /// This is a property of the singleton's settlement accounting, not of this kit, and no amount
    /// of measuring on the way in can fix it - the shortfall happens on the way out. Such a token
    /// cannot provide liquidity to a Latch pool by any route, so it cannot be seeded by one either.
    /// The test pins the failure so nobody "fixes" it with a silent partial seed.
    function test_seed_cannotSupportAnUnconditionallyTaxedToken() public {
        TaxedToken taxed = new TaxedToken();
        MockERC20 quote = new MockERC20("Quote", "QUOT", 18);
        taxed.mint(LAUNCHER, 1_000 ether);
        quote.mint(LAUNCHER, 1_000 ether);
        vm.startPrank(LAUNCHER);
        taxed.approve(address(kit), type(uint256).max);
        quote.approve(address(kit), type(uint256).max);
        vm.stopPrank();

        LaunchParams memory p = _params();
        p.launchToken = address(taxed);
        p.quoteToken = address(quote);

        vm.expectRevert(); // IVault.CurrencyNotSettled, raised inside the lock
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    function test_seed_rejectsAnInvertedTickRange() public {
        LaunchParams memory p = _params();
        p.seed.tickLower = TICK_UPPER;
        p.seed.tickUpper = TICK_LOWER;
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.InvalidTickRange.selector, TICK_UPPER, TICK_LOWER));
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    /// @dev A previous caller's stray balance must not be spendable by the next launcher. Balances
    /// are accounted as deltas against entry, so a donation to the kit is simply ignored.
    function test_seed_ignoresAStrayBalanceSittingOnTheKit() public {
        launchToken.mint(address(kit), 500 ether);
        quoteToken.mint(address(kit), 500 ether);

        uint256 before0 = launchToken.balanceOf(LAUNCHER);
        LaunchResult memory r = _create(_params());
        assertGt(r.liquiditySeeded, 0);

        // The launcher's spend is bounded by what they offered, not by what was lying around.
        assertLe(before0 - launchToken.balanceOf(LAUNCHER), SEED_LAUNCH);
        // And the stray balance is still there, untouched and unrefunded.
        assertEq(launchToken.balanceOf(address(kit)), 500 ether);
        assertEq(quoteToken.balanceOf(address(kit)), 500 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                PRESETS
    //////////////////////////////////////////////////////////////*/

    function test_preset_fairLaunchResolvesAsDocumented() public view {
        LaunchGuardHook.LaunchConfig memory cfg = kit.previewSchedule(_params());
        assertEq(cfg.initialFeeBips, 100_000);
        assertEq(cfg.finalFeeBips, 3_000);
        assertEq(cfg.decayBlocks, 25); // 300s at 12s blocks
        assertEq(cfg.startBlock, uint48(block.number + 10)); // 120s at 12s blocks
        assertTrue(cfg.enabled);
    }

    function test_preset_antiSniperRefusesToRunWithoutAPerTxCap() public {
        LaunchParams memory p = _params();
        p.preset = Preset.AntiSniperAggressive;
        p.maxBuyPerTx = 0;
        vm.expectRevert(
            abi.encodeWithSelector(ILaunchpadKit.MaxBuyRequiredByPreset.selector, Preset.AntiSniperAggressive)
        );
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    function test_preset_noTaxPinsTheFeeAndOpensImmediately() public {
        LaunchParams memory p = _params();
        p.preset = Preset.NoTax;
        p.startDelaySeconds = 0;
        LaunchResult memory r = _create(p);
        _fundSwapper();

        assertEq(r.startBlock, uint48(block.number));
        // Disabled means no gate and a pinned fee - NOT a zero fee. A dynamic-fee pool with no
        // override would be free to trade through.
        assertEq(_swapAndReadAppliedFee(r.key, false, -1 ether), 3_000);
    }

    function test_preset_customUsesTheCallersOwnNumbers() public view {
        LaunchParams memory p = _params();
        p.preset = Preset.Custom;
        p.initialFeeBips = 250_000;
        p.finalFeeBips = 500;
        p.decayBlocks = 7;
        p.enabled = true;

        LaunchGuardHook.LaunchConfig memory cfg = kit.previewSchedule(p);
        assertEq(cfg.initialFeeBips, 250_000);
        assertEq(cfg.finalFeeBips, 500);
        assertEq(cfg.decayBlocks, 7);
    }

    /// @dev Every preset must land inside the hook's own caps, or the preset is a footgun that
    /// only fails at launch time.
    function test_everyPresetIsAcceptedByTheHook() public view {
        Preset[4] memory presets =
            [Preset.FairLaunch, Preset.AntiSniperAggressive, Preset.Stealth, Preset.NoTax];
        for (uint256 i = 0; i < presets.length; i++) {
            PresetParams memory pp = LaunchPresets.params(presets[i]);
            assertLe(pp.initialFeeBips, hook.MAX_INITIAL_FEE(), "initial fee above hook cap");
            assertLe(pp.finalFeeBips, hook.MAX_FINAL_FEE(), "final fee above hook cap");
            assertGe(pp.initialFeeBips, pp.finalFeeBips, "schedule must decay");
            assertGt(pp.windowSeconds, 0);
        }
    }

    function test_presets_customHasNoParameters() public {
        vm.expectRevert(LaunchPresets.NoParametersForCustomPreset.selector);
        LaunchPresets.params(Preset.Custom);
    }

    /*//////////////////////////////////////////////////////////////
                            RECONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_reconfigure_onlyTheOperator() public {
        LaunchResult memory r = _create(_params());
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.NotLaunchOperator.selector, r.poolId, LAUNCHER));
        vm.prank(LAUNCHER);
        kit.reconfigureLaunch(r.key, _config(uint48(block.number + 20)));
    }

    function test_reconfigure_updatesTheSchedule() public {
        LaunchResult memory r = _create(_params());
        LaunchGuardHook.LaunchConfig memory cfg = _config(uint48(block.number + 50));
        cfg.initialFeeBips = 200_000;

        vm.prank(OPERATOR);
        kit.reconfigureLaunch(r.key, cfg);

        LaunchGuardHook.Launch memory l = hook.getLaunch(r.poolId);
        assertEq(l.startBlock, uint48(block.number + 50));
        assertEq(l.initialFeeBips, 200_000);
    }

    /// @dev The one rule the kit adds on top of the hook: the sort order is pinned, so an operator
    /// cannot flip `maxBuyPerTx` from capping buys to capping sells.
    function test_reconfigure_pinsLaunchTokenIsCurrency0() public {
        LaunchResult memory r = _create(_params());
        assertTrue(r.launchTokenIsCurrency0);

        LaunchGuardHook.LaunchConfig memory cfg = _config(uint48(block.number + 50));
        cfg.launchTokenIsCurrency0 = false; // a lie
        vm.prank(OPERATOR);
        kit.reconfigureLaunch(r.key, cfg);

        assertTrue(hook.getLaunch(r.poolId).launchTokenIsCurrency0, "kit must ignore the caller's value");
    }

    function test_reconfigure_isFrozenOnceTradingOpens() public {
        LaunchResult memory r = _create(_params());
        vm.roll(r.startBlock);
        vm.expectRevert(
            abi.encodeWithSelector(LaunchGuardHook.LaunchAlreadyStarted.selector, r.poolId, uint256(r.startBlock))
        );
        vm.prank(OPERATOR);
        kit.reconfigureLaunch(r.key, _config(uint48(block.number + 50)));
    }

    function test_reconfigure_rejectsAnUnknownPool() public {
        LaunchResult memory r = _create(_params());
        PoolKey memory foreign = r.key;
        foreign.parameters = bytes32(uint256(hook.getHooksRegistrationBitmap())).setTickSpacing(10);
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.UnknownLaunch.selector, foreign.toId()));
        vm.prank(OPERATOR);
        kit.reconfigureLaunch(foreign, _config(uint48(block.number + 50)));
    }

    /*//////////////////////////////////////////////////////////////
                            REGISTRY LISTING
    //////////////////////////////////////////////////////////////*/

    function test_listing_registersTheHookAndHandsOverStewardship() public {
        LaunchParams memory p = _params();
        p.listing = HookListingParams({register: true, steward: OPERATOR, metadata: _metadata()});
        _create(p);

        assertTrue(registry.isRegistered(address(hook)));
        assertEq(registry.getHook(address(hook)).steward, OPERATOR, "kit must not keep the steward right");
        assertEq(registry.getHook(address(hook)).submitter, address(kit));
        // Permissions are read off the hook, never supplied.
        assertEq(registry.getHook(address(hook)).permissions, hook.getHooksRegistrationBitmap());
        // And nothing is vouched for by being listed.
        assertTrue(registry.getHook(address(hook)).verification == Verification.Unverified);
        assertTrue(registry.getHook(address(hook)).listing == Listing.Active);
    }

    function test_listing_isANoOpForASecondLaunchOnTheSameHook() public {
        LaunchParams memory p = _params();
        p.listing = HookListingParams({register: true, steward: OPERATOR, metadata: _metadata()});
        _create(p);

        // A second launch asking to list again must not revert, or every launch after the first
        // would be impossible.
        LaunchParams memory p2 = _params();
        p2.tickSpacing = 10;
        p2.listing = HookListingParams({register: true, steward: OPERATOR, metadata: _metadata()});
        _create(p2);

        assertEq(registry.getHook(address(hook)).steward, OPERATOR);
    }

    function test_listHook_standalone() public {
        vm.prank(LAUNCHER);
        assertTrue(kit.listHook(_metadata(), OPERATOR));
        assertEq(registry.getHook(address(hook)).steward, OPERATOR);

        vm.prank(LAUNCHER);
        assertFalse(kit.listHook(_metadata(), OPERATOR), "second call is a no-op");
    }

    function test_listing_revertsWhenNoRegistryIsConfigured() public {
        LaunchpadKit bare = new LaunchpadKit(
            poolManager, hook, posm, permit2, IHookRegistryListing(address(0)), BLOCK_TIME_CENTIS
        );
        vm.expectRevert(ILaunchpadKit.RegistryNotConfigured.selector);
        bare.listHook(_metadata(), OPERATOR);
    }

    /*//////////////////////////////////////////////////////////////
                             INPUT VALIDATION
    //////////////////////////////////////////////////////////////*/

    function test_rejectsANativeLaunchToken() public {
        LaunchParams memory p = _noSeed(_params());
        p.launchToken = address(0);
        vm.expectRevert(ILaunchpadKit.LaunchTokenCannotBeNative.selector);
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    function test_rejectsIdenticalCurrencies() public {
        LaunchParams memory p = _noSeed(_params());
        p.quoteToken = p.launchToken;
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.IdenticalCurrencies.selector, p.launchToken));
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    function test_rejectsALaunchTokenWithNoCode() public {
        LaunchParams memory p = _noSeed(_params());
        p.launchToken = address(0xDEAD);
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.LaunchTokenHasNoCode.selector, address(0xDEAD)));
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    function test_rejectsADuplicateLaunch() public {
        LaunchResult memory r = _create(_noSeed(_params()));
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.LaunchAlreadyExists.selector, r.poolId));
        vm.prank(LAUNCHER);
        kit.createLaunch(_noSeed(_params()));
    }

    function test_rejectsAStartDelayBeyondTheHooksCap() public {
        LaunchParams memory p = _noSeed(_params());
        p.startDelaySeconds = type(uint32).max;
        vm.expectRevert();
        vm.prank(LAUNCHER);
        kit.createLaunch(p);
    }

    /*//////////////////////////////////////////////////////////////
                              DEPLOY-TIME CHECKS
    //////////////////////////////////////////////////////////////*/

    function test_constructor_rejectsAHookWithTheWrongBitmap() public {
        WrongBitmapHook wrong = new WrongBitmapHook(poolManager);
        vm.expectRevert(
            abi.encodeWithSelector(ILaunchpadKit.UnexpectedHookBitmap.selector, uint16(0x0041), uint16(0x0001))
        );
        new LaunchpadKit(
            poolManager,
            LaunchGuardHook(address(wrong)),
            posm,
            permit2,
            IHookRegistryListing(address(registry)),
            BLOCK_TIME_CENTIS
        );
    }

    function test_constructor_rejectsAHookServingADifferentPoolManager() public {
        (, CLPoolManager otherManager) = createFreshManager();
        LaunchGuardHook otherHook = new LaunchGuardHook(otherManager);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILaunchpadKit.HookPoolManagerMismatch.selector, address(poolManager), address(otherManager)
            )
        );
        new LaunchpadKit(
            poolManager, otherHook, posm, permit2, IHookRegistryListing(address(registry)), BLOCK_TIME_CENTIS
        );
    }

    function test_constructor_rejectsANonsenseBlockTime() public {
        vm.expectRevert(abi.encodeWithSelector(ILaunchpadKit.InvalidBlockTime.selector, uint32(1)));
        new LaunchpadKit(poolManager, hook, posm, permit2, IHookRegistryListing(address(registry)), 1);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(ILaunchpadKit.ZeroAddress.selector);
        new LaunchpadKit(
            poolManager,
            LaunchGuardHook(address(0)),
            posm,
            permit2,
            IHookRegistryListing(address(registry)),
            BLOCK_TIME_CENTIS
        );
    }

    /*//////////////////////////////////////////////////////////////
                                  FUZZ
    //////////////////////////////////////////////////////////////*/

    function testFuzz_startDelayAlwaysLandsInTheFuture(uint32 delaySeconds) public view {
        delaySeconds = uint32(bound(delaySeconds, 0, 12_000_000)); // 1e6 blocks at 12s
        LaunchParams memory p = _noSeed(_params());
        p.startDelaySeconds = delaySeconds;

        LaunchGuardHook.LaunchConfig memory cfg = kit.previewSchedule(p);
        assertGe(cfg.startBlock, block.number, "a start in the past is rejected by the hook");
        assertLe(uint256(cfg.startBlock) - block.number, hook.MAX_START_DELAY());
    }

    function testFuzz_secondsToBlocksNeverReturnsZero(uint32 secondsValue, uint32 blockTimeCentis) public pure {
        blockTimeCentis = uint32(bound(blockTimeCentis, 50, 60_000));
        uint256 blocks = LaunchPresets.secondsToBlocks(secondsValue, blockTimeCentis);
        assertGt(blocks, 0);
        // Rounds up: never fewer blocks than the duration actually spans.
        assertGe(blocks * blockTimeCentis, uint256(secondsValue) * 100);
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {BalanceDelta} from "infinity-core/src/types/BalanceDelta.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {TokenFixture} from "infinity-core/test/helpers/TokenFixture.sol";
import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";

import {RevShareHook} from "../src/RevShareHook.sol";

/**
 * ############ HAZARDS IN A CONTRACT THAT IS ALREADY DEPLOYED AND IMMUTABLE ############
 *
 * `RevShareHook` is live at `0x23CE34E8199927DD270dddd8579c947542bDE446` on Robinhood
 * Chain (4663). Nothing in this file is a bug report against code that can be changed;
 * every test below asserts the CURRENT behaviour, on purpose, because the only remedy
 * available is operational.
 *
 * They exist because an operational rule that nobody can execute is a rule that rots. Each
 * one pins a claim made in CLAUDE.md's "Deployed and unfixable" section, so that section
 * can be checked rather than believed - and so that a future, redeployable version of this
 * hook has a ready-made list of what to fix. If one of these tests starts FAILING against a
 * new implementation, that is the fix landing, and the corresponding runbook rule can go.
 *
 * Naming: `test_HAZARD_*`, so they are greppable and so nobody mistakes a green run here
 * for a security property.
 */
contract DeployedHazardsTest is Test, Deployers, TokenFixture {
    Vault vault;
    CLPoolManager poolManager;
    RevShareHook hook;
    CLPoolManagerRouter router;

    PoolKey key;
    PoolKey controlKey;
    PoolId poolId;

    address constant GOVERNANCE = address(0x600E);
    address constant GUARDIAN = address(0x6A47);
    address constant TREASURY = address(0x7EEA);
    address constant ALICE = address(0xA11CE);

    uint24 constant LP_FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE_PIPS = 10_000; // 1%
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

        // The whole cut to route 2, and NO roster. This is the configuration B3 is about, and
        // `_validateParams` accepts it without a murmur.
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

    function _roster(address a, uint96 w) internal pure returns (RevShareHook.Beneficiary[] memory r) {
        r = new RevShareHook.Beneficiary[](1);
        r[0] = RevShareHook.Beneficiary({recipient: a, weight: w});
    }

    /*//////////////////////////////////////////////////////////////
       B1 - renounceOwnership() IS LIVE ON THE DEPLOYED HOOK
    //////////////////////////////////////////////////////////////*/

    /// @dev Stock OZ `Ownable.renounceOwnership` is reachable: no override exists anywhere in
    /// `packages/*/src`. What it costs is asymmetric - the guardian may only PAUSE, and only the
    /// owner may unpause or move the guardian, so renouncing while paused freezes the hook off
    /// permanently. It cannot reach user funds: `claim`, `redeem`, `settleBeneficiaries` and
    /// `pullDistributorShare` are all permissionless and all keep working.
    ///
    /// GOVERNANCE MUST NEVER QUEUE THIS CALL. There is no on-chain guard; the guard is the runbook.
    function test_HAZARD_B1_renounceOwnershipIsLiveAndLocksThePauseState() public {
        vm.prank(GUARDIAN);
        hook.setPaused(true);

        vm.prank(GOVERNANCE);
        hook.renounceOwnership();
        assertEq(hook.owner(), address(0), "no override: the owner really is gone");

        // Nobody can turn it back on. The guardian was never allowed to, and now nobody is.
        vm.prank(GUARDIAN);
        vm.expectRevert(RevShareHook.NotGuardianOrOwner.selector);
        hook.setPaused(false);
        // `setPaused` is not `onlyOwner`; it compares against `owner()` by hand, and that is now
        // `address(0)` - an address no transaction can be sent from. Same outcome, different
        // error, and worth pinning because a runbook that greps for `OwnableUnauthorizedAccount`
        // would miss this one entirely.
        vm.prank(GOVERNANCE);
        vm.expectRevert(RevShareHook.NotGuardianOrOwner.selector);
        hook.setPaused(false);
        vm.prank(GOVERNANCE);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, GOVERNANCE));
        hook.setGuardian(ALICE);

        assertTrue(hook.paused(), "paused forever");

        // No cut is ever taken again, on any pool.
        _swap(key, SWAP_AMOUNT, true);
        assertEq(hook.pendingBeneficiary(poolId, currency1), 0, "a paused hook takes nothing");
    }

    /// @dev The bound on that damage, asserted so it is not overstated: accrued value stays
    /// reachable. Renouncing is a permanent loss of the global switch, not a loss of funds.
    function test_HAZARD_B1_renouncingDoesNotStrandAlreadyAccruedValue() public {
        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        _swap(key, SWAP_AMOUNT, true);

        vm.prank(GOVERNANCE);
        hook.renounceOwnership();

        // Permissionless, and unaffected by the missing owner.
        hook.settleBeneficiaries(key, currency1);
        uint256 owed = hook.claimable(TREASURY, currency1);
        assertGt(owed, 0);
        vm.prank(TREASURY);
        assertEq(hook.claim(currency1, TREASURY), owed);
    }

    /*//////////////////////////////////////////////////////////////
       B3 - A NON-ZERO beneficiaryBps WITH AN EMPTY ROSTER, THEN FREEZE
    //////////////////////////////////////////////////////////////*/

    /// @dev `_validateParams` enforces the distributor invariant (`distributorBps != 0` needs a
    /// distributor address) and NOT its beneficiary twin, and `setBeneficiaries` accepts a
    /// zero-length roster despite `InvalidBeneficiaries` being documented as "Roster is empty, too
    /// long, or contains an invalid entry". With `_totalWeight == 0`, `settleBeneficiaries` returns
    /// early rather than reverting, so the pot accrues silently. `freezeConfig` then removes the
    /// only repair, because `setBeneficiaries` goes through `_requireOwner`, which reverts on a
    /// frozen pool.
    ///
    /// THE OPERATIONAL RULE: set the roster BEFORE the first swap, and never freeze a pool whose
    /// `beneficiaryBps` is non-zero until `getBeneficiaries` is non-empty and
    /// `pendingBeneficiary` for BOTH currencies has been settled to dust.
    function test_HAZARD_B3_emptyRosterPlusFreezeStrandsTheBeneficiaryPotForever() public {
        assertEq(hook.getConfig(poolId).beneficiaryBps, 10_000);
        assertEq(hook.totalWeight(poolId), 0, "no roster, and nothing objected");

        _swap(key, SWAP_AMOUNT, true);
        uint256 stranded = hook.pendingBeneficiary(poolId, currency1);
        assertGt(stranded, 0);

        // Silent no-op, not a revert. Nothing in a keeper log would look wrong.
        hook.settleBeneficiaries(key, currency1);
        assertEq(hook.pendingBeneficiary(poolId, currency1), stranded, "the pot did not move");
        assertEq(hook.claimable(TREASURY, currency1), 0);

        // An empty roster is accepted outright, which is the write that would otherwise have
        // been the last chance to notice.
        hook.setBeneficiaries(key, new RevShareHook.Beneficiary[](0));
        assertEq(hook.totalWeight(poolId), 0);

        // One immediate, irreversible call and the repair is gone.
        hook.freezeConfig(key);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.setBeneficiaries(key, _roster(TREASURY, 1));

        // The value is neither payable nor recoverable, and it keeps growing.
        hook.settleBeneficiaries(key, currency1);
        _swap(key, SWAP_AMOUNT, true);
        assertGt(hook.pendingBeneficiary(poolId, currency1), stranded, "and it accumulates");
        assertGe(hook.totalOwed(currency1), hook.pendingBeneficiary(poolId, currency1));
    }

    /// @dev Not overstated: WITHOUT the freeze the pot is fine. `settleBeneficiaries` leaves it in
    /// place rather than losing it, so a roster set late still collects everything that accrued.
    /// The freeze is the irreversible half, which is why the rule is about ordering.
    function test_HAZARD_B3_aLateRosterStillCollectsEverythingIfNobodyFroze() public {
        _swap(key, SWAP_AMOUNT, true);
        uint256 accrued = hook.pendingBeneficiary(poolId, currency1);
        assertGt(accrued, 0);

        hook.setBeneficiaries(key, _roster(TREASURY, 1));
        hook.settleBeneficiaries(key, currency1);
        assertEq(hook.claimable(TREASURY, currency1), accrued, "nothing was lost by being late");
    }

    /*//////////////////////////////////////////////////////////////
       B4 - freezeConfig IS IRREVERSIBLE AND CHEAPER THAN RAISING A FEE
    //////////////////////////////////////////////////////////////*/

    /// @dev Immediate and one-way, while a fee RAISE costs `CONFIG_DELAY_BLOCKS`. That asymmetry
    /// is deliberate under this contract's own rule - delay belongs on escalation, never on
    /// reduction, and a freeze only ever reduces the owner's power. It is recorded here because
    /// the CONSEQUENCE is irreversible while the friction is a single click, and because it is the
    /// call that turns B3 from a mistake into a permanent one. A UI must confirm it like a burn.
    function test_HAZARD_B4_freezeIsInstantWhileRaisingAFeeWaits() public {
        hook.proposeConfig(key, _params(50_000, 0, 10_000, 0, address(0)));
        vm.expectRevert(
            abi.encodeWithSelector(
                RevShareHook.PendingConfigNotDue.selector, poolId, uint48(block.number) + hook.CONFIG_DELAY_BLOCKS()
            )
        );
        hook.applyPendingConfig(key);

        // No delay, no second step, no undo.
        hook.freezeConfig(key);
        assertTrue(hook.getConfig(poolId).frozen);

        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.proposeConfig(key, _params(0, 0, 10_000, 0, address(0)));
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.reduceFee(key, 1);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.disable(key);
        vm.expectRevert(abi.encodeWithSelector(RevShareHook.ConfigFrozen.selector, poolId));
        hook.transferPoolOwnership(key, ALICE);
    }

    /*//////////////////////////////////////////////////////////////
       B5 - A MATURED PROPOSAL NEVER EXPIRES, AND disable() DOES NOT CLEAR IT
    //////////////////////////////////////////////////////////////*/

    /// @dev `reduceFee` and `disable` write `_configs` and never touch `_pending`, and a matured
    /// proposal has no expiry. So the last `ConfigUpdated` a pool emitted can read
    /// `feePips: 0, enabled: false` - "revenue share turned off" to any indexer or UI - while a
    /// 10%/enabled proposal sits armed, applicable by ANYONE, at any time, including in the same
    /// block as and immediately in front of a large swap.
    ///
    /// THE OPERATIONAL RULE: `disable` and `reduceFee` are not "off". Only `cancelPendingConfig`
    /// or `freezeConfig` clears a proposal, and a UI that renders a pool's cut must read
    /// `getPendingConfig` alongside `getConfig` and show an armed proposal as armed.
    function test_HAZARD_B5_aMaturedProposalSurvivesDisableAndCanBeFiredByAnyone() public {
        hook.proposeConfig(key, _params(hook.MAX_FEE_PIPS(), 0, 10_000, 0, address(0)));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());

        // Publicly, the pool turns its revenue share off.
        hook.reduceFee(key, 0);
        hook.disable(key);
        assertEq(hook.getConfig(poolId).feePips, 0);
        assertFalse(hook.getConfig(poolId).enabled);

        _swap(key, SWAP_AMOUNT, true);
        assertEq(hook.pendingBeneficiary(poolId, currency1), 0, "and it really is off, for now");

        // The proposal is still there, matured, and belongs to nobody.
        assertGt(hook.getPendingConfig(poolId).effectiveBlock, 0);
        vm.prank(ALICE);
        hook.applyPendingConfig(key);
        assertEq(hook.getConfig(poolId).feePips, hook.MAX_FEE_PIPS());
        assertTrue(hook.getConfig(poolId).enabled);

        _swap(key, SWAP_AMOUNT, true);
        assertGt(hook.pendingBeneficiary(poolId, currency1), 0, "10% is live again, with no owner action");
    }

    /// @dev THE HONEST MITIGATION, checked rather than asserted. The cut lands on the unspecified
    /// currency and `CLHooks.afterSwap` does `delta = delta - hookDelta`, so the amount the SWAPPER
    /// receives is already net of it - which is the exact quantity a router compares against
    /// `amountOutMinimum` (`CLRouterBase._swapExactInputSingle` ->
    /// `IInfinityRouter.TooLittleReceived`). A trader with any sane slippage bound reverts rather
    /// than being charged, because `MAX_FEE_PIPS` is 10% and slippage tolerances are not.
    ///
    /// It bounds nothing for a caller that takes its own vault lock, or sets the minimum to zero.
    function test_HAZARD_B5_theAmbushIsVisibleInTheCallerDeltaARouterBoundsOn() public {
        // Gross output for the same swap through an identical hookless pool.
        BalanceDelta control = _swap(controlKey, SWAP_AMOUNT, true);
        uint256 gross = uint256(int256(control.amount1()));

        hook.proposeConfig(key, _params(hook.MAX_FEE_PIPS(), 0, 10_000, 0, address(0)));
        vm.roll(block.number + hook.CONFIG_DELAY_BLOCKS());
        vm.prank(ALICE);
        hook.applyPendingConfig(key);

        BalanceDelta hooked = _swap(key, SWAP_AMOUNT, true);
        uint256 net = uint256(int256(hooked.amount1()));

        // The full 10% is inside the number a router checks, not hidden beside it.
        assertEq(gross - net, (gross * hook.MAX_FEE_PIPS()) / hook.PIPS_DENOMINATOR());
        assertLt(net, (gross * 99) / 100, "far outside any ordinary slippage tolerance");
    }
}

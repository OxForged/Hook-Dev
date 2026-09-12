// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";
import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {ICLPoolManager as ICLPM} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";

import {RevShareHook} from "../src/RevShareHook.sol";

/**
 * The FIRST POOL ON ROBINHOOD MAINNET, with `RevShareHook` attached, exercised
 * end to end: configure -> initialize -> add liquidity -> swap -> fees accrue.
 *
 * WHY TEST TOKENS AND NOT A REAL PAIR. Initializing a pool fixes its starting
 * price permanently, and a wrong one hands the first LP to arbitrageurs. WETH
 * and USDG exist on this chain, but the deployer holds neither, so it could not
 * seed liquidity to defend a price it set. Two throwaway ERC-20s prove every
 * contract works together — which is the actual question — with nothing real at
 * risk. The real launch follows, on plumbing already known to hold.
 *
 * THE ORDER IS NOT NEGOTIABLE. `RevShareHook.beforeInitialize` REFUSES a pool
 * whose id has not been claimed, so `configure` must come first. That is
 * deliberate in the hook: it means there is no such thing as an initialised-
 * but-unconfigured pool, and therefore no window where a pool exists with the
 * hook attached and no agreed split.
 *
 * THE BITMAP GOES IN THE KEY, not the address. Permissions live in
 * `poolKey.parameters`, which core cross-checks against
 * `getHooksRegistrationBitmap()` at initialize. Get it wrong and initialize
 * reverts rather than silently attaching a hook with different powers — which
 * is why this script reads the bitmap off the deployed hook rather than
 * hardcoding 2177.
 *
 * Usage:
 *   forge script script/ExerciseRobinhood.s.sol --rpc-url $ROBINHOOD_RPC --broadcast --slow
 */
contract ExerciseRobinhoodScript is Script {
    using CLPoolParametersHelper for bytes32;
    using PoolIdLibrary for PoolKey;

    // Live on Robinhood Chain (4663). See ops/safe/robinhood-deployment.md.
    address constant VAULT = 0x78e8359c6D34Df797b8A793dE8c7c6bffA97fB6c;
    address constant CL_POOL_MANAGER = 0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66;
    address constant REVSHARE_HOOK = 0x23CE34E8199927DD270dddd8579c947542bDE446;

    uint24 constant LP_FEE = 3000; // 0.30%
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 1:1

    /* Swap price bounds. `0` is NOT "no limit" — CLPool validates the limit
       against the current price and reverts InvalidSqrtPriceLimit, which is
       exactly what the first dry run did. A zeroForOne swap pushes the price
       DOWN, so its floor is just above MIN; a oneForZero swap pushes it UP, so
       its ceiling is just below MAX. */
    uint160 constant MIN_SQRT_RATIO_PLUS_1 = 4295128740;
    uint160 constant MAX_SQRT_RATIO_MINUS_1 =
        1461446703485210103287273052203988822378723970341;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        RevShareHook hook = RevShareHook(payable(REVSHARE_HOOK));

        console.log("=== FIRST POOL ON ROBINHOOD MAINNET ===");
        console.log(" deployer ", me);

        vm.startBroadcast(pk);

        /* 1. Two throwaway tokens, and a router. The router is a test helper
              that implements ILockCallback, so the liquidity and swap calls
              below genuinely go through the Vault's lock rather than a
              convenience wrapper that fakes it. */
        MockERC20 tokenA = new MockERC20("Latch Test Token One", "LTT1", 18);
        MockERC20 tokenB = new MockERC20("Latch Test Token Two", "LTT2", 18);
        tokenA.mint(me, 1_000_000 ether);
        tokenB.mint(me, 1_000_000 ether);

        CLPoolManagerRouter router =
            new CLPoolManagerRouter(IVault(VAULT), ICLPoolManager(CL_POOL_MANAGER));
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        // currency0 must be the lower address; the key is invalid otherwise.
        (MockERC20 token0, MockERC20 token1) =
            address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        console.log("[1] token0 ", address(token0));
        console.log("    token1 ", address(token1));

        /* 2. The key. The hook's bitmap is READ FROM THE HOOK and packed into
              `parameters` alongside the tick spacing — core compares the two at
              initialize, so a mismatch reverts instead of misconfiguring. */
        uint16 bitmap = hook.getHooksRegistrationBitmap();
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            hooks: IHooks(REVSHARE_HOOK),
            poolManager: IPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: bytes32(uint256(bitmap)).setTickSpacing(TICK_SPACING)
        });
        console.log("[2] bitmap ", bitmap);

        /* 3. CLAIM AND CONFIGURE FIRST. beforeInitialize refuses an unclaimed
              pool, so this is what makes the next step possible at all.
              20% back to LPs, 80% to the beneficiary roster, nothing to a
              distributor — there is no epoch distributor on this chain yet, and
              distributorBps must be 0 when `distributor` is address(0) or
              _validateParams reverts DistributorRequired. The three shares must
              also sum to EXACTLY 10000; the check is not a ceiling. */
        /* THREE STEPS, AND THE ORDER IS LOAD-BEARING. `setBeneficiaries` needs an
           owner, and ownership is established by the first `configure`. But a
           `configure` naming a non-zero `beneficiaryBps` is now rejected while the
           roster is empty - the twin of `DistributorRequired`, added because the
           deployed hook happily accepted "80% to a roster of nobody" and
           `freezeConfig` then made that permanent. So: claim LP-only, set the
           roster, then configure for real. All three run before `initialize`, so
           nothing has traded and there is nothing to sandwich. */
        hook.configure(
            key,
            RevShareHook.ConfigParams({
                feePips: 3000, // 0.3% of the swap, on top of the LP fee
                lpDonateBps: 10_000,
                beneficiaryBps: 0,
                distributorBps: 0,
                distributor: address(0),
                enabled: true
            })
        );
        console.log("[3] pool claimed (LP-only, so no roster is needed yet)");

        // The deployer is the only beneficiary for now, so the take is traceable.
        RevShareHook.Beneficiary[] memory roster = new RevShareHook.Beneficiary[](1);
        roster[0] = RevShareHook.Beneficiary({recipient: me, weight: 1});
        hook.setBeneficiaries(key, roster);
        console.log("    roster set: deployer, weight 1");

        hook.configure(
            key,
            RevShareHook.ConfigParams({
                feePips: 3000,
                lpDonateBps: 2000,
                beneficiaryBps: 8000,
                distributorBps: 0,
                distributor: address(0),
                enabled: true
            })
        );
        console.log("    configured: 20% LPs / 80% roster");

        /* 4. Initialize at 1:1 — meaningless for real tokens, correct for two
              test tokens minted in equal supply. */
        ICLPoolManager(CL_POOL_MANAGER).initialize(key, SQRT_PRICE_1_1);
        console.log("[4] pool initialized at 1:1");

        // 5. Liquidity, so there is something to swap against.
        router.modifyPosition(
            key,
            ICLPM.ModifyLiquidityParams({
                tickLower: -600,
                tickUpper: 600,
                liquidityDelta: 1_000 ether,
                salt: bytes32(0)
            }),
            ""
        );
        console.log("[5] liquidity added");

        // 6. A swap in each direction — this is what makes the hook take a fee.
        router.swap(
            key,
            ICLPM.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: MIN_SQRT_RATIO_PLUS_1
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        router.swap(
            key,
            ICLPM.SwapParams({
                zeroForOne: false,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: MAX_SQRT_RATIO_MINUS_1
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        console.log("[6] swapped both directions");

        vm.stopBroadcast();

        /* 7. Read back what the hook actually took. This is the assertion that
              matters: everything above could succeed while the hook took
              nothing, which would mean the bitmap or the config was wrong. */
        PoolId id = key.toId();
        uint256 pend0 = hook.pendingBeneficiary(id, key.currency0);
        uint256 pend1 = hook.pendingBeneficiary(id, key.currency1);

        console.log("");
        console.log("=== RESULT ===");
        console.log(" poolId            ", uint256(PoolId.unwrap(id)));
        console.log(" pendingBeneficiary currency0 ", pend0);
        console.log(" pendingBeneficiary currency1 ", pend1);
        require(pend0 > 0 || pend1 > 0, "hook took nothing - bitmap or config is wrong");
        console.log(" The hook took a real fee on a real mainnet swap.");
    }
}

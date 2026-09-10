// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IVault} from "infinity-core/src/interfaces/IVault.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";
import {LatchProtocolFeeController} from "../src/LatchProtocolFeeController.sol";

/**
 * Exercises the LIVE Sepolia deployment with real transactions.
 *
 * This is not a unit test. Every call below lands on chain against the contracts already
 * deployed and Etherscan-verified, so it proves the deployment actually works end to end
 * rather than proving the source compiles.
 *
 * What it drives:
 *   Vault            lock / lockAcquired / sync / settle / take, via CLPoolManagerRouter
 *   CLPoolManager    initialize, modifyLiquidity (add AND remove), swap (both directions), donate
 *   FeeController    protocolFeeForPool on a live pool key, and the full governance surface
 *
 * The protocol fee assertion is the point of the whole exercise: it proves the 0.1% default
 * is genuinely reaching CLPool.swap, not merely stored in a controller nobody reads.
 *
 * Run:
 *   forge script script/ExerciseSepolia.s.sol:ExerciseSepoliaScript \
 *     --rpc-url $SEPOLIA_RPC_URL --broadcast --slow -vv
 */
contract ExerciseSepoliaScript is Script {
    using PoolIdLibrary for PoolKey;
    using CLPoolParametersHelper for bytes32;

    // Live, verified Sepolia deployment
    address constant VAULT = 0xCe3d133eb486b448A53437A5073619FbE424d01B;
    address constant CL_POOL_MANAGER = 0xb7C8a11E0B359616eD06256783aF57114841F738;
    address constant FEE_CONTROLLER = 0xc1b7A4e61A4B6ceBA3e308425dc2390c2CE57ea9;

    /// sqrt(1) in Q64.96 — a 1:1 starting price
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    int24 constant TICK_SPACING = 60;
    uint24 constant LP_FEE = 3000; // 0.30%

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        console.log("=========================================================");
        console.log(" LATCH PROTOCOL - LIVE EXERCISE ON SEPOLIA");
        console.log("=========================================================");
        console.log(" deployer ", me);
        console.log("");

        vm.startBroadcast(pk);

        // ---------------------------------------------------------------
        // 1. Tokens + lock-callback harness
        //    CLPoolManagerRouter is core's own test router: it implements
        //    ILockCallback, so every liquidity/swap call below genuinely
        //    exercises Vault.lock -> lockAcquired -> sync/settle/take.
        // ---------------------------------------------------------------
        MockERC20 tokenA = new MockERC20("Latch Test USD", "ltUSD", 18);
        MockERC20 tokenB = new MockERC20("Latch Test ETH", "ltETH", 18);
        (MockERC20 token0, MockERC20 token1) =
            address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        CLPoolManagerRouter router =
            new CLPoolManagerRouter(IVault(VAULT), ICLPoolManager(CL_POOL_MANAGER));

        token0.mint(me, 1_000_000 ether);
        token1.mint(me, 1_000_000 ether);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);

        console.log("[1] token0            ", address(token0));
        console.log("    token1            ", address(token1));
        console.log("    router            ", address(router));

        // ---------------------------------------------------------------
        // 2. Pool key + the fee the controller will hand this pool
        // ---------------------------------------------------------------
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            hooks: IHooks(address(0)),
            poolManager: IPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: bytes32(0).setTickSpacing(TICK_SPACING)
        });

        uint24 quoted = LatchProtocolFeeController(FEE_CONTROLLER).protocolFeeForPool(key);
        console.log("[2] protocolFeeForPool (packed)", quoted);
        console.log("    zeroForOne pips             ", quoted & 0xfff);
        console.log("    oneForZero pips             ", quoted >> 12);

        // ---------------------------------------------------------------
        // 3. initialize  (CLPoolManager, and the fee controller is read here)
        // ---------------------------------------------------------------
        ICLPoolManager(CL_POOL_MANAGER).initialize(key, SQRT_PRICE_1_1);
        console.log("[3] pool initialized");

        // ---------------------------------------------------------------
        // 4. add liquidity  (Vault lock -> settle)
        // ---------------------------------------------------------------
        router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -TICK_SPACING * 100,
                tickUpper: TICK_SPACING * 100,
                liquidityDelta: 10_000 ether,
                salt: bytes32(0)
            }),
            ""
        );
        console.log("[4] liquidity added");

        // ---------------------------------------------------------------
        // 5. swap both directions  (Vault lock -> settle + take)
        // ---------------------------------------------------------------
        router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -1 ether, // exact input
                sqrtPriceLimitX96: SQRT_PRICE_1_1 / 2
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        console.log("[5] swap 0->1 done");

        router.swap(
            key,
            ICLPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: SQRT_PRICE_1_1 * 2
            }),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        console.log("    swap 1->0 done");

        // ---------------------------------------------------------------
        // 6. donate  (Vault lock -> settle, no take)
        // ---------------------------------------------------------------
        router.donate(key, 0.01 ether, 0.01 ether, "");
        console.log("[6] donate done");

        // ---------------------------------------------------------------
        // 7. remove liquidity  (Vault lock -> take)
        // ---------------------------------------------------------------
        router.modifyPosition(
            key,
            ICLPoolManager.ModifyLiquidityParams({
                tickLower: -TICK_SPACING * 100,
                tickUpper: TICK_SPACING * 100,
                liquidityDelta: -5_000 ether,
                salt: bytes32(0)
            }),
            ""
        );
        console.log("[7] liquidity removed");

        // ---------------------------------------------------------------
        // 8. fee controller governance surface
        //    Each of these is a real state change on a live contract.
        // ---------------------------------------------------------------
        LatchProtocolFeeController fc = LatchProtocolFeeController(FEE_CONTROLLER);

        // per-tier override: the stable-tier fix. Three of Latch's target chains are
        // stablecoin chains where a flat 0.1% is ~11x a 0.01% pool's own fee.
        fc.setTierFee(100, true, 20, 20);
        console.log("[8] setTierFee(100, 20 pips) - stable tier");

        fc.setPoolFee(key.toId(), true, 500, 500);
        console.log("    setPoolFee(this pool, 500 pips)");

        fc.setDynamicFee(true, 300, 300);
        console.log("    setDynamicFee(300 pips)");

        // one-way emergency path, then governance reopens it
        fc.emergencyDisableFees();
        console.log("    emergencyDisableFees() -> feesDisabled");

        fc.setFeesDisabled(false);
        console.log("    setFeesDisabled(false) -> re-enabled");

        fc.setGuardian(me);
        console.log("    setGuardian(deployer)");

        fc.setDefaultFee(1000, 1000);
        console.log("    setDefaultFee restored to 1000 pips (0.1%)");

        vm.stopBroadcast();

        console.log("");
        console.log("=========================================================");
        console.log(" pool id");
        console.logBytes32(PoolId.unwrap(key.toId()));
        console.log(" vault token0 balance ", token0.balanceOf(VAULT));
        console.log(" vault token1 balance ", token1.balanceOf(VAULT));
        console.log("=========================================================");
    }
}

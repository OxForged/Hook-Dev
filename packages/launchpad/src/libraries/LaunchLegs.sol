// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {IProtocolFees} from "infinity-core/src/interfaces/IProtocolFees.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {TickMath} from "infinity-core/src/pool-cl/libraries/TickMath.sol";

import {ICLPositionManager} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionManager.sol";
import {IBinPositionManager} from "infinity-periphery/src/pool-bin/interfaces/IBinPositionManager.sol";
import {IBinFungibleToken} from "infinity-periphery/src/pool-bin/interfaces/IBinFungibleToken.sol";
import {LiquidityAmounts} from "infinity-periphery/src/pool-cl/libraries/LiquidityAmounts.sol";
import {Actions} from "infinity-periphery/src/libraries/Actions.sol";
import {Plan, Planner} from "infinity-periphery/src/libraries/Planner.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {BinLaunchGuardHook} from "latch-hooks/src/launch/BinLaunchGuardHook.sol";

import {LatchLPLocker} from "../LatchLPLocker.sol";
import {LatchBinLPLocker} from "../LatchBinLPLocker.sol";
import {LockParams, Lock} from "../interfaces/ILatchLPLocker.sol";
import {BinLock} from "../interfaces/ILatchBinLPLocker.sol";
import {
    ILaunchpadKitV2, LegKind, BinShape, CLLegParams, BinLegParams, LegParams, LaunchParamsV2
} from "../interfaces/ILaunchpadKitV2.sol";
import {ILaunchTokenFactory} from "../interfaces/ILaunchTokenFactory.sol";
import {ILaunchRegistryWriter} from "../interfaces/ILaunchRegistryWriter.sol";
import {BinLaunchShapes} from "./BinLaunchShapes.sol";

/// @dev The one read the kit makes of an installed protocol-fee controller: whose word zeroes a pool.
interface ILaunchOracleBound {
    function launchOracle() external view returns (address);
}

/// @title LaunchLegs
/// @notice The interaction phase of `LaunchpadKitV2.createLaunch`: create the token, then open, seed, lock
/// and register every CL and Bin leg.
///
/// @dev A LINKED library, not a contract, and that choice is the security argument:
///   * Its public functions run by DELEGATECALL, in the kit's own context. `address(this)` is the kit, so
///     every call below comes FROM the kit: the guards see the kit as launch owner (the pool-id
///     reservation requires exactly that), the position NFT and bin shares are minted to the kit, and the
///     kit is the account the Bin locker pulls from.
///   * Its address is fixed in the kit's bytecode at link time. There is no setter, no proxy, no upgrade,
///     and a library has no storage of its own and no selfdestruct, so the code the kit delegates to can
///     never change after deployment.
///   * Solidity's library call-guard makes every state-changing function here revert when CALLed directly,
///     so the library cannot be used by anyone as a free-standing launcher.
///   * It exists only because the kit exceeds EIP-170 (24,576 bytes) in one piece. Nothing here reads or
///     writes kit storage: the kit passes everything in and records the results itself. In particular the
///     V3 flag is written by the kit before it ever calls this library.
library LaunchLegs {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    /// @dev The kit's immutables this library needs, passed by value.
    struct Env {
        ICLPoolManager clPoolManager;
        LaunchGuardHook clHook;
        ICLPositionManager clPositionManager;
        LatchLPLocker clLocker;
        IBinPoolManager binPoolManager;
        BinLaunchGuardHook binHook;
        IBinPositionManager binPositionManager;
        LatchBinLPLocker binLocker;
        IAllowanceTransfer clPermit2;
        IAllowanceTransfer binPermit2;
        ILaunchTokenFactory tokenFactory;
        ILaunchRegistryWriter launchRegistry;
        uint16 maxBinsPerLeg;
    }

    /// @dev Resolved launch-guard schedule, shared by every leg.
    struct Schedule {
        uint40 startTime;
        uint32 decaySeconds;
        uint24 initialFeeBips;
        uint24 finalFeeBips;
        bool enabled;
        bool requiresMaxBuy;
    }

    /// @dev Everything a Bin leg's mint and lock need.
    struct BinPlan {
        int256[] deltaIds;
        uint256[] distX;
        uint256[] distY;
        uint24[] binIds; // ascending, for the locker
        uint256[] tokenIds; // aligned with binIds
    }

    /// @dev What the kit decided in its checks-and-effects phase. Every flag is already written.
    struct Context {
        Env env;
        address token;
        /// @dev `keccak256(abi.encode(launcher, userSalt))`, the salt the kit passes to the factory.
        bytes32 salt;
        address creator;
        address steward;
        Schedule schedule;
        PoolKey[] keys;
        bytes32[] poolIds;
        uint256[] supplies;
    }

    /*//////////////////////////////////////////////////////////////
                                 EXECUTE
    //////////////////////////////////////////////////////////////*/

    /// @notice The interaction phase of `LaunchpadKitV2.createLaunch`. DELEGATECALLed by the kit only.
    /// @return lockIds Per leg: the CL position token id, or the Bin lock id.
    function execute(Context memory c, LaunchParamsV2 calldata p) public returns (uint256[] memory lockIds) {
        uint256 n = p.legs.length;
        address token = c.token;

        // ---- Bin shapes R1-R6 first: pure, and still before any call to another contract ----
        BinPlan[] memory plans = new BinPlan[](n);
        bool hasCL;
        bool hasBin;
        for (uint256 i; i < n; ++i) {
            if (p.legs[i].kind == LegKind.Bin) {
                plans[i] = _planBin(
                    i, c.poolIds[i], p.legs[i].bin, _launchIs0(c.keys[i], token), c.supplies[i], c.env.maxBinsPerLeg
                );
                hasBin = true;
            } else {
                hasCL = true;
            }
        }

        // ---- the token: created to the kit, at the address the kit already flagged pools for ----
        {
            address created = c.env.tokenFactory.createToken(p.name, p.symbol, p.metadataURI, p.totalSupply, address(this), c.salt);
            if (created != token) revert ILaunchpadKitV2.LaunchTokenAddressMismatch(token, created);
            uint256 received = IERC20(token).balanceOf(address(this));
            if (received != p.totalSupply) revert ILaunchpadKitV2.LaunchTokenSupplyMismatch(p.totalSupply, received);
            // Unbounded, and harmless: Permit2 lets only the named position manager spend, a position manager
            // spends only for whoever locked it (the kit, inside this call), and the kit ends the call holding
            // zero of the token - asserted below.
            if (hasCL) {
                IERC20(token).forceApprove(address(c.env.clPermit2), type(uint256).max);
                c.env.clPermit2.approve(token, address(c.env.clPositionManager), type(uint160).max, type(uint48).max);
            }
            if (hasBin) {
                if (!hasCL || address(c.env.binPermit2) != address(c.env.clPermit2)) {
                    IERC20(token).forceApprove(address(c.env.binPermit2), type(uint256).max);
                }
                c.env.binPermit2.approve(token, address(c.env.binPositionManager), type(uint160).max, type(uint48).max);
            }
        }

        LockParams memory lp = LockParams({
            creator: c.creator,
            creatorBps: p.creatorBps,
            integrator: p.integratorBps == 0 ? address(0) : p.integrator,
            integratorBps: p.integratorBps,
            protocolBps: p.protocolBps
        });

        // ---- every leg: open, seed, lock, register ----
        lockIds = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            LegParams calldata leg = p.legs[i];
            uint256 before = IERC20(token).balanceOf(address(this));
            bool launchIs0 = _launchIs0(c.keys[i], token);
            address manager;
            if (leg.kind == LegKind.CL) {
                lockIds[i] = _openCL(c.env, i, c.keys[i], leg, c.schedule, launchIs0, c.supplies[i], lp);
                manager = address(c.env.clPoolManager);
            } else {
                lockIds[i] = _openBin(c.env, i, c.keys[i], leg, c.schedule, launchIs0, c.supplies[i], plans[i], lp);
                manager = address(c.env.binPoolManager);
            }

            // `msg.sender` is the kit, so the record is `LaunchpadAttested` and cannot be front-run.
            c.env.launchRegistry.registerLaunch(manager, c.poolIds[i], token, address(this), c.creator, c.steward, p.listing);

            emit ILaunchpadKitV2.LaunchLegCreated(
                token, c.poolIds[i], leg.quote, leg.kind, lockIds[i], before - IERC20(token).balanceOf(address(this)), leg.weightBps
            );
        }

        // ---- the unseeded allocation plus seeding rounding dust; the kit must end holding none ----
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left != 0) {
            IERC20(token).safeTransfer(p.allocationRecipient == address(0) ? c.creator : p.allocationRecipient, left);
        }
        uint256 retained = IERC20(token).balanceOf(address(this));
        if (retained != 0) revert ILaunchpadKitV2.KitRetainedLaunchToken(retained);
    }

    function _launchIs0(PoolKey memory key, address token) private pure returns (bool) {
        return Currency.unwrap(key.currency0) == token;
    }

    /*//////////////////////////////////////////////////////////////
                                 BIN PLAN
    //////////////////////////////////////////////////////////////*/

    /// @notice Shape rules R1-R6 and the id range, against the REQUESTED active id (`_openBin` asserts core
    /// agrees). Pure.
    function _planBin(
        uint256 index,
        bytes32 poolId,
        BinLegParams calldata b,
        bool launchIs0,
        uint256 supply,
        uint256 maxBins
    ) private pure returns (BinPlan memory plan) {
        uint24[] memory offsets;
        uint64[] memory weights;
        uint256 floorBins;
        if (b.shape == BinShape.Custom) {
            (offsets, weights, floorBins) = (b.offsets, b.weights, b.floorBins);
        } else {
            (offsets, weights, floorBins) = BinLaunchShapes.build(b.shape, b.binCount, maxBins);
        }
        BinLaunchShapes.validate(offsets, weights, floorBins, maxBins, supply);

        uint256 m = offsets.length;
        plan.deltaIds = new int256[](m);
        plan.distX = new uint256[](m);
        plan.distY = new uint256[](m);
        plan.binIds = new uint24[](m);
        plan.tokenIds = new uint256[](m);
        uint256 active = b.activeId;
        for (uint256 k; k < m; ++k) {
            uint256 off = offsets[k];
            uint256 id;
            uint256 slot;
            if (launchIs0) {
                // Launch token = currency0 = X: bins strictly ABOVE active hold X only.
                id = active + off;
                if (id > type(uint24).max) revert ILaunchpadKitV2.BinIdOutOfRange(index, b.activeId, offsets[k]);
                // forge-lint: disable-next-line(unsafe-typecast)
                plan.deltaIds[k] = int256(off);
                plan.distX[k] = weights[k];
                slot = k;
            } else {
                // Launch token = currency1 = Y: bins strictly BELOW active hold Y only. Id 0 is never valid.
                if (off >= active) revert ILaunchpadKitV2.BinIdOutOfRange(index, b.activeId, offsets[k]);
                id = active - off;
                // forge-lint: disable-next-line(unsafe-typecast)
                plan.deltaIds[k] = -int256(off);
                plan.distY[k] = weights[k];
                slot = m - 1 - k; // fill order descends in id; the locker wants ascending ids
            }
            // forge-lint: disable-next-line(unsafe-typecast)
            plan.binIds[slot] = uint24(id);
            plan.tokenIds[slot] = uint256(keccak256(abi.encode(poolId, id))); // BinTokenLibrary.toTokenId
        }
    }

    /*//////////////////////////////////////////////////////////////
                                  CL LEG
    //////////////////////////////////////////////////////////////*/

    /// @notice V3 doc section 4, CL: configureLaunch -> initialize -> fee assert and single-side check against
    /// core's tick -> mint to the kit -> safeTransferFrom to the locker -> read the lock back.
    function _openCL(
        Env memory env,
        uint256 index,
        PoolKey memory key,
        LegParams calldata leg,
        Schedule memory s,
        bool launchIs0,
        uint256 supply,
        LockParams memory lp
    ) private returns (uint256 tokenId) {
        bytes32 poolId = PoolId.unwrap(key.toId());
        CLLegParams calldata c = leg.cl;

        env.clHook.configureLaunch(
            key,
            LaunchGuardHook.LaunchConfig({
                startTime: s.startTime,
                decaySeconds: s.decaySeconds,
                initialFeeBips: s.initialFeeBips,
                finalFeeBips: s.finalFeeBips,
                maxBuyPerTx: leg.maxBuyPerTx,
                launchTokenIsCurrency0: launchIs0,
                enabled: s.enabled
            })
        );
        // forge-lint: disable-next-line(unused-return)
        env.clPoolManager.initialize(key, c.sqrtPriceX96);

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee,) = env.clPoolManager.getSlot0(PoolId.wrap(poolId));
        _assertBornAtZero(address(env.clPoolManager), poolId, protocolFee);
        // Strict, against the tick core reports. Core keeps [tickLower, tickUpper) in range, so a currency0
        // range with `tick == tickLower` already holds quote currency and would pull quote nobody sent.
        if (launchIs0 ? c.tickLower <= tick : c.tickUpper > tick) {
            revert ILaunchpadKitV2.RangeNotSingleSided(index, c.tickLower, c.tickUpper, tick);
        }

        // The kit bounds `supply` to uint128 before calling.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 amount = uint128(supply);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(c.tickLower),
            TickMath.getSqrtRatioAtTick(c.tickUpper),
            launchIs0 ? amount : 0,
            launchIs0 ? 0 : amount
        );
        if (liquidity == 0) revert ILaunchpadKitV2.SeedProducesNoLiquidity(index);

        tokenId = env.clPositionManager.nextTokenId();
        Plan memory plan = Planner.init();
        plan.add(
            Actions.CL_MINT_POSITION,
            abi.encode(
                key,
                c.tickLower,
                c.tickUpper,
                uint256(liquidity),
                launchIs0 ? amount : 0,
                launchIs0 ? 0 : amount,
                address(this), // mint to the KIT: a direct mint to the locker fires no receiver callback
                bytes("")
            )
        );
        plan.add(Actions.SETTLE_PAIR, abi.encode(key.currency0, key.currency1));
        env.clPositionManager.modifyLiquidities(plan.encode(), block.timestamp);

        // After `modifyLiquidities` returned: `transferFrom` is `onlyIfVaultUnlocked`.
        IERC721 nft = IERC721(address(env.clPositionManager));
        nft.safeTransferFrom(address(this), address(env.clLocker), tokenId, abi.encode(lp));

        // THE LOCK ASSERTION. Mutation-checked: without it a locker that accepts the NFT and records
        // nothing (test_ATOMIC_lockerThatRecordsNothingRevertsTheLaunch) yields a flagged, unlocked pool.
        Lock memory lk = env.clLocker.getLock(tokenId);
        if (
            !env.clLocker.isLocked(tokenId) || PoolId.unwrap(lk.poolId) != poolId || nft.ownerOf(tokenId) != address(env.clLocker)
                || lk.creator != lp.creator || lk.creatorBps != lp.creatorBps || lk.integrator != lp.integrator
                || lk.integratorBps != lp.integratorBps || lk.protocolBps != lp.protocolBps
        ) revert ILaunchpadKitV2.LockNotRecorded(index, tokenId);
    }

    /*//////////////////////////////////////////////////////////////
                                  BIN LEG
    //////////////////////////////////////////////////////////////*/

    /// @notice kit-v2-integration.md 10.6, Bin: configureLaunch -> initialize -> read the active id back and
    /// assert the fee -> BIN_ADD_LIQUIDITY to the kit -> read shares -> lock -> assert zero kit shares and the
    /// lock record.
    function _openBin(
        Env memory env,
        uint256 index,
        PoolKey memory key,
        LegParams calldata leg,
        Schedule memory s,
        bool launchIs0,
        uint256 supply,
        BinPlan memory plan,
        LockParams memory lp
    ) private returns (uint256 lockId) {
        bytes32 poolId = PoolId.unwrap(key.toId());

        env.binHook.configureLaunch(
            key,
            BinLaunchGuardHook.LaunchConfig({
                startTime: s.startTime,
                decaySeconds: s.decaySeconds,
                initialFeeBips: s.initialFeeBips,
                finalFeeBips: s.finalFeeBips,
                maxBuyPerTx: leg.maxBuyPerTx,
                launchTokenIsCurrency0: launchIs0,
                enabled: s.enabled
            })
        );
        env.binPoolManager.initialize(key, leg.bin.activeId);

        (uint24 active, uint24 protocolFee,) = env.binPoolManager.getSlot0(PoolId.wrap(poolId));
        if (active != leg.bin.activeId) revert ILaunchpadKitV2.ActiveIdMoved(index, leg.bin.activeId, active);
        _assertBornAtZero(address(env.binPoolManager), poolId, protocolFee);

        uint256 m = plan.binIds.length;
        {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 amount = uint128(supply);
            uint256[] memory minLiquidities = new uint256[](m);
            for (uint256 k; k < m; ++k) {
                minLiquidities[k] = 1; // R6: every bin must mint shares
            }
            Plan memory actions = Planner.init();
            actions.add(
                Actions.BIN_ADD_LIQUIDITY,
                abi.encode(
                    IBinPositionManager.BinAddLiquidityParams({
                        poolKey: key,
                        amount0: launchIs0 ? amount : 0,
                        amount1: launchIs0 ? 0 : amount,
                        amount0Max: launchIs0 ? amount : 0,
                        amount1Max: launchIs0 ? 0 : amount,
                        activeIdDesired: active,
                        idSlippage: 0,
                        deltaIds: plan.deltaIds,
                        distributionX: plan.distX,
                        distributionY: plan.distY,
                        minLiquidities: minLiquidities,
                        to: address(this), // never the locker: shares arriving without `lock` are orphans
                        hookData: bytes("")
                    })
                )
            );
            actions.add(Actions.SETTLE_PAIR, abi.encode(key.currency0, key.currency1));
            env.binPositionManager.modifyLiquidities(actions.encode(), block.timestamp);
        }

        IBinFungibleToken shares = IBinFungibleToken(address(env.binPositionManager));
        uint256[] memory amounts = new uint256[](m);
        for (uint256 k; k < m; ++k) {
            // A fresh pool: the kit's whole balance of each bin is this mint.
            amounts[k] = shares.balanceOf(address(this), plan.tokenIds[k]);
        }
        lockId = env.binLocker.lock(key, plan.binIds, amounts, lp);

        for (uint256 k; k < m; ++k) {
            uint256 kept = shares.balanceOf(address(this), plan.tokenIds[k]);
            if (kept != 0) revert ILaunchpadKitV2.KitRetainedBinShares(index, plan.binIds[k], kept);
        }
        BinLock memory lk = env.binLocker.getLock(lockId);
        if (
            !env.binLocker.isLocked(lockId) || PoolId.unwrap(lk.poolId) != poolId || lk.binCount != m
                || lk.creator != lp.creator || lk.creatorBps != lp.creatorBps || lk.integrator != lp.integrator
                || lk.integratorBps != lp.integratorBps || lk.protocolBps != lp.protocolBps
        ) revert ILaunchpadKitV2.LockNotRecorded(index, lockId);
    }

    /// @dev V3 doc section 4 step 9, gated on the installed controller being bound to THIS kit - so the kit
    /// stays usable under V2 (owner decision #2), where the Safe zeroes pools by hand. Bounded staticcall,
    /// at most 32 bytes copied: a controller cannot bill the launch for memory. `address(this)` is the kit.
    function _assertBornAtZero(address manager, bytes32 poolId, uint24 protocolFee) private view {
        if (protocolFee == 0) return;
        address controller = address(IProtocolFees(manager).protocolFeeController());
        if (controller.code.length == 0) return;
        bytes4 selector = ILaunchOracleBound.launchOracle.selector;
        bool ok;
        uint256 word;
        assembly ("memory-safe") {
            mstore(0x00, selector)
            ok := staticcall(20000, controller, 0x00, 0x04, 0x00, 0x20)
            word := mload(0x00)
            ok := and(ok, eq(returndatasize(), 0x20))
        }
        if (ok && word == uint256(uint160(address(this)))) revert ILaunchpadKitV2.ProtocolFeeNotZero(poolId, protocolFee);
    }
}

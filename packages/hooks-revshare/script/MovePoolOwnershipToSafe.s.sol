// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {CLPoolParametersHelper} from "infinity-core/src/pool-cl/libraries/CLPoolParametersHelper.sol";

import {RevShareHook} from "../src/RevShareHook.sol";

/**
 * Moves the live LTT1/LTT2 pool off the shared operations key and onto the
 * governance Safe. Step 1 of 2; the Safe finishes it.
 *
 * WHY THIS IS NOT HOUSEKEEPING. `getConfig` on the live pool returns
 * `poolOwner == 0x304b0cc0…c9a9` — the same key that is deployer, keeper,
 * guardian and oracle publisher, and that lives on a shared VPS. CLAUDE.md
 * enumerates what a theft of that key buys, and pool ownership is not on the
 * list, because the list was written before any pool existed.
 *
 * What it buys is the worst thing on the board, because it is the only
 * PERMANENT one:
 *
 *     proposeConfig(feePips = MAX_FEE_PIPS)   // 10%
 *     ... 3600 blocks ...
 *     applyPendingConfig(key)
 *     setBeneficiaries(key, [attacker])
 *     freezeConfig(key)                       // one way, no undo
 *
 * After the freeze, `_requireOwner` reverts on every owner call, so `reduceFee`
 * and `disable` are gone too. Neither the pool owner, nor the Safe, nor a
 * timelock can lower that fee again. The only remaining lever is
 * `setPaused(true)`, which is GLOBAL — it stops accrual on every pool at once —
 * and does not stop `claim` paying out what is already settled.
 *
 * This particular pool holds two throwaway test tokens, so the value at risk
 * today is nil. That is exactly why it is the right pool to rehearse on. The
 * next one will hold something.
 *
 * THE ORDER MATTERS, AND NOT FOR THE REASON IT LOOKS LIKE.
 *
 * `settleBeneficiaries` runs FIRST, before ownership moves, because
 * `pendingBeneficiary` is distributed against the roster IN FORCE WHEN IT IS
 * SETTLED, not the roster in force when the fee was taken. The deployer earned
 * the ~0.0024 of each token currently pending as the sole beneficiary. Hand the
 * pool over first, let the Safe re-roster, and that already-earned amount is
 * paid to the new roster instead. Nobody is robbed here — both addresses are
 * ours — but the same sequence run on a real pool with third-party
 * beneficiaries would quietly reassign their earnings, and the habit is formed
 * on the pool where it costs nothing.
 *
 * `settleBeneficiaries` is permissionless and returns EARLY rather than
 * reverting when there is nothing to do, so running it is safe and running it
 * twice is free.
 *
 * WHAT THIS SCRIPT DOES NOT DO. `transferPoolOwnership` only NOMINATES — the
 * hook uses the same two-step handshake as everything else in this protocol,
 * and the nominee must call `acceptPoolOwnership`. Until the Safe does that,
 * the shared key is still the owner and nothing here has improved. The
 * accepting half, plus the roster change, is
 * `ops/safe/robinhood-pool-owner-to-safe.json`.
 *
 * Usage (dry run first, without --broadcast):
 *   forge script script/MovePoolOwnershipToSafe.s.sol --rpc-url $ROBINHOOD_RPC
 */
contract MovePoolOwnershipToSafeScript is Script {
    using CLPoolParametersHelper for bytes32;
    using PoolIdLibrary for PoolKey;

    address constant REVSHARE_HOOK = 0x23CE34E8199927DD270dddd8579c947542bDE446;
    address constant CL_POOL_MANAGER = 0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66;
    address constant SAFE = 0x715a6176946aDbD22c1B2021d321Fb3767ca3432;

    // The live pool. currency0 is the lower address, as the key requires.
    address constant LTT1 = 0x2A21c0826848f2D597B7C87A4B931dE1407958A6;
    address constant LTT2 = 0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4;
    uint24 constant LP_FEE = 3000;
    int24 constant TICK_SPACING = 60;

    /// Cross-check: if the key below does not hash to this, the key is wrong
    /// and every call would silently address a pool that does not exist.
    bytes32 constant EXPECTED_POOL_ID =
        0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        RevShareHook hook = RevShareHook(payable(REVSHARE_HOOK));

        /* The bitmap is read off the hook rather than hardcoded, for the same
           reason the exercise script reads it: a wrong bitmap produces a
           different poolId, and every call below would address nothing. */
        uint16 bitmap = hook.getHooksRegistrationBitmap();
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(LTT1),
            currency1: Currency.wrap(LTT2),
            hooks: IHooks(REVSHARE_HOOK),
            poolManager: IPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: bytes32(uint256(bitmap)).setTickSpacing(TICK_SPACING)
        });

        PoolId id = key.toId();
        require(PoolId.unwrap(id) == EXPECTED_POOL_ID, "poolId mismatch - the key is wrong");

        RevShareHook.PoolConfig memory cfg = hook.getConfig(id);
        address currentOwner = cfg.owner;
        console.log("=== MOVE POOL OWNERSHIP TO THE SAFE ===");
        console.log("  poolId       ", uint256(PoolId.unwrap(id)));
        console.log("  current owner", currentOwner);
        console.log("  feePips      ", cfg.feePips);
        /* If this ever prints true before the handover, the window has already
           closed and no owner change can lower the fee again. */
        console.log("  frozen       ", cfg.frozen);
        console.log("  caller       ", me);
        console.log("  destination  ", SAFE);

        require(currentOwner == me, "caller is not the pool owner");
        if (currentOwner == SAFE) {
            console.log("Already owned by the Safe. Nothing to do.");
            return;
        }

        uint256 pend0Before = hook.pendingBeneficiary(id, key.currency0);
        uint256 pend1Before = hook.pendingBeneficiary(id, key.currency1);
        console.log("  pending c0   ", pend0Before);
        console.log("  pending c1   ", pend1Before);

        vm.startBroadcast(pk);

        /* 1. Settle FIRST — see the header. This credits what the CURRENT
              roster earned, at the moment it is still the current roster. */
        hook.settleBeneficiaries(key, key.currency0);
        hook.settleBeneficiaries(key, key.currency1);

        // 2. Nominate. The Safe is not the owner until it accepts.
        hook.transferPoolOwnership(key, SAFE);

        vm.stopBroadcast();

        /* Read back, do not assume. A two-step transfer that was proposed and
           never accepted looks identical to a completed one on an explorer. */
        address ownerAfter = hook.getConfig(id).owner;
        console.log("");
        console.log("=== RESULT ===");
        console.log("  owner is still  ", ownerAfter, "(expected: unchanged)");
        console.log("  claimable c0    ", hook.claimable(me, key.currency0));
        console.log("  claimable c1    ", hook.claimable(me, key.currency1));
        console.log("  pending c0      ", hook.pendingBeneficiary(id, key.currency0));
        console.log("  pending c1      ", hook.pendingBeneficiary(id, key.currency1));
        console.log("");
        console.log("NOT DONE YET. transferPoolOwnership only nominates.");
        console.log("The Safe must execute ops/safe/robinhood-pool-owner-to-safe.json");
        console.log("(acceptPoolOwnership, then setBeneficiaries) or this changed nothing.");
    }
}

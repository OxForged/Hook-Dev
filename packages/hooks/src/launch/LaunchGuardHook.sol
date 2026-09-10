// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {BaseCLHook} from "../base/BaseCLHook.sol";
import {ICLHooks} from "infinity-core/src/pool-cl/interfaces/ICLHooks.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "infinity-core/src/types/BeforeSwapDelta.sol";

/// @title LaunchGuardHook
/// @notice Anti-sniper launch protection for LatchProtocol CL pools: a decaying "sniper tax".
///
/// @dev ############################ WHAT THIS HOOK ACTUALLY DOES ############################
///
/// It prices early buying instead of trying to identify early buyers. For `decayBlocks` blocks
/// after `startBlock` the LP fee is overridden with a value that decays linearly from
/// `initialFeeBips` down to `finalFeeBips`. A sniper who buys in the first block pays the full
/// launch tax; a normal buyer who arrives after the window pays the normal fee. The proceeds are
/// ordinary LP fees, so they accrue to the pool's liquidity providers, not to this contract.
///
/// This design is deliberate, and it follows from a hard constraint of the singleton architecture:
///
///   THE `sender` ARGUMENT OF EVERY HOOK CALLBACK IS THE LOCKER, NOT THE END USER.
///
///   `CLHooks.beforeSwap` invokes the hook with `msg.sender` of the `CLPoolManager.swap` call,
///   which is whoever locked the Vault - i.e. the router. Every swap routed through a shared
///   router arrives with the SAME `sender`. A per-wallet buy cap keyed on `sender` would therefore
///   be consumed by the first buyer on behalf of everybody, and `hookData` cannot be trusted to
///   name the real buyer because anyone may bypass the router and lock the Vault directly with
///   arbitrary `hookData`.
///
///   Consequence: NO identity-based protection is implementable at this layer. There are no
///   per-wallet caps, no allowlists, and no "one buy per address" rules in this hook, because
///   none of them could be enforced honestly.
///
/// ------------------------------- WHAT IT PREVENTS -------------------------------
///  * Free front-running of a launch. Buying in block 0 of the window costs `initialFeeBips`.
///    A sniper cannot escape this with fresh wallets, contracts, or private orderflow, because
///    the tax is a function of the block number and the pool, not of the buyer.
///  * Trading before the launch opens. `beforeSwap` reverts for every swap before `startBlock`,
///    so liquidity can be seeded and the pool initialized without anyone being able to buy first.
///  * A single oversized market buy during the window, if `maxBuyPerTx` is configured.
///  * A launch owner spiking the fee mid-launch. Configuration is frozen from `startBlock` on.
///  * Silent misconfiguration: a non-dynamic-fee pool is rejected at `beforeInitialize`, because
///    core discards a `beforeSwap` fee on a static-fee pool without reverting.
///
/// ----------------------------- WHAT IT DOES NOT PREVENT -----------------------------
///  * Sybil accumulation. Splitting a buy across N wallets or N transactions in the same block is
///    NOT prevented and cannot be. `maxBuyPerTx` bounds one transaction, nothing more.
///  * A sniper who is simply willing to pay the tax. The tax is a price, not a prohibition.
///  * Accumulation via a route that does not touch this pool (another pool, an OTC deal, a CEX).
///  * Anything about the token itself: transfer restrictions, mint authority, LP-token custody,
///    or a rug pull by the token deployer. This hook only governs swaps against ONE pool.
///  * Sells. `maxBuyPerTx` is one-directional by design; the decaying fee applies to both
///    directions, so early sells are taxed too, but there is no separate sell limit.
///  * A launch owner who never opens trading. `startBlock` may be pushed back repeatedly while it
///    is still in the future. Liquidity operations are NOT hooked, so LPs can always withdraw.
/// #####################################################################################
contract LaunchGuardHook is BaseCLHook {
    using LPFeeLibrary for uint24;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice The pool key does not name this contract as its hook
    error HookMismatch(address declared);

    /// @notice The pool key names a different pool manager than this hook serves
    error PoolManagerMismatch(address declared);

    /// @notice A fee returned from `beforeSwap` is silently ignored on a static-fee pool, so a
    /// launch on such a pool would provide no protection at all. Reject it at initialization.
    error PoolMustUseDynamicFee(uint24 fee);

    /// @notice No launch has been registered for this pool
    error LaunchNotConfigured(PoolId poolId);

    /// @notice Caller is not the registered launch owner of this pool
    error NotLaunchOwner(PoolId poolId, address caller);

    /// @notice Configuration is frozen from `startBlock` onwards
    error LaunchAlreadyStarted(PoolId poolId, uint256 startBlock);

    /// @notice A swap was attempted before the launch opened
    error TradingNotOpen(PoolId poolId, uint256 startBlock, uint256 currentBlock);

    /// @notice `startBlock` is in the past or unreasonably far in the future
    error InvalidStartBlock(uint256 startBlock, uint256 currentBlock);

    /// @notice `decayBlocks` is zero or above `MAX_DECAY_BLOCKS`
    error InvalidDecayBlocks(uint32 decayBlocks);

    /// @notice The fee schedule is not a decay, or exceeds the caps this hook enforces
    error InvalidFeeSchedule(uint24 initialFeeBips, uint24 finalFeeBips);

    /// @notice A buy exceeded the configured per-transaction cap
    error BuyExceedsMaxPerTx(uint256 amountIn, uint128 maxBuyPerTx);

    /// @notice An exact-output buy was attempted while a per-transaction cap is active.
    /// @dev `beforeSwap` cannot know the input amount of an exact-output swap, so the cap cannot
    /// be enforced on one. Allowing it would be a one-line bypass of the cap, so it is rejected
    /// for the duration of the launch window instead.
    error ExactOutputBuyBlockedDuringLaunch();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted the first time an address registers a launch for a pool id
    event LaunchClaimed(PoolId indexed poolId, address indexed owner);

    /// @notice Emitted on every accepted configuration write (including the first)
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

    /// @notice Emitted once, on the first swap at or after `startBlock`
    event LaunchStarted(PoolId indexed poolId, uint256 blockNumber);

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Fees are in hundredths of a bip, matching core: 1_000_000 == 100%.
    uint24 public constant FEE_DENOMINATOR = LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE;

    /// @notice Hard cap on the opening tax. Core would accept up to 100%, which is confiscation;
    /// this hook refuses to let a launch owner configure that.
    uint24 public constant MAX_INITIAL_FEE = 500_000; // 50%

    /// @notice Hard cap on the fee that remains once the window has elapsed. Bounds how bad a
    /// permanently hostile configuration can be, since config is immutable after `startBlock`.
    uint24 public constant MAX_FINAL_FEE = 100_000; // 10%

    /// @notice Hard cap on the decay window, so a "launch tax" cannot be a permanent tax.
    uint32 public constant MAX_DECAY_BLOCKS = 1_000_000;

    /// @notice Hard cap on how far ahead `startBlock` may be set in any single write.
    uint48 public constant MAX_START_DELAY = 1_000_000;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @param owner The launch owner. `address(0)` means the pool id has never been claimed.
    /// @param startBlock First block at which swaps are permitted.
    /// @param decayBlocks Length of the decay window, in blocks, starting at `startBlock`.
    /// @param enabled When false the hook applies no gate and no tax; it simply overrides the fee
    ///        with `finalFeeBips`. The override is still required: a dynamic-fee pool's stored LP
    ///        fee is 0 at initialization, so a hook that returns no override makes the pool free.
    /// @param initialFeeBips Fee at `startBlock`.
    /// @param finalFeeBips Fee at and after `startBlock + decayBlocks`.
    /// @param maxBuyPerTx Per-transaction cap on the INPUT amount of a buy, denominated in the
    ///        quote currency (the currency that is not the launch token). 0 disables the cap.
    /// @param launchTokenIsCurrency0 Which side of the pool is the token being launched. Only used
    ///        to decide which swap direction is a "buy" for `maxBuyPerTx`.
    /// @param launched Set on the first swap at or after `startBlock`, so `LaunchStarted` fires once.
    struct Launch {
        // ---- slot 0: 160 + 48 + 32 + 8 = 248 bits ----
        address owner;
        uint48 startBlock;
        uint32 decayBlocks;
        bool enabled;
        // ---- slot 1: 24 + 24 + 128 + 8 + 8 = 192 bits ----
        uint24 initialFeeBips;
        uint24 finalFeeBips;
        uint128 maxBuyPerTx;
        bool launchTokenIsCurrency0;
        bool launched;
    }

    /// @notice Caller-supplied configuration. Mirrors `Launch` minus the fields the hook owns.
    struct LaunchConfig {
        uint48 startBlock;
        uint32 decayBlocks;
        uint24 initialFeeBips;
        uint24 finalFeeBips;
        uint128 maxBuyPerTx;
        bool launchTokenIsCurrency0;
        bool enabled;
    }

    /// @notice Launch state per pool id
    mapping(PoolId poolId => Launch) internal _launches;

    constructor(ICLPoolManager _poolManager) BaseCLHook(_poolManager) {}

    /// @inheritdoc IHooks
    /// @dev `beforeInitialize` rejects static-fee pools; `beforeSwap` gates trading and returns the
    /// decayed fee. No returns-delta permission is needed: `CLHooks.beforeSwap` parses the returned
    /// fee unconditionally and only consults `HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET` for the delta.
    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    /*//////////////////////////////////////////////////////////////
                             CONFIGURATION

        ACCESS-CONTROL MODEL
        --------------------
        A PoolKey is not owned by anybody: anyone may build a key naming this hook. So ownership
        cannot be derived from the key, and it cannot be derived from a callback's `sender` either
        (see the contract-level note). It is therefore established by explicit first-claim:

          1. The launcher calls `configureLaunch(key, cfg)`. If the pool id is unclaimed, the
             caller becomes its permanent launch owner.
          2. `beforeInitialize` REFUSES to let the pool be created unless a claim already exists.
             There is consequently no such thing as an initialized-but-unclaimed pool on this hook.
          3. Further writes require `msg.sender == owner` AND `block.number < startBlock`. Once the
             launch opens, the configuration is immutable forever - a launch owner cannot raise the
             fee on buyers who have already committed.

        Ownership is deliberately non-transferable and non-renounceable: after `startBlock` the
        owner has no powers at all, so there is nothing to transfer and nothing to renounce.
    //////////////////////////////////////////////////////////////*/

    /// @notice Register or update the launch parameters for `key`'s pool.
    /// @dev First caller for a given pool id claims it. Reverts after the launch has opened.
    function configureLaunch(PoolKey calldata key, LaunchConfig calldata cfg) external {
        if (address(key.hooks) != address(this)) revert HookMismatch(address(key.hooks));
        if (address(key.poolManager) != address(poolManager)) {
            revert PoolManagerMismatch(address(key.poolManager));
        }
        // Enforced here as well as in `beforeInitialize` so a launcher cannot burn gas building a
        // configuration for a pool that can never be initialized.
        if (!key.fee.isDynamicLPFee()) revert PoolMustUseDynamicFee(key.fee);

        PoolId poolId = key.toId();
        Launch storage l = _launches[poolId];

        address owner = l.owner;
        if (owner == address(0)) {
            l.owner = msg.sender;
            owner = msg.sender;
            emit LaunchClaimed(poolId, msg.sender);
        } else {
            if (msg.sender != owner) revert NotLaunchOwner(poolId, msg.sender);
            // Config is frozen from the moment the CURRENT schedule opens trading.
            uint256 currentStart = l.startBlock;
            if (block.number >= currentStart) revert LaunchAlreadyStarted(poolId, currentStart);
        }

        _validateConfig(cfg);

        l.startBlock = cfg.startBlock;
        l.decayBlocks = cfg.decayBlocks;
        l.enabled = cfg.enabled;
        l.initialFeeBips = cfg.initialFeeBips;
        l.finalFeeBips = cfg.finalFeeBips;
        l.maxBuyPerTx = cfg.maxBuyPerTx;
        l.launchTokenIsCurrency0 = cfg.launchTokenIsCurrency0;

        emit LaunchConfigured(
            poolId,
            owner,
            cfg.startBlock,
            cfg.decayBlocks,
            cfg.initialFeeBips,
            cfg.finalFeeBips,
            cfg.maxBuyPerTx,
            cfg.launchTokenIsCurrency0,
            cfg.enabled
        );
    }

    /// @dev All bounds that keep a hostile launch owner inside a survivable envelope.
    function _validateConfig(LaunchConfig calldata cfg) internal view {
        // `startBlock` in the past would mean the config is born frozen, and (worse) would let an
        // owner open trading retroactively at whatever fee suits them. Require it to be now-or-later.
        if (cfg.startBlock < block.number || uint256(cfg.startBlock) > block.number + MAX_START_DELAY) {
            revert InvalidStartBlock(cfg.startBlock, block.number);
        }
        if (cfg.decayBlocks == 0 || cfg.decayBlocks > MAX_DECAY_BLOCKS) {
            revert InvalidDecayBlocks(cfg.decayBlocks);
        }
        // Must be a decay, and must stay inside this hook's caps (which are stricter than core's).
        if (
            cfg.initialFeeBips < cfg.finalFeeBips || cfg.initialFeeBips > MAX_INITIAL_FEE
                || cfg.finalFeeBips > MAX_FINAL_FEE
        ) {
            revert InvalidFeeSchedule(cfg.initialFeeBips, cfg.finalFeeBips);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Full launch record for a pool id
    function getLaunch(PoolId poolId) external view returns (Launch memory) {
        return _launches[poolId];
    }

    /// @notice Launch owner of a pool id, or `address(0)` if unclaimed
    function launchOwner(PoolId poolId) external view returns (address) {
        return _launches[poolId].owner;
    }

    /// @notice The LP fee (without the override flag) that a swap in `blockNumber` would pay.
    /// @dev Reverts for an unconfigured pool. Returns `finalFeeBips` when the launch is disabled,
    /// and for blocks before `startBlock` returns `initialFeeBips` - though such a swap would in
    /// fact revert, so treat that value as "the fee at the open".
    function feeAt(PoolId poolId, uint256 blockNumber) public view returns (uint24) {
        Launch storage l = _launches[poolId];
        if (l.owner == address(0)) revert LaunchNotConfigured(poolId);
        if (!l.enabled) return l.finalFeeBips;
        if (blockNumber < l.startBlock) return l.initialFeeBips;
        return _decayedFee(l.initialFeeBips, l.finalFeeBips, blockNumber - l.startBlock, l.decayBlocks);
    }

    /// @notice The LP fee (without the override flag) a swap would pay in the current block
    function currentFee(PoolId poolId) external view returns (uint24) {
        return feeAt(poolId, block.number);
    }

    /*//////////////////////////////////////////////////////////////
                              DECAY MATHS
    //////////////////////////////////////////////////////////////*/

    /// @notice Linear decay from `initialFee` at `elapsed == 0` to `finalFee` at
    /// `elapsed >= decayBlocks`.
    ///
    /// @dev Rounding: the SUBTRACTED discount is floored, so the fee rounds UP - toward the LPs
    /// and away from the sniper. That is the safe direction for a protection mechanism.
    ///
    /// Boundaries:
    ///   elapsed == 0              -> exactly `initialFee`
    ///   elapsed == decayBlocks-1  -> the last taxed block, strictly above `finalFee` whenever the
    ///                                spread is at least `decayBlocks` (otherwise flooring may
    ///                                have already reached `finalFee`, which is fine)
    ///   elapsed == decayBlocks    -> exactly `finalFee`; the window is half-open [start, start+n)
    ///   elapsed >  decayBlocks    -> `finalFee`
    ///
    /// Range: `finalFee <= result <= initialFee` for every input, so the value can never exceed
    /// `MAX_INITIAL_FEE` and therefore never exceeds what core accepts (1_000_000).
    ///
    /// Monotonicity: `spread * elapsed / decayBlocks` is non-decreasing in `elapsed` (integer
    /// division by a fixed positive denominator preserves order), so the result is non-increasing.
    ///
    /// Overflow: `spread <= 500_000` and `elapsed < decayBlocks <= 1_000_000` in the multiplying
    /// branch, so the product is at most 5e11 - nowhere near uint256.
    function _decayedFee(uint24 initialFee, uint24 finalFee, uint256 elapsed, uint256 decayBlocks)
        internal
        pure
        returns (uint24)
    {
        if (elapsed >= decayBlocks) return finalFee;
        unchecked {
            // `initialFee >= finalFee` is enforced at configuration time.
            uint256 spread = uint256(initialFee) - uint256(finalFee);
            uint256 discount = (spread * elapsed) / decayBlocks;
            // discount <= spread, so this cannot underflow and the result stays in [finalFee, initialFee],
            // both of which are uint24 - the cast cannot truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            return uint24(uint256(initialFee) - discount);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 HOOKS
    //////////////////////////////////////////////////////////////*/

    /// @dev Rejects a pool that cannot actually enforce the launch tax, and a pool nobody has
    /// claimed. `sender` is intentionally ignored: it is the caller of `initialize`, which may be
    /// any periphery contract, and is not a trustworthy identity.
    function _beforeInitialize(address, /* sender */ PoolKey calldata key, uint160 /* sqrtPriceX96 */ )
        internal
        view
        virtual
        override
        returns (bytes4)
    {
        // On a static-fee pool `CLHooks.beforeSwap` DISCARDS the fee this hook returns, with no
        // revert and no event. Deploying launch protection there would be protection in name only.
        if (!key.fee.isDynamicLPFee()) revert PoolMustUseDynamicFee(key.fee);

        PoolId poolId = key.toId();
        if (_launches[poolId].owner == address(0)) revert LaunchNotConfigured(poolId);

        return ICLHooks.beforeInitialize.selector;
    }

    /// @dev `sender` is the Vault locker (the router), NOT the buyer. It is unused here, and that
    /// is the whole reason this hook taxes time rather than identity.
    function _beforeSwap(
        address, /* sender */
        PoolKey calldata key,
        ICLPoolManager.SwapParams calldata params,
        bytes calldata /* hookData */
    ) internal virtual override returns (bytes4, BeforeSwapDelta, uint24) {
        PoolId poolId = key.toId();
        Launch storage l = _launches[poolId];

        // Unreachable via a pool this hook gated at initialization, but a pool could in principle
        // have been created by a manager this hook does not serve; fail closed either way.
        if (l.owner == address(0)) revert LaunchNotConfigured(poolId);

        // A dynamic-fee pool stores an LP fee of 0 and this hook never calls `updateDynamicLPFee`,
        // so EVERY path must return an override. Returning 0 here would make the pool fee-free.
        if (!l.enabled) {
            return (
                ICLHooks.beforeSwap.selector,
                BeforeSwapDeltaLibrary.ZERO_DELTA,
                l.finalFeeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG
            );
        }

        uint256 startBlock = l.startBlock;
        if (block.number < startBlock) revert TradingNotOpen(poolId, startBlock, block.number);

        if (!l.launched) {
            l.launched = true;
            emit LaunchStarted(poolId, block.number);
        }

        uint256 elapsed;
        unchecked {
            elapsed = block.number - startBlock;
        }
        uint256 decayBlocks = l.decayBlocks;

        uint128 maxBuyPerTx = l.maxBuyPerTx;
        if (maxBuyPerTx != 0 && elapsed < decayBlocks) {
            _enforceMaxBuy(params, l.launchTokenIsCurrency0, maxBuyPerTx);
        }

        uint24 fee = _decayedFee(l.initialFeeBips, l.finalFeeBips, elapsed, decayBlocks);
        return (ICLHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev Per-TRANSACTION cap. It bounds one swap. It does not and cannot bound a wallet, an
    /// entity, or a block: splitting a buy into several transactions defeats it entirely, and no
    /// hook at this layer can tell those transactions apart (see the contract-level note).
    ///
    /// `amountSpecified < 0` is exact input in core's convention. For a buy, the input currency is
    /// the quote currency, which is the denomination of `maxBuyPerTx`. For an exact-OUTPUT buy the
    /// input amount is not known until the swap has been computed, so the cap cannot be checked;
    /// such a buy is rejected while the cap is live rather than waved through.
    function _enforceMaxBuy(
        ICLPoolManager.SwapParams calldata params,
        bool launchTokenIsCurrency0,
        uint128 maxBuyPerTx
    ) internal pure {
        // zeroForOne sells currency0 and receives currency1.
        bool isBuy = launchTokenIsCurrency0 ? !params.zeroForOne : params.zeroForOne;
        if (!isBuy) return;

        if (params.amountSpecified > 0) revert ExactOutputBuyBlockedDuringLaunch();

        // `amountSpecified` is strictly negative here, and the negation is CHECKED: the single
        // pathological input, `type(int256).min`, reverts rather than wrapping to a huge positive.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn > maxBuyPerTx) revert BuyExceedsMaxPerTx(amountIn, maxBuyPerTx);
    }
}

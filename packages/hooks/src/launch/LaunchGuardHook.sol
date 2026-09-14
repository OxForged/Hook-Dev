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
import {Currency} from "infinity-core/src/types/Currency.sol";

/// @notice The one read this hook makes of a launch-token factory: who created a token.
/// @dev Declared here rather than imported from `packages/launchpad`, which depends on this package.
/// `LaunchTokenFactory.deployerOf` satisfies it; a non-factory address returns zero.
interface ILaunchTokenOrigin {
    function deployerOf(address token) external view returns (address);
}

/// @title LaunchGuardHook
/// @notice Anti-sniper launch protection for LatchProtocol CL pools: a decaying "sniper tax".
///
/// @dev ############################ WHAT THIS HOOK ACTUALLY DOES ############################
///
/// It prices early buying instead of trying to identify early buyers. For `decaySeconds` seconds
/// after `startTime` the LP fee is overridden with a value that decays linearly from
/// `initialFeeBips` down to `finalFeeBips`. A sniper who buys in the first second pays the full
/// launch tax; a normal buyer who arrives after the window pays the normal fee. The proceeds are
/// ordinary LP fees, so they accrue to the pool's liquidity providers, not to this contract.
///
/// EVERY DURATION HERE IS `block.timestamp` SECONDS. It used to be `block.number` blocks, sized
/// through a per-chain `blockTimeCentis`, and on Arbitrum Nitro (Robinhood Chain, 4663) the EVM's
/// `block.number` is Ethereum's ~12 s block while the RPC reports ~0.1 s L2 blocks - the live
/// block-based deployment was built for the wrong one and runs every window ~120x long. There is
/// no block-time argument left to get wrong. See "CLOCK" below for what timestamps do and do not
/// promise on a sequencer chain.
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
///  * Free front-running of a launch. Buying in the first second of the window costs
///    `initialFeeBips`. A sniper cannot escape this with fresh wallets, contracts, or private
///    orderflow, because the tax is a function of time and the pool, not of the buyer.
///  * Trading before the launch opens. `beforeSwap` reverts for every swap before `startTime`,
///    so liquidity can be seeded and the pool initialized without anyone being able to buy first.
///  * A single oversized market buy during the window, if `maxBuyPerTx` is configured.
///  * A launch owner spiking the fee mid-launch. Configuration is frozen from `startTime` on.
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
///  * A launch owner who never opens trading. `startTime` may be pushed back repeatedly while it
///    is still in the future. Liquidity operations are NOT hooked, so LPs can always withdraw.
///  * A MALICIOUS SEQUENCER. See "CLOCK".
///
/// ---------------------------------- CLOCK ----------------------------------
/// `block.timestamp` is set by the block producer. On Ethereum L1 it is fixed per slot. On
/// Arbitrum Nitro the sequencer sets it from its own clock, and the protocol bounds it: never
/// below the previous block's timestamp, never more than 24 h behind real time, never more than
/// 1 h ahead (docs.arbitrum.io, "Block numbers and time"). Force-included transactions take the
/// parent-chain timestamp of their delayed-inbox message, so nobody but the sequencer can push
/// the clock forward. Consequences:
///  * An HONEST sequencer's clock is NTP-synchronised and whole-second; `MIN_DECAY_SECONDS`
///    bounds the relative error that leaves. A lagging or stalled clock only LENGTHENS a window.
///  * A MALICIOUS sequencer can jump the clock up to one hour forward in one block and so erase
///    any window shorter than that. No floor compatible with minutes-long presets defends
///    against it, and that same sequencer already orders every transaction. This is a trust
///    assumption on the chain operator, stated rather than hidden.
///  * A sequencer outage that spans the window erases it for everyone equally: the first block
///    after recovery carries the recovered timestamp. The old block-number clock had the same
///    property, since Nitro's `block.number` also resyncs to the parent chain on recovery.
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

    /// @notice Configuration is frozen from `startTime` onwards
    error LaunchAlreadyStarted(PoolId poolId, uint256 startTime);

    /// @notice A swap was attempted before the launch opened
    error TradingNotOpen(PoolId poolId, uint256 startTime, uint256 currentTime);

    /// @notice `startTime` is in the past or more than `MAX_START_DELAY_SECONDS` ahead
    error InvalidStartTime(uint256 startTime, uint256 currentTime);

    /// @notice `decaySeconds` is outside [`MIN_DECAY_SECONDS`, `MAX_DECAY_SECONDS`]
    error InvalidDecaySeconds(uint32 decaySeconds);

    /// @notice The fee schedule is not a decay, or exceeds the caps this hook enforces
    error InvalidFeeSchedule(uint24 initialFeeBips, uint24 finalFeeBips);

    /// @notice A buy exceeded the configured per-transaction cap
    error BuyExceedsMaxPerTx(uint256 amountIn, uint128 maxBuyPerTx);

    /// @notice A first claim named a non-native currency with no code. Launch pools are refused on
    /// addresses that do not hold a token YET, which is exactly what a front-runner squatting a
    /// predictable token address would claim.
    error CurrencyHasNoCode(address currency);

    /// @notice `token` was created by the launch-token factory, so only its creator (or the claimer
    /// that creator appointed) may claim a launch pool for it.
    error LaunchPoolReserved(address token, address creator, address caller);

    /// @notice Only a factory token's creator may appoint its launch claimer.
    error NotTokenCreator(address token, address caller);

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

    /// @notice A factory token's creator appointed (or, with `address(0)`, revoked) a launch claimer.
    event LaunchClaimerSet(address indexed token, address indexed creator, address indexed claimer);

    /// @notice Emitted on every accepted configuration write (including the first)
    event LaunchConfigured(
        PoolId indexed poolId,
        address indexed owner,
        uint40 startTime,
        uint32 decaySeconds,
        uint24 initialFeeBips,
        uint24 finalFeeBips,
        uint128 maxBuyPerTx,
        bool launchTokenIsCurrency0,
        bool enabled
    );

    /// @notice Emitted once, on the first swap at or after `startTime`
    /// @param timestamp `block.timestamp` of that swap.
    event LaunchStarted(PoolId indexed poolId, uint256 timestamp);

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Fees are in hundredths of a bip, matching core: 1_000_000 == 100%.
    uint24 public constant FEE_DENOMINATOR = LPFeeLibrary.ONE_HUNDRED_PERCENT_FEE;

    /// @notice Hard cap on the opening tax. Core would accept up to 100%, which is confiscation;
    /// this hook refuses to let a launch owner configure that.
    uint24 public constant MAX_INITIAL_FEE = 500_000; // 50%

    /// @notice Hard cap on the fee that remains once the window has elapsed. Bounds how bad a
    /// permanently hostile configuration can be, since config is immutable after `startTime`.
    uint24 public constant MAX_FINAL_FEE = 100_000; // 10%

    /// @notice ERC-6372 clock mode. Every duration and every stored time in this contract is
    /// `block.timestamp`. Off-chain readers call this to tell this hook apart from the retired
    /// block-numbered one, which does not implement it and reverts.
    string public constant CLOCK_MODE = "mode=timestamp";

    /// @notice Shortest decay window a launch may configure.
    ///
    /// @dev WHY 60 SECONDS, with the numbers:
    ///  * Resolution. `block.timestamp` is whole seconds, so a window of W seconds is exact to
    ///    within 1/W: at 60 s that is under 1.7%. (Many ~0.1 s Nitro blocks share one second.)
    ///  * Honest skew. The sequencer stamps blocks from an NTP-synchronised clock, monotonically,
    ///    so ordinary operation drifts by well under a second. A failover to a replica whose clock
    ///    is ahead by d seconds jumps the chain forward by d once; 60 s absorbs d = 6 s at 10%.
    ///  * Better than what it replaces. Nitro's `block.number` resyncs to Ethereum only "every 13
    ///    to 15 seconds (occasionally longer)" per Arbitrum's docs, so a block-denominated window
    ///    was never finer than ~15 s. 60 s of timestamp is at least four times that granularity.
    ///  * Below the owner's presets. The shortest (`Stealth`) is 120 s, so the floor constrains
    ///    only hand-built custom launches that would otherwise be measurement noise.
    ///  * NOT a defence against a malicious sequencer, which can move the clock up to 3 600 s
    ///    forward. No floor under an hour is; see the contract-level "CLOCK" note.
    uint32 public constant MIN_DECAY_SECONDS = 60;

    /// @notice Hard cap on the decay window, so a "launch tax" cannot be a permanent tax.
    uint32 public constant MAX_DECAY_SECONDS = 30 days;

    /// @notice Hard cap on how far ahead `startTime` may be set in any single write.
    /// @dev No FLOOR on the start delay, deliberately. A forward clock skew can only open trading
    /// earlier than scheduled; it cannot make trading open before the pool exists, and a start of
    /// "now" is already a legitimate launch that opens at the full `initialFeeBips`.
    uint40 public constant MAX_START_DELAY_SECONDS = 30 days;

    /// @notice The design envelope the two caps above must sit inside, kept as published
    /// constants so a reader can check the relationship without trusting this comment:
    /// `MIN_LAUNCH_WINDOW_SECONDS <= MAX_DECAY_SECONDS` (a three-day fair launch is possible) and
    /// `MAX_START_DELAY_SECONDS + MAX_DECAY_SECONDS <= MAX_LAUNCH_WINDOW_SECONDS` (the tax is gone
    /// within 60 days of any configuration write, well inside 180). Both asserted in tests.
    uint256 public constant MIN_LAUNCH_WINDOW_SECONDS = 3 days;

    /// @notice See `MIN_LAUNCH_WINDOW_SECONDS`. Past this a "launch tax" stops being a launch tax.
    uint256 public constant MAX_LAUNCH_WINDOW_SECONDS = 180 days;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @param owner The launch owner. `address(0)` means the pool id has never been claimed.
    /// @param startTime First `block.timestamp` at which swaps are permitted.
    /// @param decaySeconds Length of the decay window, in seconds, starting at `startTime`.
    /// @param enabled When false the hook applies no gate and no tax; it simply overrides the fee
    ///        with `finalFeeBips`. The override is still required: a dynamic-fee pool's stored LP
    ///        fee is 0 at initialization, so a hook that returns no override makes the pool free.
    /// @param initialFeeBips Fee at `startTime`.
    /// @param finalFeeBips Fee at and after `startTime + decaySeconds`.
    /// @param maxBuyPerTx Per-transaction cap on the INPUT amount of a buy, denominated in the
    ///        quote currency (the currency that is not the launch token). 0 disables the cap.
    /// @param launchTokenIsCurrency0 Which side of the pool is the token being launched. Only used
    ///        to decide which swap direction is a "buy" for `maxBuyPerTx`.
    /// @param launched Set on the first swap at or after `startTime`, so `LaunchStarted` fires once.
    struct Launch {
        // ---- slot 0: 160 + 40 + 32 + 8 = 240 bits ----
        address owner;
        uint40 startTime;
        uint32 decaySeconds;
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
        uint40 startTime;
        uint32 decaySeconds;
        uint24 initialFeeBips;
        uint24 finalFeeBips;
        uint128 maxBuyPerTx;
        bool launchTokenIsCurrency0;
        bool enabled;
    }

    /// @notice Launch state per pool id
    mapping(PoolId poolId => Launch) internal _launches;

    /**
     * ############ POOL-ID RESERVATION (owner decision, 2026-09-14) ############
     *
     * A launch pool's id is predictable before its transaction lands: the kit derives the token
     * address from a CREATE2 salt and the key from that. First-claim ownership then let a
     * front-runner `configureLaunch` the pool first, so the kit's own claim reverted
     * `NotLaunchOwner` and the launch failed. Nothing was stolen; the launch was denied.
     *
     * Two rules close it, and neither needs an owner or a kit address in this contract:
     *
     *   1. NO CLAIM ON AN ADDRESS WITHOUT CODE. A kit that creates the token and the pool in one
     *      transaction (Kit v2) is unsquattable: before that transaction the token has no code, so
     *      nobody can claim; inside it, the kit claims first.
     *   2. A `LAUNCH_TOKEN_FACTORY` TOKEN BELONGS TO ITS CREATOR. For a token the factory made, the
     *      first claim must come from `deployerOf(token)` - the kit, for a kit-created token - or
     *      from the one claimer that creator appointed (`setLaunchClaimer`), which is how a person
     *      who minted a token directly hands the launch to a kit. This closes the window between a
     *      token existing and its launch.
     *
     * Why the factory's creator record rather than "the registered kit": it cannot be squatted, it
     * has no setter, it works for every tenant kit on the shared factory rather than one, and it
     * avoids a hook-kit circular deployment. Pools on any other token behave exactly as before,
     * except that rule 1 refuses a currency with no code, which cannot be a working pool anyway.
     */
    ILaunchTokenOrigin public immutable LAUNCH_TOKEN_FACTORY;

    /// @notice The claimer a factory token's creator appointed. Zero means only the creator.
    mapping(address token => address claimer) public launchClaimerOf;

    /// @param _poolManager The CL singleton this hook serves, forever.
    /// @param launchTokenFactory The `LaunchTokenFactory` whose tokens get reserved launch pools, or
    /// `address(0)` for a deployment with no factory (rule 1 still applies). Every duration bound is a
    /// constant in seconds, so no chain can be configured with the wrong clock.
    constructor(ICLPoolManager _poolManager, ILaunchTokenOrigin launchTokenFactory) BaseCLHook(_poolManager) {
        LAUNCH_TOKEN_FACTORY = launchTokenFactory;
    }

    /// @notice Appoint (or revoke with `address(0)`) the one address besides you that may claim a
    /// launch pool for a factory token you created. Typically the kit you will launch through.
    function setLaunchClaimer(address token, address claimer) external {
        if (
            address(LAUNCH_TOKEN_FACTORY) == address(0) || msg.sender == address(0)
                || LAUNCH_TOKEN_FACTORY.deployerOf(token) != msg.sender
        ) revert NotTokenCreator(token, msg.sender);
        launchClaimerOf[token] = claimer;
        emit LaunchClaimerSet(token, msg.sender, claimer);
    }

    /// @inheritdoc IHooks
    /// @dev `beforeInitialize` rejects static-fee pools; `beforeSwap` gates trading and returns the
    /// decayed fee. No returns-delta permission is needed: `CLHooks.beforeSwap` parses the returned
    /// fee unconditionally and only consults `HOOKS_BEFORE_SWAP_RETURNS_DELTA_OFFSET` for the delta.
    function getHooksRegistrationBitmap() public pure override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_SWAP;
    }

    /// @notice ERC-6372 clock: the current `block.timestamp`, the unit every time here is in.
    function clock() external view returns (uint48) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint48(block.timestamp);
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
          3. Further writes require `msg.sender == owner` AND `block.timestamp < startTime`. Once
             the launch opens, the configuration is immutable forever - a launch owner cannot raise
             the fee on buyers who have already committed.

        Ownership is deliberately non-transferable and non-renounceable: after `startTime` the
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
            _requireMayClaim(key.currency0);
            _requireMayClaim(key.currency1);
            l.owner = msg.sender;
            owner = msg.sender;
            emit LaunchClaimed(poolId, msg.sender);
        } else {
            if (msg.sender != owner) revert NotLaunchOwner(poolId, msg.sender);
            // Config is frozen from the moment the CURRENT schedule opens trading.
            uint256 currentStart = l.startTime;
            if (block.timestamp >= currentStart) revert LaunchAlreadyStarted(poolId, currentStart);
        }

        _validateConfig(cfg);

        l.startTime = cfg.startTime;
        l.decaySeconds = cfg.decaySeconds;
        l.enabled = cfg.enabled;
        l.initialFeeBips = cfg.initialFeeBips;
        l.finalFeeBips = cfg.finalFeeBips;
        l.maxBuyPerTx = cfg.maxBuyPerTx;
        l.launchTokenIsCurrency0 = cfg.launchTokenIsCurrency0;

        emit LaunchConfigured(
            poolId,
            owner,
            cfg.startTime,
            cfg.decaySeconds,
            cfg.initialFeeBips,
            cfg.finalFeeBips,
            cfg.maxBuyPerTx,
            cfg.launchTokenIsCurrency0,
            cfg.enabled
        );
    }

    /// @dev The two reservation rules, for one currency of a first claim. See `LAUNCH_TOKEN_FACTORY`.
    function _requireMayClaim(Currency currency) internal view {
        address token = Currency.unwrap(currency);
        if (token == address(0)) return; // the native asset
        if (token.code.length == 0) revert CurrencyHasNoCode(token);
        if (address(LAUNCH_TOKEN_FACTORY) == address(0)) return;
        address creator = LAUNCH_TOKEN_FACTORY.deployerOf(token);
        if (creator == address(0) || msg.sender == creator) return;
        address claimer = launchClaimerOf[token];
        if (claimer != address(0) && msg.sender == claimer) return;
        revert LaunchPoolReserved(token, creator, msg.sender);
    }

    /// @dev All bounds that keep a hostile launch owner inside a survivable envelope.
    function _validateConfig(LaunchConfig calldata cfg) internal view {
        // `startTime` in the past would mean the config is born frozen, and (worse) would let an
        // owner open trading retroactively at whatever fee suits them. Require it to be now-or-later.
        if (cfg.startTime < block.timestamp || uint256(cfg.startTime) > block.timestamp + MAX_START_DELAY_SECONDS) {
            revert InvalidStartTime(cfg.startTime, block.timestamp);
        }
        // Applied whether or not the launch is `enabled`: a disabled config may be re-enabled by a
        // later write, and a single invariant is harder to get wrong than a conditional one.
        if (cfg.decaySeconds < MIN_DECAY_SECONDS || cfg.decaySeconds > MAX_DECAY_SECONDS) {
            revert InvalidDecaySeconds(cfg.decaySeconds);
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

    /// @notice The LP fee (without the override flag) that a swap at `timestamp` would pay.
    /// @dev Reverts for an unconfigured pool. Returns `finalFeeBips` when the launch is disabled,
    /// and for times before `startTime` returns `initialFeeBips` - though such a swap would in
    /// fact revert, so treat that value as "the fee at the open".
    function feeAt(PoolId poolId, uint256 timestamp) public view returns (uint24) {
        Launch storage l = _launches[poolId];
        if (l.owner == address(0)) revert LaunchNotConfigured(poolId);
        if (!l.enabled) return l.finalFeeBips;
        if (timestamp < l.startTime) return l.initialFeeBips;
        return _decayedFee(l.initialFeeBips, l.finalFeeBips, timestamp - l.startTime, l.decaySeconds);
    }

    /// @notice The LP fee (without the override flag) a swap would pay now
    function currentFee(PoolId poolId) external view returns (uint24) {
        return feeAt(poolId, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                              DECAY MATHS
    //////////////////////////////////////////////////////////////*/

    /// @notice Linear decay from `initialFee` at `elapsed == 0` to `finalFee` at
    /// `elapsed >= decaySeconds`.
    ///
    /// @dev Rounding: the SUBTRACTED discount is floored, so the fee rounds UP - toward the LPs
    /// and away from the sniper. That is the safe direction for a protection mechanism.
    ///
    /// Boundaries:
    ///   elapsed == 0                -> exactly `initialFee`
    ///   elapsed == decaySeconds-1   -> the last taxed second, strictly above `finalFee` whenever
    ///                                  the spread is at least `decaySeconds` (otherwise flooring
    ///                                  may have already reached `finalFee`, which is fine)
    ///   elapsed == decaySeconds     -> exactly `finalFee`; the window is half-open [start, start+n)
    ///   elapsed >  decaySeconds     -> `finalFee`
    ///
    /// Range: `finalFee <= result <= initialFee` for every input, so the value can never exceed
    /// `MAX_INITIAL_FEE` and therefore never exceeds what core accepts (1_000_000).
    ///
    /// Monotonicity: `spread * elapsed / decaySeconds` is non-decreasing in `elapsed` (integer
    /// division by a fixed positive denominator preserves order), so the result is non-increasing.
    ///
    /// Overflow: `spread <= 500_000` and `elapsed < decaySeconds <= 2_592_000` in the multiplying
    /// branch, so the product is below 1.3e12 - nowhere near uint256.
    function _decayedFee(uint24 initialFee, uint24 finalFee, uint256 elapsed, uint256 decaySeconds)
        internal
        pure
        returns (uint24)
    {
        if (elapsed >= decaySeconds) return finalFee;
        unchecked {
            // `initialFee >= finalFee` is enforced at configuration time.
            uint256 spread = uint256(initialFee) - uint256(finalFee);
            uint256 discount = (spread * elapsed) / decaySeconds;
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

        uint256 startTime = l.startTime;
        if (block.timestamp < startTime) revert TradingNotOpen(poolId, startTime, block.timestamp);

        if (!l.launched) {
            l.launched = true;
            emit LaunchStarted(poolId, block.timestamp);
        }

        uint256 elapsed;
        unchecked {
            elapsed = block.timestamp - startTime;
        }
        uint256 decaySeconds = l.decaySeconds;

        uint128 maxBuyPerTx = l.maxBuyPerTx;
        if (maxBuyPerTx != 0 && elapsed < decaySeconds) {
            _enforceMaxBuy(params, l.launchTokenIsCurrency0, maxBuyPerTx);
        }

        uint24 fee = _decayedFee(l.initialFeeBips, l.finalFeeBips, elapsed, decaySeconds);
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

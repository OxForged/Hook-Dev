// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {BaseBinHook} from "../base/BaseBinHook.sol";
import {IBinHooks} from "infinity-core/src/pool-bin/interfaces/IBinHooks.sol";
import {IBinPoolManager} from "infinity-core/src/pool-bin/interfaces/IBinPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "infinity-core/src/libraries/LPFeeLibrary.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "infinity-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";

/// @dev Imported, not redeclared: one declaration of the factory read for both launch guards, so a
/// kit that imports both hooks never sees two `ILaunchTokenOrigin`s. Interface only - no CL bytecode.
import {ILaunchTokenOrigin} from "./LaunchGuardHook.sol";

/// @title BinLaunchGuardHook
/// @notice Anti-sniper launch protection for LatchProtocol BIN (liquidity-book) pools: a decaying
/// "sniper tax", ported from `LaunchGuardHook` (the CL version) with the three changes that the bin
/// pool type forces. Read those first — two of them change what the hook can promise.
///
/// @dev ############################ WHAT THIS HOOK ACTUALLY DOES ############################
///
/// It prices early buying instead of trying to identify early buyers. For `decaySeconds` seconds
/// after `startTime` the LP fee is overridden with a value that decays linearly from
/// `initialFeeBips` down to `finalFeeBips`. A sniper who buys in the first second pays the full
/// launch tax; a normal buyer who arrives after the window pays the normal fee. The proceeds are
/// ordinary LP fees, so they accrue to the pool's liquidity providers, not to this contract.
///
/// EVERY DURATION HERE IS `block.timestamp` SECONDS, exactly as in `LaunchGuardHook`, whose
/// contract-level "CLOCK" note applies here word for word: honest sequencer skew is bounded by
/// `MIN_DECAY_SECONDS`; a malicious Nitro sequencer can move the clock up to one hour forward and
/// is a trust assumption, not something a floor can defend.
///
/// This design is deliberate, and it follows from a hard constraint of the singleton architecture:
///
///   THE `sender` ARGUMENT OF EVERY HOOK CALLBACK IS THE LOCKER, NOT THE END USER.
///
///   `BinHooks.beforeSwap` invokes the hook with `msg.sender` of the `BinPoolManager.swap` call,
///   which is whoever locked the Vault - i.e. the router. (`BinHooks.beforeMint` does the same for
///   `BinPoolManager.mint`.) Every swap routed through a shared router arrives with the SAME
///   `sender`. A per-wallet buy cap keyed on `sender` would therefore be consumed by the first
///   buyer on behalf of everybody, and `hookData` cannot be trusted to name the real buyer because
///   anyone may bypass the router and lock the Vault directly with arbitrary `hookData`.
///
///   Consequence: NO identity-based protection is implementable at this layer. There are no
///   per-wallet caps, no allowlists, and no "one buy per address" rules in this hook, because
///   none of them could be enforced honestly. It is also why mints are TAXED rather than GATED
///   (see the mint note below): the hook cannot tell the launcher seeding liquidity apart from a
///   sniper extracting it, so it must charge both rather than block both.
///
/// ------------------------------ BIN-SPECIFIC: THE MINT HOLE ------------------------------
///
/// This is the difference that matters, and it has no CL analogue. On a bin pool, adding liquidity
/// to the ACTIVE bin at a ratio different from the bin's own ratio performs an IMPLICIT SWAP inside
/// core, charged at the "composition fee" (`BinHelper.getCompositionFeesAmount`). Mint lopsided,
/// then burn, and you have swapped.
///
/// The composition fee is taken from the pool's stored LP fee unless `beforeMint` returns an
/// override — and a dynamic-fee pool's stored LP fee is 0 until somebody calls
/// `updateDynamicLPFee`. So a bin launch hook that only registered `beforeSwap` (the exact shape of
/// the CL hook) would leave a FEE-FREE swap route straight through the launch tax, usable even
/// before `startTime`, when ordinary swaps revert.
///
/// This hook therefore registers `beforeMint` as well and returns the SAME decayed fee there. That
/// closes the free route. What it cannot do is close the route entirely: see "WHAT IT DOES NOT
/// PREVENT".
///
/// ---------------------------- BIN-SPECIFIC: THE 10% CEILING ----------------------------
///
/// Core validates a bin LP fee against `LPFeeLibrary.TEN_PERCENT_FEE` (100_000), not
/// `ONE_HUNDRED_PERCENT_FEE`. The CL hook opens at up to 50%; this one cannot exceed 10% however it
/// is configured, because core would revert the swap with `LPFeeTooLarge`. A bin launch tax is
/// consequently a WEAKER deterrent than a CL one by construction, and that is not a parameter this
/// hook (or any bin hook) can tune around.
///
/// ------------------------------- WHAT IT PREVENTS -------------------------------
///  * Free front-running of a launch. Buying in the first second of the window costs
///    `initialFeeBips` (up to 10%). A sniper cannot escape this with fresh wallets, contracts, or
///    private orderflow, because the tax is a function of time and the pool, not of the buyer.
///  * Trading before the launch opens. `beforeSwap` reverts for every swap before `startTime`.
///  * Escaping the tax through the mint/burn composition-swap route: it is charged the same
///    decayed fee, at every moment, including before `startTime`.
///  * A single oversized market buy during the window, if `maxBuyPerTx` is configured.
///  * A launch owner spiking the fee mid-launch. Configuration is frozen from `startTime` on.
///  * Silent misconfiguration: a non-dynamic-fee pool is rejected at `beforeInitialize`, because
///    core discards a `beforeSwap`/`beforeMint` fee on a static-fee pool without reverting.
///
/// ----------------------------- WHAT IT DOES NOT PREVENT -----------------------------
///  * Sybil accumulation. Splitting a buy across N wallets or N transactions in the same block is
///    NOT prevented and cannot be. `maxBuyPerTx` bounds one swap transaction, nothing more.
///  * A sniper who is simply willing to pay the tax — and on bin that tax is capped at 10%, so the
///    price of sniping is materially lower than on a CL launch.
///  * ACQUISITION BEFORE `startTime` VIA MINT+BURN. Swaps revert before the launch opens, but
///    mints must not (nobody could seed the pool otherwise, because `sender` is the router and the
///    launcher cannot be recognised). A sniper can therefore mint lopsided into the active bin and
///    burn, acquiring the launch token before trading opens, at the cost of `initialFeeBips`
///    charged as a composition fee. The tax is paid; the gate is bypassed. This is the residual
///    risk of the bin port and it is asserted in the test suite rather than papered over.
///  * `maxBuyPerTx` on the mint route. `beforeMint` receives `liquidityConfigs` and a packed
///    `amountIn`, not the size of the implicit swap that core will compute from the bin's live
///    reserves. The cap is a swap-path control only.
///  * Accumulation via a route that does not touch this pool (another pool, an OTC deal, a CEX).
///  * Anything about the token itself: transfer restrictions, mint authority, LP-token custody,
///    or a rug pull by the token deployer. This hook only governs ONE pool.
///  * Sells. `maxBuyPerTx` is one-directional by design; the decaying fee applies to both
///    directions, so early sells are taxed too, but there is no separate sell limit.
///  * A launch owner who never opens trading. `startTime` may be pushed back repeatedly while it
///    is still in the future. Burns are NOT hooked, so LPs can always withdraw.
///  * A MALICIOUS SEQUENCER. See `LaunchGuardHook`'s "CLOCK" note.
/// #####################################################################################
contract BinLaunchGuardHook is BaseBinHook {
    using LPFeeLibrary for uint24;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice The pool key does not name this contract as its hook
    error HookMismatch(address declared);

    /// @notice The pool key names a different pool manager than this hook serves
    error PoolManagerMismatch(address declared);

    /// @notice A fee returned from `beforeSwap`/`beforeMint` is silently ignored on a static-fee
    /// pool, so a launch on such a pool would provide no protection at all. Reject it at
    /// initialization.
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

    /// @notice An exact-output buy was attempted while a per-transaction cap is active.
    /// @dev `beforeSwap` cannot know the input amount of an exact-output swap, so the cap cannot
    /// be enforced on one. Allowing it would be a one-line bypass of the cap, so it is rejected
    /// for the duration of the launch window instead.
    error ExactOutputBuyBlockedDuringLaunch();

    /// @notice A first claim named a non-native currency with no code. Same rule, same selector as
    /// `LaunchGuardHook.CurrencyHasNoCode`.
    error CurrencyHasNoCode(address currency);

    /// @notice `token` was created by the launch-token factory, so only its creator (or the claimer
    /// that creator appointed) may claim a launch pool for it. Same selector as the CL hook's.
    error LaunchPoolReserved(address token, address creator, address caller);

    /// @notice Only a factory token's creator may appoint its launch claimer.
    error NotTokenCreator(address token, address caller);

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

    /// @notice Hard cap on the opening tax. This is core's own bin ceiling (10%), NOT a policy
    /// choice: `BinPool.swap` and `BinPool.mint` both call
    /// `removeOverrideAndValidate(LPFeeLibrary.TEN_PERCENT_FEE)`, so anything above this would
    /// revert the swap rather than tax it. The CL hook's 50% opening tax is unreachable here.
    uint24 public constant MAX_INITIAL_FEE = LPFeeLibrary.TEN_PERCENT_FEE; // 10%, core's bin max

    /// @notice Hard cap on the fee that remains once the window has elapsed. Bounds how bad a
    /// permanently hostile configuration can be, since config is immutable after `startTime`.
    uint24 public constant MAX_FINAL_FEE = 20_000; // 2%

    /// @notice ERC-6372 clock mode. Every duration and stored time here is `block.timestamp`.
    string public constant CLOCK_MODE = "mode=timestamp";

    /// @notice Shortest decay window a launch may configure. Same value and same justification as
    /// `LaunchGuardHook.MIN_DECAY_SECONDS`: whole-second resolution under 1.7%, honest sequencer
    /// skew absorbed, at least 4x finer than Nitro's ~15 s `block.number` resync. NOT a defence
    /// against a malicious sequencer's one-hour forward bound.
    uint32 public constant MIN_DECAY_SECONDS = 60;

    /// @notice Hard cap on the decay window, so a "launch tax" cannot be a permanent tax.
    uint32 public constant MAX_DECAY_SECONDS = 30 days;

    /// @notice Hard cap on how far ahead `startTime` may be set in any single write. No floor, for
    /// the reason given on `LaunchGuardHook.MAX_START_DELAY_SECONDS`.
    uint40 public constant MAX_START_DELAY_SECONDS = 30 days;

    /// @notice Design envelope: `MAX_DECAY_SECONDS >= MIN_LAUNCH_WINDOW_SECONDS` and
    /// `MAX_START_DELAY_SECONDS + MAX_DECAY_SECONDS <= MAX_LAUNCH_WINDOW_SECONDS`. Asserted in tests.
    uint256 public constant MIN_LAUNCH_WINDOW_SECONDS = 3 days;

    /// @notice See `MIN_LAUNCH_WINDOW_SECONDS`.
    uint256 public constant MAX_LAUNCH_WINDOW_SECONDS = 180 days;

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @param owner The launch owner. `address(0)` means the pool id has never been claimed.
    /// @param startTime First `block.timestamp` at which swaps are permitted.
    /// @param decaySeconds Length of the decay window, in seconds, starting at `startTime`.
    /// @param enabled When false the hook applies no gate and no tax; it simply overrides the fee
    ///        with `finalFeeBips`. The override is still required: a dynamic-fee pool's stored LP
    ///        fee is 0 at initialization, so a hook that returns no override makes the pool free -
    ///        free to swap through AND free to composition-swap through via mint.
    /// @param initialFeeBips Fee at `startTime`.
    /// @param finalFeeBips Fee at and after `startTime + decaySeconds`.
    /// @param maxBuyPerTx Per-transaction cap on the INPUT amount of a buy SWAP, denominated in the
    ///        quote currency (the currency that is not the launch token). 0 disables the cap. It
    ///        does not apply to the mint route.
    /// @param launchTokenIsCurrency0 Which side of the pool is the token being launched. Only used
    ///        to decide which swap direction is a "buy" for `maxBuyPerTx`. On bin, currency0 is X
    ///        and currency1 is Y, so `swapForY == true` is the analogue of CL's `zeroForOne`.
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
     * ############ POOL-ID RESERVATION (ported from LaunchGuardHook, 2026-09-14) ############
     *
     * Closes the open LOW: the CL guard reserved launch pools and this one did not, so a Bin launch
     * pool with a predictable id (kit v2 derives the token address from a CREATE2 salt, and the key
     * from that) could be claimed by a front-runner, making the kit's own `configureLaunch` revert
     * `NotLaunchOwner`. Denial, not theft - but a launchpad whose launches can be denied at will is
     * not one anybody can ship on.
     *
     * The same two rules as `LaunchGuardHook`, word for word, so a reviewer checks one argument:
     *
     *   1. NO CLAIM ON AN ADDRESS WITHOUT CODE. Before the kit's transaction the token does not exist,
     *      so nobody can claim; inside it, the kit claims first.
     *   2. A `LAUNCH_TOKEN_FACTORY` TOKEN BELONGS TO ITS CREATOR. The first claim must come from
     *      `deployerOf(token)` - the kit, for a kit-created token - or from the one claimer that
     *      creator appointed with `setLaunchClaimer`.
     *
     * No owner and no kit address is added: the factory's creator record has no setter and serves
     * every tenant kit on the shared factory. Pools on non-factory tokens behave as before, except
     * that rule 1 refuses a currency with no code, which could never be a working pool anyway.
     */
    ILaunchTokenOrigin public immutable LAUNCH_TOKEN_FACTORY;

    /// @notice The claimer a factory token's creator appointed. Zero means only the creator.
    mapping(address token => address claimer) public launchClaimerOf;

    /// @param _poolManager The Bin singleton this hook serves, forever.
    /// @param launchTokenFactory The `LaunchTokenFactory` whose tokens get reserved launch pools, or
    /// `address(0)` for a deployment with no factory (rule 1 still applies). Every duration bound is a
    /// constant in seconds, so no chain can be configured with the wrong clock.
    constructor(IBinPoolManager _poolManager, ILaunchTokenOrigin launchTokenFactory) BaseBinHook(_poolManager) {
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
    /// decayed fee; `beforeMint` returns the same fee so the composition-swap route is taxed
    /// identically. No returns-delta permission is needed: `BinHooks` parses the returned fee
    /// unconditionally on a dynamic-fee pool and only consults the returns-delta offsets for deltas.
    ///
    /// bit 0 (beforeInitialize) | bit 2 (beforeMint) | bit 6 (beforeSwap) == 69.
    function getHooksRegistrationBitmap() public pure virtual override returns (uint16) {
        return BEFORE_INITIALIZE | BEFORE_MINT | BEFORE_SWAP;
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

    /// @dev The two reservation rules, for one currency of a first claim. Identical to
    /// `LaunchGuardHook._requireMayClaim`; see `LAUNCH_TOKEN_FACTORY`.
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
        // Applied whether or not the launch is `enabled`, as in `LaunchGuardHook`.
        if (cfg.decaySeconds < MIN_DECAY_SECONDS || cfg.decaySeconds > MAX_DECAY_SECONDS) {
            revert InvalidDecaySeconds(cfg.decaySeconds);
        }
        // Must be a decay, and must stay inside this hook's caps. `MAX_INITIAL_FEE` IS core's bin
        // ceiling, so a schedule that passes here can never make core revert with `LPFeeTooLarge`.
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
    /// and for times before `startTime` returns `initialFeeBips` - a SWAP at such a time would
    /// revert, but a MINT would not, and it is charged exactly this value as its composition fee.
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
    /// `MAX_INITIAL_FEE` and therefore never exceeds what core accepts for a bin pool (100_000).
    ///
    /// Monotonicity: `spread * elapsed / decaySeconds` is non-decreasing in `elapsed` (integer
    /// division by a fixed positive denominator preserves order), so the result is non-increasing.
    ///
    /// Overflow: `spread <= 100_000` and `elapsed < decaySeconds <= 2_592_000` in the multiplying
    /// branch, so the product is below 2.6e11 - nowhere near uint256.
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

    /// @dev The fee this hook hands to core, override flag attached. Shared by `beforeSwap` and
    /// `beforeMint` so the explicit-swap and composition-swap routes can never diverge.
    function _feeFor(Launch storage l) internal view returns (uint24) {
        if (!l.enabled) return l.finalFeeBips | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        uint256 startTime = l.startTime;
        uint256 elapsed = block.timestamp < startTime ? 0 : block.timestamp - startTime;
        return _decayedFee(l.initialFeeBips, l.finalFeeBips, elapsed, l.decaySeconds) | LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    /*//////////////////////////////////////////////////////////////
                                 HOOKS
    //////////////////////////////////////////////////////////////*/

    /// @dev Rejects a pool that cannot actually enforce the launch tax, and a pool nobody has
    /// claimed. `sender` is intentionally ignored: it is the caller of `initialize`, which may be
    /// any periphery contract, and is not a trustworthy identity. `activeId` is likewise ignored -
    /// the starting price is the launcher's business, not the guard's.
    function _beforeInitialize(
        address,
        /* sender */
        PoolKey calldata key,
        uint24 /* activeId */
    )
        internal
        view
        virtual
        override
        returns (bytes4)
    {
        // On a static-fee pool `BinHooks.beforeSwap` and `BinHooks.beforeMint` DISCARD the fee this
        // hook returns, with no revert and no event. Launch protection there is protection in name
        // only.
        if (!key.fee.isDynamicLPFee()) revert PoolMustUseDynamicFee(key.fee);

        PoolId poolId = key.toId();
        if (_launches[poolId].owner == address(0)) revert LaunchNotConfigured(poolId);

        return IBinHooks.beforeInitialize.selector;
    }

    /// @dev `sender` is the Vault locker (the router), NOT the buyer. It is unused here, and that
    /// is the whole reason this hook taxes time rather than identity.
    ///
    /// On bin there is no `SwapParams` struct: `swapForY` and `amountSpecified` (int128) arrive
    /// flat. `swapForY == true` sells currency0 (X) for currency1 (Y).
    function _beforeSwap(
        address, /* sender */
        PoolKey calldata key,
        bool swapForY,
        int128 amountSpecified,
        bytes calldata /* hookData */
    )
        internal
        virtual
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();
        Launch storage l = _launches[poolId];

        // Unreachable via a pool this hook gated at initialization, but a pool could in principle
        // have been created by a manager this hook does not serve; fail closed either way.
        if (l.owner == address(0)) revert LaunchNotConfigured(poolId);

        // A dynamic-fee pool stores an LP fee of 0 and this hook never calls `updateDynamicLPFee`,
        // so EVERY path must return an override. Returning 0 here would make the pool fee-free.
        if (!l.enabled) {
            return (IBinHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, _feeFor(l));
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

        uint128 maxBuyPerTx = l.maxBuyPerTx;
        if (maxBuyPerTx != 0 && elapsed < l.decaySeconds) {
            _enforceMaxBuy(swapForY, amountSpecified, l.launchTokenIsCurrency0, maxBuyPerTx);
        }

        return (IBinHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, _feeFor(l));
    }

    /// @dev The bin-only callback, and the reason this hook is not a straight port of the CL one.
    ///
    /// A mint into the ACTIVE bin at a ratio other than the bin's own is an implicit swap, priced
    /// at the composition fee. Without this override that fee would be the pool's stored LP fee,
    /// which is 0 on a dynamic-fee pool - a free swap around the launch tax.
    ///
    /// It deliberately does NOT gate on `startTime`. Reverting here before the launch opens would
    /// make the pool unseedable, because `sender` is the router and the launcher cannot be
    /// distinguished from a sniper. Pre-launch mints are therefore charged `initialFeeBips`, the
    /// maximum rate on the schedule, rather than blocked. See "WHAT IT DOES NOT PREVENT".
    function _beforeMint(
        address, /* sender */
        PoolKey calldata key,
        IBinPoolManager.MintParams calldata, /* params */
        bytes calldata /* hookData */
    )
        internal
        virtual
        override
        returns (bytes4, uint24)
    {
        PoolId poolId = key.toId();
        Launch storage l = _launches[poolId];
        if (l.owner == address(0)) revert LaunchNotConfigured(poolId);

        return (IBinHooks.beforeMint.selector, _feeFor(l));
    }

    /// @dev Per-TRANSACTION cap. It bounds one swap. It does not and cannot bound a wallet, an
    /// entity, or a block: splitting a buy into several transactions defeats it entirely, and no
    /// hook at this layer can tell those transactions apart (see the contract-level note). It also
    /// does not bound the mint route at all.
    ///
    /// `amountSpecified < 0` is exact input in core's convention. For a buy, the input currency is
    /// the quote currency, which is the denomination of `maxBuyPerTx`. For an exact-OUTPUT buy the
    /// input amount is not known until the swap has been computed, so the cap cannot be checked;
    /// such a buy is rejected while the cap is live rather than waved through.
    function _enforceMaxBuy(bool swapForY, int128 amountSpecified, bool launchTokenIsCurrency0, uint128 maxBuyPerTx)
        internal
        pure
    {
        // swapForY sells currency0 (X) and receives currency1 (Y) - the analogue of zeroForOne.
        bool isBuy = launchTokenIsCurrency0 ? !swapForY : swapForY;
        if (!isBuy) return;

        if (amountSpecified > 0) revert ExactOutputBuyBlockedDuringLaunch();

        // `amountSpecified` is strictly negative here (core rejects 0 with `AmountSpecifiedIsZero`
        // before any hook runs), and the negation is CHECKED: the single pathological input,
        // `type(int128).min`, reverts rather than wrapping to a huge positive.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountIn = uint256(uint128(-amountSpecified));
        if (amountIn > maxBuyPerTx) revert BuyExceedsMaxPerTx(amountIn, maxBuyPerTx);
    }
}

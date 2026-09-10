// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

/*//////////////////////////////////////////////////////////////
                        PERMISSION BITS
    Mirrors the offsets in
    infinity-core/src/pool-cl/interfaces/ICLHooks.sol.
    Duplicated as masks (not offsets) because every consumer of
    this registry wants to test them, not shift them.
//////////////////////////////////////////////////////////////*/

uint16 constant PERM_BEFORE_INITIALIZE = uint16(1) << 0;
uint16 constant PERM_AFTER_INITIALIZE = uint16(1) << 1;
uint16 constant PERM_BEFORE_ADD_LIQUIDITY = uint16(1) << 2;
uint16 constant PERM_AFTER_ADD_LIQUIDITY = uint16(1) << 3;
uint16 constant PERM_BEFORE_REMOVE_LIQUIDITY = uint16(1) << 4;
uint16 constant PERM_AFTER_REMOVE_LIQUIDITY = uint16(1) << 5;
uint16 constant PERM_BEFORE_SWAP = uint16(1) << 6;
uint16 constant PERM_AFTER_SWAP = uint16(1) << 7;
uint16 constant PERM_BEFORE_DONATE = uint16(1) << 8;
uint16 constant PERM_AFTER_DONATE = uint16(1) << 9;
uint16 constant PERM_BEFORE_SWAP_RETURNS_DELTA = uint16(1) << 10;
uint16 constant PERM_AFTER_SWAP_RETURNS_DELTA = uint16(1) << 11;
uint16 constant PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA = uint16(1) << 12;
uint16 constant PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA = uint16(1) << 13;

/// @dev Bits 14-15 carry no meaning in ICLHooks and must be zero.
uint16 constant PERM_RESERVED_BITS = uint16(0xC000);

/// @dev Every bit that ICLHooks actually assigns.
uint16 constant PERM_ALL_ASSIGNED = uint16(0x3FFF);

/// @dev Any of these lets the hook return a balance delta, i.e. move value that would otherwise
/// belong to the swapper or the liquidity provider into the hook.
uint16 constant PERM_RETURNS_DELTA_MASK = PERM_BEFORE_SWAP_RETURNS_DELTA | PERM_AFTER_SWAP_RETURNS_DELTA
    | PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA | PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA;

/// @dev The two bits that let a hook take a cut of every single swap in its pool.
uint16 constant PERM_SWAP_CUT_MASK = PERM_BEFORE_SWAP_RETURNS_DELTA | PERM_AFTER_SWAP_RETURNS_DELTA;

/// @dev `before*` callbacks run before the action is applied and may revert, which blocks it.
uint16 constant PERM_BEFORE_MASK = PERM_BEFORE_INITIALIZE | PERM_BEFORE_ADD_LIQUIDITY | PERM_BEFORE_REMOVE_LIQUIDITY
    | PERM_BEFORE_SWAP | PERM_BEFORE_DONATE;

/*//////////////////////////////////////////////////////////////
                              TYPES
//////////////////////////////////////////////////////////////*/

/// @notice The verification ladder. Strictly ordered; higher means a curator has attested more.
/// @dev Unverified is the value of every freshly registered hook and of every hook whose
/// metadata or on-chain code has changed since it was last attested. It is never possible for a
/// submitter to move themselves up this ladder.
enum Verification {
    /// @dev Listed, permissions read from chain, nobody has vouched for anything else.
    Unverified,
    /// @dev A curator has confirmed the published source matches the deployed bytecode.
    SourceVerified,
    /// @dev A curator has confirmed a real audit report covers this exact deployment.
    Audited
}

/// @notice Whether the registry still recommends this listing. Independent of `Verification`.
enum Listing {
    Active,
    /// @dev Superseded or abandoned. Not an accusation. Verification is retained.
    Deprecated,
    /// @dev Known to harm users. Verification is force-reset to Unverified when this is set.
    Malicious
}

/// @notice Capability class derived purely from the on-chain bitmap. No human judgement.
enum RiskClass {
    /// @dev Only `after*` callbacks that cannot return a delta. The hook observes; it cannot
    /// take value and it cannot block an action (an `after*` revert does block, but the action
    /// has already been priced, so it degrades to a denial of service on the whole pool rather
    /// than a selective one — still bad, still not value extraction).
    Passive,
    /// @dev Holds at least one `before*` callback. Can refuse a swap, a deposit, an
    /// initialization. Trading in the pool exists at the hook's discretion.
    Restrictive,
    /// @dev Holds a returns-delta bit (can take a cut of swaps or of liquidity movements) or
    /// `beforeRemoveLiquidity` (can permanently refuse withdrawals). This class can take or
    /// trap user funds. Nothing here should ever be presented without a prominent warning.
    ValueExtracting
}

/// @notice Human-supplied listing data. Never trusted for capability claims.
struct LatchMetadata {
    string name;
    string description;
    /// @dev Source repository / verification URI.
    string sourceURI;
    /// @dev Audit report URI. Must be non-empty before a curator may set `Audited`.
    string auditURI;
    /// @dev Chain ids the submitter claims this hook is deployed on. Informational.
    uint256[] chainIds;
}

/// @notice The full registry record for one hook address.
/// @dev Field order is chosen for storage packing, not for prose:
/// slot 0 = submitter|submittedAt|permissions|verification|listing (exactly 32 bytes),
/// slot 1 = steward|updatedAt|permissionsValid|permissionsReadable, slot 2 = codehash.
struct LatchRecord {
    /// @dev Who called `register`. Immutable, historical. Non-zero iff the hook is registered.
    address submitter;
    uint64 submittedAt;
    /// @dev Read from `getHooksRegistrationBitmap()` on the hook itself. Never submitter-supplied.
    uint16 permissions;
    Verification verification;
    Listing listing;
    /// @dev Who may currently edit the metadata. Transferable.
    address steward;
    uint64 updatedAt;
    /// @dev False if a refresh observed reserved bits or an unmet returns-delta dependency.
    bool permissionsValid;
    /// @dev False if a refresh could no longer read the bitmap at all. `permissions` then holds
    /// the last value that was successfully read, and must be treated as stale.
    bool permissionsReadable;
    /// @dev `hook.codehash` at the time permissions were last read.
    bytes32 codehash;
    LatchMetadata metadata;
}

/// @notice `permissions` expanded into named booleans, for UIs and off-chain consumers.
struct DecodedPermissions {
    bool beforeInitialize;
    bool afterInitialize;
    bool beforeAddLiquidity;
    bool afterAddLiquidity;
    bool beforeRemoveLiquidity;
    bool afterRemoveLiquidity;
    bool beforeSwap;
    bool afterSwap;
    bool beforeDonate;
    bool afterDonate;
    bool beforeSwapReturnsDelta;
    bool afterSwapReturnsDelta;
    bool afterAddLiquidityReturnsDelta;
    bool afterRemoveLiquidityReturnsDelta;
}

/// @title ILatchRegistry
/// @notice The on-chain hook registry for LatchProtocol.
interface ILatchRegistry {
    /*//////////////////////////////////////////////////////////////
                                EVENTS
        Between LatchRegistered, LatchMetadataUpdated,
        LatchVerificationChanged, LatchListingChanged,
        LatchStewardTransferred and LatchPermissionsRefreshed, the
        entire registry state is reconstructible from logs alone.
        LatchMetadataUpdated is emitted at registration too, so an
        indexer never has to read storage to learn the initial
        metadata.
    //////////////////////////////////////////////////////////////*/

    event LatchRegistered(
        address indexed hook,
        address indexed submitter,
        uint16 permissions,
        RiskClass riskClass,
        bytes32 codehash,
        uint64 timestamp
    );

    event LatchMetadataUpdated(
        address indexed hook,
        address indexed updater,
        string name,
        string description,
        string sourceURI,
        string auditURI,
        uint256[] chainIds
    );

    event LatchVerificationChanged(
        address indexed hook, address indexed actor, Verification previous, Verification current, string note
    );

    event LatchListingChanged(address indexed hook, address indexed actor, Listing previous, Listing current, string reason);

    event LatchStewardTransferred(address indexed hook, address indexed previous, address indexed current);

    event LatchPermissionsRefreshed(
        address indexed hook,
        address indexed actor,
        uint16 previousPermissions,
        uint16 currentPermissions,
        bytes32 previousCodehash,
        bytes32 currentCodehash,
        bool readable,
        bool valid
    );

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error LatchAlreadyRegistered(address hook);
    error LatchNotRegistered(address hook);
    error LatchHasNoCode(address hook);

    /// @notice `getHooksRegistrationBitmap()` reverted, ran out of the probe gas budget, or did
    /// not return exactly one clean 32-byte uint16.
    error PermissionsUnreadable(address hook);

    /// @notice The hook declares bits 14 or 15, which ICLHooks does not assign.
    error ReservedBitsSet(uint16 permissions);

    /// @notice A returns-delta bit was declared without the base callback that returns it.
    error PermissionDependencyMissing(uint16 permissions);

    /// @notice Not enough gas remains to give the probe its full budget, so an "unreadable"
    /// verdict would say more about the caller than about the hook.
    error InsufficientGasForProbe(uint256 available, uint256 required);

    error NotSteward(address hook, address caller);
    error NotCuratorOrGuardian(address caller);

    /// @notice A guardian tried to make a listing less cautious. Guardians only ever add warnings.
    error GuardianCannotRelist(Listing current, Listing attempted);

    /// @notice Verification cannot be raised while the hook is flagged malicious. Clear the flag
    /// first, in its own transaction, so the rehabilitation is separately visible in the logs.
    error LatchFlaggedMalicious(address hook);

    /// @notice Verification cannot be raised on a hook whose on-chain permissions are unreadable
    /// or invalid. You cannot attest to what you cannot read.
    error PermissionsNotAttestable(address hook);

    error AuditURIRequired();
    error SourceURIRequired();
    error PermissionsUnchanged(address hook);
    error StringTooLong(uint256 length, uint256 maximum);
    error EmptyName();
    error TooManyChains(uint256 count, uint256 maximum);
    error InvalidRange();
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Verification, Listing} from "./ILatchRegistry.sol";

/*//////////////////////////////////////////////////////////////
                              TYPES

    `Verification` and `Listing` are IMPORTED from ILatchRegistry
    rather than redefined. A launchpad moves up the same ladder a
    Latch does and gets flagged by the same guardians under the
    same rule, so it must be the same enum: two enums with the
    same members are two chances for a front end to map one of
    them wrongly, and the one it maps wrongly is the one that
    says "Malicious".
//////////////////////////////////////////////////////////////*/

/// @notice How a launch record came to name a launchpad, and therefore how much its attribution is
/// worth.
///
/// @dev This is the launch index's analogue of `PermissionSource`, and it exists for the same
/// reason: a marketplace row that says "launched via Acme" is a trust signal, and a trust signal
/// nobody can check is worse than none.
///
/// The invariant that makes it readable, enforced everywhere a record is written:
///
///     record.launchpad != address(0)   <=>   record.origin == LaunchpadAttested
///
/// There is deliberately no such thing as a *claimed* launchpad. A caller that names a launchpad
/// which does not vouch for the pool is REVERTED, not downgraded, so the field can never hold an
/// unproven name for a careless UI to render. If you want a record with no attribution, pass
/// `address(0)` and say so.
enum LaunchOrigin {
    /// @dev The pool is proven — it was read back out of a Vault-registered pool manager — but
    /// nothing corroborates who launched it. `creator` is whatever the registrant typed and must
    /// be rendered as such, or not rendered at all. This is the correct and expected state for a
    /// launch indexed by a third party.
    Claimed,
    /// @dev The named launchpad's own code named this pool: either it registered the launch itself
    /// (`msg.sender`) or it answered `ILatchLaunchOrigin.launchOriginOf`. `creator` came from the
    /// launchpad in both cases. Nobody can forge this onto a launchpad from outside.
    LaunchpadAttested
}

/// @notice How a launchpad's own listing came to exist.
enum LaunchpadOrigin {
    /// @dev Somebody else listed this launchpad. Useful — an ecosystem index should be able to
    /// cover launchpads that predate this registry — but the metadata, including the display name
    /// a marketplace prints, is a stranger's account of somebody else's contract.
    Claimed,
    /// @dev The launchpad contract itself called `registerLaunchpad` or `claimLaunchpad`. The
    /// display name is then the contract's own, and a curator badge is only ever granted here.
    SelfRegistered
}

/// @notice Human-supplied listing data for one launch. Never trusted for anything checkable.
/// @dev There is no `name` field, on purpose. A launch's name and symbol are read off the token
/// contract — see `LaunchRecord.tokenName`. Accepting them here would let a registrant list a pool
/// of some worthless token under the symbol `USDC`, which is the single most common launchpad scam
/// and exactly the laundering an official-looking index must not perform.
struct LaunchMetadata {
    string description;
    string websiteURI;
    /// @dev Rendered by front ends. Treat as attacker-controlled: proxy it, never hotlink it, and
    /// never let it sit next to a verified badge it did not earn.
    string iconURI;
    /// @dev One canonical social link. A list would be an unbounded write paid for by everyone who
    /// ever reads the record.
    string socialURI;
}

/// @notice Human-supplied listing data for one launchpad.
struct LaunchpadMetadata {
    /// @dev The display name a marketplace prints as "launched via …". Impersonation is possible
    /// and is handled the way the Latch registry handles it: curators reassign, guardians flag,
    /// and no badge is ever granted to a record the launchpad itself did not acknowledge.
    string name;
    string description;
    /// @dev Source repository. Required before any verification level above `Unverified`.
    string sourceURI;
    /// @dev Audit report. Required before `Audited`. A badge with nothing to click through to is
    /// theatre, and the same rule already governs `LatchRegistry.setVerification`.
    string auditURI;
    string websiteURI;
}

/// @notice One launch: a token, the pool it trades in, and who — if anybody provable — made it.
///
/// @dev Field order is chosen for storage packing, not for prose:
///   slot 0 = token|registeredAt|hookPermissions|origin|listing            (exactly 32 bytes)
///   slot 1 = quote|updatedAt|fee|tokenInfoReadable                        (exactly 32 bytes)
///   slot 2 = poolManager|originAttestedAt|tokenDecimals|tokenIsCurrency0  (30 bytes)
///   slot 3 = hooks|registeredAtBlock                                      (28 bytes)
///   slot 4 = launchpad, slot 5 = creator, slot 6 = steward, slot 7 = registrant,
///   slot 8 = tokenCodehash, then the two dynamic strings and the metadata struct.
struct LaunchRecord {
    /*----------------------- proven against the pool manager -----------------------*/
    /// @dev The launched token. Verified to be one of the pool's two currencies; WHICH of the two
    /// is the caller's assertion, so on a `Claimed` record a UI should render the pair, not a side.
    address token;
    /// @dev When the record was written. NOT when the pool opened — see the note on
    /// `launchedAtIsNotKnowable` in `LatchLaunchRegistry`. Never label this "launched".
    uint64 registeredAt;
    /// @dev The bitmap this pool enforces, taken from its immutable `parameters`. Unforgeable: the
    /// hook presented it to core at `initialize` or the pool would not exist.
    uint16 hookPermissions;
    LaunchOrigin origin;
    Listing listing;
    /// @dev The pool's other currency. `address(0)` is the chain's native asset.
    address quote;
    uint64 updatedAt;
    uint24 fee;
    /// @dev False when the token would not answer `name()`/`symbol()` to a bounded probe. The
    /// stored strings are then the last values that were readable, or empty.
    bool tokenInfoReadable;
    address poolManager;
    /// @dev When the launchpad attribution was proven. Zero on a `Claimed` record.
    uint64 originAttestedAt;
    uint8 tokenDecimals;
    bool tokenIsCurrency0;
    /// @dev The pool's hook. `address(0)` for a plain pool; a launch does not have to use a Latch.
    address hooks;
    /// @dev Block height of registration, so an indexer can bound its own log scan without a
    /// binary search over timestamps.
    uint64 registeredAtBlock;
    /*------------------------------- provenance --------------------------------*/
    /// @dev Non-zero IF AND ONLY IF `origin == LaunchpadAttested`.
    address launchpad;
    /// @dev Launchpad-attested when `origin == LaunchpadAttested`; otherwise the registrant's
    /// unverified assertion, and possibly zero.
    address creator;
    /// @dev May edit this record's metadata. Transferable; reassignable by a curator.
    address steward;
    /// @dev Who called `registerLaunch`. Immutable, historical. Non-zero iff the record exists.
    address registrant;
    /*----------------------------- read off the token -----------------------------*/
    /// @dev `token.codehash` when the token info was last read. A change means the token's code
    /// moved — a proxy upgrade — and the name and symbol next to it may no longer be current.
    bytes32 tokenCodehash;
    string tokenName;
    string tokenSymbol;
    LaunchMetadata metadata;
}

/// @notice One launchpad — a tenant of the shared core, in white-label terms.
struct LaunchpadRecord {
    address registrant;
    uint64 registeredAt;
    LaunchpadOrigin origin;
    Verification verification;
    Listing listing;
    address steward;
    uint64 updatedAt;
    /// @dev `launchpad.codehash` at registration or at the last refresh. A change demotes the
    /// verification, because a badge attests to a deployment and stops meaning anything the moment
    /// that deployment is swapped out behind a proxy.
    bytes32 codehash;
    LaunchpadMetadata metadata;
}

/// @title ILatchLaunchRegistry
/// @notice Events, errors and types for the shared index of launches.
interface ILatchLaunchRegistry {
    /*//////////////////////////////////////////////////////////////
                             LAUNCH EVENTS

        Between these and the launchpad events below, the whole
        index is reconstructible from logs alone. Metadata and
        token info are emitted at registration too, so an indexer
        never has to read storage to learn the initial state.
    //////////////////////////////////////////////////////////////*/

    /// @param launchpad Indexed so a marketplace can subscribe to one tenant's launches. Zero on a
    /// `Claimed` record, which is itself the useful filter: `launchpad != 0` is exactly the set of
    /// launches whose attribution was proven.
    event LaunchRegistered(
        bytes32 indexed poolId,
        address indexed token,
        address indexed launchpad,
        address poolManager,
        address quote,
        address hooks,
        uint16 hookPermissions,
        uint24 fee,
        bool tokenIsCurrency0,
        address creator,
        address registrant,
        LaunchOrigin origin,
        uint64 timestamp
    );

    event LaunchTokenInfoUpdated(
        bytes32 indexed poolId, string name, string symbol, uint8 decimals, bytes32 codehash, bool readable
    );

    event LaunchMetadataUpdated(
        bytes32 indexed poolId,
        address indexed updater,
        string description,
        string websiteURI,
        string iconURI,
        string socialURI
    );

    event LaunchStewardTransferred(bytes32 indexed poolId, address indexed previous, address indexed current);

    /// @notice A launchpad's own code has vouched for a record that previously had no attribution.
    event LaunchOriginAttested(
        bytes32 indexed poolId, address indexed launchpad, address indexed creator, address attestor
    );

    /// @notice A curator has removed an attribution. The record drops back to `Claimed` and the
    /// launchpad field is cleared; the correct launchpad may then attest again, permissionlessly.
    event LaunchAttributionCleared(
        bytes32 indexed poolId, address indexed previousLaunchpad, address indexed curator, string reason
    );

    event LaunchListingChanged(
        bytes32 indexed poolId, address indexed actor, Listing previous, Listing current, string reason
    );

    /// @notice The pool's hook was pushed into `LatchRegistry` as a pool attestation.
    /// @dev Best-effort and never fatal: `ok` is false when the hook is not listed there, when the
    /// pool was already counted, or when the deployed registry predates `attestFromPool`.
    event HookAttestationForwarded(bytes32 indexed poolId, address indexed hook, bool ok);

    /*//////////////////////////////////////////////////////////////
                            LAUNCHPAD EVENTS
    //////////////////////////////////////////////////////////////*/

    event LaunchpadRegistered(
        address indexed launchpad,
        address indexed registrant,
        address indexed steward,
        LaunchpadOrigin origin,
        bytes32 codehash,
        uint64 timestamp
    );

    event LaunchpadMetadataUpdated(
        address indexed launchpad,
        address indexed updater,
        string name,
        string description,
        string sourceURI,
        string auditURI,
        string websiteURI
    );

    event LaunchpadStewardTransferred(address indexed launchpad, address indexed previous, address indexed current);

    /// @notice A launchpad contract has taken over a listing a stranger created for it.
    event LaunchpadClaimed(address indexed launchpad, address indexed steward);

    event LaunchpadVerificationChanged(
        address indexed launchpad, address indexed actor, Verification previous, Verification current, string note
    );

    event LaunchpadListingChanged(
        address indexed launchpad, address indexed actor, Listing previous, Listing current, string reason
    );

    event LaunchpadCodeRefreshed(address indexed launchpad, bytes32 previous, bytes32 current);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();

    /*------------------------------- launches -------------------------------*/

    error LaunchAlreadyRegistered(bytes32 poolId);
    error LaunchNotRegistered(bytes32 poolId);

    /// @notice The named token is neither of the pool's two currencies, so this pool is not a
    /// venue for it and the record would be a fabrication.
    error TokenNotInPool(bytes32 poolId, address token);

    /// @notice The chain's native asset cannot be the launched token. Only the quote side may be
    /// native, matching `LaunchpadKit`.
    error LaunchTokenCannotBeNative();

    /// @notice The launch token has no code, so it cannot be an ERC-20.
    error LaunchTokenHasNoCode(address token);

    /*------------------------------ provenance ------------------------------*/

    /// @notice A launchpad was named but its own code did not vouch for this pool — it is not the
    /// caller and `launchOriginOf` did not return a creator. The call reverts rather than quietly
    /// recording an unproven attribution. Pass `address(0)` for a launch you cannot attribute.
    error LaunchpadDidNotVouch(address launchpad, bytes32 poolId);

    /// @notice A launchpad must be a contract. An EOA cannot have created a pool through a
    /// launchpad it does not have.
    error LaunchpadHasNoCode(address launchpad);

    /// @notice This record already names a launchpad. Attribution is not a race to be re-run: a
    /// curator must clear the existing one first, in its own transaction, so the change is visible.
    error OriginAlreadyAttested(bytes32 poolId, address launchpad);

    /// @notice There is no attribution on this record to clear.
    error NoAttributionToClear(bytes32 poolId);

    /*------------------------------ launchpads ------------------------------*/

    error LaunchpadAlreadyRegistered(address launchpad);
    error LaunchpadNotRegistered(address launchpad);

    /// @notice A curator tried to badge a listing the launchpad's own contract never acknowledged.
    /// This is the launch index's `AttestationRequired`: a badge on a record a stranger wrote about
    /// somebody else's contract vouches for the stranger's typing, not for the launchpad.
    error LaunchpadNotSelfRegistered(address launchpad);

    /// @notice A curator tried to badge a launchpad that has not produced a single attributed
    /// launch. Verification is a statement about a thing that works; until one launch has been
    /// proven to come from it, there is nothing to have verified.
    error LaunchpadHasNoLaunches(address launchpad);

    /// @notice Verification cannot be raised while the launchpad is flagged malicious. Clear the
    /// flag first, in its own transaction, so the rehabilitation is separately visible in the logs.
    error LaunchpadFlaggedMalicious(address launchpad);

    /// @notice `refreshLaunchpadCode` found nothing to record. Reverts so keepers cannot spam.
    error CodehashUnchanged(address launchpad);

    /*-------------------------------- access --------------------------------*/

    error NotLaunchSteward(bytes32 poolId, address caller);
    error NotLaunchpadSteward(address launchpad, address caller);
    error NotCurator(address caller);
    error NotCuratorOrGuardian(address caller);

    /// @notice A guardian tried to make a listing less cautious. Guardians only ever add warnings.
    error GuardianCannotRelist(Listing current, Listing attempted);

    /*------------------------------- validation ------------------------------*/

    /// @notice Not enough gas remains to give a probe its full budget, so a "did not answer"
    /// verdict would say more about the caller than about the callee.
    error InsufficientGasForProbe(uint256 available, uint256 required);

    error SourceURIRequired();
    error AuditURIRequired();
    error EmptyName();
    error StringTooLong(uint256 length, uint256 maximum);
    error InvalidRange();
}

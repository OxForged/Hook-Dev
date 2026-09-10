// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";

import {
    ILatchHookRegistry,
    HookMetadata,
    HookRecord,
    DecodedPermissions,
    Verification,
    Listing,
    RiskClass,
    PERM_BEFORE_INITIALIZE,
    PERM_AFTER_INITIALIZE,
    PERM_BEFORE_ADD_LIQUIDITY,
    PERM_AFTER_ADD_LIQUIDITY,
    PERM_BEFORE_REMOVE_LIQUIDITY,
    PERM_AFTER_REMOVE_LIQUIDITY,
    PERM_BEFORE_SWAP,
    PERM_AFTER_SWAP,
    PERM_BEFORE_DONATE,
    PERM_AFTER_DONATE,
    PERM_BEFORE_SWAP_RETURNS_DELTA,
    PERM_AFTER_SWAP_RETURNS_DELTA,
    PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA,
    PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA,
    PERM_RESERVED_BITS,
    PERM_RETURNS_DELTA_MASK,
    PERM_SWAP_CUT_MASK,
    PERM_BEFORE_MASK
} from "./ILatchHookRegistry.sol";

/// @title LatchHookRegistry
/// @notice The discovery and safety surface for LatchProtocol hooks.
///
/// @dev ################### WHAT THIS CONTRACT IS ACTUALLY FOR ###################
///
/// A Latch hook can be attached to a pool from any address — permissions live in the pool key and
/// are cross-checked against the hook, so there is no CREATE2 salt mining and therefore no address
/// to read capabilities off. That is a real developer advantage and it moves an entire class of
/// risk off-chain: a user looking at `0xAbCd…` has no way to see, from the address alone, that the
/// hook behind it holds `beforeSwapReturnsDelta` and takes 30 bps of every trade in the pool.
///
/// This registry exists to put that back on-chain, and it is a SAFETY surface before it is a
/// DISCOVERY surface. Three rules follow from that and none of them are negotiable:
///
///   1. PERMISSIONS COME FROM THE HOOK, NEVER FROM THE SUBMITTER. `register` reads
///      `getHooksRegistrationBitmap()` off the hook contract. There is no parameter through which
///      a submitter can declare, suggest or influence what their hook is allowed to do. A registry
///      that took the submitter's word for it would be worse than no registry, because it would
///      launder a lie through an official-looking surface.
///
///   2. NOBODY CAN PROMOTE THEMSELVES. Every hook enters at `Unverified`. Only a curator moves it
///      up the ladder, and any subsequent change to the metadata or to the hook's own code knocks
///      it straight back down. The bait-and-switch — get audited, then repoint `sourceURI` at
///      something else, or upgrade the implementation behind a proxy — is the attack this defends.
///
///   3. LISTING IS FREE AND UNGATED. No fee, no allowlist, no minimum stake. A listing fee taxes
///      exactly the independent developers the marketplace exists to attract, while being pocket
///      change to anyone running a scam at scale. Spam is priced by gas, which is the only
///      mechanism here that charges an attacker more than it charges an honest developer.
///
/// ########################### WHY NOTHING IS EVER REMOVED ###########################
///
/// There is no `delete`, no `unregister`, no owner escape hatch that erases a record. This was the
/// hardest call in the design and it went this way for four reasons:
///
///   - Deletion and censorship are the same transaction. Whoever holds a delete key can silently
///     remove a competitor. There is no on-chain way to tell that apart from removing a scam, and
///     "trust our curators not to" is exactly the assumption a registry should not require.
///
///   - Deleting a malicious hook DESTROYS THE WARNING. Absence is indistinguishable from "never
///     submitted". The users who most need the warning are the ones already in that hook's pool,
///     and delisting is precisely the moment they stop being able to look it up. A `Malicious`
///     tombstone with a reason string is strictly more protective than an empty slot.
///
///   - Log replay must be deterministic. The events here are specified so an indexer can rebuild
///     the entire registry from scratch. Deletion introduces state that exists in the log history
///     and not in storage, and every consumer then has to agree on how to reconcile that.
///
///   - Removal buys nothing. Every effect a delete could have — hide from default listings, warn
///     loudly, break the audited badge — is already reachable through `Listing.Malicious`, which
///     also force-resets verification. The only additional thing delete offers is deniability.
///
/// The cost of this choice, stated plainly: the registry accumulates junk forever, and a hook
/// squatted by a bad-faith first submitter can never have its entry vacated. Both are handled by
/// filtering rather than erasure — see `transferSteward` for the squatting case.
///
/// ####################### CALLING AN UNTRUSTED CONTRACT #######################
///
/// `register` and `refreshPermissions` call an address nobody has vetted. Core makes the same call
/// in `Hooks.validateHookConfig` with all remaining gas and no guards, which is safe there only
/// because a hostile hook that bricks its own pool initialization harms nobody else. Here it would
/// be a shared surface, so the call is made through `_probePermissions`:
///
///   - hard gas cap of `PROBE_GAS`, so an infinite loop costs its own submitter and stops;
///   - output buffer fixed at 32 bytes, so a return bomb cannot make us pay to copy it;
///   - `returndatasize() == 32` checked, so a short or empty return is a failure, not a zero;
///   - the raw word is rejected unless it fits in a `uint16`, matching what solc's own ABI decoder
///     would accept, so dirty high bits cannot be laundered into a small bitmap;
///   - `staticcall`, so the probe cannot reenter or write anything;
///   - a `gasleft()` floor, so an "unreadable" verdict is always about the hook and never about a
///     caller who deliberately starved the frame. Without it, anyone could call
///     `refreshPermissions` with hand-tuned gas and demote an honest audited hook.
///
/// A hostile hook can therefore make its own registration fail. It cannot make anyone else's fail,
/// and it cannot cost a caller more than the probe budget.
/// ###############################################################################
contract LatchHookRegistry is ILatchHookRegistry, AccessControl {
    /*//////////////////////////////////////////////////////////////
                                 ROLES
    //////////////////////////////////////////////////////////////*/

    /// @notice May attest: move a hook up or down the verification ladder, change any listing
    /// status, reassign a steward, correct metadata.
    /// @dev Curators are deliberately NOT timelocked. Marking a live hook malicious is an incident
    /// response and a six-hour queue makes it useless. The timelock sits one level up: it decides
    /// who is a curator. Granting the role is the escalation; using it is not.
    bytes32 public constant CURATOR_ROLE = keccak256("LATCH_HOOK_REGISTRY_CURATOR");

    /// @notice May only ever make a listing MORE cautious — Active to Deprecated, anything to
    /// Malicious — and nothing else.
    /// @dev Same reasoning as the guardian on LatchProtocolFeeController: delay and blast radius
    /// belong on privilege escalation, not on privilege reduction. A compromised guardian can
    /// slander a hook, which is visible, reversible by a curator, and costs nobody their funds. It
    /// cannot grant an audit badge, edit metadata, or clear an existing warning. That asymmetry is
    /// what makes it safe to hand this role to a fast-moving security desk.
    bytes32 public constant GUARDIAN_ROLE = keccak256("LATCH_HOOK_REGISTRY_GUARDIAN");

    /*//////////////////////////////////////////////////////////////
                              PROBE LIMITS
    //////////////////////////////////////////////////////////////*/

    /// @notice Hard gas ceiling on the untrusted `getHooksRegistrationBitmap()` call.
    /// @dev An honest implementation is `pure` and returns a constant: under 500 gas. 100k is
    /// roughly 200x headroom, enough for a hook that reads a few storage slots, while still being
    /// a bounded, affordable loss when the callee is a deliberate gas bomb.
    uint256 public constant PROBE_GAS = 100_000;

    /// @notice Gas that must remain before probing.
    /// @dev EIP-150 forwards at most 63/64 of what is left, so `PROBE_GAS * 64 / 63` is the amount
    /// we must hold to guarantee the child actually receives its full budget. The 30k reserve
    /// covers the storage writes that follow the probe. Below this floor we revert rather than
    /// record a verdict that a starved call frame produced.
    uint256 public constant PROBE_GAS_FLOOR = PROBE_GAS + PROBE_GAS / 63 + 30_000;

    /*//////////////////////////////////////////////////////////////
                            METADATA LIMITS
        Bounded so one registration cannot write unbounded storage
        or emit an unbounded log. Generous enough that no honest
        listing hits them.
    //////////////////////////////////////////////////////////////*/

    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_DESCRIPTION_BYTES = 2048;
    uint256 public constant MAX_URI_BYTES = 512;
    uint256 public constant MAX_NOTE_BYTES = 512;
    uint256 public constant MAX_CHAINS = 32;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(address hook => HookRecord) private _records;

    /// @dev Append-only. Index positions are stable forever, which is what lets an indexer page
    /// through the registry without worrying about entries shifting underneath it.
    address[] private _hookList;

    /// @dev Append-only, same guarantee.
    mapping(address submitter => address[] hooks) private _submitted;

    /// @param admin Holds DEFAULT_ADMIN_ROLE and therefore decides who curates. Should be
    /// LatchTimelock on any live chain, never an EOA.
    /// @param curators Initial curators. May be empty; the admin can appoint later.
    /// @param guardians Initial guardians. May be empty.
    constructor(address admin, address[] memory curators, address[] memory guardians) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i; i < curators.length; ++i) {
            _grantRole(CURATOR_ROLE, curators[i]);
        }
        for (uint256 i; i < guardians.length; ++i) {
            _grantRole(GUARDIAN_ROLE, guardians[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        PERMISSIONLESS SUBMISSION
    //////////////////////////////////////////////////////////////*/

    /// @notice List a hook. Open to anyone, free, no allowlist.
    /// @dev The permissions recorded are read from `hook` itself; `metadata` cannot influence them.
    /// Registration is rejected if the bitmap cannot be read, declares reserved bits 14-15, or
    /// declares a returns-delta bit without the base callback that returns it. Those are not
    /// stylistic objections: core calls the same function during pool initialization, so such a
    /// hook can never back a pool. Listing it would create an official-looking entry for something
    /// that is unusable, and "permissions unknown" is the one thing this registry must never say.
    /// @param hook Address of the deployed hook contract.
    /// @param metadata Human-readable listing data. Purely descriptive.
    function register(address hook, HookMetadata calldata metadata) external {
        if (hook == address(0)) revert ZeroAddress();
        HookRecord storage record = _records[hook];
        if (record.submitter != address(0)) revert HookAlreadyRegistered(hook);
        if (hook.code.length == 0) revert HookHasNoCode(hook);

        _validateMetadata(metadata);

        (bool readable, uint16 permissions) = _probePermissions(hook);
        if (!readable) revert PermissionsUnreadable(hook);
        if (permissions & PERM_RESERVED_BITS != 0) revert ReservedBitsSet(permissions);
        if (!_dependenciesSatisfied(permissions)) revert PermissionDependencyMissing(permissions);

        bytes32 codehash = hook.codehash;

        record.submitter = msg.sender;
        record.steward = msg.sender;
        record.submittedAt = uint64(block.timestamp);
        record.updatedAt = uint64(block.timestamp);
        record.permissions = permissions;
        record.permissionsValid = true;
        record.permissionsReadable = true;
        record.verification = Verification.Unverified;
        record.listing = Listing.Active;
        record.codehash = codehash;
        _writeMetadata(record, metadata);

        _hookList.push(hook);
        _submitted[msg.sender].push(hook);

        emit HookRegistered(
            hook, msg.sender, permissions, classify(permissions), codehash, uint64(block.timestamp)
        );
        _emitMetadata(hook, metadata);
    }

    /// @notice Re-read a hook's permissions and code hash from chain.
    /// @dev Permissionless on purpose. `getHooksRegistrationBitmap` is `view`, not `pure` — an
    /// implementation may read storage, and any hook behind a proxy can be swapped wholesale. The
    /// bitmap recorded at registration is a snapshot, and this is how the snapshot gets corrected.
    ///
    /// If anything moved, verification drops to `Unverified`, because an audit attests to a
    /// specific deployment and stops meaning anything the moment that deployment changes. This is
    /// not griefable: the demotion only fires when the hook's own answer or code hash actually
    /// differs from what was recorded, which is information no third party controls. Callers with
    /// too little gas are rejected by the `PROBE_GAS_FLOOR` check rather than being allowed to
    /// manufacture an "unreadable" verdict.
    ///
    /// Reverts with `PermissionsUnchanged` when there is nothing to record, so keepers cannot spam
    /// the log. Probe it with `eth_call` first if you want a cheap no-op.
    function refreshPermissions(address hook) external {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);

        uint16 previousPermissions = record.permissions;
        bytes32 previousCodehash = record.codehash;

        (bool readable, uint16 permissions) = _probePermissions(hook);
        bytes32 currentCodehash = hook.codehash;
        bool valid = readable && permissions & PERM_RESERVED_BITS == 0 && _dependenciesSatisfied(permissions);

        bool changed = readable != record.permissionsReadable || valid != record.permissionsValid
            || currentCodehash != previousCodehash || (readable && permissions != previousPermissions);
        if (!changed) revert PermissionsUnchanged(hook);

        // A failed read leaves the last known bitmap in place rather than zeroing it. Zero is a
        // meaningful bitmap ("this hook is never called"); silently claiming it for a hook that
        // merely stopped answering would understate its capabilities, which is the wrong direction
        // to be wrong in. `permissionsReadable == false` is the signal that the value is stale.
        if (readable) record.permissions = permissions;
        record.permissionsReadable = readable;
        record.permissionsValid = valid;
        record.codehash = currentCodehash;
        record.updatedAt = uint64(block.timestamp);

        emit HookPermissionsRefreshed(
            hook,
            msg.sender,
            previousPermissions,
            record.permissions,
            previousCodehash,
            currentCodehash,
            readable,
            valid
        );

        _demote(hook, record, "on-chain permissions or code changed");
    }

    /*//////////////////////////////////////////////////////////////
                            STEWARD ACTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Replace a listing's metadata.
    /// @dev Callable by the steward or by a curator. A steward edit ALWAYS resets verification to
    /// `Unverified`; a curator edit does not. Without that rule the ladder is decorative: get an
    /// audit badge on an honest listing, then repoint `sourceURI` at a repo that no longer matches
    /// the bytecode, or `auditURI` at a report for a different contract, and the badge now vouches
    /// for something no curator ever saw.
    function updateMetadata(address hook, HookMetadata calldata metadata) external {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);

        bool asCurator = hasRole(CURATOR_ROLE, msg.sender);
        if (msg.sender != record.steward && !asCurator) revert NotSteward(hook, msg.sender);

        _validateMetadata(metadata);
        _writeMetadata(record, metadata);
        record.updatedAt = uint64(block.timestamp);

        _emitMetadata(hook, metadata);
        if (!asCurator) _demote(hook, record, "metadata edited by steward");
    }

    /// @notice Hand over the right to edit a listing's metadata.
    /// @dev Two callers, one function. The steward uses it to hand a listing to a co-maintainer or
    /// to the real author. A curator uses it to fix the squatting case: registration is open, so
    /// nothing stops a stranger from listing someone else's hook first and controlling its
    /// description. That is the price of ungated submission, and reassignment is the right remedy
    /// because it repairs the listing instead of deleting it. `submitter` never changes — the
    /// historical record of who actually listed it stays intact and auditable.
    function transferSteward(address hook, address newSteward) external {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        if (newSteward == address(0)) revert ZeroAddress();
        if (msg.sender != record.steward && !hasRole(CURATOR_ROLE, msg.sender)) {
            revert NotSteward(hook, msg.sender);
        }

        address previous = record.steward;
        record.steward = newSteward;
        record.updatedAt = uint64(block.timestamp);
        emit HookStewardTransferred(hook, previous, newSteward);
    }

    /*//////////////////////////////////////////////////////////////
                            CURATED PROMOTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Move a hook along the verification ladder. Curator only, both directions.
    /// @dev Guards, all of which exist so a badge cannot mean less than it appears to:
    ///   - `SourceVerified` and above need a non-empty `sourceURI`; `Audited` also needs a
    ///     non-empty `auditURI`. A badge with nothing to click through to is theatre.
    ///   - Nothing can be promoted while flagged `Malicious`. Rehabilitation is two transactions
    ///     so it leaves two separately reviewable log entries.
    ///   - Nothing can be promoted while its permissions are unreadable or invalid.
    /// @param note Short free-text rationale, emitted with the event. May be empty.
    function setVerification(address hook, Verification level, string calldata note)
        external
        onlyRole(CURATOR_ROLE)
    {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        _boundString(bytes(note).length, MAX_NOTE_BYTES);

        if (level != Verification.Unverified) {
            if (record.listing == Listing.Malicious) revert HookFlaggedMalicious(hook);
            if (!record.permissionsReadable || !record.permissionsValid) {
                revert PermissionsNotAttestable(hook);
            }
            if (bytes(record.metadata.sourceURI).length == 0) revert SourceURIRequired();
            if (level == Verification.Audited && bytes(record.metadata.auditURI).length == 0) {
                revert AuditURIRequired();
            }
        }

        Verification previous = record.verification;
        record.verification = level;
        record.updatedAt = uint64(block.timestamp);
        emit HookVerificationChanged(hook, msg.sender, previous, level, note);
    }

    /// @notice Deprecate a hook, flag it malicious, or restore it to active.
    /// @dev Curators may set any status. Guardians may only move a listing to a strictly more
    /// cautious one, never back. Flagging `Malicious` force-resets verification to `Unverified` in
    /// the same transaction — a hook that turned out to be malicious must not keep presenting an
    /// audited badge for even one block, and relying on a curator to remember the second call is
    /// exactly the kind of gap incidents are made of. `Deprecated` deliberately KEEPS verification:
    /// a superseded but genuinely audited hook is not a lie, and erasing the audit there would
    /// punish maintainers for retiring old versions honestly.
    /// @param reason Emitted verbatim. This is what a marketplace shows next to the warning, so it
    /// should be a sentence a user can act on, not a ticket number.
    function setListing(address hook, Listing status, string calldata reason) external {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        _boundString(bytes(reason).length, MAX_NOTE_BYTES);

        if (!hasRole(CURATOR_ROLE, msg.sender)) {
            if (!hasRole(GUARDIAN_ROLE, msg.sender)) revert NotCuratorOrGuardian(msg.sender);
            if (uint8(status) <= uint8(record.listing)) {
                revert GuardianCannotRelist(record.listing, status);
            }
        }

        Listing previous = record.listing;
        record.listing = status;
        record.updatedAt = uint64(block.timestamp);
        emit HookListingChanged(hook, msg.sender, previous, status, reason);

        if (status == Listing.Malicious) _demote(hook, record, "flagged malicious");
    }

    /*//////////////////////////////////////////////////////////////
                          UNTRUSTED CALL PROBE
    //////////////////////////////////////////////////////////////*/

    /// @dev The only place this contract touches an unvetted address. See the contract-level notes.
    /// @return readable True only if the call succeeded, returned exactly 32 bytes, and those bytes
    /// are a clean `uint16` — the same three conditions solc's own decoder would impose.
    /// @return permissions The decoded bitmap, or zero when `readable` is false.
    function _probePermissions(address hook) private view returns (bool readable, uint16 permissions) {
        uint256 available = gasleft();
        if (available < PROBE_GAS_FLOOR) revert InsufficientGasForProbe(available, PROBE_GAS_FLOOR);

        bytes4 selector = IHooks.getHooksRegistrationBitmap.selector;
        uint256 budget = PROBE_GAS;
        bool success;
        uint256 raw;

        assembly ("memory-safe") {
            // Scratch space (0x00-0x3f) only: 4 bytes of calldata in, 32 bytes of return out.
            // The input is fully consumed before the output is written, so one buffer is enough.
            mstore(0, selector)
            success := staticcall(budget, hook, 0, 4, 0, 32)
            raw := mload(0)
            // A return bomb is truncated by outsize=32 above; this rejects anything that is not
            // exactly one word, including the empty return of a plain EOA-like fallback.
            success := and(success, eq(returndatasize(), 32))
        }

        if (!success) return (false, 0);
        // Dirty high bits are not a small bitmap. Core decodes this as `uint16` and solc reverts on
        // a value that does not fit, so accepting the low 16 bits here would let a hook show a tame
        // bitmap in the registry while being unusable, or differently readable, everywhere else.
        if (raw > type(uint16).max) return (false, 0);
        return (true, uint16(raw));
    }

    /*//////////////////////////////////////////////////////////////
                          PERMISSION SEMANTICS
        Pure, shared with the SDK, the lint package and the UI so
        that one bitmap cannot be described three different ways.
    //////////////////////////////////////////////////////////////*/

    /// @notice Whether a bitmap is one core would accept.
    /// @dev Mirrors `BaseCLHook._validatePermissions`.
    function isValidBitmap(uint16 permissions) public pure returns (bool) {
        return permissions & PERM_RESERVED_BITS == 0 && _dependenciesSatisfied(permissions);
    }

    /// @dev A returns-delta bit is meaningless without the callback that returns the delta.
    function _dependenciesSatisfied(uint16 p) private pure returns (bool) {
        if (p & PERM_BEFORE_SWAP_RETURNS_DELTA != 0 && p & PERM_BEFORE_SWAP == 0) return false;
        if (p & PERM_AFTER_SWAP_RETURNS_DELTA != 0 && p & PERM_AFTER_SWAP == 0) return false;
        if (p & PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA != 0 && p & PERM_AFTER_ADD_LIQUIDITY == 0) return false;
        if (p & PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA != 0 && p & PERM_AFTER_REMOVE_LIQUIDITY == 0) {
            return false;
        }
        return true;
    }

    /// @notice Capability class of a bitmap. Derived, not curated — no role can change this.
    function classify(uint16 permissions) public pure returns (RiskClass) {
        // Can take value out of a swap or a liquidity movement, or can refuse a withdrawal
        // forever. Both end with a user unable to get their money back out.
        if (permissions & PERM_RETURNS_DELTA_MASK != 0 || permissions & PERM_BEFORE_REMOVE_LIQUIDITY != 0) {
            return RiskClass.ValueExtracting;
        }
        // Holds a veto over some action.
        if (permissions & PERM_BEFORE_MASK != 0) return RiskClass.Restrictive;
        return RiskClass.Passive;
    }

    /// @notice True if the hook can take a cut of every swap in its pool (bits 10 or 11).
    function takesSwapCut(uint16 permissions) public pure returns (bool) {
        return permissions & PERM_SWAP_CUT_MASK != 0;
    }

    /// @notice True if the hook can take a cut of any swap or liquidity movement (bits 10-13).
    function returnsDelta(uint16 permissions) public pure returns (bool) {
        return permissions & PERM_RETURNS_DELTA_MASK != 0;
    }

    /// @notice True if the hook can block trading in its pool outright (bit 6).
    function canBlockSwaps(uint16 permissions) public pure returns (bool) {
        return permissions & PERM_BEFORE_SWAP != 0;
    }

    /// @notice True if the hook can refuse liquidity withdrawals and strand LP funds (bit 4).
    function canTrapLiquidity(uint16 permissions) public pure returns (bool) {
        return permissions & PERM_BEFORE_REMOVE_LIQUIDITY != 0;
    }

    /// @notice Expand a bitmap into named booleans.
    function decodePermissions(uint16 p) public pure returns (DecodedPermissions memory d) {
        d.beforeInitialize = p & PERM_BEFORE_INITIALIZE != 0;
        d.afterInitialize = p & PERM_AFTER_INITIALIZE != 0;
        d.beforeAddLiquidity = p & PERM_BEFORE_ADD_LIQUIDITY != 0;
        d.afterAddLiquidity = p & PERM_AFTER_ADD_LIQUIDITY != 0;
        d.beforeRemoveLiquidity = p & PERM_BEFORE_REMOVE_LIQUIDITY != 0;
        d.afterRemoveLiquidity = p & PERM_AFTER_REMOVE_LIQUIDITY != 0;
        d.beforeSwap = p & PERM_BEFORE_SWAP != 0;
        d.afterSwap = p & PERM_AFTER_SWAP != 0;
        d.beforeDonate = p & PERM_BEFORE_DONATE != 0;
        d.afterDonate = p & PERM_AFTER_DONATE != 0;
        d.beforeSwapReturnsDelta = p & PERM_BEFORE_SWAP_RETURNS_DELTA != 0;
        d.afterSwapReturnsDelta = p & PERM_AFTER_SWAP_RETURNS_DELTA != 0;
        d.afterAddLiquidityReturnsDelta = p & PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA != 0;
        d.afterRemoveLiquidityReturnsDelta = p & PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA != 0;
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function isRegistered(address hook) public view returns (bool) {
        return _records[hook].submitter != address(0);
    }

    /// @notice The full record. Reverts for an unregistered hook rather than returning a zeroed
    /// struct, because a zeroed struct reads as "Unverified, Active, no permissions" — the safest
    /// possible answer about a hook nobody has ever looked at.
    function getHook(address hook) external view returns (HookRecord memory) {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        return record;
    }

    function permissionsOf(address hook) external view returns (uint16 permissions, bool readable, bool valid) {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        return (record.permissions, record.permissionsReadable, record.permissionsValid);
    }

    function riskClassOf(address hook) external view returns (RiskClass) {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        return classify(record.permissions);
    }

    function statusOf(address hook) external view returns (Verification verification, Listing listing) {
        HookRecord storage record = _records[hook];
        if (record.submitter == address(0)) revert HookNotRegistered(hook);
        return (record.verification, record.listing);
    }

    /// @notice The single question a front end should ask before showing a trust badge.
    /// @dev Never true for an unregistered hook, a flagged one, or one whose code has moved since
    /// the audit was attested. Deliberately a view and not a modifier anywhere: this contract makes
    /// no authorization decisions on anyone's behalf.
    function isAudited(address hook) external view returns (bool) {
        HookRecord storage record = _records[hook];
        return record.submitter != address(0) && record.verification == Verification.Audited
            && record.listing == Listing.Active && record.permissionsReadable && record.permissionsValid;
    }

    function hookCount() external view returns (uint256) {
        return _hookList.length;
    }

    function hookAt(uint256 index) external view returns (address) {
        return _hookList[index];
    }

    /// @notice Page through every registered hook. Index positions never change.
    function listHooks(uint256 offset, uint256 limit) external view returns (address[] memory) {
        return _page(_hookList, offset, limit);
    }

    function submittedCount(address submitter) external view returns (uint256) {
        return _submitted[submitter].length;
    }

    function listBySubmitter(address submitter, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory)
    {
        return _page(_submitted[submitter], offset, limit);
    }

    function _page(address[] storage list, uint256 offset, uint256 limit)
        private
        view
        returns (address[] memory page)
    {
        uint256 length = list.length;
        if (offset > length) revert InvalidRange();
        // `limit = type(uint256).max` is the natural "give me the rest" idiom, so clamp before
        // adding rather than letting checked arithmetic panic on it.
        uint256 end = limit > length - offset ? length : offset + limit;
        page = new address[](end - offset);
        for (uint256 i; i < page.length; ++i) {
            page[i] = list[offset + i];
        }
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev Reset verification and say why. No-op when already unverified, so nothing that merely
    /// re-confirms the status quo shows up in the log.
    function _demote(address hook, HookRecord storage record, string memory note) private {
        Verification previous = record.verification;
        if (previous == Verification.Unverified) return;
        record.verification = Verification.Unverified;
        emit HookVerificationChanged(hook, msg.sender, previous, Verification.Unverified, note);
    }

    function _validateMetadata(HookMetadata calldata metadata) private pure {
        uint256 nameLength = bytes(metadata.name).length;
        if (nameLength == 0) revert EmptyName();
        _boundString(nameLength, MAX_NAME_BYTES);
        _boundString(bytes(metadata.description).length, MAX_DESCRIPTION_BYTES);
        _boundString(bytes(metadata.sourceURI).length, MAX_URI_BYTES);
        _boundString(bytes(metadata.auditURI).length, MAX_URI_BYTES);
        if (metadata.chainIds.length > MAX_CHAINS) revert TooManyChains(metadata.chainIds.length, MAX_CHAINS);
    }

    function _boundString(uint256 length, uint256 maximum) private pure {
        if (length > maximum) revert StringTooLong(length, maximum);
    }

    function _writeMetadata(HookRecord storage record, HookMetadata calldata metadata) private {
        record.metadata.name = metadata.name;
        record.metadata.description = metadata.description;
        record.metadata.sourceURI = metadata.sourceURI;
        record.metadata.auditURI = metadata.auditURI;
        record.metadata.chainIds = metadata.chainIds;
    }

    function _emitMetadata(address hook, HookMetadata calldata metadata) private {
        emit HookMetadataUpdated(
            hook,
            msg.sender,
            metadata.name,
            metadata.description,
            metadata.sourceURI,
            metadata.auditURI,
            metadata.chainIds
        );
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 LatchProtocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "infinity-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";

import {LatchRegistry} from "../src/LatchRegistry.sol";
import {
    ILatchRegistry,
    LatchMetadata,
    Verification,
    Listing,
    RiskClass,
    PERM_AFTER_SWAP,
    PERM_BEFORE_SWAP,
    PERM_BEFORE_SWAP_RETURNS_DELTA
} from "../src/ILatchRegistry.sol";
import {LatchLaunchRegistry} from "../src/LatchLaunchRegistry.sol";
import {
    ILatchLaunchRegistry,
    LaunchMetadata,
    LaunchRecord,
    LaunchOrigin,
    LaunchpadMetadata,
    LaunchpadRecord,
    LaunchpadOrigin
} from "../src/ILatchLaunchRegistry.sol";
import {PoolProof} from "../src/libraries/PoolProof.sol";
import {RegistryPaging} from "../src/libraries/RegistryPaging.sol";

import {HonestHook} from "./mocks/MockHooks.sol";
import {MockVault, MockPoolManager, NotAPoolManager} from "./mocks/MockPools.sol";
import {HonestLaunchpad, SilentLaunchpad} from "./mocks/MockLaunchpads.sol";
import {
    GoodToken,
    SilentToken,
    RevertingToken,
    LongNameToken,
    MalformedNameToken,
    LyingLengthToken,
    WideDecimalsToken,
    GasBurnerToken
} from "./mocks/MockTokens.sol";

/// @title LatchLaunchRegistry — unit coverage
/// @notice Everything except the provenance mechanism, which is large enough and load-bearing
/// enough to get its own file: `LaunchProvenance.t.sol`.
///
/// @dev The pool manager here is the same writable mock the Latch registry's attestation tests
/// use, so a pool can be filed under the wrong id or name a manager that is not itself — things
/// core can never do, and therefore the only way to exercise the checks that catch them. Keys are
/// laid out with the launch token deliberately on one side or the other rather than sorted by
/// address, so `tokenIsCurrency0` is asserted against something chosen and not against whatever
/// `vm` happened to hand out.
contract LatchLaunchRegistryTest is Test {
    LatchRegistry internal latchRegistry;
    LatchLaunchRegistry internal registry;
    MockVault internal vault;
    MockPoolManager internal manager;

    GoodToken internal token;
    GoodToken internal quote;

    address internal admin = address(0x71E10);
    address internal curator = address(0xC0A70);
    address internal guardian = address(0x69A2D);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal stranger = address(0x57A6E);

    uint16 internal constant TAME = PERM_AFTER_SWAP;
    uint16 internal constant SWAP_TAX = PERM_BEFORE_SWAP | PERM_BEFORE_SWAP_RETURNS_DELTA;

    function setUp() public {
        vault = new MockVault();
        manager = new MockPoolManager();
        vault.registerApp(address(manager));

        address[] memory curators = new address[](1);
        curators[0] = curator;
        address[] memory guardians = new address[](1);
        guardians[0] = guardian;
        latchRegistry = new LatchRegistry(admin, address(vault), curators, guardians);

        registry = new LatchLaunchRegistry(address(vault), address(latchRegistry));

        token = new GoodToken("Foo Token", "FOO", 18);
        quote = new GoodToken("Latch USD", "ltUSD", 6);
    }

    /*//////////////////////////////////////////////////////////////
                               HELPERS
    //////////////////////////////////////////////////////////////*/

    function _key(address c0, address c1, address hook, uint16 bitmap) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            hooks: IHooks(hook),
            poolManager: IPoolManager(address(manager)),
            fee: 3000,
            parameters: bytes32(uint256(bitmap) | (uint256(60) << 16))
        });
    }

    function _pool(address c0, address c1, address hook, uint16 bitmap) internal returns (bytes32) {
        return manager.setPool(_key(c0, c1, hook, bitmap));
    }

    function _meta() internal pure returns (LaunchMetadata memory) {
        return LaunchMetadata({
            description: "a launch",
            websiteURI: "https://example.invalid",
            iconURI: "ipfs://icon",
            socialURI: "https://social.invalid"
        });
    }

    function _padMeta(string memory source, string memory audit) internal pure returns (LaunchpadMetadata memory) {
        return LaunchpadMetadata({
            name: "Acme Launchpad",
            description: "a launchpad",
            sourceURI: source,
            auditURI: audit,
            websiteURI: "https://acme.invalid"
        });
    }

    function _register(bytes32 poolId, address token_) internal {
        registry.registerLaunch(address(manager), poolId, token_, address(0), alice, address(0), _meta());
    }

    /*//////////////////////////////////////////////////////////////
                       REGISTRATION — PROVEN FACTS
    //////////////////////////////////////////////////////////////*/

    function test_register_recordsFactsReadBackFromTheManager() public {
        bytes32 poolId = _pool(address(token), address(quote), address(new HonestHook(SWAP_TAX)), SWAP_TAX);
        vm.prank(alice);
        registry.registerLaunch(address(manager), poolId, address(token), address(0), bob, address(0), _meta());

        LaunchRecord memory r = registry.getLaunch(poolId);
        assertEq(r.token, address(token));
        assertEq(r.quote, address(quote));
        assertTrue(r.tokenIsCurrency0);
        assertEq(r.fee, 3000);
        assertEq(r.poolManager, address(manager));
        assertEq(r.hookPermissions, SWAP_TAX, "bitmap must come from the pool's immutable parameters");
        assertEq(r.registrant, alice);
        assertEq(r.steward, alice, "zero steward defaults to the caller");
        assertEq(uint8(r.listing), uint8(Listing.Active));
        assertEq(uint8(r.origin), uint8(LaunchOrigin.Claimed));
        assertEq(r.registeredAt, uint64(block.timestamp));
        assertEq(r.registeredAtBlock, uint64(block.number));
    }

    /// @notice The launch token may be either side of the pair, and the record says which.
    function test_register_tokenOnCurrency1Side() public {
        bytes32 poolId = _pool(address(quote), address(token), address(0), 0);
        _register(poolId, address(token));

        LaunchRecord memory r = registry.getLaunch(poolId);
        assertFalse(r.tokenIsCurrency0);
        assertEq(r.quote, address(quote));
    }

    /// @notice A pool with no hook is a perfectly good launch. Gating on one would exclude every
    /// plain pool from the shared index for no safety gain.
    function test_register_hooklessPoolIsAllowed() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        (address hooks, uint16 permissions, RiskClass risk, bool listed) = registry.launchHookOf(poolId);
        assertEq(hooks, address(0));
        assertEq(permissions, 0);
        assertEq(uint8(risk), uint8(RiskClass.Passive));
        assertFalse(listed);
    }

    function test_register_explicitStewardIsHonoured() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        vm.prank(alice);
        registry.registerLaunch(address(manager), poolId, address(token), address(0), alice, bob, _meta());
        assertEq(registry.getLaunch(poolId).steward, bob);
    }

    function test_register_indicesArePopulated() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        assertEq(registry.launchCount(), 1);
        assertEq(registry.launchAt(0), poolId);
        assertEq(registry.tokenLaunchCount(address(token)), 1);
        assertEq(registry.launchesOfToken(address(token), 0, 10)[0], poolId);
        assertEq(registry.creatorLaunchCount(alice), 1);
        // No launchpad was named, so the "launched via" index must stay empty.
        assertEq(registry.launchpadLaunchCount(address(0)), 0);
    }

    /// @notice One token, several pools. A marketplace has to be able to show all of them.
    function test_register_oneTokenManyPools() public {
        GoodToken other = new GoodToken("Other", "OTH", 18);
        bytes32 a = _pool(address(token), address(quote), address(0), 0);
        bytes32 b = _pool(address(token), address(other), address(0), 0);
        _register(a, address(token));
        _register(b, address(token));

        assertEq(registry.tokenLaunchCount(address(token)), 2);
        bytes32[] memory all = registry.launchesOfToken(address(token), 0, type(uint256).max);
        assertEq(all.length, 2);
        assertEq(all[0], a);
        assertEq(all[1], b);
    }

    /*//////////////////////////////////////////////////////////////
                       REGISTRATION — WHAT IS REFUSED
    //////////////////////////////////////////////////////////////*/

    function test_reject_untrustedPoolManager() public {
        MockPoolManager rogue = new MockPoolManager();
        bytes32 poolId = rogue.setPool(
            PoolKey({
                currency0: Currency.wrap(address(token)),
                currency1: Currency.wrap(address(quote)),
                hooks: IHooks(address(0)),
                poolManager: IPoolManager(address(rogue)),
                fee: 3000,
                parameters: bytes32(0)
            })
        );
        vm.expectRevert(abi.encodeWithSelector(PoolProof.UntrustedPoolManager.selector, address(rogue)));
        registry.registerLaunch(address(rogue), poolId, address(token), address(0), alice, address(0), _meta());
    }

    /// @notice A Vault app is not necessarily a pool manager. Decoding garbage would be worse than
    /// failing.
    function test_reject_vaultAppThatIsNotAPoolManager() public {
        NotAPoolManager fake = new NotAPoolManager();
        vault.registerApp(address(fake));
        vm.expectRevert();
        registry.registerLaunch(
            address(fake), bytes32(uint256(1)), address(token), address(0), alice, address(0), _meta()
        );
    }

    function test_reject_poolDoesNotExist() public {
        bytes32 poolId = keccak256("never initialized");
        vm.expectRevert(abi.encodeWithSelector(PoolProof.PoolNotFound.selector, address(manager), poolId));
        _register(poolId, address(token));
    }

    /// @notice A key filed under an id that is not its own hash. Core cannot produce this; the
    /// `key.toId() == poolId` check is what catches a manager that tries.
    function test_reject_keyFiledUnderTheWrongId() public {
        bytes32 wrongId = keccak256("wrong");
        manager.forgePool(wrongId, _key(address(token), address(quote), address(0), 0));
        vm.expectRevert(abi.encodeWithSelector(PoolProof.PoolNotFound.selector, address(manager), wrongId));
        _register(wrongId, address(token));
    }

    function test_reject_tokenNotInPool() public {
        GoodToken outsider = new GoodToken("Outsider", "OUT", 18);
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.TokenNotInPool.selector, poolId, address(outsider)));
        _register(poolId, address(outsider));
    }

    function test_reject_nativeAsLaunchToken() public {
        bytes32 poolId = _pool(address(0), address(token), address(0), 0);
        vm.expectRevert(ILatchLaunchRegistry.LaunchTokenCannotBeNative.selector);
        _register(poolId, address(0));
    }

    function test_reject_tokenWithoutCode() public {
        address eoa = address(0xDEAD);
        bytes32 poolId = _pool(eoa, address(quote), address(0), 0);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchTokenHasNoCode.selector, eoa));
        _register(poolId, eoa);
    }

    function test_reject_duplicateRegistration() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchAlreadyRegistered.selector, poolId));
        _register(poolId, address(token));
    }

    function test_reject_oversizedMetadata() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        LaunchMetadata memory m = _meta();
        m.description = string(new bytes(2049));
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.StringTooLong.selector, 2049, 2048));
        registry.registerLaunch(address(manager), poolId, address(token), address(0), alice, address(0), m);
    }

    /*//////////////////////////////////////////////////////////////
                            TOKEN IDENTITY

        Read off the token, never supplied. There is no parameter
        anywhere in this contract through which a registrant can
        type a name or a ticker.
    //////////////////////////////////////////////////////////////*/

    function test_tokenInfo_isReadFromTheTokenItself() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        (string memory name, string memory symbol, uint8 decimals, bytes32 codehash, bool readable) =
            registry.launchTokenInfoOf(poolId);
        assertEq(name, "Foo Token");
        assertEq(symbol, "FOO");
        assertEq(decimals, 18);
        assertEq(codehash, address(token).codehash);
        assertTrue(readable);
    }

    function test_tokenInfo_silentTokenIsUnreadableNotFabricated() public {
        SilentToken silent = new SilentToken();
        bytes32 poolId = _pool(address(silent), address(quote), address(0), 0);
        _register(poolId, address(silent));

        (string memory name, string memory symbol,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(bytes(name).length, 0);
        assertEq(bytes(symbol).length, 0);
        assertFalse(readable, "a token that will not say its name must not be recorded as if it did");
    }

    function test_tokenInfo_revertingTokenIsUnreadable() public {
        RevertingToken bad = new RevertingToken();
        bytes32 poolId = _pool(address(bad), address(quote), address(0), 0);
        _register(poolId, address(bad));
        (,,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertFalse(readable);
    }

    /// @notice An over-long name is rejected, not truncated. A truncated name is a different name.
    function test_tokenInfo_longNameRejectedOnSize() public {
        LongNameToken long = new LongNameToken();
        bytes32 poolId = _pool(address(long), address(quote), address(0), 0);
        _register(poolId, address(long));

        (string memory name, string memory symbol,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(bytes(name).length, 0);
        assertEq(symbol, "LONG", "the symbol was well formed and must still be read");
        assertFalse(readable);
    }

    function test_tokenInfo_malformedHeadRejected() public {
        MalformedNameToken bad = new MalformedNameToken();
        bytes32 poolId = _pool(address(bad), address(quote), address(0), 0);
        _register(poolId, address(bad));
        (string memory name,,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(bytes(name).length, 0);
        assertFalse(readable);
    }

    /// @notice A length longer than the bytes actually returned is the short-buffer trick. It must
    /// not produce a string that reads past the copy.
    function test_tokenInfo_lyingLengthRejected() public {
        LyingLengthToken bad = new LyingLengthToken();
        bytes32 poolId = _pool(address(bad), address(quote), address(0), 0);
        _register(poolId, address(bad));
        (string memory name,,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(bytes(name).length, 0);
        assertFalse(readable);
    }

    function test_tokenInfo_wideDecimalsIgnored() public {
        WideDecimalsToken wide = new WideDecimalsToken();
        bytes32 poolId = _pool(address(wide), address(quote), address(0), 0);
        _register(poolId, address(wide));
        (,, uint8 decimals,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(decimals, 0, "a value that does not fit a uint8 is not a small uint8");
        assertTrue(readable, "name and symbol were fine; only decimals was junk");
    }

    /// @notice A token that burns every unit of gas it is given costs the registrant its probe
    /// budget and nothing else. It cannot stop its own launch being indexed.
    function test_tokenInfo_gasBurnerCannotBrickRegistration() public {
        GasBurnerToken burner = new GasBurnerToken();
        bytes32 poolId = _pool(address(burner), address(quote), address(0), 0);
        _register(poolId, address(burner));

        (string memory name, string memory symbol,,, bool readable) = registry.launchTokenInfoOf(poolId);
        assertEq(bytes(name).length, 0);
        assertEq(symbol, "BURN");
        assertFalse(readable);
    }

    /// @notice Launch as FOO, rename to something that impersonates a real asset. The refresh is
    /// permissionless precisely so anybody who notices can put the truth back on chain.
    function test_refreshTokenInfo_picksUpARename() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        token.rename("USD Coin", "USDC");
        vm.prank(stranger);
        registry.refreshTokenInfo(poolId);

        (string memory name, string memory symbol,,,) = registry.launchTokenInfoOf(poolId);
        assertEq(name, "USD Coin");
        assertEq(symbol, "USDC");
    }

    /// @notice A proxy swap moves the codehash even when the name does not. The view exists so a
    /// UI can say "this token's code changed since we read it" without a refresh landing first.
    function test_tokenCodeHasMoved_afterAnUpgrade() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));
        assertFalse(registry.tokenCodeHasMoved(poolId));

        vm.etch(address(token), type(SilentToken).runtimeCode);
        assertTrue(registry.tokenCodeHasMoved(poolId));
    }

    /*//////////////////////////////////////////////////////////////
                    ROLES COME FROM THE LATCH REGISTRY
    //////////////////////////////////////////////////////////////*/

    function test_roles_areReadFromTheLatchRegistry() public {
        assertTrue(registry.isCurator(curator));
        assertTrue(registry.isGuardian(guardian));
        assertFalse(registry.isCurator(stranger));

        // One grant, on one contract, and it takes effect on both surfaces.
        bytes32 role = latchRegistry.CURATOR_ROLE();
        vm.prank(admin);
        latchRegistry.grantRole(role, stranger);
        assertTrue(registry.isCurator(stranger));
    }

    function test_roles_constantsMatchTheLatchRegistry() public view {
        assertEq(registry.CURATOR_ROLE(), latchRegistry.CURATOR_ROLE());
        assertEq(registry.GUARDIAN_ROLE(), latchRegistry.GUARDIAN_ROLE());
    }

    /*//////////////////////////////////////////////////////////////
                            LAUNCH LISTING
    //////////////////////////////////////////////////////////////*/

    function test_listing_curatorMaySetAnyStatus() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        vm.prank(curator);
        registry.setLaunchListing(poolId, Listing.Malicious, "drains buyers");
        assertEq(uint8(registry.getLaunch(poolId).listing), uint8(Listing.Malicious));

        vm.prank(curator);
        registry.setLaunchListing(poolId, Listing.Active, "false positive");
        assertEq(uint8(registry.getLaunch(poolId).listing), uint8(Listing.Active));
    }

    function test_listing_guardianMayOnlyEscalate() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        vm.prank(guardian);
        registry.setLaunchListing(poolId, Listing.Malicious, "rug in progress");

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILatchLaunchRegistry.GuardianCannotRelist.selector, Listing.Malicious, Listing.Active
            )
        );
        registry.setLaunchListing(poolId, Listing.Active, "");
    }

    function test_listing_strangerRejected() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.NotCuratorOrGuardian.selector, stranger));
        registry.setLaunchListing(poolId, Listing.Malicious, "");
    }

    /*//////////////////////////////////////////////////////////////
                          LAUNCH STEWARDSHIP
    //////////////////////////////////////////////////////////////*/

    function test_metadata_stewardMayEdit() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        vm.prank(alice);
        registry.registerLaunch(address(manager), poolId, address(token), address(0), alice, address(0), _meta());

        LaunchMetadata memory m = _meta();
        m.description = "edited";
        vm.prank(alice);
        registry.updateLaunchMetadata(poolId, m);
        assertEq(registry.getLaunch(poolId).metadata.description, "edited");
    }

    function test_metadata_strangerRejected() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        vm.prank(alice);
        registry.registerLaunch(address(manager), poolId, address(token), address(0), alice, address(0), _meta());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.NotLaunchSteward.selector, poolId, stranger));
        registry.updateLaunchMetadata(poolId, _meta());
    }

    /// @notice Registration is open, so a stranger can index somebody's real pool with hostile
    /// copy. Reassignment repairs the listing instead of deleting it, and `registrant` stays put.
    function test_steward_curatorFixesSquatting() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        vm.prank(stranger);
        registry.registerLaunch(address(manager), poolId, address(token), address(0), address(0), address(0), _meta());

        vm.prank(curator);
        registry.transferLaunchSteward(poolId, alice);

        LaunchRecord memory r = registry.getLaunch(poolId);
        assertEq(r.steward, alice);
        assertEq(r.registrant, stranger, "who actually listed it stays auditable");
    }

    /*//////////////////////////////////////////////////////////////
                              LAUNCHPADS
    //////////////////////////////////////////////////////////////*/

    function test_launchpad_thirdPartyListingIsClaimed() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        vm.prank(stranger);
        registry.registerLaunchpad(address(pad), address(0), _padMeta("ipfs://src", ""));

        LaunchpadRecord memory r = registry.getLaunchpad(address(pad));
        assertEq(uint8(r.origin), uint8(LaunchpadOrigin.Claimed));
        assertEq(r.registrant, stranger);
        assertEq(r.steward, stranger);
    }

    function test_launchpad_selfListingIsSelfRegistered() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        pad.selfRegister(address(registry), alice, _padMeta("ipfs://src", ""));

        LaunchpadRecord memory r = registry.getLaunchpad(address(pad));
        assertEq(uint8(r.origin), uint8(LaunchpadOrigin.SelfRegistered));
        assertEq(r.registrant, address(pad));
        assertEq(r.steward, alice);
        assertEq(r.codehash, address(pad).codehash);
    }

    function test_launchpad_eoaRejected() public {
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadHasNoCode.selector, alice));
        registry.registerLaunchpad(alice, address(0), _padMeta("", ""));
    }

    function test_launchpad_duplicateRejected() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        registry.registerLaunchpad(address(pad), address(0), _padMeta("", ""));
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadAlreadyRegistered.selector, address(pad)));
        registry.registerLaunchpad(address(pad), address(0), _padMeta("", ""));
    }

    function test_launchpad_emptyNameRejected() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        LaunchpadMetadata memory m = _padMeta("", "");
        m.name = "";
        vm.expectRevert(ILatchLaunchRegistry.EmptyName.selector);
        registry.registerLaunchpad(address(pad), address(0), m);
    }

    /// @notice The squatting remedy that needs no curator: only the launchpad can call this.
    function test_launchpad_claimUpgradesAndMovesSteward() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        vm.prank(stranger);
        registry.registerLaunchpad(address(pad), address(0), _padMeta("ipfs://src", ""));

        pad.claim(address(registry), alice);

        LaunchpadRecord memory r = registry.getLaunchpad(address(pad));
        assertEq(uint8(r.origin), uint8(LaunchpadOrigin.SelfRegistered));
        assertEq(r.steward, alice);
    }

    function test_launchpad_claimRequiresAListing() public {
        SilentLaunchpad pad = new SilentLaunchpad();
        vm.prank(address(pad));
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadNotRegistered.selector, address(pad)));
        registry.claimLaunchpad(alice);
    }

    /*//////////////////////////////////////////////////////////////
                        LAUNCHPAD VERIFICATION
    //////////////////////////////////////////////////////////////*/

    /// @dev Stands up a self-registered launchpad with one attributed launch, i.e. the minimum
    /// state in which a badge is permitted at all.
    function _badgeableLaunchpad(string memory audit) internal returns (HonestLaunchpad pad, bytes32 poolId) {
        pad = new HonestLaunchpad();
        pad.selfRegister(address(registry), alice, _padMeta("ipfs://src", audit));
        poolId = _pool(address(token), address(quote), address(0), 0);
        pad.registerLaunch(address(registry), address(manager), poolId, address(token), bob, bob, _meta());
    }

    function test_verification_happyPath() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "reviewed");
        assertTrue(registry.isLaunchpadAudited(address(pad)));
    }

    function test_verification_refusedOnAClaimedListing() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        vm.prank(stranger);
        registry.registerLaunchpad(address(pad), address(0), _padMeta("ipfs://src", "ipfs://audit"));
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        pad.registerLaunch(address(registry), address(manager), poolId, address(token), bob, bob, _meta());

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadNotSelfRegistered.selector, address(pad)));
        registry.setLaunchpadVerification(address(pad), Verification.SourceVerified, "");
    }

    function test_verification_refusedWithoutAnAttributedLaunch() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        pad.selfRegister(address(registry), alice, _padMeta("ipfs://src", ""));
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadHasNoLaunches.selector, address(pad)));
        registry.setLaunchpadVerification(address(pad), Verification.SourceVerified, "");
    }

    function test_verification_requiresSourceURI() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        pad.selfRegister(address(registry), alice, _padMeta("", ""));
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        pad.registerLaunch(address(registry), address(manager), poolId, address(token), bob, bob, _meta());

        vm.prank(curator);
        vm.expectRevert(ILatchLaunchRegistry.SourceURIRequired.selector);
        registry.setLaunchpadVerification(address(pad), Verification.SourceVerified, "");
    }

    function test_verification_auditedRequiresAuditURI() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("");
        vm.prank(curator);
        vm.expectRevert(ILatchLaunchRegistry.AuditURIRequired.selector);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");
    }

    function test_verification_blockedWhileMalicious() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(guardian);
        registry.setLaunchpadListing(address(pad), Listing.Malicious, "hostile");

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadFlaggedMalicious.selector, address(pad)));
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");
    }

    function test_verification_strangerRejected() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.NotCurator.selector, stranger));
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");
    }

    /// @notice A badge must not survive the listing being flagged, not even for one block.
    function test_verification_maliciousFlagResetsIt() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");

        vm.prank(guardian);
        registry.setLaunchpadListing(address(pad), Listing.Malicious, "turned");

        assertEq(uint8(registry.getLaunchpad(address(pad)).verification), uint8(Verification.Unverified));
        assertFalse(registry.isLaunchpadAudited(address(pad)));
    }

    /// @notice Deprecating an honest launchpad is not an accusation, so the audit stands.
    function test_verification_deprecationKeepsIt() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");

        vm.prank(curator);
        registry.setLaunchpadListing(address(pad), Listing.Deprecated, "v2 shipped");
        assertEq(uint8(registry.getLaunchpad(address(pad)).verification), uint8(Verification.Audited));
    }

    /// @notice The bait-and-switch: get badged, then repoint the source at something else.
    function test_verification_stewardEditDemotes() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");

        vm.prank(alice); // the steward
        registry.updateLaunchpadMetadata(address(pad), _padMeta("ipfs://something-else", "ipfs://audit"));
        assertEq(uint8(registry.getLaunchpad(address(pad)).verification), uint8(Verification.Unverified));
    }

    function test_verification_curatorEditDoesNotDemote() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");

        vm.prank(curator);
        registry.updateLaunchpadMetadata(address(pad), _padMeta("ipfs://src", "ipfs://audit"));
        assertEq(uint8(registry.getLaunchpad(address(pad)).verification), uint8(Verification.Audited));
    }

    /// @notice The other bait-and-switch: swap the implementation behind a proxy after the review.
    function test_verification_codeChangeDemotes() public {
        (HonestLaunchpad pad,) = _badgeableLaunchpad("ipfs://audit");
        vm.prank(curator);
        registry.setLaunchpadVerification(address(pad), Verification.Audited, "");

        // The live badge check notices immediately, before anybody calls the refresh.
        vm.etch(address(pad), type(SilentLaunchpad).runtimeCode);
        assertFalse(registry.isLaunchpadAudited(address(pad)));

        vm.prank(stranger);
        registry.refreshLaunchpadCode(address(pad));
        assertEq(uint8(registry.getLaunchpad(address(pad)).verification), uint8(Verification.Unverified));
    }

    function test_refreshLaunchpadCode_revertsWhenUnchanged() public {
        HonestLaunchpad pad = new HonestLaunchpad();
        registry.registerLaunchpad(address(pad), address(0), _padMeta("", ""));
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.CodehashUnchanged.selector, address(pad)));
        registry.refreshLaunchpadCode(address(pad));
    }

    /*//////////////////////////////////////////////////////////////
                    FORWARDING INTO THE LATCH REGISTRY
    //////////////////////////////////////////////////////////////*/

    /// @notice A launch carries exactly the evidence the Latch registry needs to move a hook off
    /// `SelfReported`, so it is pushed across for free.
    function test_forwarding_attestsTheHook() public {
        HonestHook hook = new HonestHook(SWAP_TAX);
        latchRegistry.register(
            address(hook),
            LatchMetadata({
                name: "Hook", description: "d", sourceURI: "ipfs://src", auditURI: "", chainIds: new uint256[](0)
            })
        );
        assertFalse(latchRegistry.isAttested(address(hook)));

        bytes32 poolId = _pool(address(token), address(quote), address(hook), SWAP_TAX);
        _register(poolId, address(token));

        assertTrue(latchRegistry.isAttested(address(hook)), "the launch's pool corroborated the hook");
        (uint32 count,,, bytes32 attestedPoolId,) = latchRegistry.attestationOf(address(hook));
        assertEq(count, 1);
        assertEq(attestedPoolId, poolId);
    }

    /// @notice An unlisted hook is not a reason to refuse a launch. The forward simply fails.
    function test_forwarding_isBestEffort() public {
        HonestHook hook = new HonestHook(TAME);
        bytes32 poolId = _pool(address(token), address(quote), address(hook), TAME);
        _register(poolId, address(token));

        assertTrue(registry.isLaunchRegistered(poolId));
        assertFalse(latchRegistry.isRegistered(address(hook)));
    }

    /// @notice And it can be retried once the hook is listed, which is the common ordering.
    function test_forwarding_standaloneRetry() public {
        HonestHook hook = new HonestHook(TAME);
        bytes32 poolId = _pool(address(token), address(quote), address(hook), TAME);
        _register(poolId, address(token));

        latchRegistry.register(
            address(hook),
            LatchMetadata({
                name: "Hook", description: "d", sourceURI: "ipfs://src", auditURI: "", chainIds: new uint256[](0)
            })
        );
        assertFalse(latchRegistry.isAttested(address(hook)));

        vm.prank(stranger);
        assertTrue(registry.attestHookFromLaunch(poolId));
        assertTrue(latchRegistry.isAttested(address(hook)));
    }

    function test_forwarding_hooklessPoolIsANoOp() public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));
        assertFalse(registry.attestHookFromLaunch(poolId));
    }

    /*//////////////////////////////////////////////////////////////
                             VIEWS & PAGING
    //////////////////////////////////////////////////////////////*/

    function test_views_revertForUnknownLaunch() public {
        bytes32 ghost = keccak256("ghost");
        bytes memory expected = abi.encodeWithSelector(ILatchLaunchRegistry.LaunchNotRegistered.selector, ghost);

        vm.expectRevert(expected);
        registry.getLaunch(ghost);
        vm.expectRevert(expected);
        registry.provenanceOf(ghost);
        vm.expectRevert(expected);
        registry.launchHookOf(ghost);
        vm.expectRevert(expected);
        registry.launchPairOf(ghost);
        vm.expectRevert(expected);
        registry.launchTokenInfoOf(ghost);
        vm.expectRevert(expected);
        registry.tokenCodeHasMoved(ghost);
        vm.expectRevert(expected);
        registry.refreshTokenInfo(ghost);
        vm.expectRevert(expected);
        registry.attestHookFromLaunch(ghost);

        assertFalse(registry.isLaunchRegistered(ghost));
    }

    function test_views_revertForUnknownLaunchpad() public {
        vm.expectRevert(abi.encodeWithSelector(ILatchLaunchRegistry.LaunchpadNotRegistered.selector, alice));
        registry.getLaunchpad(alice);
        assertFalse(registry.isLaunchpadRegistered(alice));
        assertFalse(registry.isLaunchpadAudited(alice));
    }

    function test_paging_clampsAndPreservesOrder() public {
        bytes32[] memory ids = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            GoodToken t = new GoodToken("T", "T", 18);
            ids[i] = _pool(address(t), address(quote), address(0), 0);
            _register(ids[i], address(t));
        }

        assertEq(registry.listLaunches(0, type(uint256).max).length, 5);
        assertEq(registry.listLaunches(3, 100).length, 2);
        assertEq(registry.listLaunches(5, 100).length, 0);
        bytes32[] memory middle = registry.listLaunches(1, 2);
        assertEq(middle[0], ids[1]);
        assertEq(middle[1], ids[2]);
    }

    function test_paging_offsetPastEndReverts() public {
        vm.expectRevert(RegistryPaging.InvalidRange.selector);
        registry.listLaunches(1, 1);
        vm.expectRevert(RegistryPaging.InvalidRange.selector);
        registry.listLaunchpads(1, 1);
    }

    /// @notice Paging must never panic, whatever offset and limit a front end passes.
    function testFuzz_paging_neverPanics(uint256 offset, uint256 limit) public {
        bytes32 poolId = _pool(address(token), address(quote), address(0), 0);
        _register(poolId, address(token));

        offset = bound(offset, 0, 1);
        try registry.listLaunches(offset, limit) returns (bytes32[] memory page) {
            assertLe(page.length, 1);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), RegistryPaging.InvalidRange.selector);
        }
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(ILatchLaunchRegistry.ZeroAddress.selector);
        new LatchLaunchRegistry(address(0), address(latchRegistry));
        vm.expectRevert(ILatchLaunchRegistry.ZeroAddress.selector);
        new LatchLaunchRegistry(address(vault), address(0));
    }

    function test_constructor_anchorsAreImmutableAndPublic() public view {
        assertEq(address(registry.vault()), address(vault));
        assertEq(address(registry.latchRegistry()), address(latchRegistry));
    }
}

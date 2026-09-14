// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {CLPoolManagerRouter} from "infinity-core/test/pool-cl/helpers/CLPoolManagerRouter.sol";
import {PoolKey} from "infinity-core/src/types/PoolKey.sol";
import {PoolId} from "infinity-core/src/types/PoolId.sol";
import {Currency} from "infinity-core/src/types/Currency.sol";
import {IHooks} from "infinity-core/src/interfaces/IHooks.sol";

import {IRevShareHook} from "../src/interfaces/IRevShareHook.sol";
import {SnapshotEpochDistributor} from "../src/distributors/SnapshotEpochDistributor.sol";

/**
 * The LEGACY RevShareHook ABI, as deployed on Sepolia at `0x1C86dc77…` from commit 313d015.
 *
 * Declared locally, deliberately, and NOT imported from `../src/RevShareHook.sol`. The current
 * source has an 8-word `PendingConfig` (it added `expiryBlock`) and a 6-argument constructor; the
 * deployed hook has a 7-word `PendingConfig` with no expiry. Decoding one shape with the other's
 * ABI either throws on every call or silently reads `feePips` as `expiryBlock` - see the keeper
 * README, "Two hook shapes on chain". The preflight below checks the RAW return length before
 * anything is decoded through this interface.
 */
interface ILegacyRevShareHook {
    struct ConfigParams {
        uint24 feePips;
        uint16 lpDonateBps;
        uint16 beneficiaryBps;
        uint16 distributorBps;
        address distributor;
        bool enabled;
    }

    struct PendingConfig {
        uint48 effectiveBlock;
        ConfigParams params;
    }

    struct PoolConfig {
        address owner;
        uint24 feePips;
        uint16 lpDonateBps;
        uint16 beneficiaryBps;
        uint16 distributorBps;
        bool enabled;
        bool frozen;
    }

    function CONFIG_DELAY_BLOCKS() external view returns (uint48);
    function paused() external view returns (bool);
    function getConfig(PoolId poolId) external view returns (PoolConfig memory);
    function getPendingConfig(PoolId poolId) external view returns (PendingConfig memory);
    function distributorOf(PoolId poolId) external view returns (address);
    function pendingDistributorShare(PoolId poolId, Currency currency) external view returns (uint256);
    function proposeConfig(PoolKey calldata key, ConfigParams calldata params) external;
    function applyPendingConfig(PoolKey calldata key) external;
    function cancelPendingConfig(PoolKey calldata key) external;
}

/**
 * ########################## REPOINT THE SEPOLIA POOL AT A `kind()` DISTRIBUTOR ##########################
 *
 * The only epoch distributor on any chain, Sepolia `0x5A908Ad9…`, predates `IEpochDistributor.kind()`.
 * Every consumer now reads it as `unknown` and refuses to decode its epochs, which is the correct
 * behaviour and leaves the dapp's populated revenue screens and the keeper's rollover job with
 * nothing to exercise. This file replaces it WITHOUT stranding holder funds beyond provable dust.
 *
 * ------------------------------- WHAT IS ON CHAIN (read 2026-09-13) -------------------------------
 *
 *   hook          0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28   legacy shape, CONFIG_DELAY_BLOCKS = 3600
 *   pool          0xfdce58bb…95ffb   votes-token / ltRSP, fee 3000, tickSpacing 60, INITIALIZED
 *   pool config   owner 0x615C9823… (Sepolia deployer EOA), feePips 50_000, 0 / 0 / 10_000 split,
 *                 enabled, NOT frozen, no pending proposal
 *   distributor   0x5A908Ad9…  SnapshotEpochDistributor (answers token(), reverts on kind()),
 *                 minEpochDuration 0, claimWindow 3600 s, epochCount 1, carryOver 0/0
 *   epoch 0       expired, NOT rolled over, remainder 14_721_584_142_822 / 14_718_652_178_491 wei
 *                 (the undelegated share: the Vault holds 2.955e20 of 1e24 votes-token supply)
 *
 * ------------------------------- HOW A DISTRIBUTOR IS CHANGED ON THIS HOOK -------------------------------
 *
 * `_distributors[poolId]` is written only by `_writeConfig`, reached by `configure` (refused once the
 * pool is initialised - `PoolAlreadyConfigured`) or by `proposeConfig` -> `applyPendingConfig`. So
 * the ONLY route is a proposal from the pool owner, a 3600-block wait (~12.3 h at Sepolia's measured
 * 12.3 s), then a PERMISSIONLESS apply. Consequences:
 *
 *   * The proposal has NO EXPIRY on this hook. Once mature, ANYONE may apply it at any moment -
 *     including a keeper running `applyPendingConfig` against this pool. Only `cancelPendingConfig`
 *     (pool owner) withdraws it. Treat step 3 as "this WILL be applied".
 *   * `freezeConfig` must NOT be called on this pool before step 4: it deletes the pending proposal
 *     and ends the owner's ability to repoint for ever.
 *
 * ------------------------------- WHAT HAPPENS TO THE OLD DISTRIBUTOR'S FUNDS -------------------------------
 *
 * The pot that has not been pulled yet (`pendingDistributor[poolId]`) is keyed by POOL, not by
 * distributor, so whatever accrues before the apply is pulled by the NEW distributor. Nothing there
 * is lost. The hazard is entirely inside the OLD distributor:
 *
 *   * `claim` never touches the hook, so every epoch the old distributor has ALREADY CLOSED stays
 *     claimable by its holders after the repoint, until that epoch's own `expiresAt`.
 *   * `rollover` never touches the hook either, and still works.
 *   * But `closeEpoch` calls `hook.pullDistributorShare`, which REVERTS `NotDistributor` for any
 *     caller that is not the current distributor. After the apply the old distributor can never
 *     close another epoch, so any `carryOver` it holds, and any unclaimed remainder that is later
 *     rolled into `carryOver`, is PERMANENTLY STRANDED.
 *
 * It cannot be driven to zero. The Vault holds undelegated voting supply (the pool's own liquidity),
 * which sits in every epoch's denominator and is claimable by nobody - each close pays out
 * ~99.97% and leaves ~0.03% to churn. So step 2 winds the old distributor down geometrically
 * (roll over, close one more epoch, claim for the known holder) and steps 3 and 4 REFUSE to proceed
 * while the amount that could strand exceeds `MAX_STRANDED_WEI`. One pass takes the bound from
 * ~1.47e13 to ~4.4e9 wei per token.
 *
 * ------------------------------- ROLES -------------------------------
 *
 * `SnapshotEpochDistributor` HAS NO OWNER, NO GUARDIAN AND NO `renounceOwnership`. It is not
 * `Ownable`; there is no admin function on it at all ("nobody posts anything, nobody can cancel
 * anything"). The Ownership table's distributor rows (Safe owner, Ops guardian) are for
 * `MerkleEpochDistributor`, which has `postRoot`/`cancelRoot`. There is therefore nothing to assign
 * to the Safe and nothing to renounce; step 1 ASSERTS that absence rather than assuming it, by
 * probing `owner()` and `renounceOwnership()` and requiring both to fail. The deployer key gains no
 * power by deploying it.
 *
 * The one privileged role in this procedure is the POOL OWNER on the legacy hook, `0x615C9823…`,
 * which is a pool-level role ("NOT ours, never assign") held by the Sepolia deployer EOA. Moving it
 * to the Safe is a separate decision this file does not make.
 *
 * ------------------------------- KEYS -------------------------------
 *
 * Every broadcasting step calls `_startBroadcast()`. Unless `BROADCAST_WITH_ENV_KEY=true` is set it
 * uses `vm.startBroadcast()` with NO key, so the sender comes from `--sender` for a simulation and
 * `PRIVATE_KEY` is never read. With the flag, it reads `vm.envUint("PRIVATE_KEY")` - the repo
 * convention - and never logs it.
 *
 * ------------------------------- ORDER, AND THE COMMANDS -------------------------------
 *
 *   RPC=https://ethereum-sepolia-rpc.publicnode.com
 *
 *   0. Dry run of the whole procedure on a fork, broadcast refused:
 *      forge script script/RepointSepoliaDistributor.s.sol:RehearseSepoliaDistributorRepoint \
 *        --rpc-url $RPC --sender 0x000000000000000000000000000000000000dEaD -vv
 *
 *   1. Deploy (any funded key; gains no role):
 *      BROADCAST_WITH_ENV_KEY=true forge script script/RepointSepoliaDistributor.s.sol:DeploySepoliaSnapshotDistributor \
 *        --rpc-url $RPC --broadcast --slow -vv
 *
 *   2. Wind the old distributor down (any funded key; permissionless). Re-run until it reports the
 *      stranded bound under MAX_STRANDED_WEI; with a 1 h claim window one pass is normally enough:
 *      BROADCAST_WITH_ENV_KEY=true forge script script/RepointSepoliaDistributor.s.sol:WindDownOldSepoliaDistributor \
 *        --rpc-url $RPC --broadcast --slow -vv
 *
 *   3. Propose (POOL OWNER key only, 0x615C9823…). Starts the 3600-block clock. No expiry:
 *      NEW_DISTRIBUTOR=0x… BROADCAST_WITH_ENV_KEY=true forge script script/RepointSepoliaDistributor.s.sol:ProposeSepoliaDistributorRepoint \
 *        --rpc-url $RPC --broadcast -vv
 *
 *   4. After >= 3600 blocks, apply (any funded key; permissionless):
 *      NEW_DISTRIBUTOR=0x… BROADCAST_WITH_ENV_KEY=true forge script script/RepointSepoliaDistributor.s.sol:ApplySepoliaDistributorRepoint \
 *        --rpc-url $RPC --broadcast -vv
 *
 *   5. Update `packages/keeper/keeper.config.json` (`distributor`) and every consumer that hardcodes
 *      `0x5A908Ad9…`. Not before step 4 lands - until then the old address IS the live one.
 */
abstract contract SepoliaRepointBase is Script {
    /* ------------------------------------------------------------------ live Sepolia addresses */

    address internal constant HOOK = 0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28;
    address payable internal constant OLD_DISTRIBUTOR = payable(0x5A908Ad96Bd4770B65c8E83a9ede093C1Cb7966c);
    address internal constant CL_POOL_MANAGER = 0xb7C8a11E0B359616eD06256783aF57114841F738;

    /// The votes token (currency0) and the pair token (currency1).
    address internal constant VOTES_TOKEN = 0x72368a4F5aBE0aF1c2735a14C468680649De6163;
    address internal constant PAIR_TOKEN = 0xBd9491b0121EFACA4782859FE2E8E2b3355bE0F2;
    uint24 internal constant LP_FEE = 3000;
    bytes32 internal constant PARAMETERS = 0x00000000000000000000000000000000000000000000000000000000003c0881;
    bytes32 internal constant POOL_ID = 0xfdce58bb8c3d5ab5e42b2dbc002334de5208b29806fccc49e503ffb0faa95ffb;

    /// The pool owner on the legacy hook. A pool-level role, not a protocol one.
    address internal constant POOL_OWNER = 0x615C982337f534aeCB4eDB4092b04fab31F57854;

    /// The only delegated holder of the votes token. Claims are permissionless and pay the ACCOUNT,
    /// so step 2 can submit them on its behalf without holding its key.
    address internal constant HOLDER = 0x615C982337f534aeCB4eDB4092b04fab31F57854;

    /// The `CLPoolManagerRouter` the original exercise deployed and the holder already approved.
    /// Used by the rehearsal only, to put a real swap through the repointed pool.
    address internal constant EXERCISE_ROUTER = 0x8FA46F53892Fe124b44febAEB9420a08AAA02e8C;

    /// The legacy hook's delay, in blocks. Sepolia measured 12.32 s/block (261 blocks / 3216 s at
    /// block 11699261), so this is ~12.3 h of wall clock - adequate on this chain. It would be SIX
    /// MINUTES on Robinhood; this constant must never be reasoned about as time elsewhere.
    uint48 internal constant EXPECTED_CONFIG_DELAY_BLOCKS = 3600;

    /// `keccak256("latch.revshare.distributor.snapshot.v1")`, written out as a literal so a change to
    /// the library constant cannot make this assertion agree with itself.
    bytes32 internal constant SNAPSHOT_KIND = 0x6c8c753e7c890a8073f5cfa610b29805cf941f79c7bf9c9a8bbac78de7c5a7c1;

    /* ------------------------------------------------------------------ new distributor windows */

    /// WALL-CLOCK SECONDS. `SnapshotEpochDistributor` compares against `block.timestamp`, so these
    /// mean the same thing on every chain - unlike the hook's block-count delay above.
    ///
    /// One day between closes: well above the 1 h `MIN_EPOCH_DURATION_FLOOR`, and it bounds the
    /// snapshot-sniping edge documented on `closeEpoch` to once per day on a token nobody trades.
    /// Days rather than hours is the contract's own advice for a thin token.
    uint64 internal constant MIN_EPOCH_DURATION = 1 days;

    /// Two days to claim before `rollover`. Long enough that a holder who checks daily cannot miss an
    /// epoch; short enough that the keeper's rollover job gets exercised on a testnet within a week.
    uint64 internal constant CLAIM_WINDOW = 2 days;

    /// Largest amount, per currency, that steps 3 and 4 will allow to become permanently stranded in
    /// the old distributor. 1e12 wei is 1e-6 of an 18-decimal token. The true floor is set by the
    /// undelegated Vault balance (~0.03% of each close) and is not zero; see the header.
    uint256 internal constant MAX_STRANDED_WEI = 1e12;

    /* ------------------------------------------------------------------ helpers */

    function _startBroadcast() internal {
        if (vm.envOr("BROADCAST_WITH_ENV_KEY", false)) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        } else {
            // No key read. The sender is `--sender` (simulation) or a forge key flag.
            vm.startBroadcast();
        }
    }

    function _key() internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(VOTES_TOKEN),
            currency1: Currency.wrap(PAIR_TOKEN),
            hooks: IHooks(HOOK),
            poolManager: ICLPoolManager(CL_POOL_MANAGER),
            fee: LP_FEE,
            parameters: PARAMETERS
        });
    }

    /// Every fact the procedure depends on, read off chain and asserted. Run first by every step.
    function _preflight() internal view returns (ILegacyRevShareHook.PoolConfig memory cfg) {
        require(block.chainid == 11155111, "not Ethereum Sepolia");
        require(HOOK.code.length > 0, "hook has no code");
        require(OLD_DISTRIBUTOR.code.length > 0, "old distributor has no code");

        PoolKey memory key = _key();
        require(PoolId.unwrap(key.toId()) == POOL_ID, "pool key does not hash to POOL_ID");

        // SHAPE CHECK FIRST, before decoding anything through the legacy interface.
        (bool ok, bytes memory raw) =
            HOOK.staticcall(abi.encodeWithSelector(ILegacyRevShareHook.getPendingConfig.selector, key.toId()));
        require(ok, "getPendingConfig reverted");
        require(raw.length == 7 * 32, "hook is not the 7-word legacy shape - wrong hook or wrong ABI");

        ILegacyRevShareHook hook = ILegacyRevShareHook(HOOK);
        require(hook.CONFIG_DELAY_BLOCKS() == EXPECTED_CONFIG_DELAY_BLOCKS, "CONFIG_DELAY_BLOCKS changed");

        cfg = hook.getConfig(key.toId());
        require(cfg.owner == POOL_OWNER, "pool owner is not the recorded owner");
        require(!cfg.frozen, "pool config is FROZEN - the distributor can never be changed");

        // The old distributor must be the one bound to this exact pool.
        SnapshotEpochDistributor old = SnapshotEpochDistributor(OLD_DISTRIBUTOR);
        require(address(old.hook()) == HOOK, "old distributor serves another hook");
        require(address(old.token()) == VOTES_TOKEN, "old distributor pays another token");
        require(PoolId.unwrap(old.poolId()) == POOL_ID, "old distributor serves another pool");
    }

    /// Upper bound on what would be stranded in the old distributor if the repoint landed now:
    /// its carry-over plus the unclaimed remainder of every epoch not yet rolled over. Conservative -
    /// holders can still claim from an unexpired epoch after the repoint, which only lowers it.
    function _strandableBound() internal view returns (uint256 bound0, uint256 bound1) {
        SnapshotEpochDistributor old = SnapshotEpochDistributor(OLD_DISTRIBUTOR);
        bound0 = old.carryOver0();
        bound1 = old.carryOver1();
        uint256 count = old.epochCount();
        for (uint256 i = 0; i < count; i++) {
            SnapshotEpochDistributor.Epoch memory e = old.getEpoch(i);
            if (e.rolledOver) continue;
            bound0 += e.amount0 - e.claimed0;
            bound1 += e.amount1 - e.claimed1;
        }
    }

    function _logStrandable(string memory when) internal view returns (uint256 b0, uint256 b1) {
        (b0, b1) = _strandableBound();
        console.log(string.concat("  strandable bound ", when, " (c0, c1):"), b0, b1);
    }

    /// Assert the deployed distributor is exactly what step 1 means to deploy, and that it has no
    /// admin surface at all.
    function _assertNewDistributor(SnapshotEpochDistributor d, uint256 deployedAt) internal {
        require(address(d).code.length > 0, "new distributor has no code");
        require(d.kind() == SNAPSHOT_KIND, "kind() is not the snapshot constant");
        require(d.kind() == keccak256("latch.revshare.distributor.snapshot.v1"), "kind() string drift");
        require(address(d.hook()) == HOOK, "hook mismatch");
        require(address(d.token()) == VOTES_TOKEN, "token mismatch");
        require(PoolId.unwrap(d.poolId()) == POOL_ID, "pool mismatch");
        require(d.clockIsBlockNumber(), "votes token clock should be block-numbered (CLOCK_MODE=blocknumber)");
        require(d.minEpochDuration() == MIN_EPOCH_DURATION, "minEpochDuration mismatch");
        require(d.claimWindow() == CLAIM_WINDOW, "claimWindow mismatch");
        require(d.minEpochDuration() >= d.MIN_EPOCH_DURATION_FLOOR(), "below floor");
        require(d.epochCount() == 0, "fresh distributor has epochs");
        require(d.carryOver0() == 0 && d.carryOver1() == 0, "fresh distributor has carry-over");
        require(uint256(d.lastCloseAt()) == deployedAt, "cooldown clock not seeded at construction");

        // NO ADMIN SURFACE. Probed, not assumed: neither selector may succeed.
        (bool hasOwner,) = address(d).staticcall(abi.encodeWithSignature("owner()"));
        require(!hasOwner, "distributor unexpectedly answers owner()");
        (bool canRenounce,) = address(d).call(abi.encodeWithSignature("renounceOwnership()"));
        require(!canRenounce, "distributor unexpectedly accepts renounceOwnership()");
        (bool hasGuardian,) = address(d).staticcall(abi.encodeWithSignature("guardian()"));
        require(!hasGuardian, "distributor unexpectedly answers guardian()");

        console.log("  [ok] kind()              ", vm.toString(d.kind()));
        console.log("  [ok] hook / token / pool match the live pool");
        console.log("  [ok] minEpochDuration s  ", d.minEpochDuration());
        console.log("  [ok] claimWindow s       ", d.claimWindow());
        console.log("  [ok] lastCloseAt seeded  ", d.lastCloseAt());
        console.log("  [ok] no owner(), no guardian(), renounceOwnership() does not exist");
    }

    function _deployDistributor() internal returns (SnapshotEpochDistributor d) {
        _startBroadcast();
        d = new SnapshotEpochDistributor(
            IRevShareHook(HOOK), _key(), IVotes(VOTES_TOKEN), MIN_EPOCH_DURATION, CLAIM_WINDOW
        );
        vm.stopBroadcast();
        _assertNewDistributor(d, block.timestamp);
    }

    /// One idempotent wind-down pass over the old distributor. Every call here is permissionless.
    function _windDownPass() internal {
        SnapshotEpochDistributor old = SnapshotEpochDistributor(OLD_DISTRIBUTOR);
        ILegacyRevShareHook hook = ILegacyRevShareHook(HOOK);
        PoolKey memory key = _key();

        uint256 count = old.epochCount();

        // (a) roll over every expired epoch, so its remainder becomes closable carry-over.
        for (uint256 i = 0; i < count; i++) {
            SnapshotEpochDistributor.Epoch memory e = old.getEpoch(i);
            if (e.rolledOver || block.timestamp < e.expiresAt) continue;
            _startBroadcast();
            old.rollover(i);
            vm.stopBroadcast();
            console.log("  rolled over old epoch", i);
        }

        // (b) close one more epoch while the old distributor still CAN close - i.e. before the
        // repoint. It pulls the pool's pending share too, which is correct: the holders are the same.
        uint256 pending0 = hook.pendingDistributorShare(key.toId(), key.currency0);
        uint256 pending1 = hook.pendingDistributorShare(key.toId(), key.currency1);
        if (old.carryOver0() + old.carryOver1() + pending0 + pending1 != 0) {
            require(hook.distributorOf(key.toId()) == OLD_DISTRIBUTOR, "already repointed - old cannot close");
            _startBroadcast();
            uint256 id = old.closeEpoch();
            vm.stopBroadcast();
            console.log("  closed old epoch", id);
            count = old.epochCount();
        }

        // (c) claim for the known holder on every open epoch. Pays the HOLDER, not the caller.
        for (uint256 i = 0; i < count; i++) {
            SnapshotEpochDistributor.Epoch memory e = old.getEpoch(i);
            if (e.rolledOver || block.timestamp >= e.expiresAt || old.claimed(i, HOLDER)) continue;
            (uint256 c0, uint256 c1) = old.claimableAmounts(i, HOLDER);
            if (c0 == 0 && c1 == 0) continue;
            _startBroadcast();
            old.claim(i, HOLDER);
            vm.stopBroadcast();
            console.log("  claimed old epoch for holder (epoch, c0, c1):", i, c0, c1);
        }
    }

    function _requireStrandableUnderBound(string memory when) internal view {
        (uint256 b0, uint256 b1) = _logStrandable(when);
        require(
            b0 <= MAX_STRANDED_WEI && b1 <= MAX_STRANDED_WEI,
            "old distributor would strand more than MAX_STRANDED_WEI - run WindDownOldSepoliaDistributor (again, after the claim window)"
        );
    }

    function _repointParams(ILegacyRevShareHook.PoolConfig memory cfg, address newDistributor)
        internal
        pure
        returns (ILegacyRevShareHook.ConfigParams memory)
    {
        // Identical economics; ONLY the distributor changes. A repoint must not be a fee change
        // riding along on a housekeeping proposal.
        return ILegacyRevShareHook.ConfigParams({
            feePips: cfg.feePips,
            lpDonateBps: cfg.lpDonateBps,
            beneficiaryBps: cfg.beneficiaryBps,
            distributorBps: cfg.distributorBps,
            distributor: newDistributor,
            enabled: cfg.enabled
        });
    }

    function _requireNewDistributorForThisPool(address newDistributor) internal view {
        require(newDistributor != address(0) && newDistributor.code.length > 0, "NEW_DISTRIBUTOR has no code");
        require(newDistributor != OLD_DISTRIBUTOR, "NEW_DISTRIBUTOR is the old one");
        SnapshotEpochDistributor d = SnapshotEpochDistributor(payable(newDistributor));
        require(d.kind() == SNAPSHOT_KIND, "NEW_DISTRIBUTOR does not answer the snapshot kind()");
        require(address(d.hook()) == HOOK && PoolId.unwrap(d.poolId()) == POOL_ID, "NEW_DISTRIBUTOR bound elsewhere");
        require(address(d.token()) == VOTES_TOKEN, "NEW_DISTRIBUTOR pays another token");
    }

    function _propose(ILegacyRevShareHook.PoolConfig memory cfg, address newDistributor)
        internal
        returns (uint48 effectiveBlock)
    {
        ILegacyRevShareHook hook = ILegacyRevShareHook(HOOK);
        PoolKey memory key = _key();
        require(hook.getPendingConfig(key.toId()).effectiveBlock == 0, "a proposal is already pending - inspect it first");
        require(hook.distributorOf(key.toId()) == OLD_DISTRIBUTOR, "pool no longer points at the old distributor");

        _startBroadcast();
        hook.proposeConfig(key, _repointParams(cfg, newDistributor));
        vm.stopBroadcast();

        ILegacyRevShareHook.PendingConfig memory p = hook.getPendingConfig(key.toId());
        effectiveBlock = p.effectiveBlock;
        require(effectiveBlock == uint48(block.number) + EXPECTED_CONFIG_DELAY_BLOCKS, "effectiveBlock unexpected");
        require(p.params.distributor == newDistributor, "pending distributor mismatch");
        require(p.params.feePips == cfg.feePips && p.params.distributorBps == cfg.distributorBps, "pending economics changed");
        require(p.params.lpDonateBps == cfg.lpDonateBps && p.params.beneficiaryBps == cfg.beneficiaryBps, "pending split changed");
        require(p.params.enabled == cfg.enabled, "pending enabled flag changed");
        console.log("  proposed; effectiveBlock", effectiveBlock);
    }

    function _apply(ILegacyRevShareHook.PoolConfig memory cfgBefore, address newDistributor) internal {
        ILegacyRevShareHook hook = ILegacyRevShareHook(HOOK);
        PoolKey memory key = _key();
        ILegacyRevShareHook.PendingConfig memory p = hook.getPendingConfig(key.toId());
        require(p.effectiveBlock != 0, "nothing pending");
        require(p.params.distributor == newDistributor, "the pending proposal names a different distributor");
        require(block.number >= p.effectiveBlock, "not due yet - applyPendingConfig would revert PendingConfigNotDue");

        _startBroadcast();
        hook.applyPendingConfig(key);
        vm.stopBroadcast();

        ILegacyRevShareHook.PoolConfig memory cfg = hook.getConfig(key.toId());
        require(hook.distributorOf(key.toId()) == newDistributor, "distributorOf did not move");
        require(hook.getPendingConfig(key.toId()).effectiveBlock == 0, "pending not cleared");
        require(cfg.owner == cfgBefore.owner && !cfg.frozen, "owner/frozen changed");
        require(cfg.feePips == cfgBefore.feePips && cfg.distributorBps == cfgBefore.distributorBps, "economics changed");
        require(cfg.lpDonateBps == cfgBefore.lpDonateBps && cfg.beneficiaryBps == cfgBefore.beneficiaryBps, "split changed");
        require(cfg.enabled == cfgBefore.enabled, "enabled changed");
        console.log("  applied; distributorOf =", newDistributor);
    }
}

/* ============================================================================================= */

/// Step 1. Deploy the replacement. Any funded key; the deployer gains no role.
contract DeploySepoliaSnapshotDistributor is SepoliaRepointBase {
    function run() external {
        _preflight();
        console.log("=== step 1: deploy SnapshotEpochDistributor with kind() ===");
        SnapshotEpochDistributor d = _deployDistributor();
        console.log("");
        console.log("NEW_DISTRIBUTOR", address(d));
        console.log("Nothing points at it yet. Next: WindDownOldSepoliaDistributor.");
    }
}

/// Step 2. Wind the old distributor down while it can still close. Permissionless; idempotent.
contract WindDownOldSepoliaDistributor is SepoliaRepointBase {
    function run() external {
        _preflight();
        console.log("=== step 2: wind down the old distributor ===");
        _logStrandable("before");
        _windDownPass();
        (uint256 b0, uint256 b1) = _logStrandable("after");
        if (b0 > MAX_STRANDED_WEI || b1 > MAX_STRANDED_WEI) {
            console.log("  STILL ABOVE MAX_STRANDED_WEI. Re-run after the old claim window (1 h) elapses.");
        } else {
            console.log("  under MAX_STRANDED_WEI. Step 3 may proceed.");
        }
    }
}

/// Step 3. Propose the repoint. POOL OWNER ONLY. Starts a delay that has no expiry on this hook.
contract ProposeSepoliaDistributorRepoint is SepoliaRepointBase {
    function run() external {
        ILegacyRevShareHook.PoolConfig memory cfg = _preflight();
        address newDistributor = vm.envAddress("NEW_DISTRIBUTOR");
        console.log("=== step 3: propose repoint ===");
        console.log("  !! Once mature this proposal NEVER expires and ANYONE can apply it.");
        console.log("  !! Only cancelPendingConfig (pool owner) withdraws it. Do NOT freezeConfig this pool.");
        _requireNewDistributorForThisPool(newDistributor);
        _requireStrandableUnderBound("at proposal");
        _propose(cfg, newDistributor);
    }
}

/// Step 4. Apply once due. Permissionless.
contract ApplySepoliaDistributorRepoint is SepoliaRepointBase {
    function run() external {
        ILegacyRevShareHook.PoolConfig memory cfg = _preflight();
        address newDistributor = vm.envAddress("NEW_DISTRIBUTOR");
        console.log("=== step 4: apply repoint ===");
        _requireNewDistributorForThisPool(newDistributor);
        // Re-checked: anyone may have closed another old epoch during the delay.
        _requireStrandableUnderBound("at apply");
        _apply(cfg, newDistributor);
    }
}

/* ============================================================================================= */

/**
 * The whole procedure on a Sepolia fork, with the 3600-block delay rolled forward, a real swap
 * through the repointed pool and a real close on the new distributor. SIMULATION ONLY: it uses
 * `vm.prank`, `vm.roll` and `vm.warp`, none of which a broadcast can honour, so it refuses to run
 * under `--broadcast`.
 */
contract RehearseSepoliaDistributorRepoint is SepoliaRepointBase {
    uint160 internal constant SQRT_RATIO_1_1 = 79228162514264337593543950336;

    function run() external {
        require(!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast), "rehearsal only: refuses --broadcast");
        require(!vm.isContext(VmSafe.ForgeContext.ScriptResume), "rehearsal only: refuses --resume");

        ILegacyRevShareHook.PoolConfig memory cfg = _preflight();
        ILegacyRevShareHook hook = ILegacyRevShareHook(HOOK);
        SnapshotEpochDistributor old = SnapshotEpochDistributor(OLD_DISTRIBUTOR);
        PoolKey memory key = _key();
        uint256 checks;

        console.log("=== REHEARSAL: repoint Sepolia pool to a kind() distributor ===");
        console.log("  block", block.number, "timestamp", block.timestamp);

        (bool oldKindOk,) = OLD_DISTRIBUTOR.staticcall(abi.encodeWithSignature("kind()"));
        require(!oldKindOk, "old distributor answers kind() - premise of this script is wrong");
        console.log("  [ok] old distributor reverts on kind() - consumers read it as unknown");
        checks++;

        /* ---- step 1 */
        console.log("");
        console.log("--- step 1: deploy");
        SnapshotEpochDistributor d = _deployDistributor();
        checks += 6;

        /* ---- the gate: step 3 must refuse while the old distributor could strand real value */
        (uint256 s0, uint256 s1) = _logStrandable("before wind-down");
        require(s0 > MAX_STRANDED_WEI || s1 > MAX_STRANDED_WEI, "expected the live remainder to be above the bound");
        console.log("  [ok] the stranded-funds gate would REFUSE step 3 right now");
        checks++;

        /* ---- step 2 */
        console.log("");
        console.log("--- step 2: wind down");
        _windDownPass();
        _requireStrandableUnderBound("after one pass");
        console.log("  [ok] one pass brings the strandable bound under MAX_STRANDED_WEI");
        checks++;

        /* ---- step 3, as the pool owner */
        console.log("");
        console.log("--- step 3: propose (pranked as pool owner)");
        _requireNewDistributorForThisPool(address(d));
        vm.prank(POOL_OWNER);
        hook.proposeConfig(key, _repointParams(cfg, address(d)));
        ILegacyRevShareHook.PendingConfig memory p = hook.getPendingConfig(key.toId());
        require(p.effectiveBlock == uint48(block.number) + EXPECTED_CONFIG_DELAY_BLOCKS, "effectiveBlock");
        require(p.params.distributor == address(d), "pending distributor");
        console.log("  [ok] proposed, effectiveBlock", p.effectiveBlock);
        checks++;

        // A stranger cannot propose.
        vm.prank(address(0xBEEF));
        try hook.proposeConfig(key, _repointParams(cfg, address(0xBEEF))) {
            revert("a non-owner was able to propose");
        } catch {
            console.log("  [ok] a non-owner proposal reverts");
            checks++;
        }

        // Not due yet.
        try hook.applyPendingConfig(key) {
            revert("applied before the delay");
        } catch {
            console.log("  [ok] applyPendingConfig before effectiveBlock reverts");
            checks++;
        }

        /* ---- step 4, after the delay, from an arbitrary address */
        console.log("");
        console.log("--- step 4: roll 3600 blocks (~12.3 h), apply from a stranger");
        vm.roll(p.effectiveBlock);
        vm.warp(block.timestamp + uint256(EXPECTED_CONFIG_DELAY_BLOCKS) * 13);
        vm.prank(address(0xCAFE));
        hook.applyPendingConfig(key);
        require(hook.distributorOf(key.toId()) == address(d), "not repointed");
        ILegacyRevShareHook.PoolConfig memory after_ = hook.getConfig(key.toId());
        require(after_.feePips == cfg.feePips && after_.distributorBps == cfg.distributorBps, "economics moved");
        require(after_.owner == cfg.owner && !after_.frozen && after_.enabled == cfg.enabled, "owner/flags moved");
        console.log("  [ok] permissionless apply repointed the pool; fee and split unchanged");
        checks++;

        /* ---- what the old distributor can and cannot still do */
        console.log("");
        console.log("--- old distributor after the repoint");
        vm.warp(block.timestamp + CLAIM_WINDOW + 1); // every old epoch is long expired
        uint256 oldCount = old.epochCount();
        for (uint256 i = 0; i < oldCount; i++) {
            if (!old.getEpoch(i).rolledOver) old.rollover(i);
        }
        console.log("  [ok] rollover still works without the hook");
        checks++;
        (uint256 stranded0, uint256 stranded1) = (old.carryOver0(), old.carryOver1());
        try old.closeEpoch() {
            revert("old distributor could still close - the strand analysis is wrong");
        } catch {
            console.log("  [ok] old closeEpoch now reverts (NotDistributor)");
            console.log("  PERMANENTLY STRANDED in old distributor (c0, c1):", stranded0, stranded1);
            checks++;
        }
        require(stranded0 <= MAX_STRANDED_WEI && stranded1 <= MAX_STRANDED_WEI, "stranded above bound");

        /* ---- the new distributor end to end: swap -> accrue -> close -> claim */
        console.log("");
        console.log("--- new distributor end to end");
        CLPoolManagerRouter router = CLPoolManagerRouter(EXERCISE_ROUTER);
        vm.startPrank(HOLDER);
        router.swap(
            key,
            ICLPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: SQRT_RATIO_1_1 / 2}),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        router.swap(
            key,
            ICLPoolManager.SwapParams({zeroForOne: false, amountSpecified: -1 ether, sqrtPriceLimitX96: SQRT_RATIO_1_1 * 2}),
            CLPoolManagerRouter.SwapTestSettings({withdrawTokens: true, settleUsingTransfer: true}),
            ""
        );
        vm.stopPrank();
        uint256 acc0 = hook.pendingDistributorShare(key.toId(), key.currency0);
        uint256 acc1 = hook.pendingDistributorShare(key.toId(), key.currency1);
        require(acc0 > 0 && acc1 > 0, "swaps accrued nothing to the distributor pot");
        console.log("  [ok] two swaps accrued to the pool pot (c0, c1):", acc0, acc1);
        checks++;

        // The cooldown is seeded at construction, so a close exactly one second early must revert.
        uint256 due = uint256(d.lastCloseAt()) + MIN_EPOCH_DURATION;
        uint256 resumeAt = block.timestamp > due ? block.timestamp : due;
        vm.warp(due - 1);
        try d.closeEpoch() {
            revert("closed before minEpochDuration");
        } catch {
            console.log("  [ok] closeEpoch one second before minEpochDuration reverts (EpochTooSoon)");
            checks++;
        }
        vm.warp(resumeAt);
        vm.roll(block.number + 1);
        uint256 epochId = d.closeEpoch();
        SnapshotEpochDistributor.Epoch memory e = d.getEpoch(epochId);
        require(e.amount0 == acc0 && e.amount1 == acc1, "new epoch did not pull exactly the pot");
        require(hook.pendingDistributorShare(key.toId(), key.currency0) == 0, "pot not emptied");
        console.log("  [ok] new closeEpoch pulled the whole pot through the LEGACY hook (c0, c1):", e.amount0, e.amount1);
        checks++;

        (uint256 want0, uint256 want1) = d.claimableAmounts(epochId, HOLDER);
        (uint256 got0, uint256 got1) = d.claim(epochId, HOLDER);
        require(got0 == want0 && got1 == want1 && got0 > 0, "claim mismatch");
        console.log("  [ok] holder claim paid (c0, c1):", got0, got1);
        checks++;

        require(d.kind() == SNAPSHOT_KIND, "kind drift");
        console.log("");
        console.log("=== rehearsal passed:", checks, "checks ===");
        console.log("kind() =", vm.toString(d.kind()));
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";

import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";
import {ICLPositionManager} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionManager.sol";
import {IImmutableState} from "infinity-periphery/src/interfaces/IImmutableState.sol";
import {Permit2Forwarder} from "infinity-periphery/src/base/Permit2Forwarder.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";

import {LaunchpadKit} from "../src/LaunchpadKit.sol";
import {IHookRegistryListing} from "../src/interfaces/IHookRegistryListing.sol";
import {LaunchPresets, Preset} from "../src/libraries/LaunchPresets.sol";

/**
 * STEP 2 OF 2. Deploys `LaunchpadKit` to a MAINNET chain.
 *
 * Run `DeployLaunchGuardHookMainnet.s.sol` first and export its address as
 * `LAUNCH_GUARD_HOOK`. The kit pins the hook as an immutable and verifies it in
 * its own constructor, so a kit deployed against the wrong hook is not a
 * misconfiguration to be corrected later — it is a contract to abandon.
 *
 * ############################ WHAT CANNOT BE UNDONE ############################
 *
 * Everything. `LaunchpadKit` has no owner, no admin, no guardian, no pause and
 * no upgrade path, and every constructor argument is an immutable. There is no
 * function on it that governance could call, which is why it has no row of its
 * own in CLAUDE.md's ownership table beyond "nothing to assign". The flip side
 * is that a wrong argument here is permanent, so every one of them is asserted
 * before the broadcast and read back after it.
 *
 * OWNERSHIP: THE `Ownable2Step` TRAP DOES NOT APPLY HERE, and that is worth
 * stating rather than leaving to inference. Elsewhere in this protocol
 * `transferOwnership` only NOMINATES — the nominee must call
 * `acceptOwnership()`, and a script that transfers and prints success leaves
 * the deployer in place looking fine on a block explorer. This contract is not
 * `Ownable` at all. Nothing is pending, nothing needs accepting, and the
 * deployer holds no authority over it the moment this script returns. The only
 * authority the kit ever exercises is being the hook's `launchOwner` for pools
 * it creates, which it delegates to the per-launch `operator` recorded at
 * `createLaunch`. That operator is chosen by the launcher, not by governance.
 *
 * BLOCK TIME IS THE ARGUMENT TO GET RIGHT, and the one nothing on chain will
 * catch for you. `blockTimeCentis` is the divisor that turns a preset's
 * second-denominated window into blocks. Declare the chain slower than it is
 * and every launch window is proportionally SHORT — the anti-sniper tax lifts
 * early, silently, in the sniper's favour. Declare it faster and windows run
 * long, which is the safe direction.
 *
 *   Measured on Robinhood Chain (4663), 500 000 blocks: 51 000s => 0.102 s/block
 *   => 10.2 centis. Declare 10, not 11: rounding the block time DOWN rounds the
 *   window UP, so a "five minute" FairLaunch spans 3 000 blocks = 306 real
 *   seconds rather than 278.
 *
 * Re-measure before running this on any chain. Two `cast block` reads a few
 * hundred thousand blocks apart is the whole procedure:
 *   BN=$(cast block-number --rpc-url $RPC)
 *   echo $(( ( $(cast block $BN --field timestamp --rpc-url $RPC) \
 *            - $(cast block $((BN-500000)) --field timestamp --rpc-url $RPC) ) * 100 / 500000 ))
 *
 * The script prints every preset's resolved window in blocks AND in real
 * seconds at the declared block time, so a wrong value is visible in the dry
 * run rather than in a launch six weeks from now.
 *
 * THE REGISTRY IS IMMUTABLE ON THE KIT. `LaunchpadKit` cannot be re-pointed at
 * a new registry, and this project has already replaced one
 * (`LatchHookRegistry` -> `LatchRegistry`, 2026-09-10, with the retired address
 * still answering `hookCount()` and still holding the original listing). Give
 * this the LIVE registry or `address(0)`; a dead one bricks the listing path
 * for the life of the kit. `address(0)` must be passed explicitly — there is no
 * default, because "I forgot to set it" and "I meant no registry" must not look
 * the same.
 *
 * BUILD PROFILE: THE DEFAULT ONE. Robinhood Chain supports EIP-1153 (verified
 * across its endpoints — see `packages/sdk/src/chains/endpoints.ts`), so this
 * deploys the cancun build. Neither contract deployed here uses transient
 * storage itself, but a cancun build emits MCOPY, and `FOUNDRY_PROFILE=legacy`
 * would produce shanghai bytecode that is merely less efficient rather than
 * wrong. Do NOT reach for the legacy profile on this chain: the live Vault and
 * position manager are the cancun build, and mixing backends is how
 * `TransientSlot.IS_EIP1153` stops meaning anything.

 * NO CREATE3, for the same reasons as step 1: nothing depends on this address
 * being identical across chains, and a CREATE3 broadcast artifact reports the
 * FACTORY as `contractAddress` with the real deployment buried in the `CREATE`
 * entry of `additionalContracts`.
 *
 * WHAT THIS SCRIPT DELIBERATELY DOES NOT DO. It creates no pool, seeds no
 * liquidity and lists nothing in the registry. Listing the hook is a separate,
 * permissionless act (`LaunchpadKit.listHook`, or the registry directly) whose
 * steward is a human decision. A deployment that quietly creates a pool as a
 * side effect is how a test fixture ends up on mainnet.
 *
 * Usage (dry run first — no --broadcast):
 *   CL_POOL_MANAGER=0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66 \
 *   LAUNCH_GUARD_HOOK=0x...                                    \
 *   CL_POSITION_MANAGER=0x957cc13b24a563cc92253213d9d5e6954c8db6a7 \
 *   PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3          \
 *   LAUNCHPAD_REGISTRY=0xE4395085De89365440A6Ee25cE24BE2bAD66AC86 \
 *   LAUNCHPAD_BLOCK_TIME_CENTIS=10                              \
 *   forge script script/DeployLaunchpadKitMainnet.s.sol --rpc-url $ROBINHOOD_RPC
 *
 * Then, when a human has read the simulation:
 *   ... --broadcast --slow
 */
contract DeployLaunchpadKitMainnetScript is Script {
    /// @dev Duplicated from the kit rather than read off it: an assertion that sources its
    /// expectation from the contract under test asserts nothing.
    uint16 internal constant EXPECTED_HOOK_BITMAP = 0x0041;

    /// @notice Every input this deployment takes. Immutable on the kit once it is built, all
    /// of it, which is why the struct is spelled out rather than passed as six loose addresses.
    struct Wiring {
        /// @dev Deployer key. Never a literal - `run` takes it from `PRIVATE_KEY`.
        uint256 pk;
        address poolManager;
        address hook;
        address positionManager;
        address permit2;
        /// @dev `address(0)` disables listing for the life of the kit.
        address registry;
        /// @dev Hundredths of a second per block. See the header; this is the one to get right.
        uint256 blockTimeCentis;
    }

    /// @notice Entry point. Reads the environment and hands off to `runWith`.
    /// @dev The environment is read HERE AND NOWHERE ELSE, so `runWith` can be driven directly by
    /// `test/DeployScripts.t.sol`. That split is not cosmetic: forge runs test cases concurrently
    /// against one shared process environment, so a harness that configured a script through
    /// `vm.setEnv` would race with every other test in the file and go green or red by timing.
    /// Env in one function, logic in another, and the logic is what gets tested.
    /// @return kit The deployed kit. Returned so `forge script --json` reports the address
    /// without anyone having to parse a broadcast artifact for it.
    function run() public returns (LaunchpadKit kit) {
        return runWith(
            Wiring({
                pk: vm.envUint("PRIVATE_KEY"),
                poolManager: vm.envAddress("CL_POOL_MANAGER"),
                hook: vm.envAddress("LAUNCH_GUARD_HOOK"),
                positionManager: vm.envAddress("CL_POSITION_MANAGER"),
                permit2: vm.envAddress("PERMIT2"),
                registry: vm.envAddress("LAUNCHPAD_REGISTRY"),
                blockTimeCentis: vm.envUint("LAUNCHPAD_BLOCK_TIME_CENTIS")
            })
        );
    }

    function runWith(Wiring memory w) public returns (LaunchpadKit kit) {
        _preflight(w);
        _reportSchedule(uint32(w.blockTimeCentis), LaunchGuardHook(w.hook).MAX_DECAY_BLOCKS());

        vm.startBroadcast(w.pk);
        kit = new LaunchpadKit(
            ICLPoolManager(w.poolManager),
            LaunchGuardHook(w.hook),
            ICLPositionManager(w.positionManager),
            IAllowanceTransfer(w.permit2),
            IHookRegistryListing(w.registry),
            uint32(w.blockTimeCentis)
        );
        vm.stopBroadcast();

        _postflight(kit, w);
    }

    /*//////////////////////////////////////////////////////////////
        PRE-FLIGHT — every one of these is cheaper to hit here than
        to discover against a contract that can never be changed.
    //////////////////////////////////////////////////////////////*/

    function _preflight(Wiring memory w) internal view {
        address deployer = vm.addr(w.pk);
        address poolManager = w.poolManager;
        address hookAddr = w.hook;
        address posmAddr = w.positionManager;
        address permit2Addr = w.permit2;
        address registryAddr = w.registry;
        uint256 blockTimeCentis = w.blockTimeCentis;
        /* --- everything that must be a contract, actually is one. A typo in
               an address almost always lands on an EOA or on nothing, and the
               kit's own `ZeroAddress` check would not notice either. --- */
        require(poolManager.code.length > 0, "CL_POOL_MANAGER has no code - not a contract");
        require(hookAddr.code.length > 0, "LAUNCH_GUARD_HOOK has no code - deploy step 1 first");
        require(posmAddr.code.length > 0, "CL_POSITION_MANAGER has no code - not a contract");
        require(permit2Addr.code.length > 0, "PERMIT2 has no code - not a contract");

        /* --- the hook is the one this kit can actually drive --- */
        LaunchGuardHook hook = LaunchGuardHook(hookAddr);
        require(
            address(hook.poolManager()) == poolManager,
            "LAUNCH_GUARD_HOOK serves a different pool manager than CL_POOL_MANAGER"
        );
        require(
            hook.getHooksRegistrationBitmap() == EXPECTED_HOOK_BITMAP,
            "LAUNCH_GUARD_HOOK reports a bitmap this kit cannot build pool keys for"
        );

        /* --- the position manager belongs to the same singleton. The kit
               initializes pools on `poolManager` and then mints into them
               through `posm`; if those disagree the mint reverts inside the
               settle with a message about currencies, not about wiring. --- */
        require(
            address(ICLPositionManager(posmAddr).clPoolManager()) == poolManager,
            "CL_POSITION_MANAGER points at a different CL pool manager"
        );
        require(
            address(IImmutableState(posmAddr).vault()) == address(ICLPoolManager(poolManager).vault()),
            "CL_POSITION_MANAGER and CL_POOL_MANAGER answer to different Vaults"
        );

        /* --- Permit2 is READ OFF THE POSITION MANAGER, not trusted from the
               environment. On several Latch target chains this is not the
               canonical Permit2, and the kit's `_approvePosition` grants an
               unbounded allowance to whatever address it was handed. Granting
               it to a Permit2 the position manager does not use would be an
               allowance to a contract with no legitimate caller. The env var
               exists only so the mismatch is loud. --- */
        address posmPermit2 = address(Permit2Forwarder(posmAddr).permit2());
        require(
            posmPermit2 == permit2Addr,
            "PERMIT2 is not the Permit2 the position manager pulls through - use the one it names"
        );

        /* --- the registry, if there is one, must be live and must answer the
               three-function surface the kit calls. `isRegistered` is a view,
               so probing it costs nothing and a dead or wrong-ABI address
               reverts here rather than on somebody's first listing. --- */
        if (registryAddr != address(0)) {
            require(registryAddr.code.length > 0, "LAUNCHPAD_REGISTRY has no code - use address(0) to disable");
            // The call is the assertion. A wrong ABI reverts; a right one tells
            // us whether the hook is already listed, which is worth printing.
            IHookRegistryListing(registryAddr).isRegistered(hookAddr);
        }

        /* --- block time. The kit rejects 0 and anything above 60 000; the
               tighter bound is human judgement, so warn loudly rather than
               silently accept a plausible-looking wrong number. --- */
        require(blockTimeCentis > 0, "LAUNCHPAD_BLOCK_TIME_CENTIS not set - it has no safe default");
        require(blockTimeCentis <= 60_000, "LAUNCHPAD_BLOCK_TIME_CENTIS above 600s per block");

        console.log("=== LaunchpadKit: pre-flight ===");
        console.log("  chain id           ", block.chainid);
        console.log("  deployer           ", deployer);
        console.log("  clPoolManager      ", poolManager);
        console.log("  vault              ", address(ICLPoolManager(poolManager).vault()));
        console.log("  hook               ", hookAddr);
        console.log("  positionManager    ", posmAddr);
        console.log("  permit2            ", permit2Addr, "(read off the position manager)");
        if (registryAddr == address(0)) {
            console.log("  registry            none - listing is disabled for the life of this kit");
        } else {
            console.log("  registry           ", registryAddr);
            console.log("  hook already listed", IHookRegistryListing(registryAddr).isRegistered(hookAddr));
        }
        console.log("  blockTimeCentis    ", blockTimeCentis);
        console.log("");
    }

    /*//////////////////////////////////////////////////////////////
                        WHAT THE BLOCK TIME MEANS
    //////////////////////////////////////////////////////////////*/

    /// @dev Prints every preset's window as the kit will resolve it. This is the only place a
    /// wrong `blockTimeCentis` becomes visible before it is permanent: the numbers below are what
    /// a launcher actually gets, and "300 seconds" turning into 60 is obvious here and invisible
    /// on a block explorer afterwards.
    /// @param maxDecayBlocks Read off the hook rather than hardcoded. It used to be a literal
    /// `1_000_000` here, which was the hook's old `constant` - and the moment that cap became a
    /// per-chain argument, a literal in this script would have been asserting the environment
    /// against a number the hook no longer uses.
    function _reportSchedule(uint32 centis, uint32 maxDecayBlocks) internal pure {
        console.log("=== Preset windows at this block time ===");
        _reportOne("FairLaunch          ", Preset.FairLaunch, centis, maxDecayBlocks);
        _reportOne("AntiSniperAggressive", Preset.AntiSniperAggressive, centis, maxDecayBlocks);
        _reportOne("Stealth             ", Preset.Stealth, centis, maxDecayBlocks);
        _reportOne("NoTax               ", Preset.NoTax, centis, maxDecayBlocks);
        console.log("");
        console.log("If a 'real s' column does not match the preset's documented window,");
        console.log("LAUNCHPAD_BLOCK_TIME_CENTIS is wrong. Stop.");
        console.log("");
    }

    function _reportOne(string memory name, Preset preset, uint32 centis, uint32 maxDecayBlocks)
        internal
        pure
    {
        uint32 windowSeconds = LaunchPresets.params(preset).windowSeconds;
        uint256 blocks = LaunchPresets.secondsToBlocks(windowSeconds, centis);
        require(blocks <= maxDecayBlocks, "a preset window exceeds the hook's MAX_DECAY_BLOCKS at this block time");
        console.log(
            string.concat("  ", name, "  documented ", vm.toString(windowSeconds), "s")
        );
        console.log(
            string.concat(
                "                          -> ",
                vm.toString(blocks),
                " blocks = ",
                vm.toString((blocks * centis) / 100),
                " real s"
            )
        );
    }

    /*//////////////////////////////////////////////////////////////
        POST-FLIGHT — assert the deployed reality, not the intent.
        Every immutable is read back off the chain, because an
        immutable set wrong is a redeployment, not a fix.
    //////////////////////////////////////////////////////////////*/

    function _postflight(LaunchpadKit kit, Wiring memory w) internal view {
        address poolManager = w.poolManager;
        address hookAddr = w.hook;
        address posmAddr = w.positionManager;
        address permit2Addr = w.permit2;
        address registryAddr = w.registry;
        uint32 centis = uint32(w.blockTimeCentis);
        require(address(kit).code.length > 0, "kit has no code");

        require(address(kit.clPoolManager()) == poolManager, "clPoolManager mismatch");
        require(address(kit.hook()) == hookAddr, "hook mismatch");
        require(address(kit.positionManager()) == posmAddr, "positionManager mismatch");
        require(address(kit.permit2()) == permit2Addr, "permit2 mismatch");
        require(address(kit.registry()) == registryAddr, "registry mismatch");
        require(kit.blockTimeCentis() == centis, "blockTimeCentis mismatch");

        /* The constructor already checks this, but it checks it against the
           hook. Checking it here against a constant is what catches a hook
           whose bitmap is right and whose kit was compiled against a different
           expectation. */
        require(kit.hookBitmap() == EXPECTED_HOOK_BITMAP, "hookBitmap is not beforeInitialize|beforeSwap");
        require(kit.EXPECTED_HOOK_BITMAP() == EXPECTED_HOOK_BITMAP, "kit compiled with a different expectation");

        /* The kit must hold nothing. It has no withdrawal function and no
           owner, so anything resting on it at birth is stuck there forever. */
        require(address(kit).balance == 0, "kit was born holding native value");

        console.log("=== LaunchpadKit: deployed ===");
        console.log("LaunchpadKit          ", address(kit));
        console.log("  clPoolManager       ", address(kit.clPoolManager()));
        console.log("  hook                ", address(kit.hook()));
        console.log("  positionManager     ", address(kit.positionManager()));
        console.log("  permit2             ", address(kit.permit2()));
        console.log("  registry            ", address(kit.registry()));
        console.log("  blockTimeCentis     ", kit.blockTimeCentis());
        console.log("  hookBitmap          ", kit.hookBitmap());
        console.log("");
        console.log("OWNERSHIP: none. Not Ownable, not Ownable2Step, not AccessControl.");
        console.log("  Nothing is pending, nothing needs accepting, and the deployer holds");
        console.log("  no authority over this contract. There is no admin key to rotate and");
        console.log("  no pause to reach for - which also means no recovery if it is wrong.");
        console.log("");
        console.log("WHAT THIS KIT NOW PERMANENTLY OWNS: for every pool it creates, IT is the");
        console.log("  hook's launchOwner, and that claim is non-transferable. A future kit at");
        console.log("  a new address will NOT be able to reconfigure any launch this one made.");
        console.log("  Redeploying the kit forks the launches, it does not migrate them.");
        console.log("");
        console.log("It creates nothing until somebody calls createLaunch(). No pool, no");
        console.log("liquidity and no registry listing was made by this script.");
    }
}

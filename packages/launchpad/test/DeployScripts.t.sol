// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {WETH} from "solmate/src/tokens/WETH.sol";

import {Vault} from "infinity-core/src/Vault.sol";
import {CLPoolManager} from "infinity-core/src/pool-cl/CLPoolManager.sol";
import {Deployers} from "infinity-core/test/pool-cl/helpers/Deployers.sol";

import {CLPositionManager} from "infinity-periphery/src/pool-cl/CLPositionManager.sol";
import {CLPositionDescriptorOffChain} from "infinity-periphery/src/pool-cl/CLPositionDescriptorOffChain.sol";
import {ICLPositionDescriptor} from "infinity-periphery/src/pool-cl/interfaces/ICLPositionDescriptor.sol";
import {IWETH9} from "infinity-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";

import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {LatchRegistry} from "latch-registry/src/LatchRegistry.sol";

import {LaunchpadKit} from "../src/LaunchpadKit.sol";
import {IHookRegistryListing} from "../src/interfaces/IHookRegistryListing.sol";
import {DeployLaunchGuardHookMainnetScript} from "../script/DeployLaunchGuardHookMainnet.s.sol";
import {DeployLaunchpadKitMainnetScript} from "../script/DeployLaunchpadKitMainnet.s.sol";

/// @title DeployScriptsTest
/// @notice Runs both mainnet deploy scripts end to end against a locally built stack.
///
/// @dev ###################### WHY THIS TEST EXISTS ######################
///
/// A deploy script is the least-exercised code in a protocol and the one with the fewest chances
/// to be right. `LaunchpadKit` has no owner, no pause and no upgrade path, so every constructor
/// argument is permanent: a script that wires it wrong produces a contract to abandon, not a
/// contract to fix. So the scripts are run here as CONTRACTS rather than read as documents.
///
/// Each pre-flight guard is additionally MUTATED, following CLAUDE.md's rule about the
/// transient-backend guards: a green run of a script whose `require`s can never trip proves
/// nothing. Delete a guard and its case here stops reverting.
///
/// THE HARNESS TALKS TO `runWith`, NEVER TO THE ENVIRONMENT. `vm.setEnv` writes PROCESS
/// environment, which is not EVM state and is therefore not rolled back between test cases -
/// and forge 1.x runs test cases concurrently against one shared process. An earlier version of
/// this file configured the scripts through `vm.setEnv` and failed with each test reporting the
/// PREVIOUS test's error message. That is the shape of that bug; it is why the scripts read env
/// in exactly one function and take their inputs as arguments everywhere else.
///
/// The block time used throughout is Robinhood Chain's real one - 10 centis, 0.1s blocks -
/// because that is the case the kit's old constructor floor of 50 rejected outright.
/// ###################################################################
contract DeployScriptsTest is Test, Deployers, DeployPermit2 {
    Vault vault;
    CLPoolManager poolManager;
    CLPositionManager posm;
    IAllowanceTransfer permit2;
    LatchRegistry registry;
    WETH weth;

    DeployLaunchGuardHookMainnetScript hookScript;
    DeployLaunchpadKitMainnetScript kitScript;

    /// @dev A publicly known throwaway. Nothing is broadcast from this test; the scripts only
    /// need a key they can derive an address from.
    uint256 constant TEST_PK = 1;

    /// @dev Robinhood Chain (4663): measured 51 000s over 500 000 blocks => 0.102 s/block.
    /// Declared DOWN to 10 so preset windows round long rather than short.
    uint256 constant ROBINHOOD_CENTIS = 10;

    address constant REGISTRY_ADMIN = address(0xAD3111);

    function setUp() public {
        (vault, poolManager) = createFreshManager();
        permit2 = IAllowanceTransfer(deployPermit2());
        weth = new WETH();
        ICLPositionDescriptor descriptor = new CLPositionDescriptorOffChain("https://latch.example/positions/");
        posm = new CLPositionManager(vault, poolManager, permit2, 100_000, descriptor, IWETH9(address(weth)));

        address[] memory none = new address[](0);
        registry = new LatchRegistry(REGISTRY_ADMIN, address(vault), none, none);

        // Constructed in setUp so `vm.expectRevert` lands on `runWith` and not on the script's
        // own creation - a mistake that makes every mutation below pass for the wrong reason.
        hookScript = new DeployLaunchGuardHookMainnetScript();
        kitScript = new DeployLaunchpadKitMainnetScript();
    }

    /// @dev The wiring a correct Robinhood deployment uses, with the hook filled in by step 1.
    function _wiring(address hook) internal view returns (DeployLaunchpadKitMainnetScript.Wiring memory) {
        return DeployLaunchpadKitMainnetScript.Wiring({
            pk: TEST_PK,
            poolManager: address(poolManager),
            hook: hook,
            positionManager: address(posm),
            permit2: address(permit2),
            registry: address(registry),
            blockTimeCentis: ROBINHOOD_CENTIS
        });
    }

    /*//////////////////////////////////////////////////////////////
                            THE HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    /// @dev Both scripts, in the documented order, at Robinhood's block time. Every `require`
    /// inside them is live; this passing means none of them tripped, and the post-flight
    /// assertions inside the scripts have already read every immutable back off chain.
    function test_bothScriptsRunInOrder() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));
        assertGt(address(hook).code.length, 0, "hook has no code");
        assertEq(address(hook.poolManager()), address(poolManager));

        LaunchpadKit kit = kitScript.runWith(_wiring(address(hook)));

        // The script asserts all of this internally. Repeated here so a deleted assertion inside
        // the script is caught by this file rather than by a mainnet deployment.
        assertEq(address(kit.clPoolManager()), address(poolManager));
        assertEq(address(kit.hook()), address(hook));
        assertEq(address(kit.positionManager()), address(posm));
        assertEq(address(kit.permit2()), address(permit2));
        assertEq(address(kit.registry()), address(registry));
        assertEq(kit.blockTimeCentis(), uint32(ROBINHOOD_CENTIS));
        assertEq(kit.hookBitmap(), 0x0041);
        assertEq(address(kit).balance, 0, "kit was born holding native value");
    }

    /// @dev `address(0)` disables listing for the life of the kit and must stay reachable. The
    /// script requires it to be passed explicitly, so "forgot to set it" cannot look like
    /// "meant no registry" - the absence of a default is the safety property.
    function test_kitScriptAcceptsNoRegistry() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.registry = address(0);

        LaunchpadKit kit = kitScript.runWith(w);
        assertEq(address(kit.registry()), address(0));
    }

    /// @dev The whole point of the block-time fix, stated as an outcome rather than a bound: at
    /// Robinhood's block time a "five minute" FairLaunch must span at least five real minutes.
    function test_robinhoodBlockTimeProducesWindowsThatAreNotShort() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));
        LaunchpadKit kit = kitScript.runWith(_wiring(address(hook)));

        // FairLaunch documents 300s. 3000 blocks at the chain's real 0.102s is 306 real seconds.
        uint256 blocks = 300 * 100 / kit.blockTimeCentis();
        assertEq(blocks, 3000);
        // 102 = the measured real block time in centis. Rounding the declared value DOWN is what
        // makes this hold; declaring it up would put the window under 300s.
        assertGe((blocks * 102) / 100, 300, "the tax would lift before the documented window ends");
    }

    /*//////////////////////////////////////////////////////////////
        MUTATIONS - each violates exactly one pre-flight guard.
    //////////////////////////////////////////////////////////////*/

    function test_hookScript_rejectsAPoolManagerWithNoCode() public {
        vm.expectRevert(bytes("CL_POOL_MANAGER has no code - not a contract"));
        hookScript.runWith(TEST_PK, address(0xDEAD));
    }

    function test_kitScript_rejectsAHookThatWasNeverDeployed() public {
        vm.expectRevert(bytes("LAUNCH_GUARD_HOOK has no code - deploy step 1 first"));
        kitScript.runWith(_wiring(address(0xBEEF)));
    }

    /// @dev A hook bound to another singleton makes every `configureLaunch` revert with
    /// `PoolManagerMismatch`, which reads as a caller error rather than a deployment error.
    function test_kitScript_rejectsAHookServingADifferentPoolManager() public {
        (, CLPoolManager other) = createFreshManager();
        LaunchGuardHook strayHook = new LaunchGuardHook(other);

        vm.expectRevert(bytes("LAUNCH_GUARD_HOOK serves a different pool manager than CL_POOL_MANAGER"));
        kitScript.runWith(_wiring(address(strayHook)));
    }

    /// @dev A position manager on another singleton passes every `code.length` check and fails
    /// only inside a settle, later, with a message about currencies.
    function test_kitScript_rejectsAPositionManagerOnAnotherSingleton() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        (Vault otherVault, CLPoolManager other) = createFreshManager();
        ICLPositionDescriptor descriptor = new CLPositionDescriptorOffChain("https://latch.example/other/");
        CLPositionManager strayPosm =
            new CLPositionManager(otherVault, other, permit2, 100_000, descriptor, IWETH9(address(weth)));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.positionManager = address(strayPosm);

        vm.expectRevert(bytes("CL_POSITION_MANAGER points at a different CL pool manager"));
        kitScript.runWith(w);
    }

    /// @dev The kit grants an UNBOUNDED Permit2 allowance to whatever address it is handed. Given
    /// a Permit2 the position manager does not pull through, that allowance has no legitimate
    /// caller and every seed reverts - so the check is identity against the position manager's
    /// own immutable, and a plausible impostor with code must still be rejected.
    function test_kitScript_rejectsAPermit2ThePositionManagerDoesNotUse() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.permit2 = address(registry); // has code, is not the position manager's Permit2

        vm.expectRevert(
            bytes("PERMIT2 is not the Permit2 the position manager pulls through - use the one it names")
        );
        kitScript.runWith(w);
    }

    /// @dev A retired registry still has code and still answers its old selectors - this project
    /// has one live on Sepolia that does exactly that. An address with code but the wrong ABI has
    /// to stop the deploy, because the kit's registry can never be re-pointed.
    function test_kitScript_rejectsARegistryWithTheWrongAbi() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.registry = address(new MockERC20("Not", "NOT", 18));

        vm.expectRevert();
        kitScript.runWith(w);
    }

    function test_kitScript_rejectsAZeroBlockTime() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.blockTimeCentis = 0;

        vm.expectRevert(bytes("LAUNCHPAD_BLOCK_TIME_CENTIS not set - it has no safe default"));
        kitScript.runWith(w);
    }

    function test_kitScript_rejectsABlockTimeAboveTenMinutes() public {
        LaunchGuardHook hook = hookScript.runWith(TEST_PK, address(poolManager));

        DeployLaunchpadKitMainnetScript.Wiring memory w = _wiring(address(hook));
        w.blockTimeCentis = 60_001;

        vm.expectRevert(bytes("LAUNCHPAD_BLOCK_TIME_CENTIS above 600s per block"));
        kitScript.runWith(w);
    }

    /*//////////////////////////////////////////////////////////////
                                 GAS
    //////////////////////////////////////////////////////////////*/

    /// @dev Measured, so the runbook's funding figure is not a guess. Not asserted to an exact
    /// number - that breaks on every compiler bump - but bounded loosely enough to be stable and
    /// tightly enough to catch a contract that doubled in size.
    function test_deploymentGasIsWithinTheFundingEstimate() public {
        uint256 before = gasleft();
        LaunchGuardHook hook = new LaunchGuardHook(poolManager);
        uint256 hookGas = before - gasleft();

        before = gasleft();
        LaunchpadKit kit = new LaunchpadKit(
            poolManager,
            hook,
            posm,
            permit2,
            IHookRegistryListing(address(registry)),
            uint32(ROBINHOOD_CENTIS)
        );
        uint256 kitGas = before - gasleft();

        emit log_named_uint("LaunchGuardHook deploy gas", hookGas);
        emit log_named_uint("LaunchpadKit deploy gas   ", kitGas);
        emit log_named_uint("total                     ", hookGas + kitGas);

        assertGt(address(kit).code.length, 0);
        assertLt(hookGas + kitGas, 6_000_000, "the deployment got much more expensive");
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchRegistry} from "../src/LatchRegistry.sol";
import {LatchMetadata, Verification, RiskClass, PermissionSource} from "../src/ILatchRegistry.sol";
import {LaunchGuardHook} from "latch-hooks/src/launch/LaunchGuardHook.sol";
import {ICLPoolManager} from "infinity-core/src/pool-cl/interfaces/ICLPoolManager.sol";

/**
 * Deploys the real LaunchGuardHook and lists it in the registry.
 *
 * This is the registry's security premise executed on chain: the submitter supplies
 * NO permissions. `register` reads `getHooksRegistrationBitmap()` off the hook
 * itself, so a listing can never claim capabilities the code does not have.
 *
 * Marked SourceVerified, not Audited — the contract has 55 tests but no third-party
 * audit report, and `Audited` requires a non-empty auditURI for exactly that reason.
 * Badging our own unaudited code as audited would be the first lie in a registry
 * whose entire job is telling people which hooks to trust.
 */
contract RegisterLaunchGuardScript is Script {
    /// @dev The LatchRegistry deployed 2026-09-10, after the LatchHookRegistry -> LatchRegistry
    /// rename. The previous registry at 0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE is retired: it
    /// still answers `hookCount()` and still holds the original listing, but nothing reads it.
    address constant REGISTRY = 0xB504da43C6ED342a511f3e5849f53035F2C807d1;
    address constant CL_POOL_MANAGER = 0xb7C8a11E0B359616eD06256783aF57114841F738;

    /// @dev The LaunchGuardHook already deployed and listed on the OLD registry. Re-listing the
    /// SAME address rather than deploying a fresh hook: the contract is unchanged, its bitmap is
    /// unchanged, and every link that already points at it keeps working. Deploying a duplicate
    /// would leave two identical hooks on chain and make the older one look abandoned.
    /// Set REDEPLOY_HOOK=true in the environment to deploy a new one instead.
    address constant EXISTING_HOOK = 0xd02A738A7A498d7131dF1079b4B3A0517757326d;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        LatchRegistry reg = LatchRegistry(REGISTRY);

        bool redeploy = vm.envOr("REDEPLOY_HOOK", false);

        vm.startBroadcast(pk);

        LaunchGuardHook hook =
            redeploy
            /* The launch window bounds are constructor arguments now, not
               constants. They were 1,000,000 blocks — ~139 days at 12s and
               28 HOURS on Robinhood, so a three-day fair launch reverted.
               26,000,000 blocks at 10 centis is ~30 days of real time. */
            ? new LaunchGuardHook(ICLPoolManager(CL_POOL_MANAGER), 10, 26_000_000, 26_000_000)
            : LaunchGuardHook(EXISTING_HOOK);

        uint256[] memory chains = new uint256[](1);
        chains[0] = 11155111;

        reg.register(
            address(hook),
            LatchMetadata({
                name: "LaunchGuard",
                description: "Decaying sniper tax priced on time, not identity. Requires a dynamic-fee pool.",
                sourceURI: "https://github.com/OxForged/Hook-Dev/blob/main/packages/hooks/src/launch/LaunchGuardHook.sol",
                auditURI: "",
                chainIds: chains
            })
        );

        bytes32 poolId = vm.envOr("POOL_ID", bytes32(0));
        if (poolId != bytes32(0)) {
            reg.attestFromPool(address(hook), CL_POOL_MANAGER, poolId);
            reg.setVerification(address(hook), Verification.SourceVerified, "Source published; not audited.");
        }

        vm.stopBroadcast();

        uint16 declared = hook.getHooksRegistrationBitmap();
        uint16 stored = reg.getLatch(address(hook)).permissions;
        require(stored == declared, "registry did not read permissions from the hook");

        (uint16 effective, PermissionSource source) = reg.effectivePermissions(address(hook));
        if (poolId != bytes32(0)) {
            require(source != PermissionSource.SelfReported, "attestation did not land");
            require(reg.permissionsConcealed(address(hook)) == 0, "hook understated its permissions to the registry");
        }

        console.log("LaunchGuardHook      ", address(hook));
        console.log("  bitmap on hook     ", declared);
        console.log("  bitmap in registry ", stored);
        console.log("  effective bitmap   ", effective);
        console.log("  permission source  ", uint8(source));
        console.log("  attestations       ", uint256(reg.getLatch(address(hook)).attestationCount));
        console.log("  risk class         ", uint8(reg.classify(stored)));
        console.log("  takesSwapCut       ", reg.takesSwapCut(stored));
        console.log("  canBlockSwaps      ", reg.canBlockSwaps(stored));
        console.log("  latchCount          ", reg.latchCount());
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {LatchHookRegistry} from "../src/LatchHookRegistry.sol";
import {HookMetadata, Verification, RiskClass} from "../src/ILatchHookRegistry.sol";
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
    address constant REGISTRY = 0x665e7e5C419d004420C6Cb8c924E1E5Ca31F43DE;
    address constant CL_POOL_MANAGER = 0xb7C8a11E0B359616eD06256783aF57114841F738;

    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        LatchHookRegistry reg = LatchHookRegistry(REGISTRY);

        vm.startBroadcast(pk);

        LaunchGuardHook hook = new LaunchGuardHook(ICLPoolManager(CL_POOL_MANAGER));

        uint256[] memory chains = new uint256[](1);
        chains[0] = 11155111;

        reg.register(
            address(hook),
            HookMetadata({
                name: "LaunchGuard",
                description: "Decaying sniper tax priced on time, not identity. Requires a dynamic-fee pool.",
                sourceURI: "https://github.com/OxForged/Hook-Dev/blob/main/packages/hooks/src/launch/LaunchGuardHook.sol",
                auditURI: "",
                chainIds: chains
            })
        );

        reg.setVerification(address(hook), Verification.SourceVerified, "Source published; not audited.");

        vm.stopBroadcast();

        uint16 declared = hook.getHooksRegistrationBitmap();
        uint16 stored = reg.getHook(address(hook)).permissions;
        require(stored == declared, "registry did not read permissions from the hook");

        console.log("LaunchGuardHook      ", address(hook));
        console.log("  bitmap on hook     ", declared);
        console.log("  bitmap in registry ", stored);
        console.log("  risk class         ", uint8(reg.classify(stored)));
        console.log("  takesSwapCut       ", reg.takesSwapCut(stored));
        console.log("  canBlockSwaps      ", reg.canBlockSwaps(stored));
        console.log("  hookCount          ", reg.hookCount());
    }
}

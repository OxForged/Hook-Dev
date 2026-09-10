// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {HookMetadata} from "latch-registry/src/ILatchHookRegistry.sol";

/// @notice The three registry entry points the launchpad kit uses.
/// @dev `ILatchHookRegistry` declares the registry's events, errors and types but no functions -
/// its callable surface lives on the concrete `LatchHookRegistry`. This narrow interface lets the
/// kit call that surface without compiling the whole registry implementation into its own build,
/// and makes the exact privileges the kit exercises legible at a glance: it may list a hook and
/// hand the listing over. It cannot verify, deprecate or flag anything.
interface IHookRegistryListing {
    function register(address hook, HookMetadata calldata metadata) external;

    function transferSteward(address hook, address newSteward) external;

    function isRegistered(address hook) external view returns (bool);
}

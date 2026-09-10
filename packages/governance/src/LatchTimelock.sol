// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title LatchTimelock
/// @notice The delay that sits between the governance multisig and any privileged protocol call.
///
/// @dev ####################### WHY THIS EXISTS RATHER THAN RAW OZ #######################
///
/// OpenZeppelin's `TimelockController` accepts `minDelay = 0` with no validation. A timelock
/// deployed that way looks correct on a block explorer, exposes the same interface, emits the
/// same events, and delays nothing. That is the single easiest way to ship governance theatre,
/// so this subclass refuses a delay below a floor chosen for the tier it protects.
///
/// ####################### WHY TWO TIMELOCKS, NOT ONE #######################
///
/// Delay should be proportional to how hard an action is to undo, and Latch has two very
/// different tiers:
///
///   CUSTODY tier — owns Vault and the pool managers.
///     `Vault.registerApp` is `onlyOwner` and IRREVERSIBLE: there is no unregister function
///     anywhere in the Vault or its interface. A registered app can move funds against the
///     Vault permanently. A mistake here cannot be walked back by governance at any speed, so
///     the only real defence is a window long enough for the public to notice and for users to
///     exit. Hence CUSTODY_MIN_DELAY.
///
///   POLICY tier — owns the protocol fee controller.
///     Fee changes are fully reversible and occasionally need to respond to market conditions.
///     A multi-day delay on a fee tweak buys nothing and creates pressure to hand someone an
///     emergency bypass, which is worse. Hence the shorter POLICY_MIN_DELAY.
///
/// These are separate contracts with separate owners, which is what makes two delays possible
/// at all — `Vault` has a single owner slot, so one timelock owning it means one delay for
/// everything it controls.
///
/// ####################### WHAT A TIMELOCK MUST NOT DELAY #######################
///
/// Delay belongs on privilege ESCALATION, never on privilege REDUCTION. If the only path to
/// switching protocol fees off runs through a two-day queue, then during an incident the
/// protocol keeps charging for two days. That is why `LatchProtocolFeeController` carries a
/// separate guardian that can disable fees immediately but can never enable them, raise them,
/// or change any configuration. The guardian can only ever make the protocol take less.
///
/// Do not add powers to the guardian. Anything that can increase what the protocol takes, or
/// change who controls it, belongs behind this timelock.
/// #####################################################################################
contract LatchTimelock is TimelockController {
    /// @notice Minimum delay for the tier that owns the Vault and pool managers.
    /// @dev 48h. Sized so that `registerApp` — irreversible, and able to move Vault funds
    /// forever — cannot be executed inside a single news cycle.
    uint256 public constant CUSTODY_MIN_DELAY = 48 hours;

    /// @notice Minimum delay for the tier that owns fee policy.
    /// @dev 6h. Long enough to be observed and contested, short enough that nobody argues for
    /// an emergency bypass around it.
    uint256 public constant POLICY_MIN_DELAY = 6 hours;

    /// @notice Tier this timelock was deployed for.
    enum Tier {
        Custody,
        Policy
    }

    /// @notice The tier, fixed at deployment.
    Tier public immutable tier;

    /// @notice Delay is below the floor for the chosen tier
    error DelayBelowTierFloor(Tier tier, uint256 provided, uint256 required);

    /// @notice A timelock with no proposer can never do anything
    error NoProposers();

    /// @notice A timelock with no executor can never execute what it queues
    error NoExecutors();

    /// @dev The OZ optional `admin` is hardcoded to address(0). An admin can grant and revoke
    /// roles directly, which is a permanent backdoor around every delay this contract enforces.
    /// It is not a constructor parameter because it should never be a deployment decision.
    /// @param tier_ Custody (Vault, pool managers) or Policy (fee controller)
    /// @param minDelay Seconds of delay; must meet the floor for `tier_`
    /// @param proposers Addresses allowed to queue operations — the governance multisig
    /// @param executors Addresses allowed to execute a matured operation. Passing address(0)
    /// makes execution permissionless, which is usually correct: once an operation has survived
    /// its delay in public, anyone executing it is harmless, and it removes the multisig as a
    /// liveness dependency.
    constructor(Tier tier_, uint256 minDelay, address[] memory proposers, address[] memory executors)
        TimelockController(minDelay, proposers, executors, address(0))
    {
        uint256 floor = tier_ == Tier.Custody ? CUSTODY_MIN_DELAY : POLICY_MIN_DELAY;
        if (minDelay < floor) revert DelayBelowTierFloor(tier_, minDelay, floor);
        if (proposers.length == 0) revert NoProposers();
        if (executors.length == 0) revert NoExecutors();

        tier = tier_;
    }

    /// @notice The floor enforced for this timelock's tier.
    function minDelayFloor() external view returns (uint256) {
        return tier == Tier.Custody ? CUSTODY_MIN_DELAY : POLICY_MIN_DELAY;
    }
}

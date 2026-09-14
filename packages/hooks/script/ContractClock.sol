// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Latch Protocol
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

/**
 * ###################### THE CONTRACT CLOCK, MEASURED AT DEPLOY TIME ######################
 *
 * Every Latch contract that turns a duration into blocks takes a `blockTimeCentis` constructor
 * argument. It was set to 10 (0.1 s) on Robinhood Chain (4663) because that is the chain's L2
 * block time as the RPC reports it. It is the wrong clock. Robinhood is Arbitrum Nitro, where
 * `block.number` INSIDE THE EVM is Ethereum's block number, advancing every ~12 s. Proven against
 * mined state on 2026-09-13: an ERC20Votes checkpoint written in L2 block 62,356,430 is keyed at
 * 25,971,883, that block's `l1BlockNumber`. So the live kit, launch hook and revenue-share hook
 * each run every window ~120x LONGER than they were configured for.
 *
 * The value was typed from a measurement of the wrong thing, and the scripts accepted it because
 * nothing asked the EVM. This file asks the EVM.
 *
 * HOW. `CONTRACT_CLOCK_PROBE` is bytecode run as a contract-creation `eth_call`; it returns
 * `NUMBER` and `TIMESTAMP` exactly as a contract executing at `latest` sees them. It is read twice
 * with a real wait in between (`vm.sleep`), and the cadence is `Δtimestamp / Δnumber`. That needs
 * no historical state (public Robinhood endpoints prune it within minutes, which defeats both a
 * historical `eth_call` and `vm.rollFork`), no header parsing, no `ffi`, and it is correct on any
 * EVM chain whatever its clock, because it measures the thing the contract will actually use.
 *
 * Deploy scripts then refuse to broadcast unless the declared `blockTimeCentis` is inside a narrow
 * band of the measurement. Deliberately asymmetric, because the two errors are not equally bad:
 *
 *   declared TOO LONG  (> measured + 5%)   every block-denominated window comes out SHORT. A launch
 *                                           tax lifts early, a fee-rise delay gives traders less
 *                                           notice than documented. Refused tightly.
 *   declared TOO SHORT (< 75% of measured)  every window comes out LONG. Safer, but 10 vs 1200 is
 *                                           this exact bug. Refused, with room for rounding down
 *                                           and for Ethereum's occasional missed slot.
 *
 * `ContractClockMath` is pure and unit-tested with mutation checks in
 * `test/script/ContractClockMath.t.sol`. `ContractClockProbe` is the RPC half and only runs inside
 * `forge script --rpc-url`.
 * ########################################################################################
 */
library ContractClockMath {
    /// @notice Shortest chain-time window a measurement may span.
    uint256 internal constant MIN_WINDOW_SECONDS = 120;

    /// @notice Fewest contract blocks a measurement may span. Below this, one block of jitter is
    /// more than 12% of the answer.
    uint256 internal constant MIN_WINDOW_BLOCKS = 8;

    /// @notice A declared block time may exceed the measurement by at most this, in percent.
    uint256 internal constant MAX_OVER_PERCENT = 105;

    /// @notice A declared block time may fall below the measurement to at least this, in percent.
    uint256 internal constant MIN_UNDER_PERCENT = 75;

    error ClockDidNotAdvance(uint256 number0, uint256 number1);
    error ClockWindowTooShort(uint256 elapsedSeconds, uint256 minimumSeconds);
    error ClockWindowTooFewBlocks(uint256 elapsedBlocks, uint256 minimumBlocks);
    error DeclaredBlockTimeTooLong(uint256 declaredCentis, uint256 measuredCentis);
    error DeclaredBlockTimeTooShort(uint256 declaredCentis, uint256 measuredCentis);

    /// @notice Hundredths of a second per contract block between two `(NUMBER, TIMESTAMP)` reads.
    /// @dev Floors. A floored measurement is the smaller block time, which makes the
    /// `DeclaredBlockTimeTooLong` bound marginally STRICTER, the safe direction.
    function centisPerBlock(uint256 number0, uint256 timestamp0, uint256 number1, uint256 timestamp1)
        internal
        pure
        returns (uint256)
    {
        if (number1 <= number0) revert ClockDidNotAdvance(number0, number1);
        uint256 elapsedSeconds = timestamp1 > timestamp0 ? timestamp1 - timestamp0 : 0;
        if (elapsedSeconds < MIN_WINDOW_SECONDS) revert ClockWindowTooShort(elapsedSeconds, MIN_WINDOW_SECONDS);
        uint256 elapsedBlocks = number1 - number0;
        if (elapsedBlocks < MIN_WINDOW_BLOCKS) revert ClockWindowTooFewBlocks(elapsedBlocks, MIN_WINDOW_BLOCKS);
        return (elapsedSeconds * 100) / elapsedBlocks;
    }

    /// @notice Reverts unless `declaredCentis` is a sane statement of `measuredCentis`.
    function requireDeclaredMatches(uint256 declaredCentis, uint256 measuredCentis) internal pure {
        if (declaredCentis * 100 > measuredCentis * MAX_OVER_PERCENT) {
            revert DeclaredBlockTimeTooLong(declaredCentis, measuredCentis);
        }
        if (declaredCentis * 100 < measuredCentis * MIN_UNDER_PERCENT) {
            revert DeclaredBlockTimeTooShort(declaredCentis, measuredCentis);
        }
    }

    /// @notice Decodes an `eth_blockNumber` result as `vm.rpc` returns it: big-endian bytes, no
    /// fixed width (a 4-byte `0x03b94195` on Robinhood today).
    function quantity(bytes memory raw) internal pure returns (uint256 value) {
        require(raw.length <= 32, "quantity wider than 32 bytes");
        for (uint256 i = 0; i < raw.length; i++) {
            value = (value << 8) | uint8(raw[i]);
        }
    }
}

library ContractClockProbe {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @notice NUMBER, MSTORE 0, TIMESTAMP, MSTORE 32, RETURN 64. Identical to the SDK's
    /// `CONTRACT_CLOCK_PROBE_CALLDATA`.
    string internal constant CONTRACT_CLOCK_PROBE = "0x436000524260205260406000f3";

    struct Measurement {
        /// @dev Real hundredths of a second per contract block.
        uint256 centisPerBlock;
        /// @dev Contract-visible `block.number` at the second read.
        uint256 contractBlockNumber;
        /// @dev `eth_blockNumber` at the second read.
        uint256 rpcBlockNumber;
        /// @dev True when those two differ: the EVM's clock is not the RPC's (Arbitrum Nitro).
        bool clockDiffersFromRpc;
        uint256 elapsedSeconds;
    }

    /// @notice `(NUMBER, TIMESTAMP)` as a contract at `latest` sees them, from the fork's RPC.
    function read() internal returns (uint256 number, uint256 timestamp) {
        bytes memory raw = VM.rpc("eth_call", string.concat('[{"data":"', CONTRACT_CLOCK_PROBE, '"},"latest"]'));
        require(raw.length == 64, "clock probe did not return two words");
        (number, timestamp) = abi.decode(raw, (uint256, uint256));
    }

    /// @notice Measures the contract clock over a real wait of `waitSeconds`.
    /// @dev Only meaningful inside `forge script --rpc-url`. Blocks the script for `waitSeconds`.
    function measure(uint256 waitSeconds) internal returns (Measurement memory m) {
        (uint256 n0, uint256 t0) = read();
        VM.sleep(waitSeconds * 1000);
        (uint256 n1, uint256 t1) = read();
        uint256 head = ContractClockMath.quantity(VM.rpc("eth_blockNumber", "[]"));

        m.centisPerBlock = ContractClockMath.centisPerBlock(n0, t0, n1, t1);
        m.contractBlockNumber = n1;
        m.rpcBlockNumber = head;
        // A native chain's NUMBER trails eth_blockNumber by at most a few blocks between two calls.
        m.clockDiffersFromRpc = head > n1 + 64 || n1 > head + 64;
        m.elapsedSeconds = t1 - t0;
    }
}

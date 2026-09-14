// SPDX-License-Identifier: MIT
// What clock does the FORK give contracts? On real Robinhood (Arbitrum Nitro) the EVM's NUMBER is
// Ethereum L1's block number (~12.1 s), not the L2 header number (~0.1 s). Anvil has no Nitro
// emulation, so this phase measures what anvil actually does rather than assuming either.
import { LATCH_DEPLOYMENTS } from "../../../../packages/sdk/src/deployments/index.ts";

export async function run(ctx) {
  const { chain, rec } = ctx;
  rec.scenario("fork-contract-clock", "eth_call NUMBER/TIMESTAMP vs header, after mining and after warping");
  const head0 = await chain.head();
  const evm0 = await chain.evmClock();
  rec.assert("anvil EVM NUMBER equals the L2 header number (NOT Nitro's L1 block.number)", evm0.number, head0.number);

  await chain.mine(10, 12);
  const evm1 = await chain.evmClock();
  rec.assert("anvil_mine(10, 12s): NUMBER advances by 10", evm1.number - evm0.number, 10n);
  rec.assert("anvil_mine(10, 12s): TIMESTAMP advances by >= 120", evm1.timestamp - evm0.timestamp >= 120n, true);

  await chain.warp(3600);
  const evm2 = await chain.evmClock();
  rec.assert("evm_increaseTime(3600)+evm_mine: NUMBER advances by exactly 1", evm2.number - evm1.number, 1n);
  rec.assert("evm_increaseTime(3600)+evm_mine: TIMESTAMP advances by >= 3600", evm2.timestamp - evm1.timestamp >= 3600n, true);

  const real = LATCH_DEPLOYMENTS[4663];
  ctx.state.clock = {
    forkHeaderNumber: head0.number.toString(),
    evmNumberAtFork: evm0.number.toString(),
    anvilEmulatesNitroL1BlockNumber: evm0.number !== head0.number,
    realChainContractBlockClock: real.contractBlockClock,
    realChainContractBlockTimeCentis: real.contractBlockTimeCentis,
    consequence:
      "On this fork block.number is the L2 number (~62.5M) and advances 1 per mined block. Contracts' stored L1-scale " +
      "block numbers (~26M) therefore read as far in the past, and every block-denominated window is measured in " +
      "anvil blocks, not real time. Time-dependent tests below advance block.number explicitly (anvil_mine) for " +
      "block-based contracts and warp timestamps for timestamp-based ones, and report the real-chain duration by " +
      `multiplying blocks by the measured ${real.contractBlockTimeCentis / 100} s contract block.`,
  };
  rec.results.meta.clock = ctx.state.clock;
  rec.note("fork clock measured", ctx.state.clock);
}

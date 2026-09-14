// LaunchpadKitV2 jobs: config, no-op when unconfigured, read-before-send, and ABI parity with the artifacts.
// No chain and no network: the public client is a stub that records every call.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatAbiItem } from 'viem/utils'

import { parseLaunchpadV2 } from '../dist/config.js'
import {
  collectBinLockerFeesJob,
  collectCLLockerFeesJob,
  flushLaunchFeesJob,
  launchpadV2Jobs,
} from '../dist/jobs/launchpad.js'
import { BIN_LP_LOCKER_KEEPER_ABI, CL_LP_LOCKER_KEEPER_ABI, LAUNCHPAD_KIT_V2_KEEPER_ABI } from '../dist/abi.js'

const KIT = '0x1111111111111111111111111111111111111111'
const CL = '0x2222222222222222222222222222222222222222'
const BIN = '0x3333333333333333333333333333333333333333'
const SAFE = '0x715a6176946aDbD22c1B2021d321Fb3767ca3432'

/** A PublicClient stand-in. `reads` maps functionName -> value or (args) => value; `sims` likewise. */
function stubClient({ reads = {}, sims = {}, logs = () => [] } = {}) {
  const calls = []
  const answer = (table, name, args) => {
    if (!(name in table)) throw new Error(`unexpected ${name}`)
    const v = table[name]
    if (v instanceof Error) throw v
    return typeof v === 'function' ? v(args) : v
  }
  return {
    calls,
    readContract: async ({ functionName, args }) => {
      calls.push(['read', functionName, args])
      return answer(reads, functionName, args)
    },
    simulateContract: async ({ functionName, args, address }) => {
      calls.push(['simulate', functionName, args])
      const result = answer(sims, functionName, args)
      return { result, request: { address, functionName, args } }
    },
    getContractEvents: async ({ fromBlock, toBlock }) => {
      calls.push(['logs', fromBlock, toBlock])
      return logs(fromBlock, toBlock)
    },
    waitForTransactionReceipt: async () => ({ status: 'success' }),
  }
}

const ctxFor = (publicClient, extra = {}) => ({
  publicClient,
  chainId: 4663,
  now: 1_800_000_000n,
  blockNumber: 1_000n,
  contractBlockNumber: 900n,
  ...extra,
})

const baseCfg = {
  kit: KIT,
  clLocker: CL,
  clTokenIds: [],
  logChunkBlocks: 10_000n,
  binLocker: BIN,
  intervalSeconds: 43_200,
}

/* ---------------------------------------------------------------- config */

test('launchpadV2 absent registers nothing', () => {
  assert.equal(parseLaunchpadV2(undefined), undefined)
  assert.deepEqual(launchpadV2Jobs(undefined), [])
})

test('every address is required, null states "not deployed", and all-null registers no job', () => {
  assert.throws(() => parseLaunchpadV2({ kit: null, clLocker: null }), /binLocker is required/)
  const cfg = parseLaunchpadV2({ kit: null, clLocker: null, binLocker: null })
  assert.deepEqual(launchpadV2Jobs(cfg), [])
})

test('configured addresses register exactly their jobs', () => {
  const ids = launchpadV2Jobs(parseLaunchpadV2({ kit: KIT, clLocker: null, binLocker: BIN })).map((j) => j.id)
  assert.deepEqual(ids, ['flush-launch-fees', 'collect-bin-locker-fees'])
})

test('a zero address, a sub-hour interval and orphaned CL ids are refused at startup', () => {
  const zero = '0x0000000000000000000000000000000000000000'
  assert.throws(() => parseLaunchpadV2({ kit: zero, clLocker: null, binLocker: null }), /zero address/)
  assert.throws(() => parseLaunchpadV2({ kit: KIT, clLocker: null, binLocker: null, intervalSeconds: 60 }), /at least 3600/)
  assert.throws(() => parseLaunchpadV2({ kit: null, clLocker: null, binLocker: null, clTokenIds: ['1'] }), /clLocker is null/)
})

test('CL token ids and the discovery block parse as bigints', () => {
  const cfg = parseLaunchpadV2({ kit: null, clLocker: CL, binLocker: null, clTokenIds: ['7', 9], clDiscoverFromBlock: '500' })
  assert.deepEqual(cfg.clTokenIds, [7n, 9n])
  assert.equal(cfg.clDiscoverFromBlock, 500n)
  assert.throws(() => parseLaunchpadV2({ kit: null, clLocker: CL, binLocker: null, clTokenIds: ['-1'] }), /non-negative integer/)
})

/* ------------------------------------------------------------ no-op jobs */

test('each job is a no-op when its address is null', async () => {
  const client = stubClient()
  const ctx = ctxFor(client)
  assert.deepEqual(await flushLaunchFeesJob({ ...baseCfg, kit: null }).run(ctx), [])
  assert.deepEqual(await collectCLLockerFeesJob({ ...baseCfg, clLocker: null }).run(ctx), [])
  assert.deepEqual(await collectBinLockerFeesJob({ ...baseCfg, binLocker: null }).run(ctx), [])
  assert.equal(client.calls.length, 0, 'not even a read')
})

/* ------------------------------------------------------------------ flush */

test('flush: nothing owed is not due, and nothing is simulated', async () => {
  const client = stubClient({ reads: { protocolFeeRecipient: SAFE, feesOwed: 0n } })
  const [v] = await flushLaunchFeesJob(baseCfg).run(ctxFor(client))
  assert.equal(v.due, false)
  assert.match(v.reason, /nothing owed/)
  assert.ok(!client.calls.some((c) => c[0] === 'simulate'))
  assert.deepEqual(client.calls.find((c) => c[1] === 'feesOwed')[2], [SAFE], 'reads the IMMUTABLE recipient\'s balance')
})

test('flush: owed fees simulate and report DUE in a dry run; the floor holds', async () => {
  const client = stubClient({ reads: { protocolFeeRecipient: SAFE, feesOwed: 5n }, sims: { flushProtocolFees: 5n } })
  const [v] = await flushLaunchFeesJob(baseCfg).run(ctxFor(client))
  assert.equal(v.due, true)
  assert.match(v.reason, /Dry run, nothing sent/)
  const [floored] = await flushLaunchFeesJob({ ...baseCfg, minFlushWei: 6n }).run(ctxFor(stubClient({ reads: { protocolFeeRecipient: SAFE, feesOwed: 5n } })))
  assert.match(floored.reason, /below the 6 floor/)
})

test('flush: a sent flush throttles the next tick', async () => {
  const client = stubClient({ reads: { protocolFeeRecipient: SAFE, feesOwed: 5n }, sims: { flushProtocolFees: 5n } })
  const walletClient = { account: { address: '0x4444444444444444444444444444444444444444' }, writeContract: async () => '0xabc' }
  const job = flushLaunchFeesJob(baseCfg)
  const ctx = ctxFor(client, { walletClient, account: '0x4444444444444444444444444444444444444444' })
  const [sent] = await job.run(ctx)
  assert.equal(sent.txHash, '0xabc')
  const [again] = await job.run({ ...ctx, now: ctx.now + 60n })
  assert.match(again.reason, /to go/)
})

/* -------------------------------------------------------------- CL locker */

test('CL: collectFees returning (0, 0) is NOT sent - it does not revert when idle', async () => {
  const client = stubClient({ sims: { collectFees: [0n, 0n] } })
  const verdicts = await collectCLLockerFeesJob({ ...baseCfg, clTokenIds: [42n] }).run(ctxFor(client))
  assert.equal(verdicts.length, 1)
  assert.equal(verdicts[0].due, false)
  assert.match(verdicts[0].reason, /nothing accrued/)
  assert.equal(client.calls.filter((c) => c[0] === 'simulate').length, 1, 'one read-simulation, no send path')
})

test('CL: accrued fees are due; a reverting simulation (paused token, unknown id) is not', async () => {
  const ok = stubClient({ sims: { collectFees: [3n, 0n] } })
  const [due] = await collectCLLockerFeesJob({ ...baseCfg, clTokenIds: [42n] }).run(ctxFor(ok))
  assert.equal(due.due, true)
  const bad = stubClient({ sims: { collectFees: new Error('Error: NotLocked(uint256 tokenId)\n (42)') } })
  const [nd] = await collectCLLockerFeesJob({ ...baseCfg, clTokenIds: [42n] }).run(ctxFor(bad))
  assert.equal(nd.due, false)
  assert.match(nd.reason, /NotLocked/)
})

test('CL: discovery reads PositionLocked in bounded chunks on the log clock and keeps its cursor', async () => {
  const client = stubClient({
    sims: { collectFees: [0n, 0n] },
    logs: (from) => (from === 100n ? [{ args: { tokenId: 7n } }] : []),
  })
  const job = collectCLLockerFeesJob({ ...baseCfg, clDiscoverFromBlock: 100n, logChunkBlocks: 400n })
  const ctx = ctxFor(client) // head = 1000
  await job.run(ctx)
  assert.deepEqual(client.calls.filter((c) => c[0] === 'logs').map((c) => [c[1], c[2]]), [[100n, 499n], [500n, 899n], [900n, 1000n]])
  assert.deepEqual(client.calls.find((c) => c[0] === 'simulate')[2], [7n])
  client.calls.length = 0
  await job.run({ ...ctx, blockNumber: 1_000n })
  assert.equal(client.calls.filter((c) => c[0] === 'logs').length, 0, 'nothing rescanned')
})

/* ------------------------------------------------------------- Bin locker */

test('Bin: no locks, and locks with no harvestable bins, are not due and not simulated', async () => {
  const empty = stubClient({ reads: { lockCount: 0n } })
  assert.match((await collectBinLockerFeesJob(baseCfg).run(ctxFor(empty)))[0].reason, /no locks yet/)
  const idle = stubClient({ reads: { lockCount: 2n, previewCollect: [0n, 0n, 0n] } })
  const v = await collectBinLockerFeesJob(baseCfg).run(ctxFor(idle))
  assert.equal(v.length, 2)
  assert.ok(v.every((x) => x.due === false))
  assert.ok(!idle.calls.some((c) => c[0] === 'simulate'))
})

test('Bin: a lock with harvestable bins is due; lock ids run 1..lockCount', async () => {
  const client = stubClient({
    reads: { lockCount: 2n, previewCollect: ([id]) => (id === 2n ? [0n, 5n] : [0n, 0n]) },
    sims: { collectFees: [1n, 1n] },
  })
  const v = await collectBinLockerFeesJob(baseCfg).run(ctxFor(client))
  assert.deepEqual(v.map((x) => x.due), [false, true])
  assert.deepEqual(client.calls.find((c) => c[0] === 'simulate')[2], [2n])
})

/* ------------------------------------------------------------ ABI parity */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const OUT = join(HERE, '..', '..', 'launchpad', 'foundry-out')
const ARTIFACTS = {
  LaunchpadKitV2: [LAUNCHPAD_KIT_V2_KEEPER_ABI, join(OUT, 'LaunchpadKitV2.sol', 'LaunchpadKitV2.json')],
  LatchLPLocker: [CL_LP_LOCKER_KEEPER_ABI, join(OUT, 'LatchLPLocker.sol', 'LatchLPLocker.json')],
  LatchBinLPLocker: [BIN_LP_LOCKER_KEEPER_ABI, join(OUT, 'LatchBinLPLocker.sol', 'LatchBinLPLocker.json')],
}

for (const [name, [abi, path]] of Object.entries(ARTIFACTS)) {
  // Monorepo with a built launchpad only; skipped rather than failed elsewhere.
  test(`every ${name} entry the keeper calls exists in the compiled artifact, byte for byte`, { skip: !existsSync(path) }, () => {
    const artifact = JSON.parse(readFileSync(path, 'utf8')).abi
    const known = new Set(artifact.filter((x) => x.type !== 'constructor' && x.type !== 'receive').map((x) => formatAbiItem(x)))
    for (const item of abi) assert.ok(known.has(formatAbiItem(item)), `${formatAbiItem(item)} is not in ${name}`)
  })
}

test('the kit v2 keeper ABIs contain no privileged or caller-paying function', () => {
  const fns = [LAUNCHPAD_KIT_V2_KEEPER_ABI, CL_LP_LOCKER_KEEPER_ABI, BIN_LP_LOCKER_KEEPER_ABI]
    .flat()
    .filter((x) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure')
    .map((x) => x.name)
    .sort()
  assert.deepEqual(fns, ['collectFees', 'collectFees', 'flushProtocolFees'])
})

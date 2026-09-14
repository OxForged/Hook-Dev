// Pure-function tests. No chain, no network. Run via `npm test` (builds first).
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from 'viem'

import { DISTRIBUTOR_KIND } from '../dist/abi.js'
import {
  decodePendingConfig,
  derivePoolId,
  inferPendingShape,
  kindFromBytes32,
  knownHookShape,
  returnedWords,
} from '../dist/decode.js'
import { resolvePendingShape } from '../dist/pendingShape.js'

/* ---------------------------------------------------------------- kind() */

test('kind constants match IEpochDistributor.sol byte for byte', () => {
  // keccak256("latch.revshare.distributor.snapshot.v1") etc., as Solidity computes them.
  assert.equal(DISTRIBUTOR_KIND.snapshot, keccak256(toHex('latch.revshare.distributor.snapshot.v1')))
  assert.equal(DISTRIBUTOR_KIND.merkle, keccak256(toHex('latch.revshare.distributor.merkle.v1')))
  // Pinned literals so a refactor that changes the string is caught, not absorbed.
  assert.equal(DISTRIBUTOR_KIND.snapshot, '0x6c8c753e7c890a8073f5cfa610b29805cf941f79c7bf9c9a8bbac78de7c5a7c1')
  assert.equal(DISTRIBUTOR_KIND.merkle, '0xa4c52bdd5374e29d7759675f0150c74d0a7b6631fa9c38e09feea924a000a516')
})

test('kindFromBytes32 is exact-match only', () => {
  assert.equal(kindFromBytes32(DISTRIBUTOR_KIND.snapshot), 'snapshot')
  assert.equal(kindFromBytes32(DISTRIBUTOR_KIND.merkle), 'merkle')
  assert.equal(kindFromBytes32(DISTRIBUTOR_KIND.merkle.toUpperCase().replace('0X', '0x')), 'merkle')
  // Zero is what every wrong answer decodes to. It must never be a kind.
  assert.equal(kindFromBytes32('0x' + '00'.repeat(32)), 'unknown')
  assert.equal(kindFromBytes32(keccak256(toHex('latch.revshare.distributor.snapshot.v2'))), 'unknown')
  assert.equal(kindFromBytes32(undefined), 'unknown')
  assert.equal(kindFromBytes32('0x1234'), 'unknown')
})

/* ------------------------------------------------------ getPendingConfig */

const LEGACY = parseAbiParameters('uint48,uint24,uint16,uint16,uint16,address,bool')
const CURRENT = parseAbiParameters('uint48,uint48,uint24,uint16,uint16,uint16,address,bool')
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

test('decodePendingConfig: block-no-expiry (Robinhood 0x23CE, Sepolia 0x1C86)', () => {
  const data = encodeAbiParameters(LEGACY, [61_000_000, 3000, 10_000, 0, 0, ZERO_ADDR, true])
  const p = decodePendingConfig(data, 'block-no-expiry')
  assert.equal(p.shape, 'block-no-expiry')
  assert.equal(p.durationClock, 'contract-block')
  assert.equal(p.effective, 61_000_000n)
  assert.equal(p.expiry, null)
})

test('decodePendingConfig: block-with-expiry (Robinhood 0xfC00)', () => {
  const data = encodeAbiParameters(CURRENT, [61_000_000, 61_500_000, 3000, 10_000, 0, 0, ZERO_ADDR, true])
  const p = decodePendingConfig(data, 'block-with-expiry')
  assert.equal(p.durationClock, 'contract-block')
  assert.equal(p.effective, 61_000_000n)
  assert.equal(p.expiry, 61_500_000n)
})

test('decodePendingConfig: timestamp-with-expiry is 8 words too, and decodes as seconds', () => {
  const data = encodeAbiParameters(CURRENT, [1_789_386_279, 1_789_645_479, 3000, 10_000, 0, 0, ZERO_ADDR, true])
  const p = decodePendingConfig(data, 'timestamp-with-expiry')
  assert.equal(p.durationClock, 'timestamp')
  assert.equal(p.effective, 1_789_386_279n)
  assert.equal(p.expiry - p.effective, 259_200n)
})

test('decodePendingConfig: the trap — a 7-word return is never decoded with an expiry', () => {
  const data = encodeAbiParameters(LEGACY, [10, 3000, 10_000, 0, 0, ZERO_ADDR, true])
  assert.throws(() => decodePendingConfig(data, 'block-with-expiry'), /returned 7 words but shape block-with-expiry returns 8/)
  assert.equal(decodePendingConfig(data, 'block-no-expiry').expiry, null)
})

test('decodePendingConfig refuses a length that contradicts the shape, and an unknown shape', () => {
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(32 * 8), 'block-no-expiry'), /refusing to guess/)
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(32 * 9), 'timestamp-with-expiry'), /refusing to guess/)
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(33), 'block-no-expiry'), /whole number of words/)
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(32 * 8), 'current'), /unknown getPendingConfig shape/)
  assert.equal(returnedWords('0x' + '00'.repeat(32 * 7)), 7)
})

/* --------------------------------------------------- shape resolution */

const T_HOOK = '0x00000000000000000000000000000000000071e5'
const fail = () => { throw new Error('probe must not be called') }

test('the built-in table names the three deployed hooks', () => {
  assert.equal(knownHookShape(4663, '0x23CE34E8199927DD270dddd8579c947542bDE446'), 'block-no-expiry')
  assert.equal(knownHookShape(4663, '0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2'), 'block-with-expiry')
  assert.equal(knownHookShape(11155111, '0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28'), 'block-no-expiry')
  assert.equal(knownHookShape(4663, T_HOOK), undefined)
})

test('inferPendingShape: CLOCK_MODE + word count, and nothing else', () => {
  assert.equal(inferPendingShape('mode=timestamp', 8), 'timestamp-with-expiry')
  assert.equal(inferPendingShape(null, 8), 'block-with-expiry')
  assert.equal(inferPendingShape(null, 7), 'block-no-expiry')
  assert.equal(inferPendingShape('mode=timestamp', 7), undefined)
  assert.equal(inferPendingShape('mode=blocknumber&from=default', 8), undefined)
})

test('resolve: a known hook uses the table and never probes', async () => {
  const r = await resolvePendingShape({ chainId: 4663, hook: '0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2', configured: undefined, words: 8, probe: fail })
  assert.deepEqual(r, { ok: true, shape: 'block-with-expiry', source: 'built-in table' })
})

test('resolve: an 8-word timestamp hook configured as timestamp is NOT read as block-shaped', async () => {
  const r = await resolvePendingShape({
    chainId: 4663, hook: T_HOOK, configured: 'timestamp-with-expiry', words: 8,
    probe: async () => ({ kind: 'mode', mode: 'mode=timestamp' }),
  })
  assert.deepEqual(r, { ok: true, shape: 'timestamp-with-expiry', source: 'config' })
})

test('resolve: config that contradicts the table or the probe is refused, not obeyed', async () => {
  const a = await resolvePendingShape({ chainId: 4663, hook: '0x23CE34E8199927DD270dddd8579c947542bDE446', configured: 'timestamp-with-expiry', words: 7, probe: fail })
  assert.equal(a.ok, false)
  const b = await resolvePendingShape({ chainId: 4663, hook: T_HOOK, configured: 'timestamp-with-expiry', words: 8, probe: async () => ({ kind: 'reverted' }) })
  assert.equal(b.ok, false)
  assert.match(b.reason, /block-with-expiry/)
})

test('resolve: an unknown hook with no resolvable shape is skipped; a transport error is never a revert', async () => {
  const garbage = await resolvePendingShape({ chainId: 4663, hook: T_HOOK, configured: undefined, words: 9, probe: async () => ({ kind: 'reverted' }) })
  assert.equal(garbage.ok, false)
  const flaky = await resolvePendingShape({ chainId: 4663, hook: T_HOOK, configured: undefined, words: 8, probe: async () => ({ kind: 'transport', detail: '429' }) })
  assert.equal(flaky.ok, false)
  assert.match(flaky.reason, /Not read as a revert/)
  const probed = await resolvePendingShape({ chainId: 4663, hook: T_HOOK, configured: undefined, words: 8, probe: async () => ({ kind: 'mode', mode: 'mode=timestamp' }) })
  assert.deepEqual(probed, { ok: true, shape: 'timestamp-with-expiry', source: 'CLOCK_MODE() probe' })
})

/* ------------------------------------------------------------- PoolId */

test('derivePoolId reproduces the live LTT1/LTT2 pool id on Robinhood (4663)', () => {
  // Read from chain: the pool ExerciseRobinhood.s.sol created. bitmap 2177 = 0x881,
  // tickSpacing 60 = 0x3c at bit offset 16.
  const id = derivePoolId({
    currency0: '0x2A21c0826848f2D597B7C87A4B931dE1407958A6',
    currency1: '0xa29927045BDFfd61B8F539D491085F1b6f7A8bE4',
    hooks: '0x23CE34E8199927DD270dddd8579c947542bDE446',
    poolManager: '0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66',
    fee: 3000,
    parameters: '0x00000000000000000000000000000000000000000000000000000000003c0881',
  })
  assert.equal(id, '0xcb1fbdafcaa52a0cc8f5ece1752737c2a5eec2b7242953270c15bdd9818a50e8')
})

test('derivePoolId reproduces the Sepolia exercise pool id', () => {
  const id = derivePoolId({
    currency0: '0x72368a4F5aBE0aF1c2735a14C468680649De6163',
    currency1: '0xBd9491b0121EFACA4782859FE2E8E2b3355bE0F2',
    hooks: '0x1C86dc775FF3FDADCCF87F132de7a4eb60B6bE28',
    poolManager: '0xb7C8a11E0B359616eD06256783aF57114841F738',
    fee: 3000,
    parameters: '0x00000000000000000000000000000000000000000000000000000000003c0881',
  })
  assert.equal(id, '0xfdce58bb8c3d5ab5e42b2dbc002334de5208b29806fccc49e503ffb0faa95ffb')
})

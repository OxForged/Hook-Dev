// Pure-function tests. No chain, no network. Run via `npm test` (builds first).
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from 'viem'

import { DISTRIBUTOR_KIND } from '../dist/abi.js'
import { decodePendingConfig, derivePoolId, kindFromBytes32 } from '../dist/decode.js'

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

test('decodePendingConfig: 7-word legacy return (Robinhood 0x23CE, Sepolia 0x1C86)', () => {
  const data = encodeAbiParameters(LEGACY, [61_000_000n, 3000, 2000, 8000, 0, ZERO_ADDR, true])
  const p = decodePendingConfig(data)
  assert.equal(p.shape, 'legacy')
  assert.equal(p.effectiveBlock, 61_000_000n)
  assert.equal(p.expiryBlock, null)
})

test('decodePendingConfig: 8-word current return', () => {
  const data = encodeAbiParameters(CURRENT, [61_000_000n, 61_500_000n, 3000, 2000, 8000, 0, ZERO_ADDR, true])
  const p = decodePendingConfig(data)
  assert.equal(p.shape, 'current')
  assert.equal(p.effectiveBlock, 61_000_000n)
  assert.equal(p.expiryBlock, 61_500_000n)
})

test('decodePendingConfig: all-zero returns of both widths mean "no proposal"', () => {
  assert.equal(decodePendingConfig('0x' + '00'.repeat(32 * 7)).effectiveBlock, 0n)
  assert.equal(decodePendingConfig('0x' + '00'.repeat(32 * 8)).effectiveBlock, 0n)
})

test('decodePendingConfig: the trap this exists to close — feePips must never land in expiryBlock', () => {
  // A legacy return whose SECOND word is feePips=3000. A 8-field decode would
  // report expiryBlock=3000, and a keeper at block >3000 would call the
  // proposal expired forever.
  const data = encodeAbiParameters(LEGACY, [10n, 3000, 0, 0, 0, ZERO_ADDR, false])
  const p = decodePendingConfig(data)
  assert.equal(p.expiryBlock, null)
  assert.equal(p.effectiveBlock, 10n)
})

test('decodePendingConfig refuses widths it has not seen', () => {
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(32 * 6)), /knows the 7-word .* and 8-word/)
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(32 * 9)), /knows the 7-word .* and 8-word/)
  assert.throws(() => decodePendingConfig('0x' + '00'.repeat(33)), /whole number of words/)
  assert.throws(() => decodePendingConfig('0x'), /knows the 7-word .* and 8-word/)
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

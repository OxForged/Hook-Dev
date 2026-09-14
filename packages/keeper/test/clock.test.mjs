// Pure-function tests for the contract clock. No chain, no network.
// Fixtures are Robinhood (4663) values read on 2026-09-13, the same ones
// packages/sdk/test/clock.test.ts pins.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTRACT_CLOCK_PROBE_CALLDATA,
  decodeContractClockProbe,
  pendingPhase,
  readContractClock,
} from '../dist/clock.js'

const L2_HEAD = 62_356_430n
const L1_AT_HEAD = 25_971_883n
const TS = 1_789_343_079n
const word = (v) => v.toString(16).padStart(64, '0')

function client({ probe = 'ok', l1 = undefined, number = L2_HEAD, probeNumber = L1_AT_HEAD } = {}) {
  const calls = []
  return {
    calls,
    async call({ data }) {
      calls.push(data)
      if (probe === 'reverts') throw new Error('creation calls refused')
      return { data: `0x${word(probeNumber)}${word(TS)}` }
    },
    async getBlock() {
      return l1 === undefined ? { number, timestamp: TS } : { number, timestamp: TS, l1BlockNumber: l1 }
    },
  }
}

test('probe bytecode matches the SDK byte for byte', () => {
  assert.equal(CONTRACT_CLOCK_PROBE_CALLDATA, '0x436000524260205260406000f3')
  assert.deepEqual(decodeContractClockProbe(`0x${word(L1_AT_HEAD)}${word(TS)}`), { number: L1_AT_HEAD, timestamp: TS })
  assert.throws(() => decodeContractClockProbe('0x00'), /expected 64/)
})

test('Robinhood: the contract block is the EVM NUMBER, the L2 head stays the log clock', async () => {
  const r = await readContractClock(client(), 4663)
  assert.equal(r.contractBlockNumber, L1_AT_HEAD)
  assert.equal(r.rpcBlockNumber, L2_HEAD)
  assert.equal(r.method, 'eth_call NUMBER')
})

test('falls back to header l1BlockNumber, never to the L2 number', async () => {
  const r = await readContractClock(client({ probe: 'reverts', l1: `0x${L1_AT_HEAD.toString(16)}` }), 4663)
  assert.equal(r.contractBlockNumber, L1_AT_HEAD)
  assert.equal(r.method, 'header l1BlockNumber')
  await assert.rejects(readContractClock(client({ probe: 'reverts' }), 4663), /not used as a substitute/)
})

test('a native chain uses the header number and does not probe', async () => {
  const c = client({ number: 11_699_528n })
  const r = await readContractClock(c, 11155111)
  assert.equal(r.contractBlockNumber, 11_699_528n)
  assert.equal(c.calls.length, 0)
})

/* A proposal made on the live block-numbered RevShareHook 0xfC00 (delay 432,000, TTL 2,592,000 contract blocks). */
const effective = L1_AT_HEAD + 432_000n
const expiry = effective + 2_592_000n
const block = (e, x) => ({ durationClock: 'contract-block', effective: e, expiry: x })
const at = (contractBlockNumber, timestamp = TS) => ({ timestamp, contractBlockNumber })

test('pendingPhase: a queued block proposal is not-due on the contract clock', () => {
  assert.equal(pendingPhase(block(effective, expiry), at(L1_AT_HEAD)), 'not-due')
})

test('pendingPhase: the same proposal reads EXPIRED against the L2 head — the bug being fixed', () => {
  assert.equal(pendingPhase(block(effective, expiry), at(L2_HEAD)), 'expired')
})

test('pendingPhase: window is [effective, expiry] inclusive, like applyPendingConfig', () => {
  const p = block(effective, expiry)
  assert.equal(pendingPhase(p, at(effective - 1n)), 'not-due')
  assert.equal(pendingPhase(p, at(effective)), 'applicable')
  assert.equal(pendingPhase(p, at(expiry)), 'applicable')
  assert.equal(pendingPhase(p, at(expiry + 1n)), 'expired')
})

test('pendingPhase: block-no-expiry has no expiry; zero effective means nothing pending', () => {
  assert.equal(pendingPhase(block(3_600n, null), at(10n ** 12n)), 'applicable')
  assert.equal(pendingPhase(block(0n, null), at(L1_AT_HEAD)), 'none')
})

test('pendingPhase: a timestamp proposal is judged on block.timestamp, never the block number', () => {
  const p = { durationClock: 'timestamp', effective: TS + 43_200n, expiry: TS + 43_200n + 259_200n }
  assert.equal(pendingPhase(p, at(10n ** 15n, TS)), 'not-due', 'a huge block number must not mature it')
  assert.equal(pendingPhase(p, at(0n, TS + 43_200n)), 'applicable')
  assert.equal(pendingPhase(p, at(0n, TS + 43_200n + 259_200n)), 'applicable')
  assert.equal(pendingPhase(p, at(0n, TS + 43_200n + 259_201n)), 'expired')
})

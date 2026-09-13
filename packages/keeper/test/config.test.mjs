// Config-loader tests. Writes temp files under the OS temp dir, never into the repo.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '../dist/config.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROBINHOOD = join(HERE, '..', 'keeper.config.robinhood.json')
const EXAMPLE = join(HERE, '..', 'keeper.config.example.json')

const dir = mkdtempSync(join(tmpdir(), 'latch-keeper-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
/** A copy of the Robinhood config with one thing changed, written to a temp file. */
function withConfig(mutate) {
  const cfg = JSON.parse(readFileSync(ROBINHOOD, 'utf8'))
  mutate(cfg)
  const p = join(dir, `cfg-${n++}.json`)
  writeFileSync(p, JSON.stringify(cfg))
  return p
}

test('the tracked Robinhood config loads and says what it means', () => {
  const cfg = loadConfig(ROBINHOOD)
  assert.equal(cfg.chainId, 4663)
  assert.equal(cfg.rpcUrls.length, 1)
  assert.equal(cfg.maxGas, 2_000_000n)
  assert.equal(cfg.targets.length, 1)
  const t = cfg.targets[0]
  assert.equal(t.distributor, null, 'no distributor on 4663 — stated, not omitted')
  assert.equal(t.hook.toLowerCase(), t.poolKey.hooks.toLowerCase())
  assert.equal(t.currencies.length, 2)
  assert.match(cfg.notes ?? '', /0xfC00485A/i, 'the current hook is named in notes so nobody thinks it was forgotten')
})

test('distributor must be present — null is a decision, absence is not', () => {
  const p = withConfig((c) => { delete c.targets[0].distributor })
  assert.throws(() => loadConfig(p), /distributor is required/)
})

test('a zero-address distributor is refused at startup, not on every tick', () => {
  const p = withConfig((c) => { c.targets[0].distributor = '0x0000000000000000000000000000000000000000' })
  assert.throws(() => loadConfig(p), /zero address/)
})

test('a real distributor address is accepted', () => {
  const p = withConfig((c) => { c.targets[0].distributor = '0x5A908Ad96Bd4770B65c8E83a9ede093C1Cb7966c' })
  assert.equal(loadConfig(p).targets[0].distributor, '0x5A908Ad96Bd4770B65c8E83a9ede093C1Cb7966c')
})

test('poolId must equal keccak256(abi.encode(poolKey))', () => {
  const p = withConfig((c) => { c.targets[0].poolKey.fee = 500 })
  assert.throws(() => loadConfig(p), /not keccak256\(abi\.encode\(poolKey\)\)/)
})

test('hook must equal poolKey.hooks', () => {
  const p = withConfig((c) => {
    // Point `hook` at the CURRENT hook while the key still names the retired one.
    c.targets[0].hook = '0xfC00485AFB2f9C73Bd7F9f5e72d14709233E2aD2'
  })
  assert.throws(() => loadConfig(p), /differs from poolKey\.hooks/)
})

test('currencies must be drawn from the pool', () => {
  const p = withConfig((c) => { c.targets[0].currencies.push('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73') })
  assert.throws(() => loadConfig(p), /neither currency0 nor currency1/)
})

test('rpcUrls must be https', () => {
  const p = withConfig((c) => { c.rpcUrls = ['http://rpc-robinhood.blockmachine.io'] })
  assert.throws(() => loadConfig(p), /must all be https/)
})

test('the example config fails loudly on its zero placeholders', () => {
  assert.throws(() => loadConfig(EXAMPLE), /zero address/)
})

/* ---------------------------------------------------------------------------
   Fee sweeps. Optional, but validated as strictly as everything else: a wrong
   controller address does not fail loudly at runtime, it reports "could not
   read accrued", which reads like an RPC blip rather than a config error.
   --------------------------------------------------------------------------- */

const SWEEP = {
  controller: '0x1111111111111111111111111111111111111111',
  targets: [
    {
      label: 'CL / USDG',
      poolManager: '0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66',
      currency: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    },
  ],
}

test('feeSweep is absent by default — the job is not registered at all', () => {
  const cfg = loadConfig(ROBINHOOD)
  assert.equal(cfg.feeSweep, undefined)
})

test('a valid feeSweep block parses, and the interval defaults later, not here', () => {
  const p = withConfig((c) => { c.feeSweep = structuredClone(SWEEP) })
  const cfg = loadConfig(p)
  assert.equal(cfg.feeSweep.targets.length, 1)
  assert.equal(cfg.feeSweep.intervalSeconds, undefined, 'the job owns the 12h default')
  assert.equal(cfg.feeSweep.targets[0].minAmount, undefined)
})

test('twelve hours is accepted, and is the number this exists for', () => {
  const p = withConfig((c) => { c.feeSweep = { ...structuredClone(SWEEP), intervalSeconds: 43200 } })
  assert.equal(loadConfig(p).feeSweep.intervalSeconds, 43200)
})

test('an interval under an hour is refused — that is gas, not revenue', () => {
  const p = withConfig((c) => { c.feeSweep = { ...structuredClone(SWEEP), intervalSeconds: 300 } })
  assert.throws(() => loadConfig(p), /at least 3600/)
})

test('a zero-address controller is refused at startup', () => {
  const p = withConfig((c) => {
    c.feeSweep = structuredClone(SWEEP)
    c.feeSweep.controller = '0x0000000000000000000000000000000000000000'
  })
  assert.throws(() => loadConfig(p), /zero address/)
})

test('a malformed currency is refused', () => {
  const p = withConfig((c) => {
    c.feeSweep = structuredClone(SWEEP)
    c.feeSweep.targets[0].currency = 'not-an-address'
  })
  assert.throws(() => loadConfig(p), /currency/)
})

test('the NATIVE currency is a legitimate sweep target, so zero is allowed there', () => {
  const p = withConfig((c) => {
    c.feeSweep = structuredClone(SWEEP)
    c.feeSweep.targets[0].currency = '0x0000000000000000000000000000000000000000'
  })
  const cfg = loadConfig(p)
  assert.equal(cfg.feeSweep.targets[0].currency, '0x0000000000000000000000000000000000000000')
})

test('minAmount survives as a bigint of RAW units', () => {
  const p = withConfig((c) => {
    c.feeSweep = structuredClone(SWEEP)
    c.feeSweep.targets[0].minAmount = '5000000'
  })
  assert.equal(loadConfig(p).feeSweep.targets[0].minAmount, 5_000_000n)
})

test('an empty targets array is refused rather than silently doing nothing', () => {
  const p = withConfig((c) => { c.feeSweep = { ...structuredClone(SWEEP), targets: [] } })
  assert.throws(() => loadConfig(p), /non-empty/)
})

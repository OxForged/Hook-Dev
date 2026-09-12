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

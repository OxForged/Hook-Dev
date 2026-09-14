/* The freeze guard (CLAUDE.md §3). Run with the SDK's vitest — see vitest.config.mjs.
   Globals (describe/it/expect) are provided by the config; vitest is not a
   dependency of apps/web. */

import { distributableNow, freezeGuard, type FreezeGuardInput } from '../src/routes/dapp/lib/freezeGuard'

declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void) => void
declare const expect: (v: unknown) => {
  toBe: (x: unknown) => void
  toEqual: (x: unknown) => void
}

/** LTT1/LTT2 on 0x23CE as read 2026-09-14: bps 8000, one entry weight 1, pots 0/0, no proposal. */
const LIVE_LTT: FreezeGuardInput = {
  beneficiaryBps: 8000,
  frozen: false,
  weights: [1n],
  totalWeight: 1n,
  pots: [
    { symbol: 'LTT1', amount: 0n },
    { symbol: 'LTT2', amount: 0n },
  ],
  proposal: 'none',
}

const failing = (input: FreezeGuardInput) =>
  freezeGuard(input)
    .checks.filter((c) => !c.ok)
    .map((c) => c.id)

describe('distributableNow mirrors settleBeneficiaries arithmetic', () => {
  it('is zero on zero weight — the contract returns early', () => {
    expect(distributableNow(1000n, [], 0n)).toBe(0n)
  })
  it('floors each share', () => {
    // 7 * 7 / 8 = 6, 7 * 1 / 8 = 0
    expect(distributableNow(7n, [7n, 1n], 8n)).toBe(6n)
  })
  it('is zero when every floored share is zero (dust)', () => {
    // 5 split across eight weight-1 entries: each floor(5/8) = 0
    expect(distributableNow(5n, [1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n], 8n)).toBe(0n)
  })
})

describe('freezeGuard', () => {
  it('allows the live LTT1/LTT2 state', () => {
    expect(freezeGuard(LIVE_LTT).allowed).toBe(true)
  })

  it('refuses an empty roster under a live beneficiary share (the §3 hazard)', () => {
    const v = freezeGuard({ ...LIVE_LTT, weights: [], totalWeight: 0n })
    expect(v.allowed).toBe(false)
    expect(failing({ ...LIVE_LTT, weights: [], totalWeight: 0n })).toEqual(['roster', 'weight'])
  })

  it('refuses an unsettled pot on either currency', () => {
    const input = { ...LIVE_LTT, pots: [{ symbol: 'LTT1', amount: 0n }, { symbol: 'LTT2', amount: 12n }] }
    expect(freezeGuard(input).allowed).toBe(false)
    expect(failing(input)).toEqual(['settled'])
  })

  it('treats a remainder no settlement can move as dust', () => {
    const input: FreezeGuardInput = {
      ...LIVE_LTT,
      weights: [1n, 1n, 1n],
      totalWeight: 3n,
      pots: [{ symbol: 'A', amount: 2n }, { symbol: 'B', amount: 0n }],
    }
    expect(freezeGuard(input).allowed).toBe(true)
  })

  it('refuses when only one currency was read', () => {
    const input = { ...LIVE_LTT, pots: [{ symbol: 'LTT1', amount: 0n }] }
    expect(failing(input)).toEqual(['both-currencies', 'settled'])
  })

  it('refuses a queued or armed proposal, not an expired one', () => {
    expect(failing({ ...LIVE_LTT, proposal: 'queued' })).toEqual(['no-proposal'])
    expect(failing({ ...LIVE_LTT, proposal: 'armed' })).toEqual(['no-proposal'])
    expect(freezeGuard({ ...LIVE_LTT, proposal: 'expired' }).allowed).toBe(true)
  })

  it('refuses readings where the roster does not sum to totalWeight', () => {
    expect(failing({ ...LIVE_LTT, weights: [1n], totalWeight: 2n })).toEqual(['weights-agree'])
  })

  it('at beneficiaryBps 0 only refuses a stranded residual pot', () => {
    const base = { ...LIVE_LTT, beneficiaryBps: 0, weights: [], totalWeight: 0n }
    expect(freezeGuard(base).allowed).toBe(true)
    const stranded = { ...base, pots: [{ symbol: 'LTT1', amount: 3n }, { symbol: 'LTT2', amount: 0n }] }
    expect(failing(stranded)).toEqual(['no-stranded-pot'])
  })

  it('refuses a pool that is already frozen', () => {
    expect(failing({ ...LIVE_LTT, frozen: true })).toEqual(['not-frozen'])
  })
})

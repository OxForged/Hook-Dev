/* The showcase filter: pools that trade an address-book test token are left out
   of every showcase surface (owner decision, 2026-09-14). The rule reads the
   book's own `isTestToken` flag, so these tests read the book too rather than
   typing addresses out — a token re-flagged in the SDK moves the answer here. */

import { DEPLOYMENTS, ROBINHOOD_CHAIN_ID, SEPOLIA_CHAIN_ID, isTestToken, showcaseTokens, tradesTestToken } from '../src/lib/chain'

const ZERO = '0x0000000000000000000000000000000000000000'
const STRANGER = '0x00000000000000000000000000000000000000aa'

for (const chainId of [ROBINHOOD_CHAIN_ID, SEPOLIA_CHAIN_ID] as const) {
  const book = DEPLOYMENTS[chainId].tokens
  const test = book.filter((t) => t.isTestToken)
  const real = book.filter((t) => !t.isTestToken)

  describe(`showcase filter on ${DEPLOYMENTS[chainId].name}`, () => {
    it('the book carries at least one of each kind, or these tests prove nothing', () => {
      expect(test.length).toBeGreaterThan(0)
      expect(real.length).toBeGreaterThan(0)
    })

    it('flags exactly the book test tokens, case-insensitively', () => {
      for (const t of test) {
        expect(isTestToken(chainId, t.address)).toBe(true)
        expect(isTestToken(chainId, t.address.toLowerCase())).toBe(true)
      }
      for (const t of real) expect(isTestToken(chainId, t.address)).toBe(false)
    })

    it('never assumes a token the book does not carry, or native, is a test token', () => {
      expect(isTestToken(chainId, STRANGER)).toBe(false)
      expect(isTestToken(chainId, ZERO)).toBe(false)
    })

    it('hides a pool when EITHER currency is a test token', () => {
      const t = test[0]!.address
      const r = real[0]!.address
      expect(tradesTestToken(chainId, { currency0: t, currency1: r })).toBe(true)
      expect(tradesTestToken(chainId, { currency0: r, currency1: t })).toBe(true)
      expect(tradesTestToken(chainId, { currency0: ZERO, currency1: r })).toBe(false)
      expect(tradesTestToken(chainId, { currency0: STRANGER, currency1: r })).toBe(false)
    })

    it('showcaseTokens is the book less its test tokens, in book order', () => {
      expect(showcaseTokens(chainId).map((t) => t.address)).toEqual(real.map((t) => t.address))
    })
  })
}

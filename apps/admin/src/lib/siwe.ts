import { adoptSignIn, apiPost, type Session } from './api.ts'

/*
 * Sign-In with Ethereum (EIP-4361) through an injected EIP-1193 provider
 * (MetaMask, Rabby, Frame). The wallet signs a plain-text message with
 * personal_sign; nothing is sent on chain and no transaction is ever requested.
 *
 * WalletConnect is not bundled: it would add a relay dependency and a remote
 * origin to an operator console whose CSP is connect-src 'self'. Safe owners
 * sign here with the same injected or hardware-backed wallet they use in the
 * Safe app.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export function injectedProvider(): Eip1193 | null {
  const eth = (globalThis as unknown as { ethereum?: Eip1193 }).ethereum
  return eth && typeof eth.request === 'function' ? eth : null
}

/** The exact EIP-4361 text the API parses with viem's parseSiweMessage. */
export function buildSiweMessage(p: { domain: string; address: string; uri: string; chainId: number; nonce: string; issuedAt: string; expirationTime: string }): string {
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to the Latch operator console. This signature grants no on-chain permission and sends no transaction.',
    '',
    `URI: ${p.uri}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
  ].join('\n')
}

const toHex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')}`

export async function signInWithInjected(): Promise<Session> {
  const eth = injectedProvider()
  if (!eth) throw new Error('No browser wallet found. Install or unlock MetaMask, Rabby or Frame, then retry.')
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  const address = accounts[0]?.toLowerCase()
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) throw new Error('The wallet returned no account.')
  const n = await apiPost<{ nonce: string; domain: string; chainId: number; expiresAt: string }>('/auth/nonce')
  const now = new Date()
  const message = buildSiweMessage({
    domain: n.domain,
    address,
    uri: `${window.location.origin}/admin/`,
    chainId: n.chainId,
    nonce: n.nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(Math.min(new Date(n.expiresAt).getTime(), now.getTime() + 5 * 60_000)).toISOString(),
  })
  const signature = (await eth.request({ method: 'personal_sign', params: [toHex(message), address] })) as string
  const s = await apiPost<Session & { csrfToken: string }>('/auth/verify', { message, signature })
  return adoptSignIn(s)
}

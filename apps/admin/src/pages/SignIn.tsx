import { useState } from 'react'
import { ApiError, type Session } from '../lib/api.ts'
import { injectedProvider, signInWithInjected } from '../lib/siwe.ts'

export function SignInPage({ reason, onSignedIn }: { reason: string | null; onSignedIn: (s: Session) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasWallet = injectedProvider() !== null

  return (
    <div className="gate">
      <main className="signin" aria-labelledby="signin-h">
        <div className="brand brand--large">
          <span className="brand__mark" aria-hidden="true">
            L
          </span>
          <span className="brand__name">Latch</span>
        </div>
        <h1 id="signin-h" className="signin__title">
          Operator console
        </h1>
        <p className="signin__lede">
          Governance, revenue, safety and moderation for the Latch protocol. For Latch operators only; developers building on Latch use the dapp.
        </p>
        {reason ? (
          <p className="state state--forbidden" role="status">
            {reason}
          </p>
        ) : null}
        <ul className="signin__facts">
          <li>
            <strong>Admin</strong>: an owner of the governance Safe (read with <code>getOwners()</code>).
          </li>
          <li>
            <strong>Curator</strong>: holds <code>CURATOR_ROLE</code> on LatchRegistry.
          </li>
          <li>
            <strong>Viewer</strong>: on the server's read-only allowlist.
          </li>
          <li>Signing in is a message signature. It grants no on-chain permission and sends no transaction.</li>
        </ul>
        {!hasWallet ? (
          <div className="state state--unconfigured">
            <strong>No browser wallet detected.</strong> Install or unlock MetaMask, Rabby or Frame (an injected EIP-1193 wallet), then reload.
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !hasWallet}
          onClick={() => {
            setBusy(true)
            setError(null)
            signInWithInjected()
              .then(onSignedIn)
              .catch((e: unknown) => {
                if (e instanceof ApiError) setError(e.failure.kind === 'forbidden' ? `This address holds no admin, curator or viewer role. ${e.failure.message}` : e.failure.message)
                else setError(e instanceof Error ? e.message : 'Sign-in failed')
              })
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Waiting for your wallet…' : 'Sign in with wallet'}
        </button>
        {error ? (
          <p className="state state--error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, hasRole, isFixtureApi, loadSession, onSignedOut, signOut, type Session } from './lib/api.ts'
import { shortAddr } from './lib/format.ts'
import { applyTheme, readTheme, type ThemeChoice } from './lib/theme.ts'
import { AuditPage } from './pages/Audit.tsx'
import { GovernancePage } from './pages/Governance.tsx'
import { KeysPage } from './pages/Keys.tsx'
import { ModerationPage } from './pages/Moderation.tsx'
import { OverviewPage } from './pages/Overview.tsx'
import { ProtocolPage } from './pages/Protocol.tsx'
import { RevenuePage } from './pages/Revenue.tsx'
import { SafeActionsPage } from './pages/SafeActions.tsx'
import { SafetyPage } from './pages/Safety.tsx'
import { SignInPage } from './pages/SignIn.tsx'
import { TreasuryPage } from './pages/Treasury.tsx'

export type PageKey = 'overview' | 'revenue' | 'protocol' | 'governance' | 'safety' | 'moderation' | 'keys' | 'audit' | 'safe-actions' | 'treasury'

const PAGES: { key: PageKey; label: string; role: 'viewer' | 'curator' | 'admin' }[] = [
  { key: 'overview', label: 'Overview', role: 'viewer' },
  { key: 'revenue', label: 'Revenue', role: 'viewer' },
  { key: 'treasury', label: 'Treasury', role: 'viewer' },
  { key: 'protocol', label: 'Protocol', role: 'viewer' },
  { key: 'governance', label: 'Governance', role: 'viewer' },
  { key: 'safety', label: 'Safety', role: 'viewer' },
  { key: 'moderation', label: 'Moderation', role: 'curator' },
  { key: 'keys', label: 'API keys', role: 'admin' },
  { key: 'audit', label: 'Audit log', role: 'admin' },
  { key: 'safe-actions', label: 'Safe actions', role: 'viewer' },
]

function pageFromHash(): PageKey {
  const k = window.location.hash.replace(/^#\/?/, '').split('?')[0] as PageKey
  return PAGES.some((p) => p.key === k) ? k : 'overview'
}

export function navigate(page: PageKey) {
  window.location.hash = `#/${page}`
}

type AuthState = { kind: 'checking' } | { kind: 'signed-out'; reason: string | null } | { kind: 'unavailable'; message: string } | { kind: 'in'; session: Session }

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'checking' })
  const [page, setPage] = useState<PageKey>(pageFromHash)
  const [theme, setTheme] = useState<ThemeChoice>(readTheme)
  const [navOpen, setNavOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  const check = useCallback(() => {
    loadSession()
      .then((session) => setAuth({ kind: 'in', session }))
      .catch((e: unknown) => {
        const f = e instanceof ApiError ? e.failure : null
        if (f?.kind === 'signed-out') setAuth({ kind: 'signed-out', reason: null })
        else if (f?.kind === 'not-configured') setAuth({ kind: 'unavailable', message: `The admin API is disabled on this server (${f.message}).` })
        else setAuth({ kind: 'unavailable', message: f?.message ?? 'The Latch API is unreachable.' })
      })
  }, [])

  useEffect(() => {
    check()
    const off = onSignedOut(() => setAuth({ kind: 'signed-out', reason: 'Your session ended or your on-chain role changed. Sign in again.' }))
    const onHash = () => {
      setPage(pageFromHash())
      setNavOpen(false)
      mainRef.current?.focus()
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
    }
  }, [check])

  if (auth.kind === 'checking') {
    return (
      <div className="gate" role="status">
        <span className="spinner" aria-hidden="true" /> Checking your session…
      </div>
    )
  }
  if (auth.kind === 'unavailable') {
    return (
      <div className="gate">
        <div className="state state--error" role="alert">
          <strong>Operator console unavailable.</strong> {auth.message}
          <button type="button" className="btn btn--xs" onClick={check}>
            Retry
          </button>
        </div>
      </div>
    )
  }
  if (auth.kind === 'signed-out') return <SignInPage reason={auth.reason} onSignedIn={(session) => setAuth({ kind: 'in', session })} />

  const session = auth.session
  const current = PAGES.find((p) => p.key === page)!
  const allowed = hasRole(session, current.role)
  const cycleTheme = () => {
    const next: ThemeChoice = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <button type="button" className="btn btn--ghost topbar__menu" aria-expanded={navOpen} aria-controls="nav" onClick={() => setNavOpen((o) => !o)}>
          Menu
        </button>
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            L
          </span>
          <span className="brand__name">Latch</span>
          <span className="brand__sub">Operator console</span>
        </div>
        <div className="topbar__right">
          <span className="chip chip--muted" title="Admin role chain">
            chain {session.chainId}
          </span>
          <span className="whoami" title={session.address}>
            <code>{shortAddr(session.address)}</code>
            {session.grants.map((g) => (
              <span key={g.role} className={`chip chip--role-${g.role}`} title={g.source}>
                {g.role} · {g.reason}
              </span>
            ))}
          </span>
          <button type="button" className="btn btn--ghost btn--xs" onClick={cycleTheme} aria-label={`Theme: ${theme}. Change theme`}>
            Theme: {theme}
          </button>
          <button
            type="button"
            className="btn btn--xs"
            onClick={() => {
              void signOut().finally(() => setAuth({ kind: 'signed-out', reason: 'Signed out.' }))
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {isFixtureApi() ? (
        <div className="fixture-banner" role="note">
          TEST FIXTURE API: every figure on this screen comes from apps/admin/test/mock-server, not from chain. Never use this build to decide anything.
        </div>
      ) : null}
      <div className="layout">
        <nav id="nav" className={`nav ${navOpen ? 'nav--open' : ''}`} aria-label="Console sections">
          <ul>
            {PAGES.map((p) => {
              const ok = hasRole(session, p.role)
              return (
                <li key={p.key}>
                  <a href={`#/${p.key}`} aria-current={p.key === page ? 'page' : undefined} className={`nav__link ${ok ? '' : 'nav__link--locked'}`}>
                    <span>{p.label}</span>
                    {!ok ? <span className="nav__lock">{p.role}</span> : null}
                  </a>
                </li>
              )
            })}
          </ul>
          <p className="nav__note">This console prepares transactions and never signs or sends one. Signing happens in the Safe app or your own wallet.</p>
        </nav>
        <main id="main" ref={mainRef} tabIndex={-1} className="main">
          <h1 className="page-title">{current.label}</h1>
          {!allowed ? (
            <div className="state state--forbidden">
              <strong>Requires the {current.role} role.</strong> You signed in with {session.roles.join(', ')}. Roles come from chain: Safe owners are admin, LatchRegistry CURATOR_ROLE holders are curator.
            </div>
          ) : page === 'overview' ? (
            <OverviewPage chainId={session.chainId} />
          ) : page === 'revenue' ? (
            <RevenuePage chainId={session.chainId} />
          ) : page === 'treasury' ? (
            <TreasuryPage session={session} />
          ) : page === 'protocol' ? (
            <ProtocolPage chainId={session.chainId} />
          ) : page === 'governance' ? (
            <GovernancePage chainId={session.chainId} />
          ) : page === 'safety' ? (
            <SafetyPage chainId={session.chainId} />
          ) : page === 'moderation' ? (
            <ModerationPage />
          ) : page === 'keys' ? (
            <KeysPage />
          ) : page === 'audit' ? (
            <AuditPage />
          ) : (
            <SafeActionsPage session={session} />
          )}
        </main>
      </div>
    </div>
  )
}

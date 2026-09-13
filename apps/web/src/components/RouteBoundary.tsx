/* ============================================================================
   Loading and error states for the lazily-loaded route chunks.

   These are two of the four house states (loading, error, empty,
   not-configured) and reuse their existing classes from dapp.css, which is
   loaded globally by main.tsx:

     loading  `.live-note.dapp-state--loading` — no box, a pulsing blue dot
     error    `.dapp-state--error`             — a box with a warning rule

   so neither can be mistaken for the other, or for content.
   ============================================================================ */

import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'

const SHELL: CSSProperties = {
  // Holds the viewport so the footer-less fallback does not collapse the page
  // to a strip and then spring back open when the route renders.
  minHeight: '100vh',
  padding: '80px 40px',
  maxWidth: 720,
  margin: '0 auto',
}

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '.22em',
  textTransform: 'uppercase',
  color: 'var(--label-ink)',
  margin: '0 0 12px',
}

/** Suspense fallback while a route's chunk downloads. */
export function RouteLoading() {
  return (
    <main style={SHELL} aria-busy="true">
      <p className="live-note dapp-state--loading" role="status">
        Loading this page&hellip;
      </p>
    </main>
  )
}

/**
 * True for the errors browsers and Vite's preload helper throw when a chunk
 * cannot be fetched or evaluated. The usual cause on a static host is a stale
 * tab: a new deploy replaced the hashed chunk files this tab's entry points at.
 */
function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|importing a module script failed|unable to preload css|failed to fetch/i.test(
    error.message,
  )
}

type Props = {
  /** Clears a caught error when it changes. App passes the pathname, so
      navigating elsewhere recovers without a reload. */
  readonly resetKey: string
  readonly children: ReactNode
}

type State = { readonly error: Error | null; readonly resetKey: string }

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[route] failed to load or render', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children

    const chunk = isChunkLoadError(error)
    return (
      <main style={SHELL}>
        <p style={EYEBROW}>Error</p>
        <div className="dapp-state--error" role="alert">
          <strong className="dapp-state__title">
            {chunk ? 'This page could not be downloaded' : 'This page failed to render'}
          </strong>
          <p className="live-note">
            {chunk
              ? 'Part of the site failed to load. This usually means a new version was published after this tab was opened, or the connection dropped. Reloading fetches the current version.'
              : 'An error was thrown while rendering this page. Reloading may clear it; if it does not, the message below is what to report.'}
          </p>
          <p className="live-note">
            <code>{error.message}</code>
          </p>
        </div>
        <p style={{ margin: '24px 0 0', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="dapp-btn dapp-btn--primary dapp-btn--sm"
            onClick={() => window.location.reload()}
          >
            Reload page
          </button>
          {/* A plain anchor, not <Link>: a full navigation re-fetches index.html
              and with it the current chunk names. */}
          <a href={import.meta.env.BASE_URL} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            &larr; back to Latch
          </a>
        </p>
      </main>
    )
  }
}

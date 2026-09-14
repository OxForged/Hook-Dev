import { useState, type ReactNode } from 'react'
import type { Loadable } from '../lib/useApi.ts'
import { shortAddr } from '../lib/format.ts'

export type Tone = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'ok' | 'muted'

export const severityTone = (s: string): Tone =>
  s === 'CRITICAL' ? 'critical' : s === 'HIGH' ? 'high' : s === 'MEDIUM' ? 'medium' : s === 'LOW' ? 'low' : 'info'

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip chip--${tone}`} title={title}>
      {children}
    </span>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState<'idle' | 'ok' | 'fail'>('idle')
  return (
    <button
      type="button"
      className="btn btn--ghost btn--xs"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setDone('ok'))
          .catch(() => setDone('fail'))
          .finally(() => setTimeout(() => setDone('idle'), 1500))
      }}
      aria-label={`${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`}
    >
      {done === 'ok' ? 'Copied' : done === 'fail' ? 'Copy failed' : label}
    </button>
  )
}

export function Addr({ value, label }: { value: string | null | undefined; label?: string | null }) {
  if (!value) return <span className="muted">—</span>
  return (
    <span className="addr">
      <code title={value}>{shortAddr(value)}</code>
      {label ? <span className="addr__label">{label}</span> : null}
      <CopyButton text={value} />
    </span>
  )
}

export function Panel({ title, provenance, actions, children, id }: { title: string; provenance?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  const headingId = id ? `${id}-h` : undefined
  return (
    <section className="panel" aria-labelledby={headingId} id={id}>
      <header className="panel__head">
        <h2 className="panel__title" id={headingId}>
          {title}
        </h2>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className="panel__body">{children}</div>
      {provenance ? <p className="provenance">Source: {provenance}</p> : null}
    </section>
  )
}

/**
 * The four states CLAUDE.md requires, visually distinct, plus "forbidden" for a
 * role that cannot see the panel. Never falls back to an example.
 */
export function StateView<T>({ state, reload, empty, isEmpty, children }: { state: Loadable<T>; reload?: () => void; empty?: ReactNode; isEmpty?: (d: T) => boolean; children: (data: T) => ReactNode }) {
  switch (state.kind) {
    case 'loading':
      return (
        <div className="state state--loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" /> Loading from the Latch API…
        </div>
      )
    case 'error':
      return (
        <div className="state state--error" role="alert">
          <strong>Could not load.</strong> {state.message}
          {state.status ? <span className="muted"> (HTTP {state.status})</span> : null}
          {reload ? (
            <button type="button" className="btn btn--xs" onClick={reload}>
              Retry
            </button>
          ) : null}
        </div>
      )
    case 'not-configured':
      return (
        <div className="state state--unconfigured">
          <strong>Not configured.</strong> {state.message}
        </div>
      )
    case 'forbidden':
      return (
        <div className="state state--forbidden">
          <strong>Not available to your role.</strong> {state.message}
        </div>
      )
    case 'signed-out':
      return <div className="state state--forbidden">Signed out. {state.message}</div>
    case 'ok':
      if (isEmpty && isEmpty(state.data)) return <div className="state state--empty">{empty ?? 'Nothing recorded yet.'}</div>
      return <>{children(state.data)}</>
  }
}

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div className="kv__row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  )
}

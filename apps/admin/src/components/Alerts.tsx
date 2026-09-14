import type { Alert, SeverityCounts } from '../pages/types.ts'
import { Chip, severityTone } from './ui.tsx'

export function SeverityBar({ counts }: { counts: SeverityCounts }) {
  const order: Alert['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
  const worst = order.find((s) => counts[s] > 0)
  return (
    <div className={`severity-bar severity-bar--${worst ? severityTone(worst) : 'ok'}`} role="status" aria-live="polite">
      <span className="severity-bar__lead">{worst ? `${counts[worst]} ${worst.toLowerCase()} alert${counts[worst] === 1 ? '' : 's'}` : 'No open alerts'}</span>
      <span className="severity-bar__counts">
        {order.map((s) => (
          <span key={s} className="severity-bar__count">
            <Chip tone={severityTone(s)}>{s}</Chip> {counts[s]}
          </span>
        ))}
      </span>
    </div>
  )
}

export function AlertList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return <div className="state state--empty">No alerts. Every rule was evaluated against the latest worker reads and none fired.</div>
  return (
    <ul className="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`alert alert--${severityTone(a.severity)}`}>
          <div className="alert__head">
            <Chip tone={severityTone(a.severity)}>{a.severity}</Chip>
            <span className="alert__cat">{a.category}</span>
            <strong className="alert__title">{a.title}</strong>
          </div>
          <p className="alert__detail">{a.detail}</p>
          <div className="alert__foot">
            <span className="provenance">Source: {a.provenance}</span>
            {a.action ? (
              <a className="btn btn--xs" href={`#/${a.action.page}`}>
                {a.action.label}
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

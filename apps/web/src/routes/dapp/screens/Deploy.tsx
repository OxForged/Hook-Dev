/* Deploy a Hook — SCREENS.md § C3.
   Step strip advances with state (1-2 at rest, 1-3 simulating, all four once
   simulated); the button reads Run simulation -> Simulating… (2.2s) ->
   Register on Base ✓ and turns green. Nothing is signed or submitted. */

import { useMemo } from 'react'
import { loadDeploy, preflightChecks, simulationLines } from '../data/deploy.ts'
import { useDapp } from '../state.tsx'

function lineTone(text: string): string {
  if (text.startsWith('✓')) return 'is-ok'
  if (text.startsWith('·')) return 'is-idle'
  return 'is-run'
}

export default function Deploy() {
  const data = useMemo(loadDeploy, [])
  const { cbs, budget, setBudget, deploying, deployed, simulate, toggleCallback } = useDapp()

  const activeThrough = deployed ? 3 : deploying ? 2 : 1
  const lines = simulationLines(deployed)
  const checks = preflightChecks(budget)
  const label = deploying ? 'Simulating…' : deployed ? 'Register on Base ✓' : 'Run simulation'
  const fillPct = Math.round((budget / data.maxBudget) * 100)

  return (
    <div className="dapp-row dapp-row--deploy">
      <div className="dapp-stack">
        <ol className="dapp-steps">
          {data.steps.map((s, i) => (
            <li key={s.n} className={i <= activeThrough ? 'dapp-step is-active' : 'dapp-step'}>
              <span className="dapp-step__num" aria-hidden="true">
                {s.n}
              </span>
              <span className="dapp-step__body">
                <span className="dapp-step__name">{s.name}</span>
                <span className="dapp-step__hint">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>

        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-card__title dapp-card__title--lg">Latch configuration</h2>

          <div className="dapp-fields">
            <div>
              <h3 className="dapp-microlabel dapp-microlabel--tight">CONTRACT ADDRESS</h3>
              <p className="dapp-readout">{data.contractAddress}</p>
            </div>

            <div>
              <h3 className="dapp-microlabel dapp-microlabel--tight" id="dapp-cb-label">
                CALLBACKS
              </h3>
              <div className="dapp-chips dapp-chips--tight" role="group" aria-labelledby="dapp-cb-label">
                {data.callbacks.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cbs.includes(c) ? 'dapp-chip is-active' : 'dapp-chip'}
                    aria-pressed={cbs.includes(c)}
                    onClick={() => toggleCallback(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="dapp-field__head">
                <label className="dapp-microlabel dapp-microlabel--tight" htmlFor="dapp-budget">
                  GAS BUDGET PER CALL
                </label>
                <span className="dapp-field__value">
                  {(budget * 1000).toLocaleString('en-US')} gas
                </span>
              </div>
              {/* The reference draws this bar static; the bar keeps its exact
                  look and a transparent range input sits over it, so the
                  documented `budget` state — and the pre-flight check that
                  fails below 9k — is actually reachable. */}
              <div className="dapp-budget">
                <div className="dapp-budget__track">
                  <span className="dapp-budget__fill" style={{ width: `${fillPct}%` }} />
                </div>
                <input
                  id="dapp-budget"
                  type="range"
                  className="dapp-budget__input"
                  min={data.minBudget}
                  max={data.maxBudget}
                  step={1}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  aria-valuetext={`${(budget * 1000).toLocaleString('en-US')} gas`}
                />
              </div>
              <div className="dapp-axis dapp-axis--tight">
                <span>{data.budgetAxis[0]}</span>
                <span>{data.budgetAxis[1]}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            className={
              deployed
                ? 'dapp-btn dapp-btn--block dapp-btn--success'
                : 'dapp-btn dapp-btn--block dapp-btn--primary'
            }
            data-busy={deploying ? 'true' : undefined}
            aria-busy={deploying}
            onClick={simulate}
          >
            {label}
          </button>
        </section>
      </div>

      <div className="dapp-stack">
        <section className="dapp-console">
          <div className="dapp-console__bar">
            <span className="dapp-dot dapp-dot--primary dapp-dot--flat" aria-hidden="true" />
            <h2 className="dapp-console__title">simulation output</h2>
          </div>
          <div className="dapp-console__body" aria-live="polite">
            {lines.map((t, i) => (
              <p
                key={t}
                className={`dapp-console__line ${lineTone(t)}${deploying || deployed ? ' is-shown' : ''}${deploying ? ' is-staggered' : ''}`}
                style={{ animationDelay: `${(i * 0.32).toFixed(2)}s` }}
              >
                {t}
              </p>
            ))}
          </div>
        </section>

        <section className="dapp-card">
          <h2 className="dapp-microlabel">PRE-FLIGHT CHECKS</h2>
          <ul className="dapp-checks">
            {checks.map((c) => (
              <li key={c.name} className="dapp-checks__row">
                <span
                  className={c.ok ? 'dapp-dot dapp-dot--success dapp-dot--lg' : 'dapp-dot dapp-dot--error dapp-dot--lg'}
                  aria-hidden="true"
                />
                <span className="dapp-checks__name">{c.name}</span>
                <span className={c.ok ? 'dapp-checks__value' : 'dapp-checks__value is-error'}>
                  {c.value}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

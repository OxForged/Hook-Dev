/* Hook Explorer — SCREENS.md § C2. Chips filter the list; cards open Pool Detail. */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { filterLatches, loadExplorer } from '../data/explorer.ts'
import type { LatchStatus } from '../data/explorer.ts'
import { dappPath } from '../paths.ts'
import { useDapp } from '../state.tsx'

const BADGE_CLASS: Record<LatchStatus, string> = {
  VERIFIED: 'dapp-badge dapp-badge--ok',
  AUDITED: 'dapp-badge dapp-badge--info',
  REVIEW: 'dapp-badge dapp-badge--warn',
}

export default function Explorer() {
  const data = useMemo(loadExplorer, [])
  const { filter, setFilter } = useDapp()
  /* Free-text search is local to the screen; the reference's search field is
     decorative, this one actually narrows the same mock list. */
  const [query, setQuery] = useState('')

  const latches = filterLatches(data.latches, filter, query)

  return (
    <>
      <div className="dapp-toolbar">
        <div className="dapp-search">
          <span className="dapp-search__ring" aria-hidden="true" />
          <input
            type="search"
            className="dapp-search__input"
            placeholder={data.searchPlaceholder}
            aria-label="Search latches, authors, pools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="dapp-chips" role="group" aria-label="Filter latches by category">
          {data.filters.map((f) => (
            <button
              key={f}
              type="button"
              className={f === filter ? 'dapp-chip is-active' : 'dapp-chip'}
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="dapp-grid dapp-grid--latches">
        {latches.map((l, i) => (
          <Link
            key={l.name}
            to={dappPath('pool')}
            className="dapp-card dapp-card--latch"
            style={{ animationDelay: `${(i * 0.05).toFixed(2)}s` }}
          >
            <div className="dapp-latch__head">
              <span className="dapp-tile" aria-hidden="true">
                <span className="dapp-tile__diamond" />
              </span>
              <span className="dapp-latch__id">
                <span className="dapp-latch__name">{l.name}</span>
                <span className="dapp-latch__author">{l.author}</span>
              </span>
              <span className={BADGE_CLASS[l.status]}>{l.status}</span>
            </div>
            <p className="dapp-latch__desc">{l.desc}</p>
            <p className="dapp-tags">
              {l.hooks.map((h) => (
                <span key={h} className="dapp-tag">
                  {h}
                </span>
              ))}
            </p>
            <div className="dapp-latch__foot">
              <span className="dapp-stat">
                <span className="dapp-stat__label">TVL</span>
                <span className="dapp-stat__value">{l.tvl}</span>
              </span>
              <span className="dapp-stat">
                <span className="dapp-stat__label">CALLS 24H</span>
                <span className="dapp-stat__value">{l.calls}</span>
              </span>
              <span className="dapp-stat">
                <span className="dapp-stat__label">GAS</span>
                <span className="dapp-stat__value">{l.gas}</span>
              </span>
            </div>
          </Link>
        ))}
        {latches.length === 0 ? (
          <p className="dapp-empty">No latches match that filter.</p>
        ) : null}
      </div>
    </>
  )
}

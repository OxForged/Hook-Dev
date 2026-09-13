/* ============================================================================
   Ecosystem — the directory of third-party projects building on Latch.

   A Latch is a hook contract attached to a pool. The Marketplace lists those
   contracts, read from the on-chain registry. THIS page lists the teams and
   products that use them — and that is information no chain holds, so it comes
   from a curated file in the repo (data/ecosystem.ts) and is added to by a
   GitHub issue the project opens itself.

   The consequence, and the thing every part of this layout says out loud: a
   listing here is the project's own words, merged as written. Nobody has
   checked that the integration exists, works, or is safe. That status is a
   property of the whole surface — it is in the header badge, the count line
   and on every card — rather than a per-entry flag nothing could set.

   THE LAYOUT is Ink's app directory, taken for structure only: search with a
   `/` shortcut, category tabs, two filter menus (Tags = Latch families from
   `uses`, Network = `chains`), "Submit app", and the card grid. The card and
   the submission form are shared with the landing page. Visuals are Option B.

   WHAT EVERY FILTER IS BUILT FROM. Tabs, tags and networks are derived from
   the listings themselves (`categoriesListed`, `kindsListed`, `chainsListed`),
   so there is never a tab or an option that matches nothing.

   With zero entries the page is the empty state and the explanatory panels.
   There is no filter row over nothing.
   ============================================================================ */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'

import { ChainTag, chainNameFor } from '../../../components/ChainTag.tsx'
import { BarList } from '../components/charts.tsx'
import { EcosystemCard } from '../components/EcosystemCard.tsx'
import { SubmitAppModal } from '../components/SubmitAppModal.tsx'
import '../components/ecosystemCard.css'
import {
  ECOSYSTEM_ISSUES_REPO,
  ECOSYSTEM_PROJECTS,
  LATCH_KINDS,
  LATCH_KIND_ORDER,
  LISTING_PROVENANCE,
  categoriesListed,
  chainCounts,
  chainsListed,
  hostOf,
  kindsListed,
  sortedProjects,
  type EcosystemCategory,
  type EcosystemProject,
  type LatchKind,
} from '../data/ecosystem.ts'
import type { LabelledBar, SeriesColor } from '../data/types.ts'
import { dappPath } from '../paths.ts'
import '../ecosystem.css'

/** A keystroke should not interrupt the previous announcement (see Explorer). */
const ANNOUNCE_DELAY_MS = 700

function resultSentence(matched: number): string {
  if (matched === 0) return 'No projects match.'
  return matched === 1 ? '1 project matches.' : `${matched} projects match.`
}

function matchesQuery(p: EcosystemProject, q: string): boolean {
  if (!q) return true
  return (
    p.name.toLowerCase().includes(q) ||
    p.tagline.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    hostOf(p.url).toLowerCase().includes(q) ||
    p.uses.some((k) => LATCH_KINDS[k].label.toLowerCase().includes(q))
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/* ---- filter menu: a button that opens a single-select listbox ------------------ */

interface MenuOption<T> {
  readonly value: T
  /** Plain text: the accessible name, and the button text when selected. */
  readonly label: string
  /** Optional visual, e.g. a chain mark. Falls back to `label`. */
  readonly render?: ReactNode
  readonly count: number
}

interface FilterMenuProps<T extends string | number> {
  /** The menu's name, shown on the button while nothing is selected: "Tags". */
  readonly name: string
  readonly allLabel: string
  readonly allCount: number
  readonly value: T | 'all'
  readonly options: readonly MenuOption<T>[]
  readonly onChange: (value: T | 'all') => void
}

/**
 * WAI-ARIA APG "listbox" behind a disclosure button.
 *
 * Keyboard: ArrowDown / ArrowUp / Enter / Space on the button open the list
 * with the current value active; in the list, ArrowUp/Down move, Home/End jump,
 * Enter/Space choose and close, Escape closes without choosing, Tab closes.
 * Focus sits on the listbox and `aria-activedescendant` names the active
 * option, so a screen reader reads each option as it is reached. Focus returns
 * to the button whenever the list closes from the keyboard.
 */
function FilterMenu<T extends string | number>({
  name,
  allLabel,
  allCount,
  value,
  options,
  onChange,
}: FilterMenuProps<T>) {
  const uid = useId()
  const buttonId = `${uid}-button`
  const listId = `${uid}-list`

  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const all: MenuOption<T | 'all'>[] = useMemo(
    () => [{ value: 'all', label: allLabel, count: allCount }, ...options],
    [allLabel, allCount, options],
  )

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [alignEnd, setAlignEnd] = useState(false)

  const selectedIndex = Math.max(
    0,
    all.findIndex((o) => o.value === value),
  )
  const selected = all[selectedIndex]

  const openList = (index: number = selectedIndex) => {
    setActive(index)
    /* Measure from the default alignment every time, or a flip from a previous
       opening would be measured against itself. */
    setAlignEnd(false)
    setOpen(true)
  }

  const close = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const choose = (index: number) => {
    const option = all[index]
    if (option) onChange(option.value)
    close(true)
  }

  /* On open: focus the list, and flip it to the right edge if it would run
     off the viewport — the menus sit at the end of a row that wraps. */
  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    list.focus()
    const rect = list.getBoundingClientRect()
    setAlignEnd(rect.right > document.documentElement.clientWidth)
  }, [open])

  /* Keep the active option in view as the arrows move it. */
  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  /* A pointer press anywhere else closes the list without moving focus. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openList()
    }
  }

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = all.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close(true)
        break
      case 'Tab':
        close(false)
        break
      default:
        break
    }
  }

  const isActive = value !== 'all'

  return (
    <div ref={wrapRef} className="eco2-menu">
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="eco2-menu__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${name}: ${selected?.label ?? allLabel}`}
        data-active={isActive ? 'true' : 'false'}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKey}
      >
        <span className="eco2-menu__text">
          {isActive && selected ? (selected.render ?? selected.label) : name}
        </span>
        <span className="eco2-menu__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={buttonId}
          aria-activedescendant={`${listId}-${active}`}
          className="eco2-menu__list"
          data-align={alignEnd ? 'end' : 'start'}
          onKeyDown={onListKey}
        >
          {all.map((o, i) => {
            const isSelected = o.value === value
            return (
              <li
                key={String(o.value)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                data-focused={i === active ? 'true' : 'false'}
                className="eco2-menu__option"
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="eco2-menu__label">
                  <span className="eco2-menu__tick" aria-hidden="true">
                    {isSelected ? '✓' : ''}
                  </span>
                  {o.render ?? o.label}
                </span>
                <span className="eco2-menu__count" aria-label={o.count === 1 ? '1 project' : `${o.count} projects`}>
                  {o.count}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ============================================================================
   Where the listings say they are live.

   THE ONLY THING ON THIS PAGE THAT CAN BE COUNTED. Nothing here is a chain
   read — `chainCounts` counts the `chains` field of entries in
   `data/ecosystem.ts`, which each project wrote itself. So the bars are an
   honest count of CLAIMS, and the caption says exactly that rather than letting
   a chart borrow the authority the Marketplace's charts have.

   A project that named three chains is one listing on each of three bars, so
   the bars can sum past the listing count. The share is a share of listings,
   not of bars, which is why `shareLabel` names its denominator.

   Not rendered at all when the directory is empty: three chains at zero would
   be a chart about nothing, and the empty state already says it in a sentence.
   ============================================================================ */
const CHAIN_SERIES: readonly SeriesColor[] = ['primary', 'signal', 'violet', 'success', 'amber']

function ChainMix({ projects }: { projects: readonly EcosystemProject[] }) {
  const bars: LabelledBar[] = useMemo(
    () =>
      chainCounts(projects).map(({ chainId, count }, i) => ({
        name: chainNameFor(chainId),
        value: String(count),
        pct: (count / projects.length) * 100,
        color: CHAIN_SERIES[i % CHAIN_SERIES.length] as SeriesColor,
      })),
    [projects],
  )

  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-mix-h">
      <h2 id="eco-mix-h" className="dapp-card__title">
        Chains claimed
      </h2>
      <BarList items={bars} valueLabel="listings" shareLabel="of the listings" />
      <p className="live-note">
        Counted from what each project wrote in its own listing. A project spanning several chains
        is counted on each.
      </p>
    </section>
  )
}

/** What the Latch-family chips mean. Every row names a contract family in this repo. */
function KindLegend() {
  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-kinds-h">
      <h2 id="eco-kinds-h" className="dapp-card__title">
        Reading the badges
      </h2>
      <p className="live-note">
        The chip is the project&rsquo;s claim; the contract name is what the family is called on
        chain.
      </p>
      <ul className="lx-legend">
        {LATCH_KIND_ORDER.map((k) => {
          const info = LATCH_KINDS[k]
          return (
            <li key={k}>
              <span className="dapp-badge dapp-badge--info">{info.label}</span>
              <span>
                {info.contract && <code className="eco-legend__code">{info.contract}</code>}
                {info.meaning}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="live-note">
        &ldquo;Featured&rdquo; is an editorial choice by Latch about which cards the landing page
        shows. It is not a review, an audit or an endorsement.
      </p>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="dapp-card lx-rail__card" aria-labelledby="eco-how-h">
      <h2 id="eco-how-h" className="dapp-card__title">
        How listings work
      </h2>
      <dl className="live-grid eco-how">
        <div>
          <dt>Source</dt>
          <dd>
            A file in this site&rsquo;s repository, <code>data/ecosystem.ts</code>. Not a chain
            read.
          </dd>
        </div>
        <div>
          <dt>Added by</dt>
          <dd>
            The project itself, through a{' '}
            <a href={`${ECOSYSTEM_ISSUES_REPO}/issues`} target="_blank" rel="noopener noreferrer">
              GitHub issue ↗
            </a>
            . &ldquo;Submit app&rdquo; prefills it; nothing is sent from this site.
          </dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>
            No — for any entry. The label on each card is the status of the whole page, not a flag
            that could flip.
          </dd>
        </div>
      </dl>
      <p className="live-note lx-rail__note">
        Want the contracts rather than the teams? The <Link to={dappPath('marketplace')}>Marketplace</Link>{' '}
        reads every listed Latch from the registry and decodes what its bytecode can do.
      </p>
    </section>
  )
}

/* ---- the screen ------------------------------------------------------------------ */

export default function Ecosystem() {
  const all = useMemo(() => sortedProjects(ECOSYSTEM_PROJECTS), [])
  const categories = useMemo(() => categoriesListed(all), [all])
  const kinds = useMemo(() => kindsListed(all), [all])
  const chains = useMemo(() => chainsListed(all), [all])

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<EcosystemCategory | 'all'>('all')
  const [kind, setKind] = useState<LatchKind | 'all'>('all')
  const [chain, setChain] = useState<number | 'all'>('all')
  const [submitting, setSubmitting] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const filtersOn = category !== 'all' || kind !== 'all' || chain !== 'all' || q !== ''

  const visible = useMemo(
    () =>
      all.filter(
        (p) =>
          matchesQuery(p, q) &&
          (category === 'all' || p.category === category) &&
          (kind === 'all' || p.uses.includes(kind)) &&
          (chain === 'all' || p.chains.includes(chain)),
      ),
    [all, q, category, kind, chain],
  )

  /* The count is announced once it has settled, not on every keystroke. */
  const summary = all.length > 0 ? resultSentence(visible.length) : ''
  const [settled, setSettled] = useState('')
  useEffect(() => {
    if (summary === '') return
    const t = window.setTimeout(() => setSettled(summary), ANNOUNCE_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [summary])

  /* `/` focuses search — Ink's shortcut. Ignored while typing in any field, in
     an open menu, with a modifier held, or while the submission dialog is up
     (it would otherwise pull focus out of a modal). */
  useEffect(() => {
    if (all.length === 0 || submitting) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, textarea, select, [role="listbox"], [role="dialog"]'))
      ) {
        return
      }
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [all.length, submitting])

  /* A chosen tab that sits past the scroll edge is brought into view. Not on
     first render: `scrollIntoView` also scrolls the PAGE, and a visitor who has
     not touched the tabs should not be moved to them. */
  const lastCategory = useRef(category)
  useEffect(() => {
    if (lastCategory.current === category) return
    lastCategory.current = category
    const row = tabsRef.current
    const pressed = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    pressed?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [category])

  const clear = () => {
    setQuery('')
    setCategory('all')
    setKind('all')
    setChain('all')
  }

  const kindOptions: MenuOption<LatchKind>[] = useMemo(
    () =>
      kinds.map((k) => ({
        value: k,
        label: LATCH_KINDS[k].label,
        count: all.filter((p) => p.uses.includes(k)).length,
      })),
    [kinds, all],
  )

  const chainOptions: MenuOption<number>[] = useMemo(
    () =>
      chains.map((id) => ({
        value: id,
        label: chainNameFor(id),
        render: <ChainTag chainId={id} size={14} />,
        count: all.filter((p) => p.chains.includes(id)).length,
      })),
    [chains, all],
  )

  const submitButton = (
    <button type="button" className="eco2-btn" onClick={() => setSubmitting(true)}>
      <span className="eco2-btn__plus" aria-hidden="true">
        +
      </span>
      Submit app
    </button>
  )

  return (
    <div className="eco2-dir">
      <section className="dapp-card hx-head eco-head" aria-labelledby="eco-h">
        <div className="dapp-card__head">
          <h2 id="eco-h" className="dapp-card__title dapp-card__title--lg">
            Projects building on Latch
          </h2>
          {/* Not a LIVE badge. Nothing on this page is read from chain, and
              the badge that says so has to be the first thing after the title. */}
          <span className="dapp-badge dapp-badge--mute">SELF-SUBMITTED · UNVERIFIED</span>
        </div>
        {/* The last sentence is the caveat, not padding: without it a
            directory of names reads as a directory of endorsements. */}
        <p className="live-note">
          Teams and products, not contracts — those are on the{' '}
          <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the registry. Every
          entry here was written by the project itself and merged as submitted, so a listing says
          a team asked to be listed. It does not say the integration works, is safe, or is
          still live.
        </p>
      </section>

      {all.length > 0 && (
        <div className="eco2-dir__toolbar">
          <div className="eco2-dir__search">
            <span className="eco2-dir__search-ring" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="eco2-dir__search-input"
              placeholder="Search apps by name, description, category or site"
              aria-label="Search apps by name, description, category or site"
              aria-keyshortcuts="/"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd className="eco2-dir__kbd" aria-hidden="true" title="Press / to search">
              /
            </kbd>
          </div>

          <div className="eco2-dir__bar">
            <div ref={tabsRef} className="eco2-dir__tabs" role="group" aria-label="Category">
              <button
                type="button"
                className="eco2-dir__tab"
                aria-pressed={category === 'all'}
                onClick={() => setCategory('all')}
              >
                All categories
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="eco2-dir__tab"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="eco2-dir__menus">
              <FilterMenu
                name="Tags"
                allLabel="All Latch families"
                allCount={all.length}
                value={kind}
                options={kindOptions}
                onChange={setKind}
              />
              <FilterMenu
                name="Network"
                allLabel="All networks"
                allCount={all.length}
                value={chain}
                options={chainOptions}
                onChange={setChain}
              />
              {submitButton}
            </div>
          </div>
        </div>
      )}

      <p className="dapp-sr" role="status" aria-live="polite">
        {summary === '' ? '' : settled}
      </p>

      {all.length === 0 && (
        <section className="dapp-card eco-empty" aria-labelledby="eco-empty-h">
          <span className="dapp-tile eco-empty__tile" aria-hidden="true">
            <span className="dapp-tile__diamond" />
          </span>
          <div className="eco-empty__body">
            <h3 id="eco-empty-h" className="eco-empty__title">
              No projects are listed yet.
            </h3>
            <p>
              Any team building on Latch can list itself with a GitHub issue — no review queue,
              no fee. It ships empty rather than seeded: every entry names a real third party
              that asked to be here, and none has yet.
            </p>
            <p className="eco-empty__aside">
              Looking for the Latches themselves? They are on the{' '}
              <Link to={dappPath('marketplace')}>Marketplace</Link>, read from the on-chain
              registry.
            </p>
            <button
              type="button"
              className="dapp-btn dapp-btn--primary dapp-btn--sm eco-empty__cta"
              onClick={() => setSubmitting(true)}
            >
              Be the first — submit your app
            </button>
          </div>
        </section>
      )}

      {visible.length > 0 && (
        <>
          <p className="lx-count" role="presentation">
            <span>
              {visible.length === 1 ? '1 project' : `${visible.length} projects`}
              {filtersOn ? ' matching' : ' listed'}
            </span>
            <span className="lx-count__note">— {LISTING_PROVENANCE}.</span>
          </p>
          <ul className="eco2-grid eco2-dir__grid" aria-label="Apps">
            {visible.map((p) => (
              <li key={`${p.name}|${p.url}`}>
                <EcosystemCard project={p} />
              </li>
            ))}
          </ul>
        </>
      )}

      {all.length > 0 && visible.length === 0 && (
        <p className="dapp-empty hx-state dapp-state--empty">
          No project matches that {filtersOn ? 'search and filter' : 'view'}.{' '}
          <button type="button" className="hx-linkbtn" onClick={clear}>
            Clear filters
          </button>
        </p>
      )}

      <div className="eco2-dir__notes">
        <HowItWorks />
        <KindLegend />
        {all.length > 0 && <ChainMix projects={all} />}
      </div>

      {submitting ? <SubmitAppModal onClose={() => setSubmitting(false)} /> : null}
    </div>
  )
}

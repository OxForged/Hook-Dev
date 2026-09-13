/* ============================================================================
   "Submit app" — the listing form, shared by the landing page and the
   /app/ecosystem directory.

   THE SITE IS STATIC. It is served from GitHub Pages and has no backend, so
   this form stores nothing, uploads nothing and sends nothing. Its only output
   is a URL: the prefilled GitHub issue built by `buildListingIssue()`, opened
   in a new tab. The issue IS the submission. Every piece of copy here says so,
   because a form that looks like it submitted when it did not is a lie about
   where somebody's data went.

   THE ICON cannot travel in a URL. The browser reads the chosen file locally to
   show a preview and its dimensions, and the form says plainly that the file
   has to be dragged into the GitHub issue. The object URL never leaves the page
   and is revoked when replaced or when the dialog closes.

   DIALOG CONTRACT (WAI-ARIA APG, modal dialog):
     · `role="dialog"`, `aria-modal="true"`, labelled by its title and
       described by its intro line.
     · Rendered into document.body through a portal, so no transformed ancestor
       (the landing page's reveal animation) can capture `position: fixed`.
     · Focus moves to the first field on open, is trapped inside while open, and
       returns to whatever opened it on close.
     · Escape closes. A click that both starts and ends on the backdrop closes;
       a text selection dragged out of the dialog does not.
     · The page behind cannot scroll; the dialog body scrolls inside itself.
     · Reduced motion drops the entry animation (ecosystemCard.css).
   ============================================================================ */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'

import { ChainTag } from '../../../components/ChainTag.tsx'
import { CHAIN_ROWS } from '../../../data/chains.ts'
import {
  CATEGORY_OTHER,
  ECOSYSTEM_CATEGORIES,
  LATCH_KINDS,
  LATCH_KIND_ORDER,
  LISTING_LIMITS,
  LISTING_PROVENANCE,
  MAX_ISSUE_URL_LENGTH,
  buildListingIssue,
  formatBytes,
  type EcosystemCategory,
  type LatchKind,
  type ListingIcon,
} from '../data/ecosystem.ts'
import './ecosystemCard.css'

/* ---- validation ------------------------------------------------------------ */

type CategoryChoice = EcosystemCategory | typeof CATEGORY_OTHER | ''

interface FormValues {
  name: string
  url: string
  description: string
  category: CategoryChoice
  categoryOther: string
  uses: LatchKind[]
  ownLatch: string
  chains: number[]
  source: string
  iconSource: string
  contact: string
}

type FieldKey = 'name' | 'url' | 'description' | 'category' | 'categoryOther' | 'uses' | 'chains' | 'source' | 'iconSource' | 'ownLatch' | 'contact'

const FIELD_NAMES: Record<FieldKey, string> = {
  name: 'App name',
  url: 'Website URL',
  description: 'Description',
  category: 'Category',
  categoryOther: 'Other category',
  uses: 'Latch families used',
  chains: 'Chains',
  source: 'Source repository',
  iconSource: 'Icon source URL',
  ownLatch: 'Your own Latch',
  contact: 'Contact',
}

const EMPTY: FormValues = {
  name: '',
  url: '',
  description: '',
  category: '',
  categoryOther: '',
  uses: [],
  ownLatch: '',
  chains: [],
  source: '',
  iconSource: '',
  contact: '',
}

/**
 * https only, and a host with a dot in it. `new URL` alone accepts
 * `https://localhost` and `https://x`, neither of which is somewhere a card can
 * send a trader.
 */
function httpsError(raw: string, required: boolean): string | null {
  const value = raw.trim()
  if (value === '') return required ? 'Enter the address, starting with https://' : null
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return 'That is not a complete address. It should look like https://example.com'
  }
  if (u.protocol !== 'https:') return 'The address must start with https://'
  if (!u.hostname.includes('.') || u.hostname.startsWith('.') || u.hostname.endsWith('.')) {
    return 'The address needs a full domain, like https://example.com'
  }
  return null
}

function lengthError(value: string, max: number): string | null {
  return Array.from(value.trim()).length > max ? `${max} characters or fewer` : null
}

function validate(v: FormValues): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {}
  const set = (k: FieldKey, msg: string | null) => {
    if (msg) e[k] = msg
  }

  set('name', v.name.trim() === '' ? 'Enter the app name' : lengthError(v.name, LISTING_LIMITS.name))
  set('url', httpsError(v.url, true) ?? lengthError(v.url, LISTING_LIMITS.url))
  set(
    'description',
    v.description.trim() === ''
      ? 'Describe the app in a sentence or two'
      : lengthError(v.description, LISTING_LIMITS.description),
  )
  set('category', v.category === '' ? 'Choose a category' : null)
  if (v.category === CATEGORY_OTHER) {
    set(
      'categoryOther',
      v.categoryOther.trim() === ''
        ? 'Name the category'
        : lengthError(v.categoryOther, LISTING_LIMITS.categoryOther),
    )
  }
  set('uses', v.uses.length === 0 ? 'Tick at least one Latch family' : null)
  set('chains', v.chains.length === 0 ? 'Tick at least one chain' : null)
  set('source', httpsError(v.source, false) ?? lengthError(v.source, LISTING_LIMITS.source))
  set('iconSource', httpsError(v.iconSource, false) ?? lengthError(v.iconSource, LISTING_LIMITS.iconSource))
  if (v.uses.includes('own')) set('ownLatch', lengthError(v.ownLatch, LISTING_LIMITS.ownLatch))
  set('contact', lengthError(v.contact, LISTING_LIMITS.contact))
  return e
}

/* ---- icon ------------------------------------------------------------------ */

/**
 * The formats public/ecosystem/SOURCES.md records: an SVG (preferred — the
 * Peddles mark) or a PNG where a site publishes no SVG (PeddlesQuest). Anything
 * else is refused here rather than accepted and rejected at merge.
 */
const ICON_TYPES: readonly string[] = ['image/svg+xml', 'image/png']
const ICON_ACCEPT = '.svg,.png,image/svg+xml,image/png'

function isAcceptedIcon(file: File): boolean {
  if (ICON_TYPES.includes(file.type)) return true
  return /\.(svg|png)$/i.test(file.name)
}

interface IconState {
  readonly file: File
  readonly previewUrl: string
  readonly width?: number
  readonly height?: number
}

/* ---- focus trap ------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 || el === document.activeElement,
  )
}

/* ---- the component ----------------------------------------------------------- */

interface SubmitAppModalProps {
  readonly onClose: () => void
}

export function SubmitAppModal({ onClose }: SubmitAppModalProps) {
  const uid = useId()
  const id = (s: string) => `${uid}-${s}`

  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const doneHeadingRef = useRef<HTMLHeadingElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const backdropDownRef = useRef(false)

  const [values, setValues] = useState<FormValues>(EMPTY)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [icon, setIcon] = useState<IconState | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [step, setStep] = useState<'form' | 'done'>('form')

  const errors = useMemo(() => validate(values), [values])
  const missing = (Object.keys(errors) as FieldKey[]).map((k) => FIELD_NAMES[k])
  const valid = missing.length === 0

  const issue = useMemo(() => {
    const iconMeta: ListingIcon | null = icon
      ? {
          fileName: icon.file.name,
          type: icon.file.type,
          bytes: icon.file.size,
          ...(icon.width !== undefined && icon.height !== undefined
            ? { width: icon.width, height: icon.height }
            : {}),
        }
      : null
    return buildListingIssue({ ...values, icon: iconMeta })
  }, [values, icon])

  /* ---- open / close lifecycle ---- */

  useLayoutEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const { body, documentElement } = document
    const prevOverflow = body.style.overflow
    const prevPadding = body.style.paddingRight
    const gap = window.innerWidth - documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (gap > 0) body.style.paddingRight = `${gap}px`

    firstFieldRef.current?.focus()

    return () => {
      body.style.overflow = prevOverflow
      body.style.paddingRight = prevPadding
      const opener = openerRef.current
      if (opener && opener.isConnected) opener.focus()
    }
  }, [])

  /* Revoke the preview URL whenever it is replaced, and on close. */
  useEffect(() => {
    if (!icon) return
    const url = icon.previewUrl
    return () => URL.revokeObjectURL(url)
  }, [icon])

  /* Focus follows the step: the button that changed it has just unmounted. The
     first run is skipped because the open effect above already placed focus. */
  const stepMounted = useRef(false)
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true
      return
    }
    if (step === 'done') doneHeadingRef.current?.focus()
    else firstFieldRef.current?.focus()
  }, [step])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = focusables(root)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        e.preventDefault()
        return
      }
      const active = document.activeElement
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  const onBackdropDown = (e: MouseEvent<HTMLDivElement>) => {
    backdropDownRef.current = e.target === e.currentTarget
  }
  const onBackdropUp = (e: MouseEvent<HTMLDivElement>) => {
    if (backdropDownRef.current && e.target === e.currentTarget) onClose()
    backdropDownRef.current = false
  }

  /* ---- field helpers ---- */

  const setField = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))
  const touch = (key: FieldKey) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  const shown = (key: FieldKey): string | undefined => (touched[key] ? errors[key] : undefined)

  const toggleIn = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(' ') || undefined

  /* ---- icon ---- */

  const takeFile = (file: File | undefined) => {
    if (!file) return
    if (!isAcceptedIcon(file)) {
      setIconError(`${file.name} is not an SVG or PNG. Choose the SVG or PNG your own site publishes.`)
      return
    }
    setIconError(null)
    setIcon({ file, previewUrl: URL.createObjectURL(file) })
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    takeFile(e.target.files?.[0])
    // Allow choosing the same file again after removing it.
    e.target.value = ''
  }

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setDragOver(false)
    takeFile(e.dataTransfer.files[0])
  }

  const onPreviewLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    setIcon((cur) =>
      cur && cur.width === undefined && naturalWidth > 0
        ? { ...cur, width: naturalWidth, height: naturalHeight }
        : cur,
    )
  }

  /* ---- submit ---- */

  const open = () => {
    if (!valid) {
      setTouched(Object.fromEntries(Object.keys(errors).map((k) => [k, true])))
      return
    }
    /* `noopener` makes window.open return null whether or not a blocker
       stopped it, so the next step always shows the link as a fallback. */
    window.open(issue.url, '_blank', 'noopener,noreferrer')
    setStep('done')
  }

  const descCount = Array.from(values.description.trim()).length
  const truncated = issue.descriptionKeptChars !== null

  const titleId = id('title')
  const introId = id('intro')

  const dialog = (
    <div className="eco2-modal" onMouseDown={onBackdropDown} onMouseUp={onBackdropUp}>
      <div
        ref={dialogRef}
        className="eco2-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        /* -1 so a click on plain text inside the dialog focuses the dialog
           rather than <body>, where Escape and the Tab trap would not reach. */
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="eco2-modal__head">
          <div>
            <h2 id={titleId} className="eco2-modal__title">
              App submission
            </h2>
            <p id={introId} className="eco2-modal__sub">
              Opens a prefilled GitHub issue. Nothing is uploaded or stored by this site.
            </p>
          </div>
          <button type="button" className="eco2-modal__close" onClick={onClose} aria-label="Close app submission">
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {step === 'form' ? (
          <>
            <div className="eco2-modal__body">
              <p className="eco2-note">
                Listing is free and merged as written. The issue that opens is the submission — a
                maintainer adds it to the directory, where every card reads{' '}
                <strong>&ldquo;{LISTING_PROVENANCE}&rdquo;</strong>.
              </p>

              {/* ---- App name ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('name')}>
                  App name<span className="eco2-field__req" aria-hidden="true">*</span>
                </label>
                <input
                  ref={firstFieldRef}
                  id={id('name')}
                  className="eco2-input"
                  type="text"
                  autoComplete="organization"
                  spellCheck={false}
                  required
                  placeholder="As you want it shown"
                  value={values.name}
                  aria-invalid={shown('name') ? true : undefined}
                  aria-describedby={describedBy(shown('name') && id('name-err'))}
                  onChange={(e) => setField('name', e.target.value)}
                  onBlur={() => touch('name')}
                />
                {shown('name') && (
                  <p id={id('name-err')} className="eco2-field__error">
                    {shown('name')}
                  </p>
                )}
              </div>

              {/* ---- Website ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('url')}>
                  Website URL<span className="eco2-field__req" aria-hidden="true">*</span>
                </label>
                <input
                  id={id('url')}
                  className="eco2-input"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  required
                  placeholder="https://"
                  value={values.url}
                  aria-invalid={shown('url') ? true : undefined}
                  aria-describedby={describedBy(id('url-hint'), shown('url') && id('url-err'))}
                  onChange={(e) => setField('url', e.target.value)}
                  onBlur={() => touch('url')}
                />
                <p id={id('url-hint')} className="eco2-field__hint">
                  https only. This is where the card links.
                </p>
                {shown('url') && (
                  <p id={id('url-err')} className="eco2-field__error">
                    {shown('url')}
                  </p>
                )}
              </div>

              {/* ---- Description ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('desc')}>
                  Description<span className="eco2-field__req" aria-hidden="true">*</span>
                </label>
                <textarea
                  id={id('desc')}
                  className="eco2-input"
                  required
                  rows={3}
                  placeholder="What the app does, in your words"
                  value={values.description}
                  aria-invalid={shown('description') ? true : undefined}
                  aria-describedby={describedBy(
                    id('desc-count'),
                    shown('description') && id('desc-err'),
                    truncated && id('desc-cut'),
                  )}
                  onChange={(e) => setField('description', e.target.value)}
                  onBlur={() => touch('description')}
                />
                <p
                  id={id('desc-count')}
                  className="eco2-field__count"
                  data-over={descCount > LISTING_LIMITS.description ? 'true' : 'false'}
                >
                  {descCount} / {LISTING_LIMITS.description}
                </p>
                {shown('description') && (
                  <p id={id('desc-err')} className="eco2-field__error">
                    {shown('description')}
                  </p>
                )}
                {truncated && (
                  <p id={id('desc-cut')} className="eco2-note eco2-note--warn" role="status">
                    <strong>Your description will be shortened.</strong> GitHub rejects links longer than
                    about 8&nbsp;KB, so the issue opens with the first {issue.descriptionKeptChars} of{' '}
                    {issue.descriptionTotalChars} characters. Paste the rest into the issue before you
                    submit it.
                  </p>
                )}
              </div>

              {/* ---- Category ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('cat')}>
                  Category<span className="eco2-field__req" aria-hidden="true">*</span>
                </label>
                <select
                  id={id('cat')}
                  className="eco2-input"
                  required
                  value={values.category}
                  aria-invalid={shown('category') ? true : undefined}
                  aria-describedby={describedBy(shown('category') && id('cat-err'))}
                  onChange={(e) => {
                    setField('category', e.target.value as CategoryChoice)
                    touch('category')
                  }}
                  onBlur={() => touch('category')}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {ECOSYSTEM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={CATEGORY_OTHER}>{CATEGORY_OTHER}</option>
                </select>
                {shown('category') && (
                  <p id={id('cat-err')} className="eco2-field__error">
                    {shown('category')}
                  </p>
                )}
                {values.category === CATEGORY_OTHER && (
                  <>
                    <label className="eco2-sr" htmlFor={id('cat-other')}>
                      Other category
                    </label>
                    <input
                      id={id('cat-other')}
                      className="eco2-input"
                      type="text"
                      required
                      placeholder="Name the category"
                      value={values.categoryOther}
                      aria-invalid={shown('categoryOther') ? true : undefined}
                      aria-describedby={describedBy(shown('categoryOther') && id('cat-other-err'))}
                      onChange={(e) => setField('categoryOther', e.target.value)}
                      onBlur={() => touch('categoryOther')}
                    />
                    {shown('categoryOther') && (
                      <p id={id('cat-other-err')} className="eco2-field__error">
                        {shown('categoryOther')}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* ---- Latch families ---- */}
              <fieldset
                className="eco2-field"
                aria-describedby={describedBy(id('uses-hint'), shown('uses') && id('uses-err'))}
              >
                <legend className="eco2-field__label">
                  Latch families used<span className="eco2-field__req" aria-hidden="true">*</span>
                </legend>
                <p id={id('uses-hint')} className="eco2-field__hint">
                  Tick every family the app uses. The code name is what the contract is called on chain.
                </p>
                <ul className="eco2-checks">
                  {LATCH_KIND_ORDER.map((k) => {
                    const info = LATCH_KINDS[k]
                    return (
                      <li key={k}>
                        <label className="eco2-check">
                          <input
                            type="checkbox"
                            checked={values.uses.includes(k)}
                            onChange={() => {
                              setField('uses', toggleIn(values.uses, k))
                              touch('uses')
                            }}
                          />
                          <span className="eco2-check__text">
                            <span>{info.label}</span>
                            {info.contract && <code className="eco2-check__code">{info.contract}</code>}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {shown('uses') && (
                  <p id={id('uses-err')} className="eco2-field__error">
                    {shown('uses')}
                  </p>
                )}
                {values.uses.includes('own') && (
                  <div className="eco2-field">
                    <label className="eco2-field__label" htmlFor={id('own')}>
                      Your own Latch <span className="eco2-field__opt">(optional)</span>
                    </label>
                    <input
                      id={id('own')}
                      className="eco2-input"
                      type="text"
                      spellCheck={false}
                      placeholder="0x… or its Marketplace link"
                      value={values.ownLatch}
                      aria-invalid={shown('ownLatch') ? true : undefined}
                      aria-describedby={describedBy(shown('ownLatch') && id('own-err'))}
                      onChange={(e) => setField('ownLatch', e.target.value)}
                      onBlur={() => touch('ownLatch')}
                    />
                    {shown('ownLatch') && (
                      <p id={id('own-err')} className="eco2-field__error">
                        {shown('ownLatch')}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>

              {/* ---- Chains ---- */}
              <fieldset
                className="eco2-field"
                aria-describedby={describedBy(id('chains-hint'), shown('chains') && id('chains-err'))}
              >
                <legend className="eco2-field__label">
                  Chains<span className="eco2-field__req" aria-hidden="true">*</span>
                </legend>
                <p id={id('chains-hint')} className="eco2-field__hint">
                  Where the integration is live. Only networks this site knows are listed.
                </p>
                <ul className="eco2-checks">
                  {CHAIN_ROWS.map((row) => (
                    <li key={row.chainId}>
                      <label className="eco2-check">
                        <input
                          type="checkbox"
                          checked={values.chains.includes(row.chainId)}
                          onChange={() => {
                            setField('chains', toggleIn(values.chains, row.chainId))
                            touch('chains')
                          }}
                        />
                        <span className="eco2-check__text">
                          <ChainTag chainId={row.chainId} size={16} />
                          {row.network === 'testnet' && <span className="eco2-check__net">Testnet</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {shown('chains') && (
                  <p id={id('chains-err')} className="eco2-field__error">
                    {shown('chains')}
                  </p>
                )}
              </fieldset>

              {/* ---- Icon ---- */}
              <div className="eco2-field">
                <span className="eco2-field__label" id={id('icon-label')}>
                  Icon <span className="eco2-field__opt">(optional)</span>
                </span>
                <p id={id('icon-hint')} className="eco2-field__hint">
                  Your own official mark, exactly as published on your own site, CDN or GitHub org —
                  never redrawn or recoloured. SVG preferred; otherwise a square PNG. The marks listed
                  today are a 100×100 SVG and a 180×180 PNG.
                </p>

                <input
                  id={id('icon')}
                  className="eco2-sr eco2-drop-input"
                  type="file"
                  accept={ICON_ACCEPT}
                  aria-labelledby={id('icon-label')}
                  aria-describedby={describedBy(id('icon-hint'), id('icon-upload'), iconError !== null && id('icon-err'))}
                  onChange={onFileChange}
                />
                <label
                  htmlFor={id('icon')}
                  className="eco2-drop"
                  data-over={dragOver ? 'true' : 'false'}
                  onDragEnter={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <span className="eco2-drop__glyph" aria-hidden="true">
                    ↥
                  </span>
                  <span>{icon ? 'Drop or click to choose a different file' : 'Drag and drop, or click to choose'}</span>
                  <span className="eco2-drop__sub">SVG or PNG · preview only</span>
                </label>

                {iconError && (
                  <p id={id('icon-err')} className="eco2-field__error" role="alert">
                    {iconError}
                  </p>
                )}

                {icon && (
                  <div className="eco2-preview">
                    <span className="eco2-preview__tile">
                      <img src={icon.previewUrl} alt={`Preview of ${icon.file.name}`} onLoad={onPreviewLoad} />
                    </span>
                    <span className="eco2-preview__meta">
                      <span className="eco2-preview__name">{icon.file.name}</span>
                      <span>
                        {icon.file.type || 'Unknown type'} · {formatBytes(icon.file.size)}
                        {icon.width !== undefined && icon.height !== undefined
                          ? ` · ${icon.width}×${icon.height} px`
                          : ''}
                      </span>
                      {icon.width !== undefined && icon.height !== undefined && icon.width !== icon.height && (
                        <span>Not square — the card tile is square, so it will show with space around it.</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="eco2-btn eco2-btn--ghost"
                      onClick={() => setIcon(null)}
                      aria-label={`Remove ${icon.file.name}`}
                    >
                      Remove
                    </button>
                  </div>
                )}

                <p id={id('icon-upload')} className="eco2-note">
                  <strong>Your icon isn&rsquo;t uploaded from here — drag this file into the GitHub issue that opens.</strong>{' '}
                  This site is static and cannot attach a file to a GitHub link.
                </p>

                <label className="eco2-field__label" htmlFor={id('icon-src')}>
                  Where the icon is published <span className="eco2-field__opt">(optional)</span>
                </label>
                <input
                  id={id('icon-src')}
                  className="eco2-input"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="https://your-site/logo.svg"
                  value={values.iconSource}
                  aria-invalid={shown('iconSource') ? true : undefined}
                  aria-describedby={describedBy(id('icon-src-hint'), shown('iconSource') && id('icon-src-err'))}
                  onChange={(e) => setField('iconSource', e.target.value)}
                  onBlur={() => touch('iconSource')}
                />
                <p id={id('icon-src-hint')} className="eco2-field__hint">
                  A maintainer records this as the icon&rsquo;s source. Without one, the card keeps its
                  monogram.
                </p>
                {shown('iconSource') && (
                  <p id={id('icon-src-err')} className="eco2-field__error">
                    {shown('iconSource')}
                  </p>
                )}
              </div>

              {/* ---- Source ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('source')}>
                  Public source repository <span className="eco2-field__opt">(optional)</span>
                </label>
                <input
                  id={id('source')}
                  className="eco2-input"
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  placeholder="https://github.com/"
                  value={values.source}
                  aria-invalid={shown('source') ? true : undefined}
                  aria-describedby={describedBy(shown('source') && id('source-err'))}
                  onChange={(e) => setField('source', e.target.value)}
                  onBlur={() => touch('source')}
                />
                {shown('source') && (
                  <p id={id('source-err')} className="eco2-field__error">
                    {shown('source')}
                  </p>
                )}
              </div>

              {/* ---- Contact ---- */}
              <div className="eco2-field">
                <label className="eco2-field__label" htmlFor={id('contact')}>
                  Contact <span className="eco2-field__opt">(optional)</span>
                </label>
                <input
                  id={id('contact')}
                  className="eco2-input"
                  type="text"
                  spellCheck={false}
                  placeholder="A handle or address for the maintainers"
                  value={values.contact}
                  aria-invalid={shown('contact') ? true : undefined}
                  aria-describedby={describedBy(id('contact-hint'), shown('contact') && id('contact-err'))}
                  onChange={(e) => setField('contact', e.target.value)}
                  onBlur={() => touch('contact')}
                />
                <p id={id('contact-hint')} className="eco2-field__hint">
                  Not shown on the card. The GitHub issue is public, so anything here is too.
                </p>
                {shown('contact') && (
                  <p id={id('contact-err')} className="eco2-field__error">
                    {shown('contact')}
                  </p>
                )}
              </div>

              {issue.overLimit && (
                <p className="eco2-note eco2-note--warn" role="status">
                  <strong>This link is still longer than GitHub accepts</strong> (
                  {issue.url.length.toLocaleString('en-US')} of {MAX_ISSUE_URL_LENGTH.toLocaleString('en-US')}{' '}
                  characters). Shorten the longer fields above.
                </p>
              )}
            </div>

            <footer className="eco2-modal__foot">
              <p id={id('status')} className="eco2-modal__foot-note">
                {valid ? 'Opens github.com in a new tab. Nothing is sent from this page.' : `Still needed: ${missing.join(', ')}.`}
              </p>
              <div className="eco2-modal__actions">
                <button type="button" className="eco2-btn eco2-btn--ghost" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="eco2-btn eco2-btn--primary"
                  disabled={!valid}
                  aria-describedby={id('status')}
                  onClick={open}
                >
                  Open GitHub issue <span aria-hidden="true">↗</span>
                </button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="eco2-modal__body">
              <h3 ref={doneHeadingRef} tabIndex={-1} className="eco2-field__label">
                Finish the submission on GitHub
              </h3>
              <ol className="eco2-steps">
                <li>
                  Check the prefilled issue in the tab that opened. If no tab opened,{' '}
                  <a href={issue.url} target="_blank" rel="noopener noreferrer">
                    open the issue here ↗
                  </a>
                  .
                </li>
                {icon ? (
                  <li>
                    <strong>Drag {icon.file.name} into the Icon box.</strong> It was not uploaded from this
                    page.
                  </li>
                ) : null}
                {truncated ? (
                  <li>Paste the rest of your description — the link carried only the first {issue.descriptionKeptChars} characters.</li>
                ) : null}
                <li>Tick the confirmations and submit the issue. That is the submission.</li>
              </ol>
              <p className="eco2-note">
                Nothing was stored by this site. Until a maintainer merges the issue, the app does not
                appear in the directory.
              </p>
            </div>
            <footer className="eco2-modal__foot">
              <div className="eco2-modal__actions">
                <button type="button" className="eco2-btn" onClick={() => setStep('form')}>
                  Back to the form
                </button>
                <button type="button" className="eco2-btn eco2-btn--primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(dialog, document.body)
}

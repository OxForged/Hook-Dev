/* ============================================================================
   "Submit app" — the button, and the on-demand load of the form behind it.

   The listing form (SubmitAppModal.tsx) is ~33 kB of code nobody needs until
   they click. It used to be a static import of both the landing page and the
   /ecosystem directory, so every landing visitor downloaded it before first
   paint. It is now its own chunk, fetched:
     · when the browser is idle after this button mounts (skipped under
       Save-Data), so the first click on a fast connection opens instantly;
     · on hover, focus or pointer-down, in case idle never came.
   One shared promise, so any number of buttons trigger one request.

   WHILE IT LOADS the button is `aria-disabled`, not `disabled`. A disabled
   button drops focus to <body>, and the dialog records "whatever had focus"
   as the element to return focus to when it closes — `disabled` would send
   focus to the top of the page on close. `aria-disabled` keeps the opener
   focused, announces it as unavailable, and the click handler ignores it.

   THE DIALOG'S OWN FOCUS CONTRACT IS UNCHANGED: it is only rendered once its
   module has arrived, so its mount-time effect still moves focus to the first
   field and still returns focus to this button on close.

   IF THE CHUNK FAILS (a tab left open across a deploy, a dropped connection)
   the button says so beside itself with a Retry, rather than doing nothing.
   Retry refocuses the opener first, so the dialog, if it then opens, still
   returns focus to a button that exists.
   ============================================================================ */

import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'

import './ecosystemCard.css'

type ModalComponent = ComponentType<{ readonly onClose: () => void }>

let loaded: ModalComponent | undefined
let pending: Promise<ModalComponent> | undefined

/** Fetch the form's chunk. Idempotent; a failure is forgotten so Retry can try again. */
function loadSubmitModal(): Promise<ModalComponent> {
  pending ??= import('./SubmitAppModal.tsx').then(
    (mod) => {
      loaded = mod.SubmitAppModal
      return mod.SubmitAppModal
    },
    (error: unknown) => {
      pending = undefined
      throw error
    },
  )
  return pending
}

/** Fire-and-forget prefetch. A failure here is reported only if someone clicks. */
function prefetch(): void {
  loadSubmitModal().catch(() => undefined)
}

/* Only reached if the dialog is rendered before `loaded` is set, which the
   button below never does; kept so the render path can never throw. */
const LazyModal = lazy(() => loadSubmitModal().then((C) => ({ default: C })))

function saveData(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return conn?.saveData === true
}

interface SubmitAppButtonProps {
  readonly className: string
  readonly children: ReactNode
  /** Told when the dialog opens and closes (the directory pauses its `/` shortcut). */
  readonly onOpenChange?: (open: boolean) => void
}

type Status = 'idle' | 'loading' | 'error'

export function SubmitAppButton({ className, children, onOpenChange }: SubmitAppButtonProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /* Idle prefetch. `requestIdleCallback` is missing in Safari; a timeout stands in. */
  useEffect(() => {
    if (loaded || saveData()) return
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const handle = window.setTimeout(prefetch, 2000)
    return () => window.clearTimeout(handle)
  }, [])

  const setOpenState = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  const openDialog = () => {
    if (status === 'loading') return
    if (loaded) {
      setStatus('idle')
      setOpenState(true)
      return
    }
    setStatus('loading')
    loadSubmitModal().then(
      () => {
        if (!alive.current) return
        setStatus('idle')
        setOpenState(true)
      },
      () => {
        if (alive.current) setStatus('error')
      },
    )
  }

  const retry = () => {
    /* The Retry button unmounts as soon as loading starts; put focus back on
       the opener first so the dialog records a live element to return to. */
    buttonRef.current?.focus()
    openDialog()
  }

  const Modal = loaded

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} eco2-launch`}
        aria-haspopup="dialog"
        aria-disabled={status === 'loading' ? true : undefined}
        onClick={openDialog}
        onPointerEnter={prefetch}
        onPointerDown={prefetch}
        onFocus={prefetch}
      >
        {children}
      </button>

      {status === 'error' ? (
        <span className="eco2-launch__error" role="alert">
          The submission form did not load.{' '}
          <button type="button" className="eco2-launch__retry" onClick={retry}>
            Retry
          </button>
        </span>
      ) : null}

      {open ? (
        Modal ? (
          <Modal onClose={() => setOpenState(false)} />
        ) : (
          <Suspense fallback={null}>
            <LazyModal onClose={() => setOpenState(false)} />
          </Suspense>
        )
      ) : null}
    </>
  )
}

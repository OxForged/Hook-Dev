/* ============================================================================
   HexReveal — a truncated address that can show, and copy, its full value.

   Addresses in this dapp are middle-truncated (`0xfC00…2aD2`) with the full
   value in `title`. A title is a hover tooltip, and a phone has no hover, so
   on the device this was built for the full value was unreachable without
   leaving for the explorer. This wraps the existing truncated link (which
   still goes to the explorer, unchanged) with one small toggle:

     tap    show the full value beside the short one AND copy it
     tap    hide it again

   THE "COPIED" WORD IS EARNED. It appears only after `writeText` resolves.
   `navigator.clipboard` is typed as always present and is not (insecure
   contexts, some in-app browsers), and a button that says "copied" when
   nothing reached the clipboard is worse than no button — so a missing API or
   a rejected write says so, and the full value is on screen to select by hand.
   ============================================================================ */

import { useId, useState, type ReactNode } from 'react'

type CopyState = 'idle' | 'copied' | 'unavailable'

export function HexReveal({ value, children }: { value: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [copy, setCopy] = useState<CopyState>('idle')
  const id = useId()

  const toggle = () => {
    if (open) {
      setOpen(false)
      setCopy('idle')
      return
    }
    setOpen(true)
    const clip: Clipboard | undefined =
      typeof navigator === 'undefined' ? undefined : (navigator.clipboard as Clipboard | undefined)
    if (clip === undefined) {
      setCopy('unavailable')
      return
    }
    clip.writeText(value).then(
      () => setCopy('copied'),
      () => setCopy('unavailable'),
    )
  }

  return (
    <span className="dapp-hex">
      {children}
      <button
        type="button"
        className="dapp-hex__btn"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={open ? 'Hide the full value' : 'Show the full value and copy it'}
        onClick={toggle}
      >
        <span className="dapp-hex__glyph" aria-hidden="true" />
        <span className="dapp-sr">{open ? 'Hide the full value' : 'Show the full value and copy it'}</span>
      </button>
      {open ? (
        <span id={id} className="dapp-hex__full">
          <code className="dapp-hex__value">{value}</code>
          <span className="dapp-hex__status" role="status">
            {copy === 'copied' ? 'Copied' : copy === 'unavailable' ? 'Copy unavailable here — select the value' : ''}
          </span>
        </span>
      ) : null}
    </span>
  )
}

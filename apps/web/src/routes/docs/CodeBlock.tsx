import { useCallback, useEffect, useRef, useState } from 'react'
import { plainText, tokenize } from './highlight'

type Props = {
  /** Window-bar filename, e.g. `shell` or `src/FeeLatch.sol`. */
  filename: string
  /** Window-bar dot colour. Shell blocks use Success green, source files Latch Blue. */
  dot: 'shell' | 'source'
  /** Snippet in `[[kind:text]]` markup — see `highlight.ts`. */
  source: string
  /** Accessible name for the copy button, e.g. "Copy install commands". */
  copyLabel: string
}

/**
 * Code panel: 1px hairline border, --r-sm radius, panel-coloured window bar
 * over a code-ground interior, 12.5px / 1.9 mono (README: "Code: 12–12.5 /
 * line-height 1.85–1.9").
 *
 * The <pre> keeps `white-space: pre` and scrolls in its own container rather
 * than wrapping, so a narrow viewport never breaks a Solidity token across
 * lines and never pushes the page into horizontal scroll.
 */
export default function CodeBlock({ filename, dot, source, copyLabel }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = useCallback(() => {
    const text = plainText(source)
    const done = () => {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 2000)
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => setCopied(false))
      return
    }
    // Insecure-context fallback: no clipboard API, so select the text instead.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try {
      document.execCommand('copy')
      done()
    } finally {
      document.body.removeChild(area)
    }
  }, [source])

  return (
    <div className="dk-code">
      <div className="dk-code__bar">
        <span className={`dk-code__dot dk-code__dot--${dot}`} aria-hidden="true" />
        <span className="dk-code__name">{filename}</span>
        <button type="button" className="dk-code__copy" onClick={copy} aria-label={copyLabel}>
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>
      <pre className="dk-code__pre" tabIndex={0}>
        <code>
          {tokenize(source).map((t, i) =>
            t.kind === 'plain' ? (
              // eslint-disable-next-line react/no-array-index-key -- tokens are static
              <span key={i}>{t.text}</span>
            ) : (
              <span key={i} className={`dk-t dk-t--${t.kind}`}>
                {t.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  )
}

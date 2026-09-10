import { FEE_LATCH_SOL, type CodeKind } from './data'
import styles from './landing.module.css'

/** Syntax role → token-backed class. README § Design tokens fixes the palette. */
const KIND_CLASS: Record<CodeKind, string | undefined> = {
  txt: undefined,
  kw: styles['cKeyword'],
  type: styles['cType'],
  fn: styles['cFn'],
  str: styles['cString'],
  num: styles['cNum'],
  com: styles['cComment'],
}

/**
 * A6 (right column). `FeeLatch.sol` — a real <pre><code> with preserved
 * whitespace, per README § Code block rule. Indentation is a tab and
 * `tab-size: 18px` in the stylesheet gives the specced 18px per level.
 *
 * The sample is data (see FEE_LATCH_SOL) so that the exact published text can
 * be extracted and compiled; long lines scroll inside the panel rather than
 * widening the page.
 */
export function CodePanel() {
  return (
    <div className={styles['codePanel']}>
      <div className={styles['codeBar']}>
        <span className={styles['codeDot']} aria-hidden="true" />
        <span className={styles['codeFile']}>FeeLatch.sol</span>
      </div>
      <div className={styles['codeScroll']}>
        <pre className={styles['code']}>
          <code>
            {FEE_LATCH_SOL.map((token, i) =>
              token.k === 'txt' ? (
                token.t
              ) : (
                <span key={i} className={KIND_CLASS[token.k]}>
                  {token.t}
                </span>
              ),
            )}
          </code>
        </pre>
      </div>
    </div>
  )
}

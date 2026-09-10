/**
 * A ~40-line syntax tokenizer for the handful of Solidity and shell snippets on
 * this page. Deliberately not a highlighting library: the spec fixes exactly
 * five colours (README § Design tokens — Code Keyword #C56BFF,
 * Code Comment #6D80A0, Amber #FFD166 for type names, plus Signal Blue for
 * function names and Success green for literals and shell verbs) and pulling in
 * a grammar package for three snippets would ship a lot of CSS we would then
 * have to fight back into the palette.
 *
 * Snippets carry their own markup — `[[kind:text]]` — so the colouring is the
 * one the reference specifies rather than whatever a generic Solidity grammar
 * happens to infer. Text outside a marker renders in the default code ink.
 */

export type TokenKind =
  | 'plain'
  /** Solidity keywords — Code Keyword #C56BFF */
  | 'kw'
  /** contract / interface names — Amber #FFD166 */
  | 'type'
  /** function names — Signal Blue #4A9BFF */
  | 'fn'
  /** string literals — Success #5FD39A */
  | 'str'
  /** numeric literals — Success #5FD39A */
  | 'num'
  /** shell verb (`forge`, `latch`) — Success #5FD39A, per README "shell prompts" */
  | 'cmd'
  /** comments and shell result lines — Code Comment #6D80A0 */
  | 'com'

export type Token = { kind: TokenKind; text: string }

const KINDS: ReadonlySet<string> = new Set([
  'kw',
  'type',
  'fn',
  'str',
  'num',
  'cmd',
  'com',
])

const MARKER = /\[\[([a-z]+):([\s\S]*?)\]\]/g

/** Split a marked-up snippet into coloured tokens. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0

  MARKER.lastIndex = 0
  for (let m = MARKER.exec(source); m !== null; m = MARKER.exec(source)) {
    const kind = m[1]
    const text = m[2]
    if (kind === undefined || text === undefined || !KINDS.has(kind)) continue

    if (m.index > cursor) {
      tokens.push({ kind: 'plain', text: source.slice(cursor, m.index) })
    }
    tokens.push({ kind: kind as TokenKind, text })
    cursor = m.index + m[0].length
  }

  if (cursor < source.length) {
    tokens.push({ kind: 'plain', text: source.slice(cursor) })
  }
  return tokens
}

/** The snippet with all markup removed — what the copy button puts on the clipboard. */
export function plainText(source: string): string {
  return source.replace(MARKER, (_full, _kind: string, text: string) => text)
}

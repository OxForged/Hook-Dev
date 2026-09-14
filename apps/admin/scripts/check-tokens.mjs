// Copies or checks apps/web/src/styles/tokens.css into apps/admin/src/styles/tokens.css.
//
// WHY A COPY and not an import by relative path: the admin UI is built inside the
// API image, whose Docker context is an allowlist that does not (and should not)
// include apps/web. A copy keeps the build self-contained; this script keeps it
// honest. `node scripts/check-tokens.mjs` fails when the copy has drifted;
// `node scripts/check-tokens.mjs --write` refreshes it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, '../../web/src/styles/tokens.css')
const target = resolve(here, '../src/styles/tokens.css')
const MARKER = '/* ---- copied verbatim below this line ---- */\n'
const HEADER =
  '/* COPY of apps/web/src/styles/tokens.css (Latch Option B, both themes).\n' +
  '   Do not edit here: edit the web file, then run `node scripts/check-tokens.mjs --write`.\n' +
  '   `npm run check-tokens` fails when this copy drifts. */\n' +
  MARKER

if (!existsSync(source)) {
  console.log('apps/web tokens.css not present (sparse checkout?); skipping the drift check')
  process.exit(0)
}
const want = HEADER + readFileSync(source, 'utf8')
if (process.argv.includes('--write')) {
  writeFileSync(target, want)
  console.log('tokens.css refreshed from apps/web')
} else {
  const have = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (have !== want) {
    console.error('apps/admin/src/styles/tokens.css has drifted from apps/web; run node scripts/check-tokens.mjs --write')
    process.exit(1)
  }
  console.log('tokens.css matches apps/web')
}

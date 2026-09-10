/* ============================================================================
   Copy `src/styles.css` to `dist/styles.css`.

   `tsc` emits only TypeScript, so the stylesheet that `package.json` exposes
   as `./styles.css` has to be placed in `dist/` by hand. This is the whole of
   that step: no bundler, no transform, no dependencies. Paths are resolved
   from this file's own location so the script works from any cwd.
   ============================================================================ */

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src', 'styles.css')
const target = resolve(root, 'dist', 'styles.css')

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)

// Copies the brand kit from the design handoff into public/ so Vite can serve it.
// The handoff at "latch design/brand-kit" is the single source of truth; public/brand
// is derived and gitignored, so the two can never drift.
import { cp, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../../latch design/brand-kit')
const dest = resolve(here, '../public/brand')

if (!existsSync(src)) {
  console.error(`[sync-brand] source not found: ${src}`)
  console.error('[sync-brand] the brand kit ships in the design handoff; restore it before building.')
  process.exit(1)
}

await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })
console.log(`[sync-brand] ${(await readdir(dest)).length} assets -> public/brand`)

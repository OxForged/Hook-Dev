# Prompt for Claude Code

Copy everything below the line into Claude Code, from the root of the target repository, with this handoff folder available (or its contents copied into the repo).

---

I'm building **Latch Protocol** — infrastructure for custom hooks (we call them **Latches**) that let developers attach programmable logic to AMM pools, lending markets and assets without forking the protocol underneath.

In `design_handoff_latch_protocol/` you'll find four HTML design references and a complete brand kit. Read `README.md` first — exact colors, type, spacing, layout specs, interaction and animation timings — then `SCREENS.md`, which lists every element on every screen in DOM order with the exact copy and data to use.

## What I want built

Recreate all four designs **pixel-perfectly** in this codebase:

1. **Marketing landing page** — `design-references/Latch Landing.dc.html`
2. **Developer docs / quickstart** — `design-references/Latch Docs.dc.html`
3. **Dapp** — `design-references/Latch Dapp.dc.html` — seven screens behind one app shell: Dashboard, Hook Explorer, Deploy a Hook, Pool Detail, Portfolio, Analytics, Settings
4. **Brand kit page** — `design-references/Latch Brand Kit.dc.html` — public asset download page

## Ground rules

- The HTML files are **design references, not production code**. Do not copy their markup or their `support.js` runtime. Rebuild the designs using this repo's existing framework, component library, styling approach and routing conventions. If the repo is empty, use Next.js (App Router) + TypeScript + Tailwind and tell me before you start.
- These are **high-fidelity** mocks. Match colors, type sizes, weights, letter-spacing, border radii, borders, shadows, spacing and animation timings exactly as documented in `README.md`. Where the reference and the README disagree, the README wins.
- Open each HTML file in a browser and compare against your build as you go. Diff visually, screen by screen.
- **Fonts:** Chakra Petch (600/700) for headings and numerals, IBM Plex Sans (400/500) for body, IBM Plex Mono (400/500) for labels, code, addresses and data. Load from Google Fonts or self-host.
- **Brand assets:** use the files in `brand-kit/` as shipped. Do not redraw, recolor, stretch or re-outline the hook mark. Wire `favicon.svg` + `favicon-180.png` + `app-icon-192.png`/`512` and `og-1200x630.png` into the app head.
- **Motion:** implement the animations listed in the README (section reveals, chart line draw-on, bars rising from baseline, KPI count-ups, live block ticker, pulsing status dots, button sheen, card hover lifts). Every animation must be disabled under `prefers-reduced-motion: reduce`.
- **Charts:** the references draw them with inline SVG paths and flex-height divs. Reimplement with whatever this repo uses for charts, or keep them as SVG — but keep the exact colors, stroke widths and easing.
- **Responsive:** the references are desktop-first. Build proper responsive behavior: sidebars collapse to a drawer under ~1024px, multi-column grids stack, tables become stacked rows on mobile, hit targets stay ≥44px.
- **Accessibility:** semantic landmarks, real `<button>`/`<a>` elements, visible focus rings in Latch Blue, body text ≥4.5:1 contrast, alt text on brand imagery.

## Data

All numbers, addresses, latch names, roadmap dates and team entries in the references are **placeholders**. Wire the dapp to typed mock data modules (one per screen) with a clean seam for the real API/contract calls later. Keep the shapes documented in the README's State Management section.

## How to proceed

1. Read `README.md` end to end and confirm the target stack.
2. Scaffold routes, the design-token layer (colors, type scale, radii, shadows) and the app shell first.
3. Then build screen by screen, in this order: landing → docs → dapp shell → the seven dapp screens → brand kit page.
4. After each screen, show me a screenshot next to the reference and list any deviations you made and why.

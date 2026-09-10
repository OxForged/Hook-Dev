# Handoff: Latch Protocol — marketing site, docs, dapp and brand kit

## Overview

Latch Protocol is infrastructure for custom hooks — called **Latches** — that let developers attach programmable logic to AMM pools, lending markets and assets without forking the protocol underneath. A Latch implements one interface, declares which callbacks it wants via a permission bitmap, and registers against the protocol registry. Pools then opt in.

This package contains four design references and the complete brand kit:

| Reference | What it is |
| --- | --- |
| `design-references/Latch Landing.dc.html` | Marketing landing page |
| `design-references/Latch Docs.dc.html` | Developer docs / quickstart |
| `design-references/Latch Dapp.dc.html` | The dapp — 7 screens in one shell |
| `design-references/Latch Brand Kit.dc.html` | Public brand asset page |
| `brand-kit/` | All logo, icon, favicon and social assets (PNG + SVG, transparent) |

Audience for the product: Solidity developers, DeFi users, partner protocols. Copy tone: technical and precise.

## About the design files

The four HTML files are **design references created as prototypes** — they show intended look and behavior. They are not production code. They run on a small streaming-component runtime (`support.js`) that exists only to make the prototypes render; **do not port it**.

The task is to **recreate these designs in the target codebase's own environment** — React, Vue, Svelte, SwiftUI, native, whatever the repo already uses — following its established patterns, component library and routing. If there is no codebase yet, pick the most appropriate framework (Next.js App Router + TypeScript + Tailwind is a good default for this product) and implement there.

To view a reference: open the `.dc.html` file directly in a browser. `support.js` and `assets/` must sit alongside it (they do, in `design-references/`).

## Fidelity

**High-fidelity.** Final colors, typography, spacing, motion and copy. Recreate pixel-perfectly using the codebase's libraries. Every value you need is in the Design Tokens section below; the per-screen sections give layout and component specs.

---

## Design tokens

### Color

| Token | Hex | Role |
| --- | --- | --- |
| Latch Blue | `#2B8BFF` | Primary. CTAs, active states, chart lines, accents |
| Deep Blue | `#0A63E0` | Gradient end for primary buttons, pressed state |
| Signal Blue | `#4A9BFF` | Links, secondary data series, icon strokes |
| Sky Ink | `#8FC2FF` | Active nav text, inline code, emphasis on dark |
| Eyebrow Blue | `#3F8FF0` | Section eyebrow labels |
| Void | `#04060C` | Page background |
| Panel | `#070C17` | Cards, surfaces |
| Panel Alt | `#080E1A` | Inputs, sidebar cards, feed rows |
| Code Ground | `#05080F` | Code block interiors |
| Deep Panel | `#061024` | Gradient mid-tone for hero/banner grounds |
| Hairline | `#16223A` | Card borders, dividers |
| Hairline Soft | `#131F34` | Inner dividers, chart gridlines |
| Hairline Blue | `#1B2942` / `#24314C` | Input borders / secondary button borders |
| Active Nav | `#173768` | Selected pill/tab background |
| Ink | `#E4ECF9` | Primary text |
| Ink Bright | `#FFFFFF` | Headline and numeral text |
| Muted Ink | `#8A9BB6` | Body text |
| Muted Ink 2 | `#96A6C0` | Long-form paragraphs |
| Label Ink | `#61789C` | Mono micro-labels |
| Faint Ink | `#4C5F7D` | Table headers, axis labels, copyright |
| Success | `#5FD39A` | Verified, positive delta, shell prompts |
| Warning | `#E0C05F` / `#E0A95F` | Review status, warning dots |
| Error | `#E06A6A` | Failed checks, don't-do list |
| Violet | `#6C5CFF` | Third data series |
| Amber | `#FFD166` | Code type names, audit-coverage dot |
| Code Keyword | `#C56BFF` | Solidity keywords |
| Code Comment | `#6D80A0` | Comments |
| Light Surface | `#EEF2F8` | Light-ink badge preview panel |

Gradients used verbatim:

- Primary button — `linear-gradient(180deg, #2B8BFF, #0A63E0)`
- Success button — `linear-gradient(180deg, #37C98D, #159463)`
- Hero ground — `linear-gradient(115deg, #04060C 0%, #061024 48%, #04070F 100%)`
- Chart area fill — `#2B8BFF` at 42% opacity → 0% (vertical)
- Bar fill — `linear-gradient(180deg, #2B8BFF, rgba(43,139,255,.16))`
- Progress fill — `linear-gradient(90deg, #2B8BFF, #5FD39A)`
- Sidebar active row — `linear-gradient(90deg, rgba(23,55,104,.75), rgba(8,14,26,.2))`
- Hero glow — `radial-gradient(680px 420px at 78% 42%, rgba(26,127,255,.20), transparent 70%)`

### Typography

| Family | Weights | Used for |
| --- | --- | --- |
| Chakra Petch | 600, 700 | Headlines, wordmark support, KPI numerals, card titles |
| IBM Plex Sans | 400, 500 | Body copy, UI labels, buttons |
| IBM Plex Mono | 400, 500 | Micro-labels, code, addresses, table headers, data values |

Type scale as used (px):

- H1 landing: `clamp(38, 4.6vw, 64)` / line-height 1.04 / letter-spacing −0.01em / Chakra Petch 700
- H1 docs: `clamp(32, 3.8vw, 50)` / 1.06 / Chakra Petch 700
- H2 section: `clamp(28, 3.2vw, 42)` – `clamp(30, 3.4vw, 44)` / 1.1 / Chakra Petch 700
- H2 docs step: 26 / Chakra Petch 600
- Card title: 16–21 / Chakra Petch 600
- KPI numeral: 26–34 / Chakra Petch 700 / `#FFFFFF`
- Lead paragraph: 16.5–17 / 1.62–1.65 / `#96A6C0`
- Body: 13.5–15.5 / 1.55–1.65 / `#8A9BB6`
- Mono eyebrow: 11 / letter-spacing .22em / `#3F8FF0`
- Mono micro-label: 9.5–10.5 / letter-spacing .14–.18em / `#61789C` or `#4C5F7D`
- Mono data: 11–13 / `#A9B9D1`–`#E4ECF9`
- Code: 12–12.5 / line-height 1.85–1.9

Wordmark set in Chakra Petch when typed rather than imaged: `LATCH` 700 / letter-spacing .14em / white, with `PROTOCOL` 600 / letter-spacing .3em / `#2B8BFF` beneath at roughly half the size.

### Spacing, radii, shadows

- Page gutters: 40px (landing, brand kit), 32px (docs), 26px (dapp content)
- Max content width: 1280 (landing), 1400 (docs), 1180 (brand kit); dapp is full-width
- Section rhythm: 96px top padding between landing sections, 52px between docs sections, 14px between dapp cards
- Grid gaps: 12–18px cards, 34px docs columns, 56px hero columns
- Card padding: 20–26px; hero CTA card 64px 44px
- Radii: 999px pills and buttons; 24px hero CTA panel; 18px landing cards; 16px dapp cards; 14px small cards, inputs, code blocks; 10–12px buttons and chips; 7–8px badges and micro-pills
- Borders: 1px `#16223A` default, `#1B2942` inputs, `#24314C` secondary buttons, `#1C3A68` CTA panel; hover `#25528F`
- Shadows: primary button `0 10px 30px rgba(26,127,255,.32)` (hover `0 16px 42px rgba(26,127,255,.5)`); card hover `0 18px 48px rgba(4,10,24,.8)`; status dot glow `0 0 10px` of its own color at 75–80%
- Glow rings: `inset 0 0 40px rgba(26,127,255,.14)` plus `0 0 70px rgba(26,127,255,.35)` on the hero centre tile

---

## Screens

### 1. Landing page

**Purpose:** convince a Solidity developer that Latch is the shortest path to shipping a hook, and route them to docs or the app.

**Layout:** single column, `max-width: 1280px`, 40px gutters. Sticky translucent header (`rgba(4,6,12,.82)` + `blur(14px)`, bottom border `#131C2E`).

Sections in order:

1. **Header** — mark image (30px tall) + typed `LATCH`/`PROTOCOL` lockup left; nav right: Home (active, `#4A9BFF`), Developers, Docs, Ecosystem, About, Brand Kit, then a pill "Launch App".
2. **Hero** — two columns `minmax(0,1.05fr) minmax(0,1fr)`, 56px gap, 76px/96px vertical padding, radial glow behind the right column.
   - Left: eyebrow pill "DEVELOPER INFRASTRUCTURE" (7px 16px, border `#1E4F96`, bg `rgba(16,50,102,.35)`, text `#6FB2FF`); H1 "Powerful Hooks. / Limitless **Possibilities.**" (second line's last word in Latch Blue); lead paragraph; two CTAs — "Get Started →" (primary, with a repeating sheen sweep) and "Read Docs" (secondary → docs page).
   - Right: 520px-tall node graph. Centre tile 200×200, radius 26, blue rim + glow, hook mark 104px inside, floating ±14px on a 7s loop. Six labelled satellite nodes (LENDING, NFTs, GAMING, DeFi, RWA, AMM) positioned by percentage, each a 52×52 rounded tile with a rotated 16px diamond, floating on staggered 6.5s loops.
3. **Stats strip** — 4 columns, `#060A14` ground, top and bottom hairlines, 30px 28px cells, Chakra Petch 700 34px numerals that **count up** when scrolled into view, mono caption beneath.
4. **Protocol activity** — eyebrow + H2 "Measured at the hook layer." with a 30D/90D/1Y range switcher (mono pills, active `#173768`/`#8FC2FF`).
   - Big card (1.55fr): TVL headline + green delta + right-aligned mono caption; 720×240 SVG area chart with four gridlines, gradient fill, 2.5px Latch Blue line that draws on via `stroke-dasharray` over 1.5s, and per-point dots that fade+scale in on a 0.09s stagger; month labels beneath.
   - Right column (1fr): "HOOK CALLS BY CATEGORY" — four labelled 6px progress bars that animate width over 1s; "GAS OVERHEAD PER CALL" — 14 columns rising from baseline on a 0.045s stagger, peak column in solid Latch Blue.
   - Bottom row of three: donut "TVL BY NETWORK" (46px radius, 14px stroke, four segments + legend with 9px swatches); "LATCHES DEPLOYED · WEEKLY" 20-column bar chart; "REGISTRY HEALTH" three rows with glowing status dots.
5. **Use cases** — H2 "One Infrastructure. / **Every Ecosystem.**"; four cards (DeFi, Gaming, NFTs, RWA) each with a 44px icon tile, title, description and a mono tag; hover lifts 4px, border → `#25528F`, shadow.
6. **How it works** — three numbered layer cards (01/02/03), then a two-column block: bullet list of interface facts beside a `FeeLatch.sol` code panel (window bar with a blue dot and mono filename; syntax-colored Solidity; each line is its own block element with `padding-left` per indent depth).
7. **Features grid** — four items (Plug & Play, Secure, Modular, Open Ecosystem), 38px icon tile above title and one-line description.
8. **Chains** — eyebrow "BUILT FOR EVERY CHAIN", H2 "Chain agnostic by design.", 10 tiles (Ethereum, BNB Chain, Arbitrum, Polygon, Optimism, Base, Avalanche, Solana, Sui, "and more…"). **Placeholder:** each tile has a plain 40px circle where the real chain logo goes.
9. **Roadmap** — four quarter columns, each with a glowing 9px dot sitting on its own top rule (rule is per-item so it survives wrapping), mono quarter label, title, description.
10. **Team** — four cards; image area is a diagonally striped placeholder labelled `DROP HEADSHOT`.
11. **CTA panel** — 24px-radius panel, centred, radial glow from top, "Ship your first Latch this week.", two buttons.
12. **Footer** — lockup left; Docs / GitHub / Audits / Brand Kit / Launch App links and `© 2026 LATCH PROTOCOL` (nowrap) right.

### 2. Docs / developer quickstart

**Purpose:** get a developer from empty repo to a registered latch on Base Sepolia.

**Layout:** flex-wrap shell, `max-width: 1400px`, 34px gap. Left rail `flex: 0 0 220px`, sticky at `top: 86px`, max-height `calc(100vh - 120px)`, own scroll. Main `flex: 1 1 540px; min-width: 0`. The rails wrap below main instead of squeezing it — main must never fall below a readable measure (~540px).

- **Header** — same as landing plus a `DOCS` mono badge; nav: Home, Quickstart (active), Reference, Brand Kit, Launch App pill.
- **Left rail** — four groups (GET STARTED, REFERENCE, GUIDES, OPERATIONS) of anchor links; active link gets `rgba(23,55,104,.5)` background and `#8FC2FF` text. Below a hairline: "ON THIS PAGE" list.
- **Main** — eyebrow, H1 "Ship your first Latch.", lead paragraph with inline mono code, then a facts strip (TOOLCHAIN / SOLIDITY / TIME TO FIRST LATCH, values nowrap).
- **Steps** — `1 · Install` (shell block), `2 · Write the latch` (full `FeeLatch.sol` with pragma, imports, constants, `permissions()`, `beforeSwap`) plus an info callout with a pulsing dot, `3 · Simulate and register` (shell block with CLI + result comment).
- **Callback reference** — 3-column table (CALLBACK / BIT / RETURNS) listing `beforeSwap 0x0001 uint24 fee`, `afterSwap 0x0002 —`, `beforeAddLiquidity 0x0004 bool allow`, `afterAddLiquidity 0x0008 —`, `beforeRemoveLiquidity 0x0010 bool allow`, `afterDonate 0x0020 —`. Rows fade in on a 0.05s stagger.
- **Execution order** — five step cards (01–05) describing swap → beforeSwap latches → swap executes → afterSwap latches → registry records.
- **Common errors** — four rows: `LatchBitmapMismatch()`, `GasBudgetExceeded(uint256 used)`, `LatchNotVerified()`, `ReentrantLatchCall()`, each with a one-sentence fix.
- **Next panel + footer** — CTA into the app; footer links nowrap.

**Code block rule:** the references render each code line as its own block element, with indentation as `padding-left` (18px per level) and blank lines as `height: .9em` spacers. In a normal codebase use a real `<pre><code>` with preserved whitespace or a syntax highlighter — just keep the palette above and the 1.85–1.9 line-height.

### 3. Dapp

**Shell:** CSS grid `238px minmax(0,1fr)`, `min-height: 100vh`.

- **Sidebar** (`#060A12`, right border `#101A2C`): lockup; nav of seven items — Dashboard, Hook Explorer, Deploy a Hook, Pool Detail, Portfolio, Analytics, Settings. Each row: 3px×16px indicator bar (Latch Blue when active), 13.5px label, active row gets the sidebar gradient and `#E4ECF9` text; transitions 0.22s. Bottom: "GAS SPONSOR CREDITS" card with a 62% gradient progress bar and "0.62 ETH remaining", then a wallet button (`0x8f2c…41ba`, 22px gradient avatar, pulsing green dot).
- **Header:** screen title (Chakra Petch 600 20px) + subtitle (12.5px `#7F92AD`); right side a mono "BLOCK 21,904,118" chip whose number **increments every 4s** with a pulsing green dot, and a primary "Deploy Latch" button with sheen.
- **Content area:** 22px 26px padding, fades in on every screen change (0.45s).

Screens:

1. **Dashboard** — four KPI cards (TVL WITH LATCHES $48.2M +6.4%, HOOK CALLS 24H 412,905 +12.1%, FEES EARNED 30D $186.4K +3.8%, MEDIAN OVERHEAD 8,412 gas −2.2%), each with a 12-bar sparkline rising on a stagger; then a 1.5fr/1fr row: volume area chart with range switcher (30D/90D/1Y changes the series), and a column with "CALL MIX" bars + "LIVE HOOK FEED" (six rows, colored glowing dots, mono event name, relative time; first two dots pulse).
2. **Hook Explorer** — search field placeholder plus five filter chips (All / DeFi / NFT / Gaming / RWA) that actually filter; grid of latch cards: icon tile, name, author, status badge (VERIFIED green / AUDITED blue / REVIEW amber), description, hook tags, and a TVL / CALLS 24H / GAS footer above a hairline. Cards are clickable → Pool Detail.
3. **Deploy a Hook** — 1fr/0.85fr. Left: 4-step progress strip (Contract / Callbacks / Simulate / Register) whose active steps advance with state; config card with contract address, six selectable callback chips, a gas-budget bar (24k of 60k) and a primary button that reads "Run simulation" → "Simulating…" (2.2s) → "Register on Base ✓" and turns green. Right: simulation output panel whose six mono lines fade in on a 0.32s stagger once simulating, and a PRE-FLIGHT CHECKS card whose "Gas within budget" row flips to red when the budget is too low.
4. **Pool Detail** — header card with overlapping token circles, "ETH / USDC · 0.05%", "DynamicFeeLatch attached · Base", and four stats (TVL $14.2M, VOLUME 24H $8.1M, FEE (LIVE) 0.11%, HOOK CALLS 182K); then a fee-vs-volatility chart (green solid fee line drawing on, blue dashed volatility line) with a legend, beside a "RECENT HOOK CALLS" list (kind / fee / gas, rows fading in on a stagger).
5. **Portfolio** — three KPI cards (POSITION VALUE $1.94M, FEES EARNED $61.2K, ACTIVE LATCHES 5) then a five-row table: POSITION / LATCH / VALUE / FEES 30D / STATUS with ACTIVE / PENDING / PAUSED badges.
6. **Analytics** — 1.3fr/1fr. Left: "HOOK CALLS · WEEKLY" 18-column bar chart (last column green) with the range switcher. Right: TVL-by-network donut with legend, and "TOP LATCHES BY FEES" bars.
7. **Settings** — Preferences card with four labelled toggles (simulate before registration, revert alerts, show testnet deployments, auto gas sponsorship) — 44×24 track, 18px knob sliding 0.25s; DEFAULT NETWORK chip group (Ethereum / Base / Arbitrum / Optimism / Polygon); API KEY card with masked key and a ROTATE button.

### 4. Brand kit page

Public asset page: hero with a download CTA; LOGO grid (primary lockup on dark, lockup on light, mark, single-blue mark, wordmark, app icon — each tile shows the asset on the correct ground with PNG and SVG download buttons); ICON & FAVICON section (168px app icon plus 16/32/64/180/512 favicon row); SOCIAL section (X banner, OG image, profile picture, safe-area note); PARTNER BADGE section (light-ink badge on `#04060C`, dark-ink badge on `#EEF2F8`); COLOR palette swatches with hex and role; TYPOGRAPHY specimens; USAGE (clear space = height of the hook's eye on all four sides; minimum sizes — full lockup 120px wide, mark 24px, badge 160px; a DON'T list); WEB EMBED snippets for favicon and og tags.

---

## Interactions & behavior

| Behavior | Spec |
| --- | --- |
| Section reveal | `opacity 0 → 1`, `translateY(26px) → 0`, 0.85s `cubic-bezier(.22,.61,.36,1)`, per-section delays 0–0.2s. Implemented as CSS animation so content is never hidden if JS fails |
| Chart line draw-on | `stroke-dasharray: 2400` + `stroke-dashoffset 2400 → 0`, 1.4–1.5s same easing |
| Chart dots | fade + scale from 0.4, 0.4s, 0.09s stagger |
| Bars / columns / sparklines | `scaleY(.05) → 1`, `transform-origin: bottom`, 0.6–0.8s, 0.03–0.045s stagger |
| Progress bars | `width` transition 1s same easing |
| KPI count-up | numeric prefix/suffix preserved, ~1.1s, cubic ease-out, fires when the element is ≥55% in view, runs once |
| Block ticker | +1 every 4000ms |
| Status dots | opacity 0.3 → 1 → 0.3, 1.6–2.4s infinite |
| Button sheen | 38–40% wide white gradient sweeping `translateX(-140% → 260%)`, 3.6–4.6s infinite |
| Card hover | `translateY(-3px)`/`-4px`, border → `#25528F`, shadow `0 18px 48px rgba(4,10,24,.8)`, 0.25–0.3s |
| Primary button hover | `translateY(-2px)`, shadow grows to `0 16px 42px rgba(26,127,255,.5)`, 0.22–0.25s |
| Nav / tab switch | background and color 0.2–0.22s |
| Screen change (dapp) | content area fades + rises 0.45s |
| Toggle | knob `left` 0.25s `cubic-bezier(.22,.61,.36,1)`, track background 0.25s |
| Deploy simulation | button disabled-looking at 0.75 opacity for 2.2s, then success state; sim lines stagger in; step strip advances |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` collapses all animation durations — honor this |

## State management

Dapp state in the reference (replicate the shapes, wire to mock data modules):

- `screen`: one of `dashboard | explorer | deploy | pool | portfolio | analytics | settings`
- `range`: `30D | 90D | 1Y` — selects the volume series (each series is `{ pts: number[], labels: string[] }`)
- `filter`: `All | DeFi | NFT | Gaming | RWA` — filters the latch list
- `cbs`: string[] of selected callbacks (default `["beforeSwap","afterSwap"]`)
- `budget`: number in thousands of gas (default 24, max 60) — drives the gas bar and the "Gas within budget" check
- `deploying` / `deployed`: booleans driving the button label, color, step strip and sim-line opacity
- `net`: default network chip
- `flags`: `{ sim, alerts, testnet, autoGas }` booleans for the settings toggles
- `block`: number, incremented on an interval

Landing page: `range` for the activity chart, plus IntersectionObserver-driven count-ups.

Data fetching: none in the reference. Everything is placeholder — TVL, latch counts, gas figures, roadmap dates, team names, addresses. Put each screen's data behind a typed module so the real registry/subgraph calls can replace it.

## Assets

Everything in `brand-kit/` (also mirrored at `design-references/assets/brand/` so the HTML references resolve). All PNGs have real alpha; the "dark" variants are pre-composited on the brand ground for social platforms that don't handle transparency.

**Logo**
- `latch-lockup-transparent.png` — primary lockup, mark + wordmark + tagline
- `latch-lockup.svg` — same, scalable wrapper
- `latch-lockup-onlight.png` — dark-ink lockup for light surfaces
- `latch-mark-transparent.png`, `latch-mark.svg` — mark only (white + blue)
- `latch-mark-blue.png` — single-color blue mark
- `latch-wordmark-transparent.png`, `latch-wordmark.svg` — wordmark only

**App icons / favicons**
- `app-icon-1024.png`, `app-icon-512.png`, `app-icon-192.png`, `app-icon-180.png` — rounded-square icon, dark ground, blue rim + glow
- `favicon-16/32/64/180/512/1024.png` — transparent mark, padded square
- `favicon.svg` — scalable favicon

**Social**
- `x-banner-1500x500-dark.png` / `-transparent.png`
- `linkedin-banner-1584x396-dark.png` / `-transparent.png`
- `og-1200x630.png` / `og-1200x630-transparent.png` — link previews, `summary_large_image`
- `social-square-1080-dark.png` / `-transparent.png` — square post
- `pfp-800-circle-dark.png`, `pfp-400-circle-dark.png` — pre-circled profile pictures
- `pfp-800-transparent.png`, `pfp-400-transparent.png`, `pfp-800-dark.png` — square profile variants

**Partner badge**
- `powered-by-latch-light.png` / `.svg` — light ink, for dark surfaces
- `powered-by-latch-dark.png` / `.svg` — dark ink, for light surfaces

### Asset caveats — read this

1. **Source quality.** The only logo input available was a JPEG reference sheet. Every asset here is cut from it and alpha-extracted, so edges are soft at large sizes and there is faint JPEG noise. **Ask the brand owner for the original vector (AI/SVG/EPS) and regenerate the whole kit from it** before launch.
2. **The `.svg` files are wrappers, not vector.** Each embeds the transparent PNG. They scale without pixelation artifacts in layout but are not true outlines. Replace them once the vector source arrives.
3. **Social image type.** Headline text in `og-*` and `social-square-*` is rendered in a fallback grotesque, not Chakra Petch — the image generator could not load web fonts. Regenerate these two with the real typeface.
4. **Chain logos and headshots are placeholders** in the designs (plain circles, striped tiles). Source the official chain marks and real photography.

## Files in this bundle

```
design_handoff_latch_protocol/
├── README.md                      ← this document
├── SCREENS.md                     ← screen-by-screen inventory: every element, in order, with exact copy and data
├── CLAUDE_PROMPT.md               ← paste into Claude Code to start the build
├── brand-kit/                     ← the complete brand kit (PNG + SVG, transparent)
└── design-references/
    ├── Latch Landing.dc.html
    ├── Latch Docs.dc.html
    ├── Latch Dapp.dc.html
    ├── Latch Brand Kit.dc.html
    ├── support.js                 ← prototype runtime only; do not port
    └── assets/brand/              ← copy of brand-kit so the HTML resolves
```

Open any `.dc.html` in a browser to view the reference. The four pages are cross-linked, so you can click through the whole experience.

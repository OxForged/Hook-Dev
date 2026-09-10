# SCREENS.md — screen-by-screen inventory

Written substitute for screenshots. Every screen below lists its elements **in DOM order**, with exact copy and the values needed to rebuild it. Colors, type scale, radii and animation timings live in `README.md`; this document is the content and ordering spec.

Open the matching `.dc.html` in `design-references/` at ≥1440px wide to see any of these rendered.

---

## A. Landing page — `Latch Landing.dc.html`

### A1. Header (sticky)
Mark image 30px + typed lockup (`LATCH` / `PROTOCOL`) → nav: `Home` (active) · `Developers` · `Docs` → docs page · `Ecosystem` · `About` · `Brand Kit` → brand kit page · **Launch App** pill → dapp.

### A2. Hero — two columns
Left, in order:
1. Eyebrow pill — `DEVELOPER INFRASTRUCTURE`
2. H1 — `Powerful Hooks.` / `Limitless ` + `Possibilities.` (last word Latch Blue)
3. Paragraph — "Latch Protocol is the infrastructure layer for custom hooks — we call them Latches. Attach programmable logic to pools, markets and assets without forking a protocol or redeploying it."
4. Buttons — `Get Started →` (primary, sheen sweep) · `Read Docs` (secondary → docs)

Right: 520px node graph. Centre tile (200×200, blue rim + glow, hook mark 104px, floating). Six satellites at percentage positions — `LENDING` (20%,4%) · `NFTs` (74%,10%) · `GAMING` (80%,46%) · `DeFi` (70%,84%) · `RWA` (8%,78%) · `AMM` (0%,40%); each a 52×52 tile with a rotated diamond and a mono label beneath.

### A3. Stats strip — 4 cells, count up on scroll
| Value | Label |
| --- | --- |
| `$412M` | VALUE ROUTED THROUGH LATCHES |
| `1,840` | LATCHES DEPLOYED |
| `9` | NETWORKS LIVE |
| `27ms` | MEDIAN HOOK OVERHEAD |

### A4. Protocol activity — `#activity`
Eyebrow `PROTOCOL ACTIVITY`; H2 `Measured at the hook layer.`; range switcher `30D` `90D` `1Y` (default 1Y).

**Main card:** `$412M` + `+544% / 1y` + right caption `VALUE ROUTED THROUGH LATCHES`; area chart, 4 gridlines, line draws on, dots stagger in; x labels `Oct Dec Feb Apr Jun Sep`.
Series by range — 30D `352 368 381 412` (labels W1–W4, `+17.0% / 30d`); 90D `268 301 344 362 381 412` (Apr May Jun, `+53.7% / 90d`); 1Y `64 88 102 141 168 205 248 262 301 344 381 412`.

**HOOK CALLS BY CATEGORY** (bars): AMM / swap hooks `18.4M` 100% · Lending markets `7.1M` 39% · NFT / assets `3.6M` 20% · Gaming `2.2M` 12%.

**GAS OVERHEAD PER CALL (µ, GAS)** — 14 columns `8 17 34 58 92 100 84 61 44 31 22 15 10 6`; axis `2k` / `median 8.4k` / `40k`.

**TVL BY NETWORK** donut + legend: Ethereum 41% · Base 27% · Arbitrum 19% · Others 13%.

**LATCHES DEPLOYED · WEEKLY** — 20 columns `12 18 15 24 31 27 38 44 36 52 48 61 57 70 66 74 81 77 88 96`; caption `1,840 total · 96 added this week`.

**REGISTRY HEALTH** — Verified latches `1,612 / 1,840` (green) · Reverts (24h) `0.021%` (blue) · Audit coverage `94% of TVL` (amber).

### A5. Use cases — `#ecosystem`
Eyebrow `USE CASES`; H2 `One Infrastructure.` / `Every Ecosystem.` Four cards:

| Name | Tag | Body |
| --- | --- | --- |
| DeFi | AMM · LENDING | Dynamic fees, custom curves, JIT liquidity and yield routing attached directly to pool lifecycle events. |
| Gaming | ONCHAIN GAMES | Mint, burn and reward logic that reacts to in-game state without a custom AMM deployment per title. |
| NFTs | PROGRAMMABLE ASSETS | Latches let collections mutate metadata, royalties and access rules from onchain conditions. |
| RWA | COMPLIANCE | Transfer restrictions, KYC gating and oracle-driven settlement enforced at the hook layer. |

### A6. How it works — `#developers`
Eyebrow `HOW IT WORKS`; H2 `Three layers, one integration path.`
1. **01 Write the Latch** — Implement ILatch, declare a permission bitmap for the callbacks you need.
2. **02 Register it** — The registry validates the bitmap, deterministic address and gas budget before activation.
3. **03 Attach to pools** — Pools opt in. Callbacks run in declared order with revert isolation per latch.

Then two columns — left card `Integrate in one interface` + paragraph ("A Latch implements a single interface and registers against a pool. The registry enforces permissions, gas caps and lifecycle order, so the host protocol never has to trust your bytecode.") and mono list: `— beforeSwap / afterSwap callbacks`, `— deterministic latch addresses`, `— revert isolation per hook`, `— on-chain permission bitmap`. Right: `FeeLatch.sol` code panel (dynamic-fee example returning `3000` above threshold else `500`).

### A7. Features grid
Plug & Play — One interface, any integrating protocol. · Secure — Gas caps, revert isolation, audited registry. · Modular — Use only the callbacks you need. · Open Ecosystem — Permissionless publishing for developers.

### A8. Chains
Eyebrow `BUILT FOR EVERY CHAIN`; H2 `Chain agnostic by design.`; tiles: Ethereum · BNB Chain · Arbitrum · Polygon · Optimism · Base · Avalanche · Solana · Sui · `and more…`. **Circles are placeholders for real chain marks.**

### A9. Roadmap
| When | Title | Body |
| --- | --- | --- |
| Q3 2026 | Core registry mainnet | ILatch v1, registry and reference latches live on Ethereum and Base. |
| Q4 2026 | Latch explorer | Public catalogue with verified source, gas profiles and usage stats. |
| Q1 2027 | Cross-chain latches | Message-passing latches with shared state across supported networks. |
| Q2 2027 | Permissionless publishing | Open registry with staking-backed review and revenue share for authors. |

### A10. Team — `#about`
H2 `Built by protocol engineers.` Four cards, striped `DROP HEADSHOT` placeholder + roles: Protocol Engineering · Smart Contracts · Security · Developer Relations. Names are `Name Placeholder`.

### A11. CTA + footer
`Ship your first Latch this week.` / "Read the integration guide, clone the starter latch, and deploy to testnet in a single afternoon." / `Read the Docs` · `View on GitHub`. Footer: lockup + Docs · GitHub · Audits · Brand Kit · Launch App · `© 2026 LATCH PROTOCOL`.

---

## B. Docs — `Latch Docs.dc.html`

Shell: left rail 220px (sticky, own scroll) + main (`flex: 1 1 540px`), rails wrap below main when space runs out.

### B1. Header
Lockup + `DOCS` badge → nav Home · Quickstart (active) · Reference · Brand Kit · Launch App pill.

### B2. Left rail
- **GET STARTED** — Quickstart (active) · Install · Simulate & register
- **REFERENCE** — Callbacks · Execution order · Errors
- **GUIDES** — Dynamic fees · JIT liquidity · Compliance gating
- **OPERATIONS** — Gas sponsorship · Verification · Audits
- **ON THIS PAGE** — Quickstart · 1 · Install · 2 · Write the latch · 3 · Simulate and register · Callback reference · Execution order · Common errors

Guides and Operations links currently point back at the quickstart — real pages still to be written.

### B3. Intro
Eyebrow `DEVELOPER QUICKSTART`; H1 `Ship your first Latch.`; paragraph "A Latch is a contract that implements `ILatch`, declares which callbacks it wants, and registers against the protocol registry. Pools then opt in. This page takes you from an empty repo to a registered latch on Base Sepolia."
Facts strip: `TOOLCHAIN Foundry ≥ 0.2` · `SOLIDITY ^0.8.26` · `TIME TO FIRST LATCH ~20 min`.

### B4. `1 · Install`
"The core interfaces and test helpers ship as one package. Foundry is the supported toolchain; Hardhat works with the same artifacts."
```
forge install latch-protocol/core
forge remappings > remappings.txt
```

### B5. `2 · Write the latch`
"Implement `permissions()` to declare the callbacks you want, then implement only those callbacks. Anything you leave out is never called, so it costs no gas."

`src/FeeLatch.sol` — SPDX header, `pragma solidity ^0.8.26`, imports of `{ILatch, PoolKey, SwapParams}` from `@latch/core/ILatch.sol` and `{BEFORE_SWAP, AFTER_SWAP}` from `@latch/core/Permissions.sol`, contract with `LOW = 500` / `HIGH = 3000`, `permissions()` returning `BEFORE_SWAP | AFTER_SWAP`, and `beforeSwap` returning `volatility(key) > p.threshold ? HIGH : LOW`.

Callout (pulsing dot): "The registry reverts registration if `permissions()` declares a callback the contract does not implement. Keep the bitmap and the implementation in sync."

### B6. `3 · Simulate and register`
```
latch simulate --contract FeeLatch --pool ETH/USDC --runs 1000
median overhead 8,412 gas · 0 reverts · bitmap 0x0003 ok

latch register --network base-sepolia --budget 24000
```

### B7. Callback reference
`beforeSwap 0x0001 uint24 fee` · `afterSwap 0x0002 —` · `beforeAddLiquidity 0x0004 bool allow` · `afterAddLiquidity 0x0008 —` · `beforeRemoveLiquidity 0x0010 bool allow` · `afterDonate 0x0020 —`

### B8. Execution order
01 Pool receives a swap (Router calls the pool as usual.) · 02 beforeSwap latches run (In registration order, each within its gas budget.) · 03 Swap executes (Using the fee returned by the last latch.) · 04 afterSwap latches run (Side effects only; return values ignored.) · 05 Registry records the call (Gas used, reverts and fee applied.)

### B9. Common errors
- `LatchBitmapMismatch()` — permissions() declares a callback the contract does not implement. Align the bitmap with your functions.
- `GasBudgetExceeded(uint256 used)` — The callback used more gas than the registered budget. Raise the budget or trim state writes.
- `LatchNotVerified()` — The pool requires verified latches. Submit source for verification, or attach to a permissionless pool.
- `ReentrantLatchCall()` — The latch re-entered the pool. Route external calls through afterSwap instead.

### B10. Next panel + footer
`Next: attach it to a pool` / "Open the app, find your registered latch in the explorer, and attach it to a pool you control. Simulation runs again before the pool accepts it." / `Open the app →` · `Back to quickstart`.

---

## C. Dapp — `Latch Dapp.dc.html`

Shell: sidebar 238px + main. Sidebar nav order: Dashboard · Hook Explorer · Deploy a Hook · Pool Detail · Portfolio · Analytics · Settings. Below: `GAS SPONSOR CREDITS` (62% bar, `0.62 ETH remaining`) and wallet button `0x8f2c…41ba` with pulsing green dot.

Header per screen — title + subtitle, `BLOCK 21,904,118` chip (ticks +1 / 4s), `Deploy Latch` button:

| Screen | Title | Subtitle |
| --- | --- | --- |
| dashboard | Dashboard | Your latches across 4 networks |
| explorer | Latch Explorer | 1,840 latches · 1,612 verified |
| deploy | Deploy a Latch | Register a hook against the protocol registry |
| pool | Pool detail | ETH / USDC · 0.05% · Base |
| portfolio | Portfolio | 5 positions with latches attached |
| analytics | Analytics | Protocol-wide hook activity |
| settings | Settings | Account, network and API access |

### C1. Dashboard
KPI cards (each with a 12-bar sparkline): `TVL WITH LATCHES $48.2M +6.4%` · `HOOK CALLS 24H 412,905 +12.1%` · `FEES EARNED 30D $186.4K +3.8%` · `MEDIAN OVERHEAD 8,412 gas −2.2%` (last trend in blue, not green).

`Volume routed through your latches` card with 30D/90D/1Y switcher. Series — 30D `18 24 21 29 34 31 38 44 41 52 48 61` (W1–W4) · 90D `12 19 26 22 33 41 38 47 55 51 63 72` (Jun Jul Aug) · 1Y `4 7 11 9 16 22 27 34 41 52 63 78` (Q4 Q1 Q2 Q3).

`CALL MIX` bars: beforeSwap `8.2M` 100% · afterSwap `6.4M` 78% · beforeAddLiquidity `1.9M` 24% · afterRemoveLiquidity `0.7M` 9%.

`LIVE HOOK FEED` rows (dot, name, age): DynamicFeeLatch · beforeSwap `2s` · JITLatch · afterSwap `6s` · KYCGateLatch · beforeAddLiquidity `14s` · RewardLatch · afterDonate `31s` · OracleLatch · beforeSwap `48s` (amber — failed) · DynamicFeeLatch · afterSwap `1m`. First two dots pulse.

### C2. Hook Explorer
Search field placeholder `Search latches, authors, pools…`; filter chips `All` `DeFi` `NFT` `Gaming` `RWA` (functional).

| Latch | Author | Status | Hooks | TVL | Calls 24h | Gas | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DynamicFeeLatch | latch-labs.eth | VERIFIED | beforeSwap, afterSwap | $14.2M | 182K | 8.4k | Adjusts pool fees from realised volatility every block. |
| JITLatch | 0x4a1c…88de | VERIFIED | beforeSwap | $9.8M | 64K | 12.1k | Just-in-time liquidity provisioning around large swaps. |
| KYCGateLatch | compliance.eth | AUDITED | beforeAddLiquidity | $6.1M | 9.2K | 5.7k | Blocks transfers from addresses outside an allowlist root. |
| RewardLatch | guildworks.eth | REVIEW | afterSwap, afterDonate | $2.4M | 27K | 9.9k | Streams game rewards on swap volume thresholds. |
| OracleLatch | 0x71c2…9ef4 | VERIFIED | afterSwap | $5.6M | 41K | 7.2k | Publishes TWAP updates as a side effect of pool activity. |
| NFTMintLatch | studio.eth | REVIEW | afterAddLiquidity | $1.1M | 3.8K | 18.4k | Mints a receipt NFT for liquidity positions above a size. |

Filter mapping — DeFi: DynamicFeeLatch, JITLatch, OracleLatch · NFT: NFTMintLatch · Gaming: RewardLatch · RWA: KYCGateLatch. Cards click through to Pool Detail.

### C3. Deploy a Hook
Step strip: `1 Contract / address + ABI` · `2 Callbacks / permission bitmap` · `3 Simulate / replay mainnet` · `4 Register / sign + submit`. Steps 1–2 active at rest, 1–3 while simulating, all four once simulated.

Config card `Latch configuration`: `CONTRACT ADDRESS 0x71c2…9ef4`; `CALLBACKS` chips beforeSwap · afterSwap (both on by default) · beforeAddLiquidity · afterAddLiquidity · beforeRemoveLiquidity · afterDonate; `GAS BUDGET PER CALL` `24,000 gas` with a bar (max 60k, axis `2k`/`60k`). Button: `Run simulation` → `Simulating…` (2.2s) → `Register on Base ✓` (turns green).

Right — `simulation output` panel, lines staggering in:
```
→ compiling FeeLatch.sol
✓ bytecode 4.2 KB · under 24 KB limit
✓ permission bitmap 0x0003 accepted
→ replaying 1,000 mainnet swaps
✓ median overhead 8,412 gas
· awaiting simulation   ← becomes "✓ ready to register on Base"
```
`PRE-FLIGHT CHECKS`: Bytecode size `4.2 KB` · Reentrancy scan `clean` · Gas within budget `8.4k / 24k` (red `over budget` if budget < 9k) · Registry slot `available`.

### C4. Pool Detail
Header card: overlapping token circles, `ETH / USDC · 0.05%`, `DynamicFeeLatch attached · Base`, stats `TVL $14.2M` · `VOLUME 24H $8.1M` · `FEE (LIVE) 0.11%` · `HOOK CALLS 182K`.

`FEE APPLIED BY LATCH · 24H` chart — green fee line `26 31 28 42 55 48 38 44 61 52 47 39` drawing on, blue dashed volatility line; legend `fee bps` / `volatility index`.

`RECENT HOOK CALLS`: beforeSwap 0.11% 8.2k · afterSwap — 3.1k · beforeSwap 0.30% 8.6k · beforeSwap 0.05% 8.1k · afterSwap — 3.0k · beforeSwap 0.11% 8.3k · afterSwap — 3.2k.

### C5. Portfolio
KPIs: `POSITION VALUE $1.94M (+$42.1K / 30d)` · `FEES EARNED $61.2K (+8.4% vs no latch)` · `ACTIVE LATCHES 5 (across 3 networks)`.

| Position | Latch | Value | Fees 30d | Status |
| --- | --- | --- | --- | --- |
| ETH / USDC 0.05% | DynamicFeeLatch | $812K | $24.1K | ACTIVE |
| WBTC / ETH 0.30% | JITLatch | $466K | $14.8K | ACTIVE |
| ETH / USDT 0.05% | OracleLatch | $318K | $11.2K | ACTIVE |
| ARB / ETH 0.30% | RewardLatch | $204K | $7.4K | PENDING |
| RWA-T / USDC 0.01% | KYCGateLatch | $142K | $3.7K | PAUSED |

### C6. Analytics
`HOOK CALLS · WEEKLY` — 18 columns `42 58 51 66 74 61 82 90 77 96 88 71 84 93 79 68 87 100`, last column green, with the range switcher.
`TVL BY NETWORK` donut — Ethereum 41% · Base 27% · Arbitrum 19% · Others 13%.
`TOP LATCHES BY FEES` — DynamicFeeLatch `$88.1K` 100% · JITLatch `$41.6K` 47% · OracleLatch `$29.4K` 33% · RewardLatch `$12.2K` 14%.

### C7. Settings
`Preferences` toggles (all on except testnet):
- Simulate before every registration — Replays 1,000 recent swaps against your latch
- Revert alerts — Notify when a latch reverts more than 0.1% of calls
- Show testnet deployments — Include Sepolia and Base Sepolia in lists
- Auto gas sponsorship — Draw from credits when a caller cannot pay

`DEFAULT NETWORK` chips — Ethereum · Base (selected) · Arbitrum · Optimism · Polygon.
`API KEY` — `latch_sk_••••••••••••7f21` + `ROTATE`; note "Rotating the key invalidates existing simulation sessions within 60 seconds."

---

## D. Brand kit page — `Latch Brand Kit.dc.html`

1. **Hero** — `BRAND KIT · V1`; H1 `Latch Protocol` / `assets and usage.`; paragraph "Logo, icon, favicon, social art and the Powered By badge — every file in transparent PNG and SVG. Use these as shipped; do not redraw, recolor or stretch the mark."; `Download primary logo` · `Usage rules`.
2. **Logo** — six tiles: Primary lockup (dark ground) · Lockup on light (`#EEF2F8`) · Mark (gradient ground) · Mark · single blue · Wordmark · App icon. Each with PNG + SVG buttons.
3. **Icon & favicon** — 168px app icon card; favicon row 16 / 32 / 64 / 180 / 512; note "Serve the SVG first and 180×180 as the Apple touch icon."
4. **Social** — X banner (dark + transparent), OG / share image 1200×630, profile picture (dark + transparent), safe-area note ("Keep the mark inside the centre 60% of the banner's height…").
5. **Partner badge** — light ink on `#04060C`, dark ink on `#EEF2F8`, PNG + SVG each.
6. **Color** — eight swatches: Latch Blue `#2B8BFF` · Deep Blue `#0A63E0` · Signal Blue `#4A9BFF` · Void `#04060C` · Panel `#070C17` · Hairline `#16223A` · Ink `#E4ECF9` · Muted Ink `#8A9BB6`, each with role.
7. **Typography** — Chakra Petch (600/700 · headlines, wordmark support) · IBM Plex Sans (400/500 · body, UI) · IBM Plex Mono (400/500 · labels, code, addresses).
8. **Usage** — clear space = height of the hook's eye on all four sides; minimum sizes full lockup 120px / mark 24px / badge 160px; DON'T list: recolor outside blue and white · stretch, rotate or outline · add glow, bevel or drop shadow to the lockup · place the mark on a busy photo without a solid plate · rebuild the wordmark in another typeface.
9. **Web embed** — favicon head snippet and og:image / twitter:card snippet.

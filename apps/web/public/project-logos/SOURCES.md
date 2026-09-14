# Ecosystem logo asset sources

Same rule as `../chains/SOURCES.md`: every file here was downloaded **as-is** from the
project's own website, its own asset CDN, or its official GitHub organisation. Nothing
was drawn, traced, recoloured or reconstructed by hand, and nothing came from a logo
aggregator (CoinGecko, CMC, cryptologos.cc, Brandfetch, etc.).

A project with no sourceable mark gets **no file here**. The card falls back to a
typographic monogram built from its name, which is the honest output — an approximation
of somebody's logo is worse than no logo.

| Project | File | Source URL | Notes |
| --- | --- | --- | --- |
| Peddles | `peddles.svg` | https://peddles.xyz/brand/svg/favicon-mark.svg | The site's own `rel="icon"` SVG, declared in the page head. 100×100, self-contained: it carries its own `#0A0D14` rounded-rect ground, so it reads on both themes without a plate behind it. |
| PeddlesQuest | `peddlequest.png` | https://peddlequest.xyz/apple-touch-icon.png | The site's own apple-touch-icon, declared in the page head. 180×180 RGBA. Raster because the site publishes no SVG mark. |
| PeddleSwap | *(none)* | — | **No asset exists to take.** peddleswap.xyz is a "Coming soon" SPA that answers **200 with the app-shell HTML for every path** — `/icon.svg`, `/favicon.ico`, `/brand/favicon-32.png`, `/brand/favicon-64.png`, `/brand/app-icon-ink-192.png` and `/brand/og-card-1200x630.png` were all probed and every one returned HTML, not an image. The head declares those files; the server does not serve them. Falls back to the monogram until the real assets are deployed, at which point drop the file here and add the row. |

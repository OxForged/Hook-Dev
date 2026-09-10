import { Link } from 'react-router-dom'
import { DownloadRow, Lockup, Section } from './components'
import { donts, favicons, logos, minimums, palette, specimens } from './assets'
import './brand.css'

/**
 * Brand kit — public asset download page.
 *
 * Spec: "latch design/README.md" (authoritative) + SCREENS.md § D, diffed
 * against design-references/Latch Brand Kit.dc.html.
 *
 * Two things this page owes the people who use it:
 *  1. Every download works. Every button is an `<a download>` onto a real file
 *     in /brand — no JS handlers, nothing that 404s.
 *  2. No file is labelled as something it is not. The kit's SVGs wrap a raster
 *     image rather than carrying outlines, and three tiles have no SVG at all;
 *     both facts are stated on the page (§ Logo, "File formats") instead of
 *     being discovered by a partner after they open the file.
 */
export default function BrandKit() {
  return (
    <div className="bk">
      <header className="bk-header">
        <Lockup />
        <nav className="bk-nav" aria-label="Primary">
          <Link to="/">Home</Link>
          <a href="#logo" aria-current="page">
            Brand Kit
          </a>
          <a href="#color">Color</a>
          <a href="#type">Type</a>
          <a href="#embed">Embed</a>
          <Link to="/docs">Docs</Link>
          <Link to="/app">Launch App</Link>
        </nav>
      </header>

      <main>
        {/* ------------------------------------------------------------ hero */}
        <Section eyebrow="BRAND KIT · V1" hero labelledBy="bk-title">
          <h1 className="bk-h1" id="bk-title">
            Latch Protocol
            <br />
            <span>assets and usage.</span>
          </h1>
          <p className="bk-lead">
            Logo, icon, favicon, social art and the Powered By badge — every file in transparent PNG
            and SVG. Use these as shipped; do not redraw, recolor or stretch the mark.
          </p>
          <div className="bk-cta-row">
            <a
              className="bk-btn bk-btn--primary"
              href="/brand/latch-lockup-transparent.png"
              download="latch-lockup-transparent.png"
            >
              Download primary logo
            </a>
            <a className="bk-btn bk-btn--ghost" href="#usage">
              Usage rules
            </a>
          </div>
        </Section>

        {/* ------------------------------------------------------------ logo */}
        <Section id="logo" eyebrow="LOGO" delay={0.05} labelledBy="bk-logo-h">
          <h2 className="bk-h2" id="bk-logo-h">
            Primary lockup, mark and wordmark.
          </h2>
          <ul className="bk-grid bk-grid--list">
            {logos.map((logo) => (
              <li key={logo.id} className="bk-card bk-card--hover bk-tile">
                <div className={`bk-plate bk-plate--${logo.ground}`}>
                  <img className={`bk-preview--${logo.preview}`} src={logo.src} alt={logo.alt} />
                </div>
                <div className="bk-tile-foot">
                  <div style={{ minWidth: 0 }}>
                    <p className="bk-tile-name">{logo.name}</p>
                    <p className="bk-tile-meta">{logo.meta}</p>
                  </div>
                  <DownloadRow downloads={logo.downloads} />
                </div>
              </li>
            ))}
          </ul>

          {/*
            What a downloader can only learn from us. Three facts about the
            files, each of which changes how you'd use them — deliberately not
            an internal to-do list, and deliberately not styled as an error.
          */}
          <aside className="bk-note" aria-labelledby="bk-formats">
            <p className="bk-micro" id="bk-formats">
              FILE FORMATS
            </p>
            <ul>
              <li>
                The <code>.svg</code> files embed the transparent PNG rather than carrying outlines.
                They place and scale cleanly in layout, but they are not editable vector paths — if
                you need true outlines for print or cutting, ask for the vector source before you
                ship.
              </li>
              <li>
                Every raster in this kit is alpha-extracted from a bitmap original, so edges soften
                and faint noise shows above roughly 512px. Comfortable up to that; request the
                source for large-format work.
              </li>
              <li>
                Three assets have no SVG in this kit — the on-light lockup, the single-blue mark and
                the app icon are PNG only. Their tiles say so rather than handing you a different
                file under an SVG label.
              </li>
            </ul>
          </aside>
        </Section>

        {/* --------------------------------------------------- icon & favicon */}
        <Section eyebrow="ICON &amp; FAVICON" delay={0.1} labelledBy="bk-icon-h">
          <h2 className="bk-h2" id="bk-icon-h">
            App icon and favicon set.
          </h2>
          <div className="bk-icon-row">
            <div className="bk-card bk-card--pad bk-card--hover bk-icon-card">
              <img
                className="bk-app-icon"
                src="/brand/app-icon-1024.png"
                alt="The Latch app icon: the Latch mark centred on a dark rounded square with a glowing blue rim."
              />
              <p className="bk-tile-name">App icon</p>
              <p className="bk-tile-meta">1024×1024 PNG · rounded square, blue rim</p>
              <a
                className="bk-dl"
                style={{ alignSelf: 'flex-start' }}
                href="/brand/app-icon-1024.png"
                download="app-icon-1024.png"
                aria-label="Download the app icon as a 1024 by 1024 PNG"
              >
                Download PNG
              </a>
            </div>

            <div className="bk-card bk-card--pad">
              <p className="bk-micro">TRANSPARENT FAVICONS</p>
              <div className="bk-fav-row">
                {favicons.map((f) => (
                  // The whole swatch is the link, so even the 16px favicon
                  // clears a 44px hit target.
                  <a
                    key={f.size}
                    className="bk-fav"
                    href={f.href}
                    download={`favicon-${f.size}.png`}
                    aria-label={`Download the ${f.size} by ${f.size} favicon PNG`}
                  >
                    <span
                      className="bk-fav-box"
                      style={{ width: f.px + 22, height: f.px + 22 }}
                      aria-hidden="true"
                    >
                      <img src={f.href} alt="" width={f.px} height={f.px} />
                    </span>
                    <span className="bk-fav-label">{f.label}</span>
                  </a>
                ))}
              </div>
              <p className="bk-fav-note">
                Scalable{' '}
                <a href="/brand/favicon.svg" download="favicon.svg">
                  favicon.svg
                </a>{' '}
                ships alongside the raster set. Serve the SVG first and 180×180 as the Apple touch
                icon.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------------------------------------------------------- social */}
        <Section eyebrow="SOCIAL" delay={0.15} labelledBy="bk-social-h">
          <h2 className="bk-h2" id="bk-social-h">
            X banner and profile picture.
          </h2>

          <div className="bk-card bk-banner">
            <img
              src="/brand/x-banner-1500x500-dark.png"
              alt="Latch Protocol X banner: the lockup set against the dark brand ground, 1500 by 500."
            />
            <div className="bk-banner-foot">
              <p className="bk-tile-name">X / Twitter banner</p>
              <p className="bk-tile-meta" style={{ marginTop: 0 }}>
                1500×500 @2x · dark and transparent
              </p>
              <DownloadRow
                downloads={[
                  {
                    label: 'DARK PNG',
                    href: '/brand/x-banner-1500x500-dark.png',
                    aria: 'Download the X banner, dark version, as a PNG',
                  },
                  {
                    label: 'TRANSPARENT PNG',
                    href: '/brand/x-banner-1500x500-transparent.png',
                    aria: 'Download the X banner, transparent version, as a PNG',
                  },
                ]}
              />
            </div>
          </div>

          <div className="bk-card bk-banner">
            <img
              src="/brand/og-1200x630.png"
              alt="Latch Protocol link-preview image: the lockup and tagline on the dark brand ground, 1200 by 630."
            />
            <div className="bk-banner-foot">
              <p className="bk-tile-name">OG / share image</p>
              <p className="bk-tile-meta" style={{ marginTop: 0 }}>
                1200×630 @2x · link previews, Twitter card
              </p>
              <DownloadRow
                downloads={[
                  {
                    label: 'DARK PNG',
                    href: '/brand/og-1200x630.png',
                    aria: 'Download the OG share image, dark version, as a PNG',
                  },
                  {
                    label: 'TRANSPARENT PNG',
                    href: '/brand/og-1200x630-transparent.png',
                    aria: 'Download the OG share image, transparent version, as a PNG',
                  },
                ]}
              />
            </div>
          </div>

          <div className="bk-grid--social bk-grid">
            <div className="bk-card bk-pfp-card">
              <img
                className="bk-pfp"
                src="/brand/pfp-800-dark.png"
                alt="Latch Protocol profile picture: the Latch mark centred on the dark brand ground, safe to crop to a circle."
              />
              <div className="bk-pfp-body">
                <p className="bk-tile-name">Profile picture</p>
                <p className="bk-tile-meta">800×800 · crops safely to a circle</p>
                <div className="bk-dl-row" style={{ marginTop: 12, marginLeft: 0 }}>
                  <a
                    className="bk-dl"
                    href="/brand/pfp-800-dark.png"
                    download="pfp-800-dark.png"
                    aria-label="Download the profile picture, dark version, as a PNG"
                  >
                    DARK
                  </a>
                  <a
                    className="bk-dl"
                    href="/brand/pfp-800-transparent.png"
                    download="pfp-800-transparent.png"
                    aria-label="Download the profile picture, transparent version, as a PNG"
                  >
                    TRANSPARENT
                  </a>
                </div>
              </div>
            </div>

            <div className="bk-card bk-safe-card">
              <p className="bk-micro">SAFE AREA</p>
              <p className="bk-safe-body">
                Keep the mark inside the centre 60% of the banner&rsquo;s height. Profile-picture
                overlap on X sits at the lower left of the banner, so nothing critical goes there.
              </p>
              {/* Relevant to anyone reusing this artwork next to live type. */}
              <p className="bk-safe-body">
                Headline type inside the OG and square social images is set in a fallback grotesque,
                not Chakra Petch.
              </p>
            </div>
          </div>
        </Section>

        {/* --------------------------------------------------- partner badge */}
        <Section eyebrow="PARTNER BADGE" delay={0.2} labelledBy="bk-badge-h">
          <h2 className="bk-h2 bk-h2--tight" id="bk-badge-h">
            Powered By Latch Protocol.
          </h2>
          <p className="bk-lead bk-lead--section">
            For any protocol running a Latch. Two inks, both on transparent grounds — pick the one
            that contrasts with your surface.
          </p>
          <div className="bk-grid bk-grid--wide">
            {/* Each ink previews on the ground it is drawn for: light ink on
                Void, dark ink on --light-surface. */}
            <div className="bk-card bk-card--hover bk-tile">
              <div className="bk-badge-plate bk-plate--void">
                <img
                  src="/brand/powered-by-latch-light.png"
                  alt="The Powered by Latch Protocol badge in light ink, previewed on the dark Void ground it is drawn for."
                />
              </div>
              <div className="bk-tile-foot">
                <p style={{ fontSize: 14, margin: 0 }}>Light ink · for dark surfaces</p>
                <DownloadRow
                  downloads={[
                    {
                      label: 'PNG',
                      href: '/brand/powered-by-latch-light.png',
                      aria: 'Download the light-ink partner badge as a transparent PNG',
                    },
                    {
                      label: 'SVG',
                      href: '/brand/powered-by-latch-light.svg',
                      aria: 'Download the light-ink partner badge as an SVG',
                    },
                  ]}
                />
              </div>
            </div>

            <div className="bk-card bk-card--hover bk-tile">
              <div className="bk-badge-plate bk-plate--light">
                <img
                  src="/brand/powered-by-latch-dark.png"
                  alt="The Powered by Latch Protocol badge in dark ink, previewed on the pale surface it is drawn for."
                />
              </div>
              <div className="bk-tile-foot">
                <p style={{ fontSize: 14, margin: 0 }}>Dark ink · for light surfaces</p>
                <DownloadRow
                  downloads={[
                    {
                      label: 'PNG',
                      href: '/brand/powered-by-latch-dark.png',
                      aria: 'Download the dark-ink partner badge as a transparent PNG',
                    },
                    {
                      label: 'SVG',
                      href: '/brand/powered-by-latch-dark.svg',
                      aria: 'Download the dark-ink partner badge as an SVG',
                    },
                  ]}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------------- color */}
        <Section id="color" eyebrow="COLOR" delay={0.05} labelledBy="bk-color-h">
          <h2 className="bk-h2" id="bk-color-h">
            Palette.
          </h2>
          <ul className="bk-grid bk-grid--palette bk-grid--list">
            {palette.map((c) => (
              <li key={c.token} className="bk-card bk-swatch-card">
                <div
                  className={`bk-swatch${c.needsRule ? ' bk-swatch--ruled' : ''}`}
                  style={{ background: `var(${c.token})` }}
                />
                <div className="bk-swatch-body">
                  <p className="bk-swatch-name">{c.name}</p>
                  <p className="bk-swatch-hex">{c.hex}</p>
                  <p className="bk-swatch-role">{c.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ------------------------------------------------------ typography */}
        <Section id="type" eyebrow="TYPOGRAPHY" delay={0.1} labelledBy="bk-type-h">
          <h2 className="bk-h2" id="bk-type-h">
            Two families, one mono.
          </h2>
          <div className="bk-grid">
            {specimens.map((s) => (
              <div key={s.name} className="bk-card bk-card--pad bk-card--hover">
                <p
                  className="bk-specimen"
                  style={{ fontFamily: s.font, fontWeight: s.weight, margin: 0 }}
                  aria-hidden="true"
                >
                  Aa
                </p>
                <p className="bk-specimen-name">{s.name}</p>
                <p className="bk-specimen-meta">{s.meta}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ----------------------------------------------------------- usage */}
        <Section id="usage" eyebrow="USAGE" delay={0.15} labelledBy="bk-usage-h">
          <h2 className="bk-h2" id="bk-usage-h">
            Clear space and limits.
          </h2>
          <div className="bk-grid bk-grid--usage">
            <div className="bk-card bk-card--pad">
              <div className="bk-clearspace">
                <img
                  src="/brand/latch-lockup-transparent.png"
                  alt="The primary lockup inside a dashed frame, showing the clear space that must stay empty on all four sides."
                />
              </div>
              <p className="bk-usage-caption">
                Clear space equals the height of the mark&rsquo;s eye on all four sides.
              </p>
            </div>

            <div className="bk-card bk-card--pad">
              <p className="bk-micro">MINIMUM SIZES</p>
              <ul className="bk-list">
                {minimums.map((m) => (
                  <li key={m.what}>
                    {m.what}
                    <span className="bk-list-value">{m.size}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bk-card bk-card--pad">
              <p className="bk-micro bk-micro--error">DON&rsquo;T</p>
              <ul className="bk-list bk-list--dont">
                {donts.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* ----------------------------------------------------------- embed */}
        <Section id="embed" eyebrow="WEB EMBED" delay={0.2} labelledBy="bk-embed-h">
          <h2 className="bk-h2" id="bk-embed-h">
            Drop-in snippets.
          </h2>
          <div className="bk-grid bk-grid--embed">
            <div className="bk-card bk-code-card">
              <p className="bk-code-bar">favicon · head</p>
              <pre className="bk-code">
                <code>
                  <span className="bk-tag">&lt;link</span> rel=
                  <span className="bk-str">&quot;icon&quot;</span> href=
                  <span className="bk-str">&quot;/favicon.svg&quot;</span> type=
                  <span className="bk-str">&quot;image/svg+xml&quot;</span>
                  <span className="bk-tag">&gt;</span>
                  {'\n'}
                  <span className="bk-tag">&lt;link</span> rel=
                  <span className="bk-str">&quot;apple-touch-icon&quot;</span> href=
                  <span className="bk-str">&quot;/favicon-180.png&quot;</span>
                  <span className="bk-tag">&gt;</span>
                </code>
              </pre>
            </div>

            <div className="bk-card bk-code-card">
              <p className="bk-code-bar">og image · head</p>
              <pre className="bk-code">
                <code>
                  <span className="bk-tag">&lt;meta</span> property=
                  <span className="bk-str">&quot;og:image&quot;</span> content=
                  <span className="bk-str">&quot;/og.png&quot;</span>
                  <span className="bk-tag">&gt;</span>
                  {'\n'}
                  <span className="bk-tag">&lt;meta</span> name=
                  <span className="bk-str">&quot;twitter:card&quot;</span>
                  {'\n  '}content=
                  <span className="bk-str">&quot;summary_large_image&quot;</span>
                  <span className="bk-tag">&gt;</span>
                </code>
              </pre>
            </div>
          </div>
        </Section>
      </main>

      <footer className="bk-footer">
        <Lockup />
        <div className="bk-footer-links">
          <Link to="/">Home</Link>
          <a href="#logo">Assets</a>
          <a href="#usage">Usage</a>
          <span className="bk-copyright">© 2026 LATCH PROTOCOL</span>
        </div>
      </footer>
    </div>
  )
}

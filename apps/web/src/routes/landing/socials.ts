/**
 * Latch Protocol social destinations — the single source of truth.
 *
 * Every surface that links to a Latch account imports from here, so a handle
 * that turns out to be wrong is corrected in ONE place. `DocsFooter` reads
 * `GITHUB_URL` from this module for exactly that reason.
 *
 * HANDLES: `GITHUB_URL` is confirmed. It is NOT the URL the docs footer used
 * to hardcode — that one (`github.com/latch-protocol`) pointed at the wrong
 * org and was a bug; `DocsFooter` now imports this constant instead. The other
 * four are provisional: they assume the `latchprotocol` handle stem on each
 * platform and have NOT been verified against a live account. Correct them
 * here before launch.
 *
 * ICONS: each entry carries its own path data rather than pulling from
 * `public/icons.svg`. That sprite is unreferenced by any component and its
 * glyphs are hardcoded to `#08060d`, so they cannot follow the theme. These
 * paths are drawn on the same 24-unit grid the brand marks are published on
 * and are filled with `currentColor`, which is what lets the footer hover
 * state recolour them.
 *
 * The paragraph.xyz entry is a drawn pilcrow, not Paragraph's official
 * wordmark — swap in the real asset when it is available.
 */

/** Confirmed org. Also consumed by `src/routes/docs/DocsFooter.tsx`. */
export const GITHUB_URL = 'https://github.com/Latch-Protocol-Team'

export interface SocialLink {
  /** Stable react key. */
  readonly id: string
  /**
   * The link's accessible name. The icon is `aria-hidden`, so this string is
   * the ONLY thing a screen reader announces — it has to name the destination,
   * not the glyph.
   */
  readonly label: string
  readonly href: string
  /** True once a human has confirmed the account exists at this URL. */
  readonly confirmed: boolean
  readonly viewBox: string
  /** Single filled path, `currentColor`, no strokes. */
  readonly path: string
}

/* ===========================================================================
   !! FOUR OF THESE FIVE URLs ARE UNCONFIRMED — CORRECT THEM HERE !!

   X, YouTube, paragraph.xyz and Medium below are BEST GUESSES. They assume the
   handle stem `latchprotocol` on each platform and nobody has checked that the
   accounts exist. GitHub is the one confirmed entry and is marked as such.

   This array is the ONLY place any of them is written down — the landing
   footer and the docs footer both read from here — so fixing all four is a
   single edit to this block. Flip `confirmed` to true as each is verified.
   =========================================================================== */

export const SOCIALS: readonly SocialLink[] = [
  // --- UNCONFIRMED handle -------------------------------------------------
  {
    id: 'x',
    label: 'Latch Protocol on X',
    href: 'https://x.com/latchprotocol',
    confirmed: false,
    viewBox: '0 0 24 24',
    // The 2023 X mark, not the retired bird.
    path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  // --- UNCONFIRMED handle -------------------------------------------------
  {
    id: 'youtube',
    label: 'Latch Protocol on YouTube',
    href: 'https://www.youtube.com/@latchprotocol',
    confirmed: false,
    viewBox: '0 0 24 24',
    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814M9.545 15.568V8.432L15.818 12z',
  },
  // --- CONFIRMED ----------------------------------------------------------
  {
    id: 'github',
    label: 'Latch Protocol on GitHub',
    href: GITHUB_URL,
    confirmed: true,
    viewBox: '0 0 24 24',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  // --- UNCONFIRMED handle -------------------------------------------------
  {
    id: 'paragraph',
    label: 'Latch Protocol on paragraph.xyz',
    href: 'https://paragraph.xyz/@latchprotocol',
    confirmed: false,
    viewBox: '0 0 24 24',
    // Pilcrow — placeholder for Paragraph's own mark.
    path: 'M19 3v2h-2v16h-2V5h-2v16h-2v-7h-1a5.5 5.5 0 0 1 0-11h9z',
  },
  // --- UNCONFIRMED handle -------------------------------------------------
  {
    id: 'medium',
    label: 'Latch Protocol on Medium',
    href: 'https://medium.com/@latchprotocol',
    confirmed: false,
    viewBox: '0 0 24 24',
    path: 'M13.54 12a6.8 6.8 0 0 1-6.77 6.82A6.8 6.8 0 0 1 0 12a6.8 6.8 0 0 1 6.77-6.82A6.8 6.8 0 0 1 13.54 12m7.42 0c0 3.54-1.51 6.42-3.38 6.42s-3.39-2.88-3.39-6.42 1.52-6.42 3.39-6.42 3.38 2.88 3.38 6.42M24 12c0 3.17-.53 5.75-1.19 5.75s-1.19-2.58-1.19-5.75.53-5.75 1.19-5.75S24 8.83 24 12',
  },
]

/* ===========================================================================
   The subset the site HEADER carries.

   The header is the most expensive real estate on the site and it sits beside
   the one thing we want clicked, so it takes the two accounts a first-time
   visitor might actually act on — the code (GitHub) and the announcements (X).
   The three publishing channels are a "come back and read" ask, not a "do
   something now" ask, and they stay in the footer and the mobile menu, both of
   which carry all five.

   Ids, not a second array of URLs: every href in the app still comes from
   SOCIALS above, so a corrected handle propagates here with no second edit.
   =========================================================================== */

const HEADER_SOCIAL_IDS: readonly string[] = ['x', 'github']

export const HEADER_SOCIALS: readonly SocialLink[] = SOCIALS.filter((social) =>
  HEADER_SOCIAL_IDS.includes(social.id),
)

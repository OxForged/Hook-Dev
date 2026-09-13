import './BrandLockup.css'

/* ============================================================================
   The Latch mark and LATCH / PROTOCOL lockup — ONE implementation for every
   surface (landing header and footer, the dapp sidebar, the docs header and
   footer, the brand kit page).

   Four surfaces had each grown their own copy: the same two images and the
   same theme swap, with the mark at 26 or 30px, the name at 16 or 19px and the
   PROTOCOL line at 8.4, 9.5 or 10.5px. A lockup is a logo; it is not allowed to
   be a slightly different logo on each page.

   THE TWO SHIPPED MARKS, one shown per theme. `latch-mark-transparent.png` is
   drawn in white and blue for dark grounds, and on a light header its white
   half disappears. `favicon-180-light.png` is the brand kit's own dark-ink
   mark for light grounds. Neither file is altered or recoloured; CSS only
   chooses which one displays, following `data-theme` when set and
   `prefers-color-scheme` when it is not.

   Both images are `alt=""`: the lockup words (or the link that wraps a bare
   mark) already name the thing, and an alt on the mark made a screen reader
   say the name twice.

   A global stylesheet, like ThemeToggle.css, because the dapp, docs and brand
   surfaces are plain global CSS and cannot import a CSS module class.
   ========================================================================== */

const MARK_ON_LIGHT = '/brand/favicon-180-light.png'
const MARK_ON_DARK = '/brand/latch-mark-transparent.png'

export type LockupSize = 'md' | 'lg'

/** The theme-swapped mark on its own (the docs footer uses it without words). */
export function BrandMark({ size = 'md' }: { readonly size?: LockupSize }) {
  return (
    <span className="brand-markpair" data-size={size}>
      <img src={MARK_ON_LIGHT} alt="" className="brand-mark brand-mark--onlight" />
      <img src={MARK_ON_DARK} alt="" className="brand-mark brand-mark--ondark" />
    </span>
  )
}

/** Mark + typed LATCH / PROTOCOL. The caller supplies any link around it. */
export function BrandLockup({ size = 'md' }: { readonly size?: LockupSize }) {
  return (
    <span className="brand-lockup" data-size={size}>
      <BrandMark size={size} />
      <span className="brand-lockup__words">
        <span className="brand-lockup__name">LATCH</span>
        <span className="brand-lockup__sub">PROTOCOL</span>
      </span>
    </span>
  )
}

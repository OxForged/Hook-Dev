/**
 * Link classification for the shared site chrome.
 *
 * `SiteHeader` and `SiteFooter` are rendered by `/`, `/privacy`, `/terms` and
 * `/verify`, not only by the landing page, and the three kinds of href they
 * carry each behave differently once you are off `/`:
 *
 *   external  `https://…`  — must open in a new tab, never through <Link>,
 *                            which would resolve it as a relative path.
 *   route     `/docs`      — client-side <Link>, no full reload.
 *   section   `#ecosystem` — a position on the LANDING page. On `/` it is an
 *                            in-page anchor. Anywhere else it has to become
 *                            `/#ecosystem` or the browser sets a hash that
 *                            matches no element and the link does nothing —
 *                            which is exactly what the old header did on the
 *                            legal pages.
 *
 * The cross-page form is a plain <a>, so the browser performs a real document
 * load and its native fragment scrolling takes the visitor to the section.
 * react-router's <Link to="/#ecosystem"> would navigate client-side and then
 * NOT scroll: v7 has no built-in hash scrolling, so the visitor would land at
 * the top of the landing page with no idea why. A full load on a cross-page
 * jump is the cheap, correct option here.
 */

export type LinkKind = 'external' | 'route' | 'section'

export function linkKind(href: string): LinkKind {
  if (href.startsWith('http')) return 'external'
  if (href.startsWith('#')) return 'section'
  return 'route'
}

/** Rewrites a landing-page section anchor for whatever route we are on. */
export function resolveHref(href: string, pathname: string): string {
  if (linkKind(href) !== 'section') return href
  return pathname === '/' ? href : `/${href}`
}

/**
 * True when this link points at the page currently being viewed, and therefore
 * when it should carry `aria-current="page"`.
 *
 * Only a route can be current. A section anchor is a place on a page — marking
 * one "current page" is what made every route announce "Home, current page",
 * and no amount of hash-watching would fix it, because scrolling past a section
 * does not update `location.hash`.
 */
export function isCurrentPage(href: string, pathname: string): boolean {
  return linkKind(href) === 'route' && pathname === href
}

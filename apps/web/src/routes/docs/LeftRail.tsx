import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { RAIL_GROUPS, TOC } from './content'
import { ThemeToggle } from '../../components/ThemeToggle'

type Props = {
  /** Section id currently under the reading line, from `useScrollSpy`. */
  activeId: string | null
  /** True when the viewport is narrow enough that the rail is a drawer. */
  isDrawer: boolean
  open: boolean
  onClose: () => void
}

const slug = (s: string) => `rail-${s.toLowerCase().replace(/[^a-z]+/g, '-')}`

/**
 * Left rail — SCREENS.md § B2. Four link groups plus ON THIS PAGE, mirroring
 * the page's real heading hierarchy.
 *
 * Desktop: `flex: 0 0 220px`, sticky at `top: 86px`, `max-height: calc(100vh -
 * 120px)` with its own scroll (README § Docs layout).
 *
 * Below 1024px it becomes an off-canvas drawer opened from the header. The
 * drawer is `inert` while closed so its links stay out of the tab order, and it
 * carries a SITE group holding the header links the narrow header drops.
 *
 * Group labels are plain elements referenced by `aria-labelledby`, not
 * headings: the page's heading outline is H1 "Ship your first Latch." followed
 * by one H2 per section, and rail labels must not appear in it.
 */
export default function LeftRail({ activeId, isDrawer, open, onClose }: Props) {
  const closeBtn = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isDrawer || !open) return
    closeBtn.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [isDrawer, open, onClose])

  const handleNav = () => {
    if (isDrawer) onClose()
  }

  return (
    <>
      {isDrawer && open ? (
        <button
          type="button"
          className="dk-scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onClose}
        />
      ) : null}

      <aside
        id="docs-rail"
        className="dk-rail"
        data-open={isDrawer && open ? 'true' : 'false'}
        inert={isDrawer && !open}
      >
        <nav className="dk-rail__nav" aria-label="Documentation">
          {isDrawer ? (
            <div className="dk-rail__head">
              <span className="dk-rail__title">CONTENTS</span>
              <button
                ref={closeBtn}
                type="button"
                className="dk-rail__close"
                onClick={onClose}
                aria-label="Close contents"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ) : null}

          {RAIL_GROUPS.map((group) => (
            <div className="dk-rail__group" key={group.title}>
              <span className="dk-rail__title" id={slug(group.title)}>
                {group.title}
              </span>
              <ul className="dk-rail__items" aria-labelledby={slug(group.title)}>
                {group.items.map((item) => {
                  const isActive =
                    item.spy && activeId !== null && item.href === `#${activeId}`
                  return (
                    <li key={`${group.title}-${item.label}`}>
                      <a
                        href={item.href}
                        className={
                          isActive ? 'dk-rail__link dk-rail__link--active' : 'dk-rail__link'
                        }
                        aria-current={isActive ? 'true' : undefined}
                        onClick={handleNav}
                      >
                        {item.label}
                      </a>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {isDrawer ? (
            <div className="dk-rail__group">
              <span className="dk-rail__title" id="rail-site">
                SITE
              </span>
              <ul className="dk-rail__items" aria-labelledby="rail-site">
                <li>
                  <Link to="/" className="dk-rail__link" onClick={handleNav}>
                    Home
                  </Link>
                </li>
                <li>
                  <Link to="/brand" className="dk-rail__link" onClick={handleNav}>
                    Brand Kit
                  </Link>
                </li>
                <li>
                  <Link to="/app" className="dk-rail__link" onClick={handleNav}>
                    Launch App
                  </Link>
                </li>
              </ul>
            </div>
          ) : null}

          {/* The header's toggle hides at this same breakpoint (.dk-theme-slot
              in docs.css), so the drawer is the only way to reach it here. */}
          {isDrawer ? (
            <div className="dk-rail__group">
              <span className="dk-rail__title" id="rail-theme">
                THEME
              </span>
              <ThemeToggle showLabels />
            </div>
          ) : null}

          <div className="dk-rail__toc">
            <span className="dk-rail__title" id="rail-on-this-page">
              ON THIS PAGE
            </span>
            <ul className="dk-rail__tocitems" aria-labelledby="rail-on-this-page">
              {TOC.map((t) => {
                const isActive = activeId !== null && t.href === `#${activeId}`
                return (
                  <li key={t.href + t.label}>
                    <a
                      href={t.href}
                      className={
                        isActive
                          ? 'dk-rail__toclink dk-rail__toclink--active'
                          : 'dk-rail__toclink'
                      }
                      aria-current={isActive ? 'true' : undefined}
                      onClick={handleNav}
                    >
                      {t.label}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>
      </aside>
    </>
  )
}

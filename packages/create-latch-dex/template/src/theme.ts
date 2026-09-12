// SPDX-License-Identifier: MIT
/**
 * Branding, applied as CSS custom properties.
 *
 * Every colour in `styles.css` reads a `--brand-*` variable and nothing
 * hardcodes a hex value, so restyling the whole app is an edit to
 * `latch.config.ts` rather than a search through stylesheets. That is the
 * difference between "restyle the UI if you want" being a sentence in a README
 * and it being true.
 *
 * The `--latch-*` names are also set, because that is the namespace
 * `@latchprotocol/widgets` themes through. Setting both from one source is what
 * stops the embedded swap widget looking like a different product from the page
 * around it.
 */

import { resolveConfig } from "./config/resolve";

export function applyBrand(root: HTMLElement = document.documentElement): void {
  const { brand } = resolveConfig();
  const c = brand.colors;
  const radius = `${brand.radius ?? 12}px`;

  const vars: Record<string, string> = {
    "--brand-accent": c.accent,
    "--brand-on-accent": c.onAccent,
    "--brand-bg": c.background,
    "--brand-surface": c.surface,
    "--brand-surface-alt": c.surfaceAlt,
    "--brand-text": c.text,
    "--brand-text-muted": c.textMuted,
    "--brand-border": c.border,
    "--brand-positive": c.positive,
    "--brand-negative": c.negative,
    "--brand-radius": radius,
    "--brand-font": brand.fontFamily ?? "system-ui, sans-serif",
    "--brand-mono": brand.monoFamily ?? "ui-monospace, monospace",

    /* The widgets' own token namespace, fed from the same values. */
    "--latch-color-accent": c.accent,
    "--latch-color-on-accent": c.onAccent,
    "--latch-color-bg": c.background,
    "--latch-color-surface": c.surface,
    "--latch-color-surface-alt": c.surfaceAlt,
    "--latch-color-text": c.text,
    "--latch-color-text-muted": c.textMuted,
    "--latch-color-border": c.border,
    "--latch-color-positive": c.positive,
    "--latch-color-negative": c.negative,
    "--latch-radius-md": radius,
    "--latch-font-sans": brand.fontFamily ?? "system-ui, sans-serif",
    "--latch-font-mono": brand.monoFamily ?? "ui-monospace, monospace",
  };

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  document.title = brand.name;
}

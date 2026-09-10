// SPDX-License-Identifier: MIT
/**
 * The stylesheet, as a string.
 *
 * It lives in TypeScript rather than a `.css` file for one reason: the web
 * component renders into a shadow root, and a shadow root cannot see the host
 * page's stylesheets. The same source therefore has to be injectable in three
 * places - a `<style>` in the document head for React hosts, a
 * `CSSStyleSheet` adopted by each shadow root, and `dist/styles.css` for hosts
 * that prefer a `<link>`. One source, no drift.
 *
 * ## Theming
 *
 * Every colour, radius and font is a `--latch-*` custom property declared on
 * `.latch-widget`. Overriding one from the host page is enough to restyle the
 * widget; nothing is hardcoded inside a rule. Light is the base, dark is applied
 * by `[data-latch-theme="dark"]` and by `prefers-color-scheme` when the theme is
 * left on `system`.
 *
 * The layout is single-column and fluid from 280px up, because these widgets
 * are expected to live in narrow sidebars.
 */

/** The complete widget stylesheet. */
export const WIDGET_CSS = `
.latch-widget {
  /* Palette */
  --latch-bg: #ffffff;
  --latch-bg-elevated: #f6f7f9;
  --latch-bg-sunken: #eceef2;
  --latch-border: #dfe3e8;
  --latch-border-strong: #c4cad3;
  --latch-text: #10131a;
  --latch-text-muted: #5c6472;
  --latch-text-inverted: #ffffff;
  --latch-accent: #3b5bdb;
  --latch-accent-hover: #2f49b2;
  --latch-accent-text: #ffffff;
  --latch-success: #157347;
  --latch-warning: #9a6700;
  --latch-warning-bg: #fff8e1;
  --latch-danger: #b42318;
  --latch-danger-bg: #fef3f2;
  --latch-focus: #3b5bdb;

  /* Shape and type */
  --latch-radius: 14px;
  --latch-radius-sm: 9px;
  --latch-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --latch-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  --latch-font-size: 14px;
  --latch-font-size-sm: 12px;
  --latch-font-size-lg: 22px;
  --latch-gap: 12px;
  --latch-padding: 16px;
  --latch-control-height: 44px;
  --latch-shadow: 0 1px 2px rgba(16, 19, 26, 0.06), 0 8px 24px rgba(16, 19, 26, 0.06);

  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--latch-gap);
  width: 100%;
  min-width: 0;
  max-width: 480px;
  padding: var(--latch-padding);
  background: var(--latch-bg);
  color: var(--latch-text);
  border: 1px solid var(--latch-border);
  border-radius: var(--latch-radius);
  box-shadow: var(--latch-shadow);
  font-family: var(--latch-font);
  font-size: var(--latch-font-size);
  line-height: 1.45;
}

.latch-widget *,
.latch-widget *::before,
.latch-widget *::after {
  box-sizing: inherit;
}

.latch-widget[data-latch-theme="dark"] {
  --latch-bg: #14161b;
  --latch-bg-elevated: #1c1f26;
  --latch-bg-sunken: #23262f;
  --latch-border: #2b2f38;
  --latch-border-strong: #3d4350;
  --latch-text: #f2f4f8;
  --latch-text-muted: #98a1b1;
  --latch-text-inverted: #14161b;
  --latch-accent: #6b8afd;
  --latch-accent-hover: #849dff;
  --latch-accent-text: #0b0d12;
  --latch-success: #4ade80;
  --latch-warning: #fbbf5c;
  --latch-warning-bg: #33280f;
  --latch-danger: #ff8a80;
  --latch-danger-bg: #3a1a17;
  --latch-focus: #849dff;
  --latch-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
}

@media (prefers-color-scheme: dark) {
  .latch-widget[data-latch-theme="system"] {
    --latch-bg: #14161b;
    --latch-bg-elevated: #1c1f26;
    --latch-bg-sunken: #23262f;
    --latch-border: #2b2f38;
    --latch-border-strong: #3d4350;
    --latch-text: #f2f4f8;
    --latch-text-muted: #98a1b1;
    --latch-text-inverted: #14161b;
    --latch-accent: #6b8afd;
    --latch-accent-hover: #849dff;
    --latch-accent-text: #0b0d12;
    --latch-success: #4ade80;
    --latch-warning: #fbbf5c;
    --latch-warning-bg: #33280f;
    --latch-danger: #ff8a80;
    --latch-danger-bg: #3a1a17;
    --latch-focus: #849dff;
    --latch-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  }
}

.latch-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.latch-title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.latch-subtitle {
  margin: 0;
  color: var(--latch-text-muted);
  font-size: var(--latch-font-size-sm);
}

.latch-mock-banner {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--latch-warning);
  border-radius: var(--latch-radius-sm);
  background: var(--latch-warning-bg);
  color: var(--latch-warning);
  font-size: var(--latch-font-size-sm);
  font-weight: 600;
}

.latch-mock-banner span {
  font-weight: 500;
}

.latch-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--latch-bg-elevated);
  border: 1px solid var(--latch-border);
  border-radius: var(--latch-radius-sm);
}

.latch-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.latch-label {
  display: block;
  color: var(--latch-text-muted);
  font-size: var(--latch-font-size-sm);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.latch-amount-input {
  flex: 1 1 120px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--latch-text);
  font-family: var(--latch-font);
  font-size: var(--latch-font-size-lg);
  font-weight: 600;
  line-height: 1.2;
}

.latch-amount-input::placeholder {
  color: var(--latch-text-muted);
  font-weight: 500;
}

.latch-amount-input:focus-visible,
.latch-select:focus-visible,
.latch-button:focus-visible,
.latch-icon-button:focus-visible,
.latch-slider:focus-visible,
.latch-chip:focus-visible {
  outline: 2px solid var(--latch-focus);
  outline-offset: 2px;
  border-radius: 4px;
}

.latch-select {
  flex: 0 1 auto;
  max-width: 100%;
  height: 34px;
  padding: 0 8px;
  background: var(--latch-bg);
  color: var(--latch-text);
  border: 1px solid var(--latch-border-strong);
  border-radius: 999px;
  font-family: inherit;
  font-size: var(--latch-font-size);
  font-weight: 600;
  cursor: pointer;
}

.latch-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--latch-text-muted);
  font-size: var(--latch-font-size-sm);
}

.latch-meta-value {
  font-variant-numeric: tabular-nums;
}

.latch-switch-row {
  display: flex;
  justify-content: center;
  margin: -6px 0;
}

.latch-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: var(--latch-bg);
  color: var(--latch-text);
  border: 1px solid var(--latch-border-strong);
  border-radius: 999px;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}

.latch-icon-button:hover {
  background: var(--latch-bg-sunken);
}

.latch-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--latch-bg-sunken);
  border-radius: var(--latch-radius-sm);
  font-size: var(--latch-font-size-sm);
}

.latch-summary dl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.latch-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.latch-summary-row dt {
  color: var(--latch-text-muted);
  min-width: 0;
}

.latch-summary-row dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.latch-summary-row[data-latch-emphasis="fee"] dd {
  color: var(--latch-accent);
  font-weight: 650;
}

.latch-summary-row[data-latch-severity="high"] dd,
.latch-summary-row[data-latch-severity="severe"] dd {
  color: var(--latch-danger);
  font-weight: 650;
}

.latch-route {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: var(--latch-font-size-sm);
  color: var(--latch-text-muted);
}

.latch-route-token {
  padding: 2px 8px;
  background: var(--latch-bg);
  border: 1px solid var(--latch-border);
  border-radius: 999px;
  color: var(--latch-text);
  font-weight: 600;
}

.latch-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: var(--latch-control-height);
  padding: 0 16px;
  background: var(--latch-accent);
  color: var(--latch-accent-text);
  border: 1px solid transparent;
  border-radius: var(--latch-radius-sm);
  font-family: inherit;
  font-size: 15px;
  font-weight: 650;
  cursor: pointer;
}

.latch-button:hover:not(:disabled) {
  background: var(--latch-accent-hover);
}

.latch-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.latch-button[data-latch-variant="secondary"] {
  background: var(--latch-bg-elevated);
  color: var(--latch-text);
  border-color: var(--latch-border-strong);
}

.latch-button[data-latch-variant="danger"] {
  background: var(--latch-danger);
  color: var(--latch-text-inverted);
}

.latch-status {
  min-height: 18px;
  margin: 0;
  font-size: var(--latch-font-size-sm);
  color: var(--latch-text-muted);
}

.latch-status[data-latch-tone="error"] {
  color: var(--latch-danger);
}

.latch-status[data-latch-tone="success"] {
  color: var(--latch-success);
}

.latch-error {
  padding: 10px 12px;
  background: var(--latch-danger-bg);
  border: 1px solid var(--latch-danger);
  border-radius: var(--latch-radius-sm);
  color: var(--latch-danger);
  font-size: var(--latch-font-size-sm);
  overflow-wrap: anywhere;
}

.latch-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--latch-bg-sunken);
  border-radius: 999px;
}

.latch-chip {
  flex: 1 1 0;
  min-width: 0;
  padding: 7px 10px;
  background: transparent;
  color: var(--latch-text-muted);
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: var(--latch-font-size-sm);
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.latch-chip[aria-selected="true"],
.latch-chip[aria-pressed="true"] {
  background: var(--latch-bg);
  color: var(--latch-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.latch-progress {
  height: 8px;
  background: var(--latch-bg-sunken);
  border-radius: 999px;
  overflow: hidden;
}

.latch-progress-fill {
  height: 100%;
  background: var(--latch-accent);
  border-radius: 999px;
  transition: width 200ms ease;
}

.latch-slider {
  width: 100%;
  accent-color: var(--latch-accent);
}

.latch-range-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.latch-range-grid input {
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  background: var(--latch-bg);
  color: var(--latch-text);
  border: 1px solid var(--latch-border-strong);
  border-radius: var(--latch-radius-sm);
  font-family: var(--latch-font-mono);
  font-size: var(--latch-font-size);
}

.latch-curve {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--latch-radius-sm);
  background: var(--latch-bg-sunken);
}

.latch-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}

.latch-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--latch-text-muted);
  font-size: 11px;
}

.latch-footer a {
  color: inherit;
}

@media (max-width: 380px) {
  .latch-widget {
    --latch-padding: 12px;
    --latch-font-size-lg: 20px;
  }

  .latch-range-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .latch-progress-fill {
    transition: none;
  }
}
`;

const STYLE_ELEMENT_ID = "latch-widgets-styles";

/**
 * Injects the stylesheet into the document once.
 *
 * React hosts call this automatically the first time a styled widget mounts.
 * Hosts that bundle CSS themselves can import `@latchprotocol/widgets/styles.css`
 * instead and never call it.
 */
export function injectWidgetStyles(target: Document | ShadowRoot | null = globalThis.document ?? null): void {
  if (target === null) return;
  const root: Document | ShadowRoot = target;
  if (root.getElementById(STYLE_ELEMENT_ID) !== null) return;

  const doc = "createElement" in root ? root : root.ownerDocument;
  if (doc === null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = WIDGET_CSS;
  const parent = "head" in root && root.head !== null ? root.head : root;
  parent.appendChild(style);
}

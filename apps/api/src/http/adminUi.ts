import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { Router } from "express";

/**
 * Static hosting for the built admin UI (apps/admin/dist) at /admin, on the SAME
 * ORIGIN as /v1/admin — so the session cookie is SameSite=Strict first-party and
 * CSRF is an Origin check plus a header, with no CORS at all.
 *
 * Served only when ADMIN_ENABLED=true and the directory holds an index.html.
 * The UI routes by hash (#/revenue), so only index.html needs a fallback.
 *
 * CSP is strict: scripts and styles from this origin only (the build emits no
 * inline script; vite's modulepreload polyfill is disabled), connections to this
 * origin only, no frames in or out, no plugins, no base-uri rewriting.
 */

export const ADMIN_UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

export function adminUiRouter(dir: string): Router | null {
  const root = resolve(dir);
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) return null;
  const index = readFileSync(indexPath);
  const r = Router();

  r.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return void res.status(405).end();
    res.setHeader("Content-Security-Policy", ADMIN_UI_CSP);
    res.setHeader("X-Frame-Options", "DENY");
    // same-origin, not no-referrer: under no-referrer the browser serialises a
    // same-origin POST's Origin as "null", and /v1/admin refuses it (Origin allowlist).
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  r.use(
    "/assets",
    express.static(join(root, "assets"), {
      index: false,
      dotfiles: "deny",
      fallthrough: false,
      immutable: true,
      maxAge: "365d",
    }),
  );

  const sendIndex: express.RequestHandler = (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(index);
  };
  r.get("/", sendIndex);
  r.get("/index.html", sendIndex);
  r.use(express.static(root, { index: false, dotfiles: "deny", fallthrough: true, maxAge: "1h" }));
  r.use((_req, res) => void res.status(404).type("text/plain").send("Not found"));
  return r;
}

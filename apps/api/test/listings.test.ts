import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { CaptchaVerifier } from "../src/admin/turnstile.js";
import { turnstileVerifier } from "../src/admin/turnstile.js";
import { ADMIN_UI_CSP } from "../src/http/adminUi.js";
import { ECOSYSTEM_CATEGORIES, LATCH_KINDS, LISTING_BODY_LIMIT_BYTES, LISTING_LIMITS } from "../src/http/listings.js";
import { LISTING_BODY_LIMIT_BYTES as MIDDLEWARE_LIMIT } from "../src/http/middleware.js";
import { buildAdminApp } from "./helpers/adminApp.js";

const valid = {
  name: "Example DEX",
  description: "Swaps on Latch pools.",
  url: "https://example.org",
  category: "DEX",
  uses: ["rev-share"],
  chains: [4663],
  contact: "ops@example.org",
};

const benignSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#2f5fe0"/></svg>').toString("base64");

describe("POST /v1/listings", () => {
  it("is off unless enabled", async () => {
    const { app } = buildAdminApp({ listings: { enabled: false } });
    await request(app).post("/v1/listings").send(valid).expect(404);
  });

  it("accepts a valid submission, stores the contact privately, and never publishes a pending one", async () => {
    const { app, tables } = buildAdminApp({ listings: { enabled: true } });
    const r = await request(app).post("/v1/listings").send({ ...valid, icon: { contentType: "image/svg+xml", dataBase64: benignSvg } }).expect(202);
    const row = tables.listingSubmission.rows.find((x) => x.id === r.body.id)!;
    expect(row.contactPrivate).toBe("ops@example.org");
    expect(row.status).toBe("PENDING");
    expect(row.submitterIpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tables.listingAsset.rows).toHaveLength(1);
    const pub = await request(app).get("/v1/listings").expect(200);
    expect(pub.body.items).toHaveLength(0);
  });

  it("GET returns approved listings only, without contact, reviewer or IP hash; icons only for approved", async () => {
    const { app, tables } = buildAdminApp({ listings: { enabled: true } });
    const a = await request(app).post("/v1/listings").send({ ...valid, icon: { contentType: "image/svg+xml", dataBase64: benignSvg } }).expect(202);
    const b = await request(app).post("/v1/listings").send({ ...valid, name: "Pending one" }).expect(202);
    await request(app).get(`/v1/listings/${a.body.id}/icon`).expect(404);
    Object.assign(tables.listingSubmission.rows.find((x) => x.id === a.body.id)!, { status: "APPROVED", reviewer: "0xabc", reviewedAt: new Date() });
    const pub = await request(app).get("/v1/listings").expect(200);
    expect(pub.body.items.map((i: { id: string }) => i.id)).toEqual([a.body.id]);
    const text = JSON.stringify(pub.body);
    for (const secret of ["ops@example.org", "contact", "submitterIpHash", "reviewer", b.body.id]) expect(text).not.toContain(secret);
    const icon = await request(app).get(`/v1/listings/${a.body.id}/icon`).expect(200);
    expect(icon.headers["content-type"]).toContain("image/svg+xml");
    expect(icon.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(icon.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("enforces the ecosystem form's limits and shapes", async () => {
    const { app } = buildAdminApp({ listings: { enabled: true } });
    const bad = async (patch: Record<string, unknown>) => (await request(app).post("/v1/listings").send({ ...valid, ...patch })).status;
    expect(await bad({ name: "x".repeat(LISTING_LIMITS.name + 1) })).toBe(422);
    expect(await bad({ name: "é".repeat(LISTING_LIMITS.name) })).toBe(202); // code points, not bytes
    expect(await bad({ description: "x".repeat(LISTING_LIMITS.description + 1) })).toBe(422);
    expect(await bad({ url: "http://example.org" })).toBe(422);
    expect(await bad({ url: "https://localhost" })).toBe(422);
    expect(await bad({ source: "javascript:alert(1)" })).toBe(422);
    expect(await bad({ category: "Casino" })).toBe(422);
    expect(await bad({ category: "Other" })).toBe(422);
    expect(await bad({ uses: [] })).toBe(422);
    expect(await bad({ uses: ["not-a-kind"] })).toBe(422);
    expect(await bad({ chains: [] })).toBe(422);
    expect(await bad({ contact: "x".repeat(LISTING_LIMITS.contact + 1) })).toBe(422);
    expect(await bad({ name: "Evil‮gpj.exe" })).toBe(422);
    expect(await bad({ unexpected: true })).toBe(422);
  });

  it("rejects an SVG icon carrying script, and does not store it", async () => {
    const { app, tables } = buildAdminApp({ listings: { enabled: true } });
    const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64");
    const r = await request(app).post("/v1/listings").send({ ...valid, icon: { contentType: "image/svg+xml", dataBase64: evil } }).expect(422);
    expect(r.body.error.details[0].message).toContain("script");
    expect(tables.listingAsset.rows).toHaveLength(0);
    expect(tables.listingSubmission.rows).toHaveLength(0);
  });

  it("rate limits per IP", async () => {
    const { app } = buildAdminApp({ listings: { enabled: true, perHour: 2 } });
    await request(app).post("/v1/listings").send(valid).expect(202);
    await request(app).post("/v1/listings").send(valid).expect(202);
    const third = await request(app).post("/v1/listings").send(valid).expect(429);
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("caps the request body", async () => {
    const { app } = buildAdminApp({ listings: { enabled: true } });
    await request(app).post("/v1/listings").set("Content-Type", "application/json").send(JSON.stringify({ ...valid, description: "x".repeat(LISTING_BODY_LIMIT_BYTES + 10) })).expect(413);
    expect(LISTING_BODY_LIMIT_BYTES).toBe(MIDDLEWARE_LIMIT);
  });

  it("Turnstile, when enabled, fails closed", async () => {
    const failing: CaptchaVerifier = { enabled: true, verify: async () => ({ ok: false, reason: "captcha rejected" }) };
    const { app } = buildAdminApp({ listings: { enabled: true, captcha: failing } });
    const r = await request(app).post("/v1/listings").send(valid).expect(400);
    expect(r.body.error.code).toBe("CAPTCHA_FAILED");
    const offline = turnstileVerifier("secret", (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch);
    expect((await offline.verify("token", "1.2.3.4")).ok).toBe(false);
    expect((await offline.verify(undefined, undefined)).ok).toBe(false);
  });

  it("mirrors the web form's constants (apps/web ecosystem.ts)", () => {
    const path = fileURLToPath(new URL("../../web/src/routes/ecosystem/data/ecosystem.ts", import.meta.url));
    if (!existsSync(path)) return;
    const src = readFileSync(path, "utf8");
    const block = /LISTING_LIMITS = \{([\s\S]*?)\}/.exec(src)![1]!;
    for (const [k, v] of Object.entries(LISTING_LIMITS)) expect(block, k).toMatch(new RegExp(`\\b${k}: ${v}\\b`));
    for (const c of ECOSYSTEM_CATEGORIES) expect(src).toContain(`'${c}'`);
    for (const k of LATCH_KINDS) expect(src).toContain(`'${k}'`);
  });
});

describe("the admin UI is served same-origin with a strict CSP, only when admin is enabled", () => {
  const dir = join(tmpdir(), `latch-admin-ui-test-${process.pid}`);
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Latch admin</title>");
  writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1)");

  it("serves index and assets with CSP when enabled", async () => {
    const { app } = buildAdminApp({ adminUiDir: dir });
    const idx = await request(app).get("/admin/").expect(200);
    expect(idx.headers["content-security-policy"]).toBe(ADMIN_UI_CSP);
    expect(ADMIN_UI_CSP).toContain("script-src 'self'");
    expect(ADMIN_UI_CSP).not.toContain("unsafe");
    expect(idx.headers["x-frame-options"]).toBe("DENY");
    // no-referrer would make same-origin POSTs carry Origin: null and fail the CSRF origin check.
    expect(idx.headers["referrer-policy"]).toBe("same-origin");
    expect(idx.headers["cache-control"]).toBe("no-store");
    const js = await request(app).get("/admin/assets/app-abc.js").expect(200);
    expect(js.headers["cache-control"]).toContain("immutable");
    await request(app).post("/admin/").expect(405);
    await request(app).get("/admin/../package.json").expect(404);
  });

  it("is absent when the admin API is disabled", async () => {
    const { app } = buildAdminApp({ adminUiDir: dir, adminEnabled: false });
    await request(app).get("/admin/").expect(404);
  });
});

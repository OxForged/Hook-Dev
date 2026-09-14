import { describe, expect, it } from "vitest";
import { hashKey, keyFromHeaders, mintKey, parseKey, verifyKey } from "../src/auth/keys.js";
import { usagePeriod } from "../src/auth/identity.js";
import { checkRate, decide, FallbackRateLimitStore, MemoryRateLimitStore, type RateLimitStore } from "../src/ratelimit/limiter.js";
import { parseCookies, safeEqualHex, sessionCookie, sha256 } from "../src/admin/session.js";
import { hasRole, impliedRoles } from "../src/admin/roles.js";
import { prepareCollectProtocolFees, buildSafeTransaction } from "../src/admin/safeTx.js";
import { REDACT_PATHS } from "../src/config/logger.js";
import { trustProxySetting } from "../src/config/env.js";
import { decodeFunctionData } from "viem";
import { FEE_CONTROLLER_V2_FUNCTIONS_ABI } from "../src/chain/abis.js";

const PEPPER = "test-pepper-0123456789abcdef0123456789abcdef";

describe("API key hashing and verification", () => {
  it("mints a well-formed key and stores only an HMAC", () => {
    const k = mintKey(PEPPER);
    expect(k.plaintext).toMatch(/^latchk_[a-z2-7]{12}_[A-Za-z0-9_-]{43}$/);
    expect(k.plaintext.startsWith("latch_sk_")).toBe(false);
    expect(k.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.secretHash).not.toContain(k.plaintext.split("_")[2]);
    expect(parseKey(k.plaintext)?.prefix).toBe(k.prefix);
  });

  it("verifies the right key and rejects everything else", () => {
    const k = mintKey(PEPPER);
    expect(verifyKey(k.plaintext, k.secretHash, PEPPER)).toBe(true);
    expect(verifyKey(k.plaintext, k.secretHash, "another-pepper")).toBe(false);
    expect(verifyKey(`${k.plaintext.slice(0, -1)}A`, k.secretHash, PEPPER)).toBe(false);
    expect(verifyKey("latchk_short", k.secretHash, PEPPER)).toBe(false);
    expect(verifyKey(mintKey(PEPPER).plaintext, k.secretHash, PEPPER)).toBe(false);
  });

  it("is keyed: the same key hashes differently under a different pepper", () => {
    const k = mintKey(PEPPER);
    expect(hashKey(k.plaintext, PEPPER)).not.toBe(hashKey(k.plaintext, `${PEPPER}x`));
  });

  it("never mints the same key twice", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintKey(PEPPER).plaintext));
    expect(seen.size).toBe(200);
  });

  it("reads keys from X-API-Key or a Bearer header only", () => {
    const k = mintKey(PEPPER).plaintext;
    expect(keyFromHeaders({ "x-api-key": k })).toBe(k);
    expect(keyFromHeaders({ authorization: `Bearer ${k}` })).toBe(k);
    expect(keyFromHeaders({ authorization: "Bearer something-else" })).toBeNull();
    expect(keyFromHeaders({})).toBeNull();
  });

  it("buckets usage by UTC month", () => {
    expect(usagePeriod(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09");
    expect(usagePeriod(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10");
  });
});

describe("sliding-window rate limiter", () => {
  it("allows up to the limit then denies with a Retry-After", async () => {
    const store = new MemoryRateLimitStore();
    const now = 1_000_000_020_000; // 20 s into a minute bucket
    for (let i = 0; i < 5; i++) expect((await checkRate(store, "ip:1", 5, now)).allowed).toBe(true);
    const denied = await checkRate(store, "ip:1", 5, now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(denied.remaining).toBe(0);
    // Another client is unaffected.
    expect((await checkRate(store, "ip:2", 5, now)).allowed).toBe(true);
  });

  it("weights the previous bucket so a boundary burst is not a free double limit", () => {
    // 10 hits in the last second of bucket N, then at 1 s into bucket N+1:
    // weighted = 10 * (59/60) + 1 > 10.
    const d = decide(60_000 * 101 + 1_000, 60_000, 10, 1, 10);
    expect(d.allowed).toBe(false);
    // Late in the next bucket the old burst has mostly aged out.
    expect(decide(60_000 * 101 + 55_000, 60_000, 10, 1, 10).allowed).toBe(true);
  });

  it("computes retry-after for the moment the weighted count drops under the limit", () => {
    // limit 10, prev 20, current 1 at t=0: needs 20*(1-t)+1 <= 10 => t >= 0.55 => 33 s.
    const d = decide(60_000 * 5, 60_000, 10, 1, 20);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBe(33);
  });

  it("falls back to an in-process limiter when Redis is down, instead of removing the limit", async () => {
    const broken: RateLimitStore = { hit: async () => Promise.reject(new Error("ECONNREFUSED")) };
    const store = new FallbackRateLimitStore(broken);
    const now = 5_000_000_000;
    for (let i = 0; i < 3; i++) expect((await checkRate(store, "k", 3, now)).allowed).toBe(true);
    expect((await checkRate(store, "k", 3, now)).allowed).toBe(false);
  });
});

describe("admin session primitives", () => {
  it("builds a hardened session cookie", () => {
    const c = sessionCookie("__Host-latch_admin", "tok", 600, true);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
    expect(c).not.toContain("Domain=");
  });

  it("parses cookies and compares hashes in constant time", () => {
    expect(parseCookies("a=1; __Host-latch_admin=abc%2Fd; a=2")).toEqual({ a: "1", "__Host-latch_admin": "abc/d" });
    expect(safeEqualHex(sha256("x"), sha256("x"))).toBe(true);
    expect(safeEqualHex(sha256("x"), sha256("y"))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });

  it("role implication: admin > curator > viewer", () => {
    expect([...impliedRoles(["admin"])].sort()).toEqual(["admin", "curator", "viewer"]);
    expect(hasRole(["curator"], "viewer")).toBe(true);
    expect(hasRole(["viewer"], "curator")).toBe(false);
    expect(hasRole(["superuser"], "viewer")).toBe(false);
  });
});

describe("Safe payload preparation (no key, no send)", () => {
  const safe = "0x715a6176946aDbD22c1B2021d321Fb3767ca3432";
  it("encodes collect() as a CALL with no nonce baked in", () => {
    const p = prepareCollectProtocolFees({
      chainId: 4663,
      safe,
      feeController: "0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB",
      poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
      currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
      amount: 0n,
      recipient: safe,
    });
    expect(p.operation).toBe(0);
    expect("nonce" in p).toBe(false);
    expect(p.warnings).toEqual([]);
    const decoded = decodeFunctionData({ abi: FEE_CONTROLLER_V2_FUNCTIONS_ABI, data: p.data });
    expect(decoded.functionName).toBe("collect");
    expect(decoded.args[2]).toBe(0n);
  });

  it("warns when fees would go anywhere but the Safe, and refuses the zero address", () => {
    const p = prepareCollectProtocolFees({
      chainId: 4663,
      safe,
      feeController: "0x9c2c09EFBDb1726d3563B3f92F9912C9134f54aB",
      poolManager: "0xf4A28fA4CFeCAEf349A7D52fA1eB4dF56EB22F66",
      currency: "0x2A21c0826848f2D597B7C87A4B931dE1407958A6",
      amount: 5n,
      recipient: "0x304b0cc019CDBA6C7c767D86a2A34e69FDb3c9a9",
    });
    expect(p.warnings.length).toBe(1);
    expect(() => buildSafeTransaction({ chainId: 1, safe, to: `0x${"0".repeat(40)}`, data: "0x", description: "x" })).toThrow();
  });
});

describe("secrets stay out of logs and headers stay honest", () => {
  it("redacts every credential-bearing path", () => {
    for (const p of ["req.headers.authorization", "req.headers.cookie", 'req.headers["x-api-key"]', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]']) {
      expect(REDACT_PATHS).toContain(p);
    }
  });

  it("refuses TRUST_PROXY=true, which would let any client forge its IP", () => {
    expect(() => trustProxySetting("true")).toThrow();
    expect(trustProxySetting("false")).toBe(false);
    expect(trustProxySetting("172.18.0.0/16")).toBe("172.18.0.0/16");
    expect(trustProxySetting("1")).toBe(1);
  });
});

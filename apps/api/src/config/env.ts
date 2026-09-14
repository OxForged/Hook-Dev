import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// `quiet` suppresses dotenv 17's promotional banner. Never log the parsed env.
loadDotenv({ quiet: true });

const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

/**
 * Environment contract. Parsed once at boot; anything missing or malformed is a
 * start-up failure. Per-chain RPC overrides are dynamic (`LATCH_RPC_<chainId>`,
 * the SDK's own convention) and read through `resolveEndpoints`.
 *
 * Secrets in here: DATABASE_URL, REDIS_URL, API_KEY_PEPPER and
 * any LATCH_RPC_* URL carrying a provider key. None of them is ever logged; see
 * config/logger.ts for the redaction list.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  /**
   * `trust proxy` for Express. `false` (default) means req.ip is the socket peer
   * and X-Forwarded-For is IGNORED — otherwise any client can forge its IP and
   * escape the per-IP limit. Behind a reverse proxy set this to the proxy's
   * address or CIDR (e.g. "172.18.0.0/16"), never to `true`.
   */
  TRUST_PROXY: z.string().default("false"),

  // --- chains ----------------------------------------------------------------
  /** Chain ids to index. Must be in the SDK address book. */
  INDEX_CHAIN_IDS: csv.default("4663"),
  /** Blocks behind the observed head that are considered final enough to index. */
  INDEX_CONFIRMATIONS: z.coerce.number().int().min(0).default(100),
  /** Trailing blocks re-read (and range-replaced) on every pass. */
  INDEX_REINDEX_WINDOW: z.coerce.number().int().min(0).default(2_000),
  /** Largest single eth_getLogs span. Halved on refusal down to INDEX_MIN_WINDOW. */
  INDEX_MAX_WINDOW: z.coerce.number().int().positive().default(500_000),
  INDEX_MIN_WINDOW: z.coerce.number().int().positive().default(1_000),
  /** How far to rewind, per step, when the checkpoint block's hash changed. */
  INDEX_REORG_REWIND: z.coerce.number().int().positive().default(10_000),
  INDEX_POLL_MS: z.coerce.number().int().min(1_000).default(15_000),
  SNAPSHOT_POLL_MS: z.coerce.number().int().min(5_000).default(60_000),
  GOVERNANCE_POLL_MS: z.coerce.number().int().min(30_000).default(600_000),
  FEEDS_POLL_MS: z.coerce.number().int().min(30_000).default(300_000),
  RPC_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),

  // --- cache -----------------------------------------------------------------
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(15),
  CACHE_PREFIX: z.string().default("latch:api"),
  BULLMQ_PREFIX: z.string().default("latch:jobs"),

  // --- public tier -----------------------------------------------------------
  /** Anonymous requests per minute per client IP. */
  ANON_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /** Default for newly minted keys; each key stores its own. */
  KEY_DEFAULT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  KEY_DEFAULT_MONTHLY_QUOTA: z.coerce.number().int().positive().default(1_000_000),
  /**
   * HMAC pepper for API-key hashes. Required in production. Rotating it
   * invalidates every key, which is the intended effect if it leaks.
   */
  API_KEY_PEPPER: z.string().optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  DEXSCREENER_MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(100_000),

  // --- admin panel -----------------------------------------------------------
  /** Master switch for /v1/admin/*. Off by default: no admin HTTP surface unless asked for. */
  ADMIN_ENABLED: bool("false"),
  /** Exact origins allowed to call /v1/admin with credentials. No wildcard. */
  ADMIN_ORIGINS: csv,
  /** The SIWE `domain` the message must name, e.g. "admin.latch.guru". */
  ADMIN_SIWE_DOMAIN: z.string().optional(),
  /** Chain whose Safe owners / registry curators define admin roles. */
  ADMIN_ROLE_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  /** Addresses granted `viewer`. On-chain roles are never taken from env. */
  ADMIN_VIEWER_ALLOWLIST: csv,
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
  /** Roles are re-read on chain after this many seconds within a session. */
  ADMIN_ROLE_RECHECK_SECONDS: z.coerce.number().int().min(15).max(3_600).default(300),
  ADMIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

  /** Set false for a local http:// admin session. Never false in production. */
  COOKIE_SECURE: bool("true"),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    if (!env.API_KEY_PEPPER || env.API_KEY_PEPPER.length < 32) {
      throw new Error("API_KEY_PEPPER must be set (>= 32 chars) in production.");
    }
    if (env.ADMIN_ENABLED && (env.ADMIN_ORIGINS.length === 0 || !env.ADMIN_SIWE_DOMAIN)) {
      throw new Error("ADMIN_ENABLED requires ADMIN_ORIGINS and ADMIN_SIWE_DOMAIN.");
    }
    if (env.ADMIN_ENABLED && !env.COOKIE_SECURE) {
      throw new Error("COOKIE_SECURE=false is not allowed in production.");
    }
  }
  return env;
}

export const env: Env = parseEnv();
export const isProduction = env.NODE_ENV === "production";

/** Express `trust proxy` value from TRUST_PROXY. */
export function trustProxySetting(raw: string = env.TRUST_PROXY): boolean | string | number {
  const v = raw.trim();
  if (v === "" || v === "false") return false;
  if (v === "true") {
    // Refused: `true` trusts every hop, so X-Forwarded-For is attacker-controlled.
    throw new Error("TRUST_PROXY=true is refused; name the proxy address or CIDR.");
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** The pepper, with a loud development-only fallback. */
export function apiKeyPepper(): string {
  if (env.API_KEY_PEPPER) return env.API_KEY_PEPPER;
  if (isProduction) throw new Error("API_KEY_PEPPER missing");
  return "development-only-pepper-do-not-use-in-production";
}

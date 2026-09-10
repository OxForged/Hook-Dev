import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// `quiet` suppresses dotenv 17's promotional startup banner.
loadDotenv({ quiet: true });

/**
 * Environment contract. Parsed once at boot; anything missing or malformed is a
 * startup failure rather than a surprise at request time.
 *
 * Per-chain RPC URLs are NOT listed here because they are dynamic
 * (`RPC_URL_<chainId>`). They are read through `rpcUrlForChain()` below, and
 * their absence is what keeps the chain-data layer on the fixture provider.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  /// Comma-separated allowed origins, or "*" for any.
  CORS_ORIGINS: z.string().default("*"),

  /// Seconds. 0 disables the response cache entirely.
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
  CACHE_PREFIX: z.string().default("hp:api"),

  /**
   * Which chain-data provider the ingestion pipeline uses.
   *
   *   fixture — deterministic local fixtures. The default, because no
   *             LatchProtocol contract is deployed anywhere yet.
   *   rpc     — real `eth_getLogs` against RPC_URL_<chainId>.
   *   auto    — rpc for any chain that has both an RPC URL and known contract
   *             addresses configured; fixture for the rest.
   */
  CHAIN_PROVIDER: z.enum(["fixture", "rpc", "auto"]).default("fixture"),

  /// Max blocks per eth_getLogs window. Providers differ; 2000 is broadly safe.
  INGEST_BLOCK_RANGE: z.coerce.number().int().positive().max(100_000).default(2_000),
  /// How often the repeatable poll job runs, in milliseconds.
  INGEST_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
  /// Confirmations to stay behind the head by, to avoid reorg churn.
  INGEST_CONFIRMATIONS: z.coerce.number().int().min(0).default(5),
  /// Set false in the API process when the worker runs separately.
  INGEST_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /// Shared secret for POST /api/v1/admin/*. Unset disables those routes.
  ADMIN_TOKEN: z.string().optional(),

  BULLMQ_PREFIX: z.string().default("hp:jobs"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nSee .env.example for the full contract.`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** RPC endpoint for a chain, or undefined when none is configured. */
export function rpcUrlForChain(chainId: number): string | undefined {
  const raw = process.env[`RPC_URL_${chainId}`];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

/** Parsed CORS origin list. `"*"` means allow any origin. */
export function corsOrigins(): string[] | "*" {
  if (env.CORS_ORIGINS.trim() === "*") return "*";
  return env.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

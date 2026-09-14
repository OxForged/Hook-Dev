import pino from "pino";
import { env, isProduction } from "./env.js";

/**
 * Structured logger. Redaction is by path and is the last line of defence, not
 * the first: code never passes a key, cookie, session token, pepper or RPC URL
 * to the logger in the first place (RPC endpoints are logged by host only).
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  "apiKey",
  "secret",
  "token",
  "sessionToken",
  "csrfToken",
  "signature",
  "DATABASE_URL",
  "REDIS_URL",
  "API_KEY_PEPPER",
  "rpcUrl",
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "latch-api" },
  ...(isProduction ? {} : { transport: { target: "pino/file", options: { destination: 1 } } }),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
});

export type Logger = typeof logger;

/** Host of a URL, for logs. Never the path or query, which is where keys live. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

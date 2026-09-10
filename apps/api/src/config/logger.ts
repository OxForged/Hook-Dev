import pino from "pino";
import { env, isProduction } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "latchprotocol-api" },
  // Structured JSON in production; readable lines locally.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "DATABASE_URL", "REDIS_URL"],
    remove: true,
  },
});

export type Logger = typeof logger;

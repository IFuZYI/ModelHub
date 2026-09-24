import pino from "pino";
import { config } from "../config/env";

/**
 * Structured logger. In development uses pretty transport; in production
 * emits JSON lines suitable for log aggregation. Secrets are redacted.
 */
export const logger = pino({
  level: config.logLevel,
  base: { app: "modelhub" },
  redact: {
    paths: [
      "key",
      "*.key",
      "key_enc",
      "*.key_enc",
      "headers.authorization",
      "*.headers.authorization",
    ],
    censor: "[redacted]",
  },
  transport: config.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
      },
});

export type Logger = typeof logger;

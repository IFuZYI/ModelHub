// Vitest global setup: ensure a master key exists before any module that
// imports lib/config/env captures the environment (ESM hoists imports).
process.env.MODELHUB_MASTER_KEY ||= Buffer.alloc(32, 7).toString("base64");

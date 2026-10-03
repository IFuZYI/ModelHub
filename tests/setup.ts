// Vitest global setup: ensure a master key exists before any module that
// imports lib/config/env captures the environment (ESM hoists imports).
process.env.MODELHUB_MASTER_KEY ||= Buffer.alloc(32, 7).toString("base64");

// The importer/probe suites spin up their own mock relay on 127.0.0.1 and
// expect the app to fetch it. Production refuses loopback/private targets by
// default (SSRF guard, lib/infra/http.ts), so tests opt in explicitly — the
// guard's own suite (tests/ssrfGuard.test.ts) exercises the refusal path.
process.env.MODELHUB_ALLOW_PRIVATE_FETCH ||= "true";

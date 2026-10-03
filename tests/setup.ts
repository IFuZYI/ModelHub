// Vitest global setup: make the environment hermetic before any module that
// imports lib/config/env captures it (ESM hoists imports).
//
// Every suite uses an in-memory SQLite database, so the driver must never come
// from the ambient shell. Without this, an operator who happened to `export
// DATABASE_DRIVER=postgres` (e.g. while testing docker-compose) would see the
// whole suite fail with "DATABASE_URL is required" — a false alarm that looks
// like a code regression.
process.env.DATABASE_DRIVER = "sqlite";
delete process.env.DATABASE_URL;

process.env.MODELHUB_MASTER_KEY ||= Buffer.alloc(32, 7).toString("base64");

// The importer/probe suites spin up their own mock relay on 127.0.0.1 and
// expect the app to fetch it. Production refuses loopback/private targets by
// default (SSRF guard, lib/infra/http.ts), so tests opt in explicitly — the
// guard's own suite (tests/ssrfGuard.test.ts) exercises the refusal path.
process.env.MODELHUB_ALLOW_PRIVATE_FETCH ||= "true";

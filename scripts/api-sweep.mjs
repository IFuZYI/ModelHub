#!/usr/bin/env node
/**
 * Full-surface API sweep: auth enforcement, input validation, error shapes.
 * Read-only except where it creates then removes its own probe rows.
 *
 * Usage: node scripts/api-sweep.mjs <baseUrl> <adminUser> <adminPass>
 */
const BASE = process.argv[2] || "http://127.0.0.1:9000";
const USER = process.argv[3] || "admin";
const PASS = process.argv[4] || "12345678";

let cookie = "";
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
    redirect: "manual",
  });
  const setC = res.headers.get("set-cookie");
  if (setC) cookie = setC.split(";")[0];
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}

async function main() {
  // ---- unauthenticated access must be denied ----
  const protectedRoutes = [
    ["GET", "/api/me/providers"],
    ["GET", "/api/me/profile"],
    ["POST", "/api/me/password"],
    ["POST", "/api/me/slug"],
    ["DELETE", "/api/me/slug"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/settings"],
    ["GET", "/api/admin/stats"],
    ["GET", "/api/admin/transfer"],
    ["GET", "/api/admin/transfer/export"],
    ["GET", "/api/admin/invite-codes"],
    ["POST", "/api/admin/invite-codes"],
    ["POST", "/api/admin/transfer/import"],
  ];
  for (const [method, path] of protectedRoutes) {
    const r = await call(path, { method, body: method === "GET" ? undefined : "{}" });
    rec(`anon ${method} ${path} -> 401/403`, [401, 403].includes(r.status), `got ${r.status}`);
  }

  // ---- public routes must work without auth ----
  for (const path of ["/api/health", "/api/auth/status", "/api/providers", "/api/tags", "/api/search?q=x"]) {
    const r = await call(path);
    rec(`public GET ${path} -> 200`, r.status === 200, `got ${r.status}`);
  }

  // ---- login ----
  const badLogin = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: USER, password: "definitely-wrong" }),
  });
  rec("login with wrong password -> 401", badLogin.status === 401, `got ${badLogin.status}`);

  const login = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  rec("login with correct password -> 200", login.status === 200, `got ${login.status}`);
  if (login.status !== 200) { console.log("\nCannot continue without auth."); summary(); return; }

  // ---- malformed input must be 400, never 500 ----
  const badInputs = [
    ["POST", "/api/auth/login", "{}"],
    ["POST", "/api/auth/login", '{"username":123,"password":[]}'],
    ["POST", "/api/auth/register", "{}"],
    ["POST", "/api/providers", '{"name":"","type":"nope","base_url":"not-a-url"}'],
    ["POST", "/api/providers", '{"name":"x","type":"newapi","base_url":"ftp://x.com"}'],
    ["PUT", "/api/admin/settings", "{}"],
    ["PUT", "/api/admin/settings", '{"aff_blank_policy":"bogus"}'],
    ["PUT", "/api/admin/settings", '{"smtp_port":99999999}'],
    ["POST", "/api/admin/invite-codes", "{}"],
    ["POST", "/api/admin/invite-codes", '{"base_url":"https://x.com","code":"RANDOM"}'],
    ["POST", "/api/providers/import", '{"url":"not-a-url"}'],
    ["POST", "/api/providers/import", '{"url":"ftp://x.com"}'],
    ["POST", "/api/me/password", "{}"],
    ["PUT", "/api/me/profile", '{"bio":123}'],
  ];
  for (const [method, path, body] of badInputs) {
    const r = await call(path, { method, body });
    rec(`${method} ${path} bad-input -> 400 (not 500)`, r.status === 400, `got ${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
  }

  // ---- malformed JSON body ----
  const malformed = await call("/api/auth/login", { method: "POST", body: "{not json" });
  rec("malformed JSON body -> 400", malformed.status === 400, `got ${malformed.status}`);

  // ---- 404s for unknown ids ----
  const unknownId = "00000000-0000-4000-8000-000000000000";
  for (const path of [`/api/providers/${unknownId}`, `/api/pages/no-such-slug-xyz`]) {
    const r = await call(path);
    rec(`GET ${path} unknown -> 404`, r.status === 404, `got ${r.status}`);
  }
  const delUnknown = await call(`/api/providers/${unknownId}`, { method: "DELETE" });
  rec("DELETE unknown provider -> 404", delUnknown.status === 404, `got ${delUnknown.status}`);

  // ---- non-uuid id must not 500 ----
  const badId = await call("/api/providers/not-a-uuid");
  rec("GET provider with non-uuid id -> 404 (not 500)", badId.status === 404, `got ${badId.status}`);

  // ---- unknown admin sub-resource id ----
  const delCode = await call(`/api/admin/invite-codes/${unknownId}`, { method: "DELETE" });
  rec("DELETE unknown invite code -> 200/404 (not 500)", [200, 404].includes(delCode.status), `got ${delCode.status}`);

  // ---- admin/users validation ----
  const dupUser = await call("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username: "admin", password: "password123", role: "user" }),
  });
  rec("create duplicate username -> 400/409 (not 500)", [400, 409].includes(dupUser.status), `got ${dupUser.status}`);

  const shortPw = await call("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({ username: "zz_probe", password: "1", role: "user" }),
  });
  rec("create user with short password -> 400", shortPw.status === 400, `got ${shortPw.status}`);

  // ---- method not allowed ----
  const wrongMethod = await call("/api/auth/login", { method: "GET" });
  rec("GET on POST-only route -> 405 (not 500)", [405, 404].includes(wrongMethod.status), `got ${wrongMethod.status}`);

  summary();
}

function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const f of failed) console.log(`  - ${f.name}  (${f.detail})`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("SWEEP ERROR:", e); process.exit(2); });

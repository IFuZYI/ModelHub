import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.MODELHUB_FETCH_TIMEOUT_MS = "2000";

const { importNewapiSite, NEWAPI_FALLBACK_ICON } = await import(
  "@/lib/services/importer"
);

// Local newapi-style site: /api/status returns { data: { system_name, logo } }.
let server: http.Server;
let base = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.endsWith("/api/status")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          data: {
            system_name: "Cat API",
            logo: "/logo.png",
            password_register_enabled: true,
            register_enabled: true,
            email_verification: true,
            github_oauth: true,
            linuxdo_oauth: true,
            discord_oauth: false,
          },
        })
      );
    }
    res.writeHead(404);
    res.end("x");
  });
  await new Promise<void>((r) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      r();
    })
  );
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("importNewapiSite", () => {
  it("reads system_name and parses aff from a sign-up URL", async () => {
    const r = await importNewapiSite(`${base}/sign-up?aff=dl7w`);
    expect(r.name).toBe("Cat API");
    expect(r.base_url).toBe(base); // origin only, path stripped
    expect(r.aff_code).toBe("dl7w");
    expect(r.reachable).toBe(true);
  });

  it("resolves a site-relative logo to an absolute icon URL", async () => {
    const r = await importNewapiSite(`${base}/`);
    expect(r.icon).toBe(`${base}/logo.png`);
  });

  it("falls back to {origin}/logo.png when the site has no logo configured", async () => {
    // Site whose /api/status omits `logo` — should still get the convention default.
    const noLogo = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ success: true, data: { system_name: "No Logo" } })
        );
      }
      if (req.url?.endsWith("/logo.png")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end("PNG");
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => noLogo.listen(0, "127.0.0.1", () => r()));
    const nlBase = `http://127.0.0.1:${(noLogo.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${nlBase}/`);
      expect(r.icon).toBe(`${nlBase}/logo.png`);
    } finally {
      await new Promise<void>((r) => noLogo.close(() => r()));
    }
  });

  it("skips {origin}/logo.png when it is an SPA catch-all (HTML) and uses the newapi mark", async () => {
    // Many newapi frontends answer EVERY path with their SPA shell: HTTP 200
    // with text/html. Blindly trusting /logo.png yields a broken avatar.
    const spa = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: { system_name: "SPA Site", logo: "" },
          })
        );
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html></html>");
    });
    await new Promise<void>((r) => spa.listen(0, "127.0.0.1", () => r()));
    const spaBase = `http://127.0.0.1:${(spa.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${spaBase}/`);
      expect(r.icon).toBe(NEWAPI_FALLBACK_ICON);
    } finally {
      await new Promise<void>((r) => spa.close(() => r()));
    }
  });

  it("prefers a configured logo over the convention default", async () => {
    const custom = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: {
              system_name: "Custom",
              logo: "https://cdn.example.com/my-logo.png",
            },
          })
        );
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => custom.listen(0, "127.0.0.1", () => r()));
    const cBase = `http://127.0.0.1:${(custom.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${cBase}/`);
      // The configured logo is used without a reachability probe (it is
      // authoritative when the site set it explicitly).
      expect(r.icon).toBe("https://cdn.example.com/my-logo.png");
    } finally {
      await new Promise<void>((r) => custom.close(() => r()));
    }
  });

  it("resolves a site-relative configured logo against the origin", async () => {
    const rel = http.createServer((req, res) => {
      if (req.url?.endsWith("/api/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: { system_name: "Rel", logo: "/assets/l.png" },
          })
        );
      }
      if (req.url?.endsWith("/assets/l.png")) {
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end("PNG");
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => rel.listen(0, "127.0.0.1", () => r()));
    const rBase = `http://127.0.0.1:${(rel.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${rBase}/`);
      expect(r.icon).toBe(`${rBase}/assets/l.png`);
    } finally {
      await new Promise<void>((r) => rel.close(() => r()));
    }
  });

  it("detects sign-up / login methods from /api/status", async () => {
    const r = await importNewapiSite(`${base}/`);
    expect(r.register_methods).toContain("密码注册（需邮箱验证）");
    expect(r.register_methods).toContain("GitHub");
    expect(r.register_methods).toContain("LinuxDO");
    expect(r.register_methods).not.toContain("Discord");
  });

  it("returns null aff when absent, still resolves name", async () => {
    const r = await importNewapiSite(`${base}/`);
    expect(r.name).toBe("Cat API");
    expect(r.aff_code).toBeNull();
    expect(r.reachable).toBe(true);
  });

  it("is best-effort when /api/status is unreachable", async () => {
    // valid URL, but a port with no server → fetch fails
    const r = await importNewapiSite("http://127.0.0.1:1/x?aff=Z");
    expect(r.base_url).toBe("http://127.0.0.1:1");
    expect(r.aff_code).toBe("Z");
    expect(r.reachable).toBe(false);
    expect(r.name).toBeNull();
  });

  it("passes an ESA acw challenge: retries with the solved cookie and reads the real payload", async () => {
    // Real challenge body captured from anyrouter.top (see fixtures). The mock
    // site serves it until the request carries the correct acw_sc__v2 cookie —
    // exactly what the live WAF does — then returns the normal JSON.
    const challenge = readFileSync(
      join(ROOT, "tests/fixtures/acw-challenge-1.html"),
      "utf8"
    );
    const expectedCookie = "6ac21bd3de4e480b2df6aefeeab09f2aedea0666";
    let cookieSeen: string | null = null;
    const guarded = http.createServer((req, res) => {
      const cookie = req.headers.cookie ?? "";
      if (req.url?.endsWith("/api/status")) {
        if (!cookie.includes(`acw_sc__v2=${expectedCookie}`)) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        cookieSeen = cookie;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: { system_name: "Challenged API" },
          })
        );
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => guarded.listen(0, "127.0.0.1", () => r()));
    const gBase = `http://127.0.0.1:${(guarded.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${gBase}/?aff=Q`);
      expect(cookieSeen).not.toBeNull(); // the retry carried the solved cookie
      expect(r.reachable).toBe(true);
      expect(r.name).toBe("Challenged API");
      expect(r.aff_code).toBe("Q");
    } finally {
      await new Promise<void>((r) => guarded.close(() => r()));
    }
  });

  it("stays best-effort when a challenge cannot be solved", async () => {
    // A challenge-shaped page with no arg1 seed: the solver returns null and
    // the importer must keep the pre-existing best-effort result, not throw.
    const unsolvable = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><script>var arg1='not-hex';</script></html>");
    });
    await new Promise<void>((r) =>
      unsolvable.listen(0, "127.0.0.1", () => r())
    );
    const uBase = `http://127.0.0.1:${(unsolvable.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${uBase}/?aff=U`);
      expect(r.base_url).toBe(uBase);
      expect(r.aff_code).toBe("U");
      expect(r.reachable).toBe(false);
      expect(r.name).toBeNull();
    } finally {
      await new Promise<void>((r) => unsolvable.close(() => r()));
    }
  });

  it("reuses the solved challenge cookie for the icon probe", async () => {
    // Live anyrouter.top behaviour: without the cookie, /logo.png answers a
    // 307 redirect to itself (an infinite loop the fetch layer aborts);
    // with it, the real PNG. The importer must reuse the cookie it solved.
    const challenge = readFileSync(
      join(ROOT, "tests/fixtures/acw-challenge-1.html"),
      "utf8"
    );
    const expectedCookie = "6ac21bd3de4e480b2df6aefeeab09f2aedea0666";
    const site = http.createServer((req, res) => {
      const ok = (req.headers.cookie ?? "").includes(
        `acw_sc__v2=${expectedCookie}`
      );
      if (req.url?.endsWith("/api/status")) {
        if (!ok) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end(challenge);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({
            success: true,
            data: { system_name: "Icon Site", logo: "" },
          })
        );
      }
      if (req.url?.endsWith("/logo.png")) {
        if (!ok) {
          res.writeHead(307, { Location: "/logo.png" });
          return res.end();
        }
        res.writeHead(200, { "Content-Type": "image/png" });
        return res.end("PNG");
      }
      res.writeHead(404);
      res.end("x");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const sBase = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
    try {
      const r = await importNewapiSite(`${sBase}/`);
      expect(r.icon).toBe(`${sBase}/logo.png`);
      expect(r.name).toBe("Icon Site");
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });

  it("rejects a non-http URL", async () => {
    await expect(importNewapiSite("ftp://x.com")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects garbage input", async () => {
    await expect(importNewapiSite("not a url")).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 7).toString("base64");
process.env.MODELHUB_FETCH_TIMEOUT_MS = "2000";

const { importNewapiSite } = await import("@/lib/services/importer");

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

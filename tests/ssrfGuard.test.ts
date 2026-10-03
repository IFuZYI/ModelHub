import { afterEach, describe, expect, it, vi } from "vitest";
import { isBlockedHost } from "@/lib/infra/http";
import type { AppError } from "@/lib/domain/errors";

/**
 * SSRF guard: any outbound fetch to a user-supplied URL (site import, provider
 * refresh, model probe) must not reach loopback, private ranges, link-local
 * (cloud metadata 169.254.169.254), or other non-public addresses.
 *
 * isBlockedHost is pure, so those cases run directly. assertSafeUrl consults
 * the operator opt-in (MODELHUB_ALLOW_PRIVATE_FETCH), so those cases re-import
 * the module with the flag forced OFF — the default an operator gets.
 */

async function guardWithPrivateFetch(allowed: boolean) {
  vi.resetModules();
  vi.stubEnv("MODELHUB_ALLOW_PRIVATE_FETCH", allowed ? "true" : "false");
  return import("@/lib/infra/http");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isBlockedHost", () => {
  it("blocks loopback in every spelling", () => {
    for (const h of [
      "127.0.0.1",
      "127.1.2.3",
      "127.255.255.255",
      "localhost",
      "LOCALHOST",
      "app.localhost",
      "::1",
      "[::1]",
      "0.0.0.0",
      "0",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks private and link-local ranges", () => {
    for (const h of [
      "10.0.0.5",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "169.254.0.1",
      "100.64.0.1", // CGNAT
      "fc00::1",
      "fe80::1",
      "fd12:3456::1",
    ]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("allows ordinary public hosts", () => {
    for (const h of [
      "api.openai.com",
      "example.com",
      "8.8.8.8",
      "1.1.1.1",
      "2606:4700:4700::1111",
      "172.32.0.1", // just outside 172.16/12
      "11.0.0.1",
    ]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });
});

describe("assertSafeUrl (default: private fetch refused)", () => {
  it("rejects a URL pointing at an internal address with a VALIDATION error", async () => {
    const { assertSafeUrl } = await guardWithPrivateFetch(false);
    expect(() => assertSafeUrl("http://127.0.0.1:9876/status")).toThrow();
    try {
      assertSafeUrl("http://169.254.169.254/latest/meta-data/");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("VALIDATION");
    }
  });

  it("rejects non-http(s) schemes", async () => {
    const { assertSafeUrl } = await guardWithPrivateFetch(false);
    for (const u of ["ftp://example.com", "file:///etc/passwd", "gopher://x"]) {
      expect(() => assertSafeUrl(u), u).toThrow();
    }
  });

  it("accepts an ordinary public http(s) URL", async () => {
    const { assertSafeUrl } = await guardWithPrivateFetch(false);
    expect(() => assertSafeUrl("https://api.example.com/v1")).not.toThrow();
  });
});

describe("assertSafeUrl (operator opt-in allows private targets)", () => {
  it("permits loopback when MODELHUB_ALLOW_PRIVATE_FETCH is on", async () => {
    const { assertSafeUrl } = await guardWithPrivateFetch(true);
    expect(() => assertSafeUrl("http://127.0.0.1:9000/api/status")).not.toThrow();
  });
});

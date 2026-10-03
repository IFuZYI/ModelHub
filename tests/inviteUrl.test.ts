import { describe, it, expect } from "vitest";
import { buildInviteUrl, normalizeBaseUrl } from "@/lib/domain/provider";

describe("buildInviteUrl", () => {
  it("uses base_url as-is (canonical URL) when no aff code", () => {
    expect(buildInviteUrl("https://openai.com", null)).toBe(
      "https://openai.com"
    );
  });

  it("keeps a deep path (e.g. a product/console page)", () => {
    expect(
      buildInviteUrl("https://www.volcengine.com/product/ark", null)
    ).toBe("https://www.volcengine.com/product/ark");
  });

  it("strips a trailing slash", () => {
    expect(buildInviteUrl("https://x.ai/", null)).toBe("https://x.ai");
  });

  it("appends aff, url-encoding the code", () => {
    expect(buildInviteUrl("https://site.example.com", "a b/c")).toBe(
      "https://site.example.com?aff=a%20b%2Fc"
    );
  });

  it("uses & as separator when the url already has a query", () => {
    expect(buildInviteUrl("https://site.example.com?x=1", "K")).toBe(
      "https://site.example.com?x=1&aff=K"
    );
  });

  it("REPLACES an existing aff param instead of appending a duplicate", () => {
    // Duplicate ?aff= params are undefined behaviour on the relay: if it reads
    // the first one the pool draw silently never takes effect.
    expect(
      buildInviteUrl("https://site.example.com/sign-up?aff=OLD", "NEW")
    ).toBe("https://site.example.com/sign-up?aff=NEW");
    // …and the other params survive.
    expect(
      buildInviteUrl("https://site.example.com/?aff=OLD&x=1", "NEW")
    ).toBe("https://site.example.com/?aff=NEW&x=1");
  });

  it("does not leave a stray separator when the query is empty", () => {
    expect(buildInviteUrl("https://site.example.com/?", "K")).toBe(
      "https://site.example.com/?aff=K"
    );
  });

  it("leaves a URL without aff alone when replacing", () => {
    expect(buildInviteUrl("https://site.example.com?a=1", "K")).toBe(
      "https://site.example.com?a=1&aff=K"
    );
  });
});

describe("normalizeBaseUrl trailing-dot (FQDN root) handling", () => {
  it("strips the trailing dot so both spellings share one pool scope", () => {
    // WHATWG keeps the root dot; without stripping it one physical relay
    // becomes two isolated scopes and registered codes are silently missed.
    expect(normalizeBaseUrl("https://api.x.com./v1")).toBe(
      normalizeBaseUrl("https://api.x.com/v1")
    );
    expect(normalizeBaseUrl("https://api.x.com./v1")).toBe(
      "https://api.x.com"
    );
  });

  it("still normalizes the usual spellings to one form", () => {
    const expected = "https://api.x.com";
    for (const raw of [
      "https://api.x.com",
      "https://API.X.COM/",
      "https://api.x.com:443",
      "https://api.x.com/v1",
      "HTTPS://API.X.COM:443/V1",
    ]) {
      expect(normalizeBaseUrl(raw), raw).toBe(expected);
    }
  });
});

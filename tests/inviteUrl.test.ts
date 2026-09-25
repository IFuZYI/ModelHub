import { describe, it, expect } from "vitest";
import { buildInviteUrl } from "@/lib/domain/provider";

describe("buildInviteUrl", () => {
  it("appends aff to the origin, stripping /v1 path", () => {
    expect(buildInviteUrl("https://newapi.example.com/v1", "ABC123")).toBe(
      "https://newapi.example.com?aff=ABC123"
    );
  });

  it("returns the origin with no aff when code is null", () => {
    expect(buildInviteUrl("https://api.openai.com/v1", null)).toBe(
      "https://api.openai.com"
    );
  });

  it("url-encodes the aff code", () => {
    expect(buildInviteUrl("https://x.com/v1", "a b/c")).toBe(
      "https://x.com?aff=a%20b%2Fc"
    );
  });

  it("falls back to raw base_url when unparseable", () => {
    expect(buildInviteUrl("not-a-url", "Z")).toBe("not-a-url?aff=Z");
  });

  it("keeps port in origin", () => {
    expect(buildInviteUrl("http://127.0.0.1:3000/v1", "K")).toBe(
      "http://127.0.0.1:3000?aff=K"
    );
  });

  it("prefers an explicit site_url over the base_url origin", () => {
    // Official platforms link to their website, not the API endpoint.
    expect(
      buildInviteUrl("https://api.openai.com", null, "https://openai.com")
    ).toBe("https://openai.com");
  });

  it("keeps a deep site_url path (e.g. a product page)", () => {
    expect(
      buildInviteUrl(
        "https://ark.cn-beijing.volces.com/api/v3",
        null,
        "https://www.volcengine.com/product/ark"
      )
    ).toBe("https://www.volcengine.com/product/ark");
  });

  it("falls back to base_url origin when site_url is empty", () => {
    expect(buildInviteUrl("https://api.example.com/v1", null, "")).toBe(
      "https://api.example.com"
    );
  });

  it("appends aff to the site_url when both are set", () => {
    expect(
      buildInviteUrl("https://relay.example.com", "ABC", "https://brand.com")
    ).toBe("https://brand.com?aff=ABC");
  });
});

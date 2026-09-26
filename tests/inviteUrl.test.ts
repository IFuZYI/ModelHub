import { describe, it, expect } from "vitest";
import { buildInviteUrl } from "@/lib/domain/provider";

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
});

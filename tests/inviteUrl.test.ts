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
});

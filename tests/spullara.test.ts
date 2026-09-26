import { describe, it, expect } from "vitest";
import {
  spullaraAdapter,
  SPULLARA_BASE_URL,
  spullaraUrl,
} from "@/lib/upstream/spullara";
import { getAdapter, listAdapters } from "@/lib/upstream";

describe("spullaraAdapter", () => {
  it("is registered and resolvable by id", () => {
    expect(listAdapters().some((a) => a.id === "spullara")).toBe(true);
    expect(getAdapter("spullara").id).toBe("spullara");
  });

  it("builds the raw <slug>.txt url for a bare slug", () => {
    expect(spullaraUrl("openai")).toBe(`${SPULLARA_BASE_URL}/openai.txt`);
    const [attempt] = spullaraAdapter.buildAttempts("", null, {
      catalogSlug: "grok",
    });
    expect(attempt.request.url).toBe(`${SPULLARA_BASE_URL}/grok.txt`);
  });

  it("uses a full URL verbatim (custom text model interface)", () => {
    const custom = "https://example.com/my-models.txt";
    const [attempt] = spullaraAdapter.buildAttempts("", null, {
      catalogSlug: custom,
    });
    expect(attempt.request.url).toBe(custom);
  });

  it("parses newline-delimited model ids via parseText", () => {
    const [attempt] = spullaraAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    const body = "gpt-4o\n gpt-5.6 \n\n# comment\no3\ngpt-4o\n";
    expect(attempt.parseText!(body)).toEqual(["gpt-4o", "gpt-5.6", "o3"]);
  });

  it("parse() (JSON path) is unused and throws", () => {
    const [attempt] = spullaraAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(() => attempt.parse({})).toThrow(/text response/);
  });

  it("parseText throws when slug missing or body empty", () => {
    const [noSlug] = spullaraAdapter.buildAttempts("", null, {});
    expect(() => noSlug.parseText!("gpt-4o")).toThrow(/requires a slug/);
    const [attempt] = spullaraAdapter.buildAttempts("", null, {
      catalogSlug: "openai",
    });
    expect(() => attempt.parseText!("\n\n")).toThrow(/no models/);
  });
});

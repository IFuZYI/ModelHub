import { describe, it, expect } from "vitest";
import {
  createProviderSchema,
  updateProviderSchema,
} from "@/lib/domain/validation";

describe("createProviderSchema", () => {
  it("accepts a valid payload", () => {
    const r = createProviderSchema.safeParse({
      name: "My OpenAI",
      type: "native",
      base_url: "https://api.openai.com/v1",
      key: "sk-abc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a payload WITHOUT a key (public pricing newapi)", () => {
    const r = createProviderSchema.safeParse({
      name: "Public Relay",
      type: "newapi",
      base_url: "https://relay.example.com",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-http base_url", () => {
    const r = createProviderSchema.safeParse({
      name: "x",
      type: "newapi",
      base_url: "ftp://nope",
      key: "k",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const r = createProviderSchema.safeParse({
      name: "x",
      type: "bogus",
      base_url: "https://a.com",
      key: "k",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty name", () => {
    const r = createProviderSchema.safeParse({
      name: "  ",
      type: "newapi",
      base_url: "https://a.com",
      key: "k",
    });
    expect(r.success).toBe(false);
  });
});

describe("updateProviderSchema", () => {
  it("allows partial update", () => {
    const r = updateProviderSchema.safeParse({ name: "renamed" });
    expect(r.success).toBe(true);
  });

  it("rejects empty object", () => {
    const r = updateProviderSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

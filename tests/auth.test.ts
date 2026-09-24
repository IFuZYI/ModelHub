import { describe, it, expect } from "vitest";

process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 3).toString("base64");
process.env.MODELHUB_ADMIN_PASSWORD = "s3cret-pw";

const { verifyPassword, createToken, verifyToken } = await import(
  "@/lib/services/auth"
);

describe("auth", () => {
  it("verifies the correct password", () => {
    expect(verifyPassword("s3cret-pw")).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
  });

  it("issues and validates a session token", () => {
    const token = createToken();
    expect(verifyToken(token)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = createToken();
    const tampered = token.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    expect(verifyToken(tampered)).toBe(false);
  });

  it("rejects an expired token", () => {
    // craft a token whose expiry is in the past
    const past = createToken(Date.now() - 999_999_999);
    expect(verifyToken(past)).toBe(false);
  });

  it("rejects empty/garbage", () => {
    expect(verifyToken(undefined)).toBe(false);
    expect(verifyToken("garbage")).toBe(false);
  });
});

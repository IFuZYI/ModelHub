import { describe, it, expect, beforeEach } from "vitest";

// master key must be set before importing crypto (config reads env at import)
process.env.MODELHUB_MASTER_KEY =
  process.env.MODELHUB_MASTER_KEY || Buffer.alloc(32, 7).toString("base64");

const { encrypt, decrypt, _resetKeyCache } = await import("@/lib/infra/crypto");

describe("crypto", () => {
  beforeEach(() => _resetKeyCache());

  it("round-trips a value", () => {
    const enc = encrypt("sk-secret-123");
    expect(enc.v).toBe(1);
    expect(enc.ct).not.toContain("sk-secret-123");
    expect(decrypt(enc)).toBe("sk-secret-123");
  });

  it("produces distinct IVs / ciphertext for same input", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("fails to decrypt tampered ciphertext", () => {
    const enc = encrypt("hello");
    const tampered = { ...enc, ct: Buffer.from("garbage").toString("base64") };
    expect(() => decrypt(tampered)).toThrowError(/decrypt/i);
  });
});

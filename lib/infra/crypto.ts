import crypto from "crypto";
import { config } from "../config/env";
import { AppError } from "../domain/errors";

/**
 * AES-256-GCM encryption for provider API keys.
 * Master key comes from config (env), decoded once and cached.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }
  if (key.length !== KEY_BYTES) {
    throw AppError.config(
      `MODELHUB_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  return key;
}

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (!config.masterKey) {
    throw AppError.config(
      "MODELHUB_MASTER_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  cachedKey = decodeKey(config.masterKey);
  return cachedKey;
}

export interface EncryptedValue {
  v: 1;
  iv: string;
  ct: string;
  tag: string;
}

export function encrypt(plain: string): EncryptedValue {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decrypt(enc: EncryptedValue): string {
  const key = getMasterKey();
  try {
    const decipher = crypto.createDecipheriv(
      ALGO,
      key,
      Buffer.from(enc.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(enc.ct, "base64")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext — never leak crypto internals.
    throw AppError.crypto(
      "Failed to decrypt stored key (wrong master key or corrupted data)"
    );
  }
}

/** Validate configuration at startup; throws AppError.config on failure. */
export function assertMasterKey(): void {
  getMasterKey();
}

/** For tests: clear the cached key so a new env value takes effect. */
export function _resetKeyCache(): void {
  cachedKey = null;
}

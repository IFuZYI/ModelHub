import { getDatabase } from "../infra/db";
import { SettingsRepository } from "../infra/repositories/settingsRepo";
import type { AffBlankPolicy } from "../domain/provider";

/**
 * System settings (ADR-0012). Non-secret values are JSON; the SMTP password is
 * stored encrypted and never returned in the public settings view.
 */

export type KeyShareConsumers = "admin" | "everyone";

export interface PublicSettings {
  registration_enabled: boolean;
  email_verification_required: boolean;
  email_domain_whitelist: string[];
  personal_pages_enabled: boolean;
  key_share_enabled: boolean;
  key_share_consumers: KeyShareConsumers;
  /** What a blank 邀请码 aff means: "none" (no code) or "random" (draw). */
  aff_blank_policy: AffBlankPolicy;
  smtp_host: string;
  smtp_port: number | null;
  smtp_username: string;
  smtp_from: string;
  /** True when an SMTP password is stored (never the value itself). */
  smtp_password_set: boolean;
}

const DEFAULTS: Omit<PublicSettings, "smtp_password_set"> = {
  registration_enabled: false,
  email_verification_required: false,
  email_domain_whitelist: [],
  personal_pages_enabled: false,
  key_share_enabled: false,
  key_share_consumers: "admin",
  aff_blank_policy: "none",
  smtp_host: "",
  smtp_port: null,
  smtp_username: "",
  smtp_from: "",
};

const SMTP_PASSWORD_KEY = "smtp_password";

export interface SettingsPatch {
  registration_enabled?: boolean;
  email_verification_required?: boolean;
  email_domain_whitelist?: string[];
  personal_pages_enabled?: boolean;
  key_share_enabled?: boolean;
  key_share_consumers?: KeyShareConsumers;
  aff_blank_policy?: AffBlankPolicy;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from?: string;
}

export class SettingsService {
  private readonly repo: SettingsRepository;
  constructor(repo: SettingsRepository = new SettingsRepository(getDatabase())) {
    this.repo = repo;
  }

  async getPublic(): Promise<PublicSettings> {
    const [
      registration_enabled,
      email_verification_required,
      email_domain_whitelist,
      personal_pages_enabled,
      key_share_enabled,
      key_share_consumers,
      aff_blank_policy,
      smtp_host,
      smtp_port,
      smtp_username,
      smtp_from,
      smtpPassword,
    ] = await Promise.all([
      this.repo.get("registration_enabled", DEFAULTS.registration_enabled),
      this.repo.get(
        "email_verification_required",
        DEFAULTS.email_verification_required
      ),
      this.repo.get("email_domain_whitelist", DEFAULTS.email_domain_whitelist),
      this.repo.get("personal_pages_enabled", DEFAULTS.personal_pages_enabled),
      this.repo.get("key_share_enabled", DEFAULTS.key_share_enabled),
      this.repo.get<KeyShareConsumers>(
        "key_share_consumers",
        DEFAULTS.key_share_consumers
      ),
      this.repo.get<AffBlankPolicy>(
        "aff_blank_policy",
        DEFAULTS.aff_blank_policy
      ),
      this.repo.get("smtp_host", DEFAULTS.smtp_host),
      this.repo.get<number | null>("smtp_port", DEFAULTS.smtp_port),
      this.repo.get("smtp_username", DEFAULTS.smtp_username),
      this.repo.get("smtp_from", DEFAULTS.smtp_from),
      this.repo.getSecret(SMTP_PASSWORD_KEY),
    ]);
    return {
      registration_enabled,
      email_verification_required,
      email_domain_whitelist,
      personal_pages_enabled,
      key_share_enabled,
      key_share_consumers,
      aff_blank_policy,
      smtp_host,
      smtp_port,
      smtp_username,
      smtp_from,
      smtp_password_set: smtpPassword !== null,
    };
  }

  /** Blank-aff policy on its own (hot path: read per public page render). */
  async getAffBlankPolicy(): Promise<AffBlankPolicy> {
    return this.repo.get<AffBlankPolicy>(
      "aff_blank_policy",
      DEFAULTS.aff_blank_policy
    );
  }

  /**
   * Personal-page switch on its own (hot path: read per public page render).
   * ADR-0012: when off, existing pages are closed and no new slug is assigned.
   */
  async getPersonalPagesEnabled(): Promise<boolean> {
    return this.repo.get(
      "personal_pages_enabled",
      DEFAULTS.personal_pages_enabled
    );
  }

  async update(patch: SettingsPatch): Promise<PublicSettings> {
    const entries: Array<[string, unknown]> = [];
    if (patch.registration_enabled !== undefined)
      entries.push(["registration_enabled", patch.registration_enabled]);
    if (patch.email_verification_required !== undefined)
      entries.push([
        "email_verification_required",
        patch.email_verification_required,
      ]);
    if (patch.email_domain_whitelist !== undefined)
      entries.push(["email_domain_whitelist", patch.email_domain_whitelist]);
    if (patch.personal_pages_enabled !== undefined)
      entries.push(["personal_pages_enabled", patch.personal_pages_enabled]);
    if (patch.key_share_enabled !== undefined)
      entries.push(["key_share_enabled", patch.key_share_enabled]);
    if (patch.key_share_consumers !== undefined)
      entries.push(["key_share_consumers", patch.key_share_consumers]);
    if (patch.aff_blank_policy !== undefined)
      entries.push(["aff_blank_policy", patch.aff_blank_policy]);
    if (patch.smtp_host !== undefined) entries.push(["smtp_host", patch.smtp_host]);
    if (patch.smtp_port !== undefined) entries.push(["smtp_port", patch.smtp_port]);
    if (patch.smtp_username !== undefined)
      entries.push(["smtp_username", patch.smtp_username]);
    if (patch.smtp_from !== undefined) entries.push(["smtp_from", patch.smtp_from]);

    for (const [key, value] of entries) await this.repo.set(key, value);
    // SMTP password is a secret: encrypt, or clear when an empty string is sent.
    if (patch.smtp_password !== undefined) {
      await this.repo.setSecret(SMTP_PASSWORD_KEY, patch.smtp_password);
    }
    return this.getPublic();
  }

  /** Full SMTP config incl. decrypted password, for the mailer only. */
  async smtpConfig(): Promise<{
    host: string;
    port: number | null;
    username: string;
    password: string | null;
    from: string;
  }> {
    const s = await this.getPublic();
    return {
      host: s.smtp_host,
      port: s.smtp_port,
      username: s.smtp_username,
      password: await this.repo.getSecret(SMTP_PASSWORD_KEY),
      from: s.smtp_from,
    };
  }
}

export const settingsService = new SettingsService();

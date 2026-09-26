import { z } from "zod";
import { AppError } from "../domain/errors";
import { fetchWithTimeout } from "../infra/http";

/**
 * Quick-import for newapi-style relay sites. Given any URL on the site
 * (home page, sign-up link with ?aff=..., a /v1 base, etc.) this:
 *   - derives the site origin as the provider base_url,
 *   - pulls the invite/referral code from the `aff` query param if present,
 *   - fetches {origin}/api/status and reads data.system_name for a nice name.
 *
 * The status probe is best-effort: if the site is down or not a newapi site,
 * we still return base_url + aff_code so the admin can finish manually.
 */

// newapi GetStatus returns { success, data: { system_name, logo, + auth flags } }.
const statusSchema = z.object({
  data: z
    .object({
      system_name: z.string().optional(),
      logo: z.string().optional(),
      // registration / login method flags (all optional, best-effort)
      password_register_enabled: z.boolean().optional(),
      register_enabled: z.boolean().optional(),
      email_verification: z.boolean().optional(),
      github_oauth: z.boolean().optional(),
      discord_oauth: z.boolean().optional(),
      linuxdo_oauth: z.boolean().optional(),
      telegram_oauth: z.boolean().optional(),
      wechat_login: z.boolean().optional(),
      oidc_enabled: z.boolean().optional(),
      passkey_login: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
});

/** Human-readable labels for each detected sign-up / login method. */
function extractRegisterMethods(
  data: Record<string, unknown> | undefined
): string[] {
  if (!data) return [];
  const out: string[] = [];
  const on = (k: string) => data[k] === true;
  // Password registration: on unless explicitly disabled; email verification
  // is a modifier shown alongside.
  const passwordReg =
    data.password_register_enabled !== false && data.register_enabled !== false;
  if (passwordReg) {
    out.push(on("email_verification") ? "密码注册（需邮箱验证）" : "密码注册");
  }
  if (on("github_oauth")) out.push("GitHub");
  if (on("discord_oauth")) out.push("Discord");
  if (on("linuxdo_oauth")) out.push("LinuxDO");
  if (on("telegram_oauth")) out.push("Telegram");
  if (on("wechat_login")) out.push("微信");
  if (on("oidc_enabled")) out.push("OIDC");
  if (on("passkey_login")) out.push("Passkey");
  if (data.register_enabled === false) return ["注册已关闭"];
  return out;
}

export interface NewapiImportResult {
  /** system_name from /api/status, or null when unavailable. */
  name: string | null;
  /** Site origin, used as the provider base_url. */
  base_url: string;
  /** Referral code parsed from ?aff=, or null. */
  aff_code: string | null;
  /** Site logo URL from /api/status (absolute), or null. */
  icon: string | null;
  /** Detected sign-up / login methods (labels), empty when unknown. */
  register_methods: string[];
  /** Whether the /api/status probe succeeded (i.e. looks like a newapi site). */
  reachable: boolean;
}

export async function importNewapiSite(
  rawUrl: string
): Promise<NewapiImportResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw AppError.validation("请输入有效的站点 URL（含 http/https）");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw AppError.validation("URL 必须以 http:// 或 https:// 开头");
  }

  const base_url = parsed.origin;
  const rawAff = parsed.searchParams.get("aff");
  const aff_code = rawAff && rawAff.trim().length ? rawAff.trim() : null;

  let name: string | null = null;
  let icon: string | null = null;
  let register_methods: string[] = [];
  let reachable = false;
  try {
    const res = await fetchWithTimeout(`${base_url}/api/status`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const p = statusSchema.safeParse(json);
      if (p.success) {
        reachable = true;
        const sn = p.data.data?.system_name?.trim();
        name = sn && sn.length ? sn : null;
        // logo may be absolute (https://...) or site-relative (/logo.png).
        // When a site hasn't configured its own logo, newapi serves the
        // convention default at {origin}/logo.png — fall back to that so the
        // avatar still renders instead of the name initial.
        const rawLogo = p.data.data?.logo?.trim();
        const logoRef = rawLogo && rawLogo.length ? rawLogo : "/logo.png";
        try {
          icon = new URL(logoRef, base_url).href;
        } catch {
          icon = null;
        }
        register_methods = extractRegisterMethods(
          p.data.data as Record<string, unknown> | undefined
        );
      }
    }
  } catch {
    // best-effort: leave fields null / reachable false
  }

  return { name, base_url, aff_code, icon, register_methods, reachable };
}

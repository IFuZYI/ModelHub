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

/**
 * Last-resort avatar when a site publishes no usable logo. A site that hasn't
 * configured one serves the newapi convention default at {origin}/logo.png,
 * but some frontends answer EVERY path with their SPA shell (HTTP 200,
 * text/html), which renders as a broken image. Only accept a response whose
 * content-type is actually an image, and fall back to the official newapi mark
 * so the avatar is never a broken glyph.
 */
export const NEWAPI_FALLBACK_ICON = "https://www.newapi.ai/logo.svg";

/** True when the URL resolves to a real image (not an SPA HTML catch-all). */
async function isUsableImage(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    return ct.startsWith("image/");
  } catch {
    return false;
  }
}

/**
 * Resolve a site's avatar, most-specific first:
 *   1. the logo from /api/status (absolute or site-relative) — trusted as-is,
 *      since the site set it explicitly and it may live on a third-party CDN
 *      this server cannot reach (the browser still can). A genuinely broken
 *      one degrades to the name initial via ProviderAvatar's onError.
 *   2. the {origin}/logo.png convention default, accepted only when it really
 *      serves an image: many newapi frontends answer EVERY path with their SPA
 *      shell (HTTP 200 + text/html), which would render as a broken avatar.
 *   3. the official newapi mark, so the avatar is never a broken glyph.
 */
async function resolveIcon(
  rawLogo: string | undefined,
  baseUrl: string
): Promise<string | null> {
  const configured = rawLogo?.trim();
  if (configured) {
    try {
      return new URL(configured, baseUrl).href;
    } catch {
      // unparseable logo value: fall through to the convention default
    }
  }
  const convention = new URL("/logo.png", baseUrl).href;
  if (await isUsableImage(convention)) return convention;
  return NEWAPI_FALLBACK_ICON;
}

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
        icon = await resolveIcon(p.data.data?.logo, base_url);
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

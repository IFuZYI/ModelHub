/** Thin front-end API helpers shared across pages. */

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  slug: string | null;
}

export interface AuthStatus {
  authenticated: boolean;
  role: "admin" | "user" | "guest";
  user: SessionUser | null;
  adminConfigured: boolean;
  registration_enabled: boolean;
  personal_pages_enabled: boolean;
}

/** Fetch the current session/registration status. Never throws on shape. */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  return {
    authenticated: Boolean(json?.authenticated),
    role: json?.role ?? "guest",
    user: json?.user ?? null,
    adminConfigured: Boolean(json?.adminConfigured),
    registration_enabled: Boolean(json?.registration_enabled),
    personal_pages_enabled: Boolean(json?.personal_pages_enabled),
  };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}

export interface NewapiImportResult {
  name: string | null;
  base_url: string;
  aff_code: string | null;
  icon: string | null;
  register_methods: string[];
  reachable: boolean;
}

/** Probe a newapi site URL; returns name/base_url/aff_code for form prefill. */
export async function importNewapiSite(
  url: string
): Promise<NewapiImportResult> {
  const res = await fetch("/api/providers/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || "解析站点失败");
  }
  return json as NewapiImportResult;
}

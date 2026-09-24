/** Thin front-end API helpers shared across pages. */

export interface AuthStatus {
  authenticated: boolean;
  adminConfigured: boolean;
}

/** Fetch the current session/admin status. Never throws on shape. */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status");
  const json = await res.json().catch(() => ({}));
  return {
    authenticated: Boolean(json?.authenticated),
    adminConfigured: Boolean(json?.adminConfigured),
  };
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
    body: JSON.stringify({ url }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message || "解析站点失败");
  }
  return json as NewapiImportResult;
}

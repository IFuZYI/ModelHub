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

// ---- blog-layer helpers (v0.4) ----

export interface RatingSummary {
  average: number | null;
  count: number;
  distribution: number[];
}

export interface CommentItem {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  username: string;
  mine?: boolean;
}

/** POST a JSON body and unwrap the standard error envelope. */
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || "操作失败");
  return json as T;
}

/** PUT a JSON body and unwrap the standard error envelope. */
async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || "保存失败");
  return json as T;
}

export const rateProvider = (id: string, score: number) =>
  putJson<{ summary: RatingSummary; my_score: number }>(
    `/api/providers/${id}/ratings`,
    { score }
  );

export const unrateProvider = (id: string) =>
  fetch(`/api/providers/${id}/ratings`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then(async (res) => {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || "操作失败");
    return json as { summary: RatingSummary };
  });

export const postComment = (id: string, body: string) =>
  postJson<CommentItem>(`/api/providers/${id}/comments`, { body });

export const deleteComment = (commentId: string) =>
  fetch(`/api/comments/${commentId}`, {
    method: "DELETE",
    credentials: "same-origin",
  }).then(async (res) => {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || "删除失败");
    return json as { ok: boolean };
  });

export interface ProfilePayload {
  account: SessionUser;
  display_name: string | null;
  bio: string | null;
  avatar: string | null;
}

export const fetchMyProfile = () =>
  fetch("/api/me/profile", { credentials: "same-origin" }).then(async (res) => {
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || "加载失败");
    return json as ProfilePayload;
  });

export const saveMyProfile = (patch: {
  display_name?: string | null;
  bio?: string | null;
  avatar?: string | null;
}) => putJson<{ display_name: string | null; bio: string | null; avatar: string | null }>(
  "/api/me/profile",
  patch
);

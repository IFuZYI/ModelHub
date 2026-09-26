"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import ProviderAvatar from "../components/ProviderAvatar";
import { TypeBadge, FreeBadge, StatusDot } from "../components/badges";
import { fetchAuthStatus, logout as apiLogout, type SessionUser } from "../lib/api";

interface MyProvider {
  id: string;
  name: string;
  type: "native" | "proxy" | "newapi" | "custom";
  base_url: string;
  free_tier: "full" | "free" | "none";
  icon: string | null;
  model_count: number;
  has_key: boolean;
  last_status: "ok" | "error" | "pending" | "needs_key";
  last_error: string | null;
}

export default function ConsolePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [role, setRole] = useState<"admin" | "user" | "guest">("guest");
  const [providers, setProviders] = useState<MyProvider[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [personalPagesEnabled, setPersonalPagesEnabled] = useState(false);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (!status.authenticated) {
      router.replace("/login");
      return;
    }
    setUser(status.user);
    setRole(status.role);
    setSlug(status.user?.slug ?? null);
    setPersonalPagesEnabled(status.personal_pages_enabled);
    const res = await fetch("/api/me/providers", { credentials: "same-origin" });
    const json = await res.json();
    setProviders(json.providers ?? []);
    setReady(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assignSlug() {
    const res = await fetch("/api/me/slug", {
      method: "POST",
      credentials: "same-origin",
    });
    const json = await res.json();
    if (res.ok) setSlug(json.slug);
  }

  async function refresh(id: string) {
    await fetch(`/api/providers/${id}/refresh`, {
      method: "POST",
      credentials: "same-origin",
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("确定删除这个提供商？")) return;
    await fetch(`/api/providers/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    await load();
  }

  if (!ready)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="spin">加载中…</div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader
        authenticated
        role={role}
        onLogout={async () => {
          await apiLogout();
          router.replace("/login");
        }}
      />
      <main className="shell">
        <div className="detail-head" style={{ paddingTop: 40 }}>
          <div>
            <h1 className="detail-title">控制台</h1>
            <p className="card-domain" style={{ marginTop: 10 }}>
              你好，{user?.username}。管理你的提供商与个人页。
            </p>
            <div className="admin-bar" style={{ marginTop: 12 }}>
              <Link href="/admin" className="icon-btn">
                + 管理提供商
              </Link>
              {role === "admin" && (
                <Link href="/admin/users" className="icon-btn">
                  管理后台
                </Link>
              )}
            </div>
          </div>
        </div>

        {personalPagesEnabled && (
          <div className="panel">
            <h2 className="panel-title">个人分享页</h2>
            {slug ? (
              <p className="card-domain">
                你的公开页：
                <Link href={`/p/${slug}`} className="back-link">
                  /p/{slug}
                </Link>
                <button
                  className="icon-btn"
                  style={{ marginLeft: 12 }}
                  onClick={assignSlug}
                >
                  重新生成
                </button>
              </p>
            ) : (
              <button className="btn secondary" onClick={assignSlug}>
                生成个人页链接
              </button>
            )}
          </div>
        )}

        {providers.length === 0 ? (
          <div className="empty">
            还没有提供商。
            <div style={{ marginTop: 16 }}>
              <Link href="/admin" className="btn secondary">
                添加第一个
              </Link>
            </div>
          </div>
        ) : (
          <div className="card-grid">
            {providers.map((p) => (
              <div key={p.id} className="site-card" style={{ cursor: "default" }}>
                <div className="card-top">
                  <ProviderAvatar name={p.name} icon={p.icon} />
                  <div className="card-identity">
                    <p className="card-title">{p.name}</p>
                    <div className="card-domain">{p.base_url}</div>
                  </div>
                </div>
                <div className="card-bottom">
                  <TypeBadge type={p.type} />
                  <FreeBadge tier={p.free_tier} />
                  <span className="card-tag">{p.model_count} 模型</span>
                  {p.has_key && <span className="card-tag">已配置密钥</span>}
                  <StatusDot status={p.last_status} />
                </div>
                {p.last_error && (
                  <div className="error-box" style={{ marginBottom: 0 }}>
                    {p.last_error}
                  </div>
                )}
                <div className="admin-bar" style={{ marginBottom: 0 }}>
                  <button className="icon-btn" onClick={() => refresh(p.id)}>
                    刷新
                  </button>
                  <Link
                    href={`/console/providers/${p.id}`}
                    className="icon-btn"
                  >
                    编辑
                  </Link>
                  <button
                    className="icon-btn"
                    style={{ color: "var(--err)" }}
                    onClick={() => remove(p.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

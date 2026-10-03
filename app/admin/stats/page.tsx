"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import { fetchAuthStatus, logout as apiLogout } from "../../lib/api";

interface StatRow {
  normalized_base_url: string;
  base_url: string;
  effective_name: string | null;
  effective_icon: string | null;
  effective_type: "native" | "proxy" | "newapi" | "custom" | null;
  effective_free_tier: "full" | "free" | "none" | null;
  user_count: number;
  admin_added: boolean;
}

export default function AdminStatsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (!status.authenticated || status.role !== "admin") {
      setAllowed(false);
      setReady(true);
      return;
    }
    setAllowed(true);
    const res = await fetch("/api/admin/stats", { credentials: "same-origin" });
    const json = await res.json();
    setStats(json.stats ?? []);
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function quickAdd(normalized: string) {
    setBusy(normalized);
    await fetch("/api/admin/stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ normalized_base_url: normalized }),
    });
    setBusy(null);
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

  if (!allowed)
    return (
      <>
        <SiteHeader authenticated role="user" />
        <main className="shell">
          <div className="empty">
            需要管理员权限。
            <div style={{ marginTop: 16 }}>
              <Link href="/console" className="btn secondary">返回控制台</Link>
            </div>
          </div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader
        authenticated
        role="admin"
        onLogout={async () => {
          await apiLogout();
          router.replace("/login");
        }}
      />
      <main className="shell">
        <div className="detail-head" style={{ paddingTop: 40 }}>
          <div>
            <h1 className="detail-title">全服供应商统计</h1>
            <p className="card-domain" style={{ marginTop: 10 }}>
              所有用户配置的提供商（按 base_url 聚合）。标注管理员未添加的，可一键加入。
            </p>
            <div className="admin-bar" style={{ marginTop: 12 }}>
              <Link href="/admin" className="icon-btn">提供商</Link>
              <Link href="/admin/users" className="icon-btn">用户管理</Link>
              <Link href="/admin/settings" className="icon-btn">系统设置</Link>
            </div>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>提供商</th>
                <th>地址</th>
                <th>类型</th>
                <th>用户数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.normalized_base_url}>
                  <td>
                    <span className="cell-provider">
                      <ProviderAvatar
                        name={s.effective_name ?? s.base_url}
                        icon={s.effective_icon}
                        className="preset-avatar"
                      />
                      {s.effective_name ?? "—"}
                    </span>
                  </td>
                  <td className="cell-mono">{s.base_url}</td>
                  <td>{s.effective_type ?? "—"}</td>
                  <td>{s.user_count}</td>
                  <td>
                    {s.admin_added ? (
                      <span className="badge free-tag">已添加</span>
                    ) : (
                      <span className="card-domain">未添加</span>
                    )}
                  </td>
                  <td>
                    {!s.admin_added && (
                      <button
                        className="icon-btn"
                        disabled={busy === s.normalized_base_url}
                        onClick={() => quickAdd(s.normalized_base_url)}
                      >
                        {busy === s.normalized_base_url ? "添加中…" : "一键添加"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

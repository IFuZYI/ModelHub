"use client";

import { useEffect, useState, useCallback } from "react";
import ConsoleShell from "../../components/ConsoleShell";
import ProviderAvatar from "../../components/ProviderAvatar";
import { fetchAuthStatus } from "../../lib/api";

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

  return (
    <>
      <ConsoleShell
        title="全服统计"
        requireAdmin
        subtitle="所有用户配置的站点（按 base_url 聚合）。标注未添加的可一键加入。"
      >
        {() =>
          !ready ? (
            <div className="spin">加载中…</div>
          ) : !allowed ? (
            <div className="empty">需要管理员权限。</div>
          ) : (
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
          )
        }
      </ConsoleShell>
    </>
  );
}

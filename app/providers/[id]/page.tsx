"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import { TypeBadge } from "../../components/badges";
import { statusLabel } from "../../lib/display";
import { fetchAuthStatus } from "../../lib/api";
import { ProviderView } from "@/lib";

export default function ProviderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [p, setP] = useState<ProviderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const [res, auth] = await Promise.all([
      fetch(`/api/providers/${id}`),
      fetchAuthStatus(),
    ]);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setP(await res.json());
    setAuthed(auth.authenticated);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="spin">加载中…</div>
        </main>
      </>
    );

  if (notFound)
    return (
      <>
        <SiteHeader authenticated={authed} />
        <main className="shell">
          <div className="empty">
            提供商不存在。
            <div style={{ marginTop: 16 }}>
              <Link href="/" className="btn secondary">
                返回首页
              </Link>
            </div>
          </div>
        </main>
      </>
    );

  if (!p) return null;

  const filtered = p.models.filter((m) =>
    m.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <SiteHeader authenticated={authed} />
      <main className="shell">
        <div style={{ paddingTop: 40 }}>
          <Link href="/" className="back-link">
            ← 返回目录
          </Link>
        </div>
        <div className="detail-head">
          <div>
            <h1 className="detail-title">
              <ProviderAvatar name={p.name} icon={p.icon} />
              {p.name}
              <TypeBadge type={p.type} />
            </h1>
            <p className="card-domain" style={{ marginTop: 10 }}>
              {p.base_url}
            </p>
          </div>
        </div>

        {p.invite_url && (
          <a
            className="btn"
            href={p.invite_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginBottom: 4 }}
          >
            前往{p.type === "newapi" ? "站点" : "官网"}
            {p.aff_code ? "（含邀请码）" : ""} ↗
          </a>
        )}

        <div className="admin-bar">
          <span className="status">
            <span className={`dot ${p.last_status}`} />
            {statusLabel(p.last_status)}
          </span>
          {p.last_fetched && (
            <span className="card-domain">
              上次刷新：{new Date(p.last_fetched).toLocaleString()}
            </span>
          )}
          {p.updated_at && (
            <span className="card-domain">
              模型更新：{new Date(p.updated_at).toLocaleString()}
            </span>
          )}
        </div>

        {p.last_error && (
          <div className="error-box">抓取错误：{p.last_error}</div>
        )}

        {p.register_methods && p.register_methods.length > 0 && (
          <div className="reg-section">
            <div className="reg-section-label">支持的注册方式</div>
            <div className="reg-methods">
              {p.register_methods.map((m) => (
                <span key={m} className="reg-chip">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="results-bar" style={{ marginTop: 30 }}>
          <span>
            可用模型 <strong>{p.model_count}</strong>
          </span>
        </div>

        {p.model_count === 0 ? (
          <div className="empty">
            {p.last_status === "error"
              ? "模型未知：该提供商未开放模型列表接口，或抓取失败。可在后台编辑手动填写模型。"
              : "暂无模型缓存。"}
          </div>
        ) : (
          <>
            <input
              className="search-input"
              style={{ marginBottom: 16 }}
              placeholder="搜索模型…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="model-list">
              {filtered.map((m) => (
                <div key={m} className="model-item">
                  {m}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

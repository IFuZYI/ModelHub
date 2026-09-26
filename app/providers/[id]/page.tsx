"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import { TypeBadge, FreeBadge } from "../../components/badges";
import { modelVendor, vendorLabel } from "../../lib/display";
import { fetchAuthStatus } from "../../lib/api";
import type { PublicProviderDetail } from "@/lib";

export default function ProviderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [p, setP] = useState<PublicProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string>("all");

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

  // Group models by vendor for the category filter + sectioned list.
  const { vendors, grouped, filteredCount } = useMemo(() => {
    const models = p?.models ?? [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? models.filter((m) => m.toLowerCase().includes(q))
      : models;

    // vendor key -> models
    const byVendor = new Map<string, string[]>();
    for (const m of matched) {
      const v = modelVendor(m);
      const list = byVendor.get(v);
      if (list) list.push(m);
      else byVendor.set(v, [m]);
    }
    // Sort vendors by descending count, "其他" last.
    const vendorList = [...byVendor.entries()]
      .map(([key, list]) => ({ key, count: list.length }))
      .sort((a, b) => {
        if (a.key === "其他") return 1;
        if (b.key === "其他") return -1;
        return b.count - a.count;
      });

    // Which vendors to render, honoring the active filter.
    const visible =
      vendor === "all"
        ? vendorList.map((v) => v.key)
        : vendorList.filter((v) => v.key === vendor).map((v) => v.key);

    const groups = visible.map((key) => ({
      key,
      label: vendorLabel(key),
      models: (byVendor.get(key) ?? []).slice().sort(),
    }));

    return {
      vendors: vendorList,
      grouped: groups,
      filteredCount: matched.length,
    };
  }, [p, query, vendor]);

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
              <FreeBadge tier={p.free_tier} />
            </h1>
            <p className="card-domain" style={{ marginTop: 10 }}>
              {p.base_url}
            </p>
            {p.description && (
              <p className="detail-desc">{p.description}</p>
            )}
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
          {p.register_methods && p.register_methods.length > 0 && (
            <span className="card-domain">
              支持：{p.register_methods.join("、")}
            </span>
          )}
        </div>

        <div className="results-bar" style={{ marginTop: 30 }}>
          <span>
            可用模型 <strong>{p.model_count}</strong>
            {query && (
              <>
                {" "}
                · 匹配 <strong>{filteredCount}</strong>
              </>
            )}
          </span>
        </div>

        {p.model_count === 0 ? (
          <div className="empty">暂无模型信息。</div>
        ) : (
          <>
            <input
              className="search-input"
              style={{ marginBottom: 16 }}
              placeholder="搜索模型…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {/* Vendor category chips (newapi-style). */}
            {vendors.length > 1 && (
              <div className="vendor-filter">
                <button
                  className={`vendor-chip ${vendor === "all" ? "active" : ""}`}
                  onClick={() => setVendor("all")}
                >
                  全部
                  <span className="vendor-chip-count">{filteredCount}</span>
                </button>
                {vendors.map((v) => (
                  <button
                    key={v.key}
                    className={`vendor-chip ${vendor === v.key ? "active" : ""}`}
                    onClick={() => setVendor(v.key)}
                  >
                    {vendorLabel(v.key)}
                    <span className="vendor-chip-count">{v.count}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredCount === 0 ? (
              <div className="empty">没有匹配的模型。</div>
            ) : (
              grouped.map((g) => (
                <section key={g.key} className="model-group">
                  {vendor === "all" && vendors.length > 1 && (
                    <div className="model-group-label">
                      {g.label}
                      <span className="model-group-count">
                        {g.models.length}
                      </span>
                    </div>
                  )}
                  <div className="model-list">
                    {g.models.map((m) => (
                      <div key={m} className="model-item" title={m}>
                        {m}
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </main>
    </>
  );
}

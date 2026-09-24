"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import Select from "./components/Select";
import ProviderAvatar from "./components/ProviderAvatar";
import { TypeBadge, StatusDot } from "./components/badges";
import { hostOf, categoryOf } from "./lib/display";
import { fetchAuthStatus } from "./lib/api";
import { ProviderView } from "@/lib";

type SortKey = "name" | "models";
type CategoryFilter = "all" | "official" | "other";

export default function Home() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<CategoryFilter>("all");
  const [sort, setSort] = useState<SortKey>("models");

  const load = useCallback(async () => {
    const [pRes, auth] = await Promise.all([
      fetch("/api/providers"),
      fetchAuthStatus(),
    ]);
    const pJson = await pRes.json();
    setProviders(pJson.providers ?? []);
    setAuthed(auth.authenticated);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = providers.filter((p) => {
      if (catFilter !== "all" && categoryOf(p.type) !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.base_url.toLowerCase().includes(q) ||
        p.models.some((m) => m.toLowerCase().includes(q))
      );
    });
    list = [...list].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : b.model_count - a.model_count
    );
    return list;
  }, [providers, query, catFilter, sort]);

  const totalModels = providers.reduce((s, p) => s + p.model_count, 0);

  return (
    <>
      <SiteHeader authenticated={authed} />
      <main className="shell">
        <section className="intro">
          <div className="eyebrow">API 模型索引</div>
          <h1>
            发现每个提供商
            <br />
            <span className="dim">可用的模型。</span>
          </h1>
          <p>
            汇集官方（原生 / 中转）与其他（NewAPI / 自建）API
            提供商，浏览各家实时可用的模型清单。
            后台定时自动刷新，数据始终最新。
          </p>
          <div className="stats">
            <span className="stat">
              <strong>{providers.length}</strong> 提供商
            </span>
            <span className="stat">
              <strong>{totalModels}</strong> 模型
            </span>
          </div>
        </section>

        <section className="explorer">
          <div className="toolbar">
            <div className="search-wrap">
              <input
                className="search-input"
                placeholder="搜索提供商或模型…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Select
              className="sort-select"
              ariaLabel="排序方式"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={[
                { value: "models", label: "按模型数" },
                { value: "name", label: "按名称" },
              ]}
            />
          </div>
          <div className="filter-row">
            {(["all", "official", "other"] as const).map((t) => (
              <button
                key={t}
                className={`filter-chip ${catFilter === t ? "active" : ""}`}
                onClick={() => setCatFilter(t)}
              >
                {t === "all" ? "全部" : t === "official" ? "官方" : "其他"}
              </button>
            ))}
          </div>
        </section>

        <div className="results-bar">
          <span>
            共 <strong>{filtered.length}</strong> 个结果
          </span>
        </div>

        {loading ? (
          <div className="spin">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {providers.length === 0
              ? "还没有提供商。管理员可登录后台添加。"
              : "没有匹配的提供商。"}
          </div>
        ) : (
          <div className="card-grid">
            {filtered.map((p) => (
              <Link
                key={p.id}
                href={`/providers/${p.id}`}
                className="site-card"
              >
                <div className="card-top">
                  <ProviderAvatar name={p.name} icon={p.icon} />
                  <div className="card-identity">
                    <p className="card-title">{p.name}</p>
                    <div className="card-domain">{hostOf(p.base_url)}</div>
                  </div>
                </div>
                <div className="card-bottom">
                  <TypeBadge type={p.type} />
                  <span className="card-tag">{p.model_count} 模型</span>
                  {p.aff_code && <span className="card-tag">邀请码</span>}
                  <StatusDot status={p.last_status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

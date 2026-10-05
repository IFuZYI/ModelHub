"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import Select from "./components/Select";
import ProviderAvatar from "./components/ProviderAvatar";
import { TypeBadge, FreeBadge, Stars } from "./components/badges";
import {
  hostOf,
  categoryOf,
  filterHitsByCategory,
  filterHitsByFreeTier,
  freeTierLabel,
  FREE_TIER_FILTERS,
  type FreeTierFilter,
  timeAgo,
} from "./lib/display";
import { fetchAuthStatus, logout } from "./lib/api";
import { PublicProvider } from "@/lib";

// The homepage list returns the public projection (PublicProvider), which
// includes rating/author/tags/comment_count. The card only needs a subset.
type ProviderSummary = Omit<PublicProvider, "models" | "comment_count">;

type SortKey = "rating" | "models" | "name";
type CategoryFilter = "all" | "official" | "other";

interface SearchHit {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  type: "native" | "proxy" | "newapi" | "custom";
  base_url: string;
  free_tier: "full" | "free" | "none";
  model_count: number;
  updated_at: string | null;
  tags: { slug: string; name: string }[];
  rating: { average: number | null; count: number; distribution: number[] };
  matched_models: string[];
  matched_model_count: number;
  matched_vendors: string[];
  reasons: string[];
}

export default function Home() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [totalModels, setTotalModels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<CategoryFilter>("all");
  const [freeFilter, setFreeFilter] = useState<FreeTierFilter>("all");
  const [sort, setSort] = useState<SortKey>("rating");

  // Homepage search state (single-owner scope: the homepage directory's owner).
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request id: only the latest search may commit its result, so a
  // slow stale response can't overwrite a newer one (and can't clear the
  // loading state of a newer in-flight search).
  const searchSeqRef = useRef(0);

  const runLoad = useCallback(async () => {
    try {
      const response = await fetch("/api/providers", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("无法加载站点列表");
      const payload = await response.json();
      setProviders(payload.providers ?? []);
      setTotalModels(payload.total_model_count ?? 0);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "无法加载站点列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runLoad();
  }, [runLoad]);

  useEffect(() => {
    void fetchAuthStatus().then((auth) => {
      setAuthed(auth.authenticated);
    });
  }, []);

  // Initial query from the URL (?q=tag-name) so tag chips deep-link into a
  // live search. Read once on mount (window is available post-hydration).
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) setQuery(initial);
  }, []);

  // Debounced homepage search: fires when the query has content; clears
  // back to the directory list when emptied. Only the latest request commits
  // (sequence guard), and emptying the box cancels any in-flight commit.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      searchSeqRef.current += 1; // invalidate in-flight responses
      setHits(null);
      return;
    }
    setHits(null); // clear old results so stale hits never render with a new query
    const seq = ++searchSeqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        if (seq !== searchSeqRef.current) return; // stale: a newer query won
        const json = await res.json();
        // Re-check AFTER parsing: a newer query can start while the body is
        // being read, and committing here would render the old query's hits
        // under the new query's text.
        if (seq !== searchSeqRef.current) return;
        setHits(json.hits ?? []);
      } catch {
        if (seq !== searchSeqRef.current) return;
        setHits([]);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = providers.filter((p) => {
      if (catFilter !== "all" && categoryOf(p.type) !== catFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) || p.base_url.toLowerCase().includes(q)
      );
    });
    list = filterHitsByFreeTier(list, freeFilter);
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "models") return b.model_count - a.model_count;
      // Rating: higher average first; unrated last. Ties break by rating
      // count, then model count, so popular well-rated sites lead.
      const ra = a.rating.average;
      const rb = b.rating.average;
      if (ra === null && rb === null) return b.model_count - a.model_count;
      if (ra === null) return 1;
      if (rb === null) return -1;
      if (rb !== ra) return rb - ra;
      if (b.rating.count !== a.rating.count) return b.rating.count - a.rating.count;
      return b.model_count - a.model_count;
    });
    return list;
  }, [providers, query, catFilter, freeFilter, sort]);

  const searchingMode = query.trim().length > 0;

  // Category chips apply to search hits as well as the directory list, so the
  // 官方/其他 filter stays usable while searching (previously the chips were
  // hidden in search mode and hits were never filtered). The free-tier chips
  // compose with them.
  const visibleHits = useMemo(
    () =>
      filterHitsByFreeTier(
        filterHitsByCategory(hits ?? [], catFilter),
        freeFilter
      ),
    [hits, catFilter, freeFilter]
  );
  // Count reflects the visible (filtered) set so "N 个站点命中" matches the
  // cards below it. The panel shows a spinner (not the bar) until hits
  // arrive, so the count is only ever read once a result set exists.
  const filteredSearchTotal = visibleHits.length;

  return (
    <>
      <SiteHeader
        authenticated={authed}
        onLogout={async () => {
          await logout();
          setAuthed(false);

        }}
      />
      <main className="shell">
        <section className="intro">
          <div className="eyebrow">API 模型索引</div>
          <h1>
            发现每个站点
            <br />
            <span className="dim">可用的模型。</span>
          </h1>
          <p>
            汇集官方（原生 / 中转）与其他（NewAPI / 自建）API 站点，浏览各家实时可用的模型清单。
            支持按模型名或来源检索站点。
          </p>
          <div className="stats">
            <span className="stat">
              <strong>{providers.length}</strong> 站点
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
                aria-label="搜索站点或模型"
                placeholder="搜索站点，或按模型与来源检索…"
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
                { value: "rating", label: "按评分" },
                { value: "models", label: "按模型数" },
                { value: "name", label: "按名称" },
              ]}
            />
          </div>
          {/* Category chips stay visible in search mode too: they filter the
              search hits below (same 官方/其他 taxonomy as the directory
              list). Hiding them while searching made the filter unreachable —
              users could not narrow a search to official/other sites.
              Labelled group + aria-pressed so assistive tech can tell this
              row's 「全部」 from the free-tier row's. */}
          <div className="filter-row" role="group" aria-label="分类筛选">
            {(["all", "official", "other"] as const).map((t) => (
              <button
                key={t}
                className={`filter-chip ${catFilter === t ? "active" : ""}`}
                onClick={() => setCatFilter(t)}
                aria-pressed={catFilter === t}
              >
                {t === "all" ? "全部" : t === "official" ? "官方" : "其他"}
              </button>
            ))}
          </div>
          {/* Free-tier chips: same three grades the console assigns
              (ALL FREE / FREE / NO), applied to the directory list AND the
              search hits. Labels come from freeTierLabel so chips and card
              badges can never drift. The group is named by its VISIBLE label
              (aria-labelledby) so screen readers don't announce a separate
              aria-label in addition to the text. */}
          <div
            className="filter-row"
            role="group"
            aria-labelledby="free-tier-filter-label"
          >
            <span className="filter-row-label" id="free-tier-filter-label">
              免费额度
            </span>
            {FREE_TIER_FILTERS.map((t) => (
              <button
                key={t}
                className={`filter-chip ${freeFilter === t ? "active" : ""}`}
                onClick={() => setFreeFilter(t)}
                aria-pressed={freeFilter === t}
              >
                {t === "all" ? "全部" : freeTierLabel(t)}
              </button>
            ))}
          </div>
        </section>

        {searchingMode ? (
          <SearchResults
            hits={visibleHits}
            loaded={hits !== null}
            total={filteredSearchTotal}
            query={query}
            category={catFilter}
            freeTier={freeFilter}
          />
        ) : (
          <>
            <div className="results-bar">
              <span>
                共 <strong>{filtered.length}</strong> 个结果
              </span>
            </div>

            {loading ? (
              <div className="spin">加载中…</div>
            ) : loadError ? (
              <div className="empty">
                {loadError}
                <div style={{ marginTop: 16 }}>
                  <button
                    className="btn secondary"
                    onClick={() => void runLoad()}
                  >
                    重试
                  </button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty">
                {providers.length === 0
                  ? "还没有站点。管理员可登录后台添加。"
                  : "没有匹配的站点。可切换或清除筛选条件。"}
              </div>
            ) : (
              <div className="card-grid">
                {filtered.map((p) => (
                  <Link key={p.id} href={`/providers/${p.id}`} className="site-card">
                    <div className="card-top">
                      <ProviderAvatar name={p.name} icon={p.icon} />
                      <div className="card-identity">
                        <p className="card-title">{p.name}</p>
                        <div className="card-domain">{hostOf(p.base_url)}</div>
                      </div>
                    </div>
                    <div className="card-bottom">
                      <TypeBadge type={p.type} />
                      <FreeBadge tier={p.free_tier} />
                      <span className="card-tag">{p.model_count} 模型</span>
                      <Stars average={p.rating.average} count={p.rating.count} />
                      {p.aff_code && <span className="card-tag">邀请码</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

function SearchResults({
  hits,
  loaded,
  total,
  query,
  category,
  freeTier,
}: {
  hits: SearchHit[];
  /** False until the first response for the current query has committed. */
  loaded: boolean;
  total: number;
  query: string;
  category: "all" | "official" | "other";
  freeTier: FreeTierFilter;
}) {
  // Before the first result lands, show the spinner — NOT the results bar or
  // the empty state. `hits` here is already filtered (`?? []` upstream), so
  // the old `hits === null` test was dead code and the panel flashed
  // 「搜索 … — 0 个站点命中」 + 「没有站点包含 …」 for the debounce+fetch window.
  if (!loaded) return <div className="spin">搜索中…</div>;
  // Explain which active filter narrowed the list to nothing; the message
  // must name every chip the user set, or "没有站点" reads as "the search
  // found nothing" when the search actually matched sites the filter hid.
  const activeFilters: string[] = [];
  if (category !== "all")
    activeFilters.push(category === "official" ? "官方" : "其他");
  if (freeTier !== "all") activeFilters.push(freeTierLabel(freeTier));
  return (
    <>
      <div className="results-bar">
        <span>
          搜索 “{query}” — <strong>{total}</strong> 个站点命中
        </span>
      </div>
      {hits.length === 0 ? (
        <div className="empty">
          {activeFilters.length === 0
            ? `没有站点包含 “${query}”。可尝试模型名或来源。`
            : `当前「${activeFilters.join(" + ")}」筛选下没有命中站点，可切回「全部」查看。`}
        </div>
      ) : (
        <div className="search-hits">
          {hits.map((h) => (
            <Link
              key={h.id}
              href={`/providers/${h.id}`}
              className="search-hit site-card"
            >
              <div className="card-top">
                <ProviderAvatar name={h.name} icon={h.icon} />
                <div className="card-identity">
                  <p className="card-title">{h.name}</p>
                  <div className="card-domain">{hostOf(h.base_url)}</div>
                </div>
                <Stars average={h.rating.average} count={h.rating.count} />
              </div>
              {h.matched_models.length > 0 && (
                <div className="hit-models">
                  {h.matched_vendors.length > 0 && (
                    <span className="hit-vendor">
                      来源：{h.matched_vendors.join("、")}
                    </span>
                  )}
                  {h.matched_models.slice(0, 8).map((m) => (
                    <span key={m} className="seed-model">
                      {m}
                    </span>
                  ))}
                  {h.matched_model_count > 8 && (
                    <span className="card-tag">
                      +{h.matched_model_count - 8}
                    </span>
                  )}
                </div>
              )}
              <div className="card-bottom">
                <TypeBadge type={h.type} />
                <FreeBadge tier={h.free_tier} />
                <span className="card-tag">{h.model_count} 模型</span>
                {h.tags.map((t) => (
                  <span key={t.slug} className="card-tag">
                    #{t.name}
                  </span>
                ))}
                {h.updated_at && (
                  <span className="card-tag">更新于 {timeAgo(h.updated_at)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

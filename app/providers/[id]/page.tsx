"use client";

import { use, useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import {
  TypeBadge,
  FreeBadge,
  Stars,
  StarPicker,
} from "../../components/badges";
import { modelVendor, vendorLabel, timeAgo } from "../../lib/display";
import { usePageTitle } from "../../lib/usePageTitle";
import {
  fetchAuthStatus,
  logout as apiLogout,
  rateProvider,
  unrateProvider,
  postComment,
  deleteComment,
  type CommentItem,
} from "../../lib/api";
import type { PublicProviderDetail } from "@/lib";

interface DetailPayload extends PublicProviderDetail {
  comments: CommentItem[];
}

export default function ProviderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [p, setP] = useState<DetailPayload | null>(null);
  // Document title reflects the site name once loaded (WCAG 2.4.2).
  usePageTitle(p?.name);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [vendor, setVendor] = useState<string>("all");

  // Social state.
  const [myScore, setMyScore] = useState<number | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Ref mirror for the delete guard: two rapid clicks both run before React
  // re-renders, so the state value alone cannot block the second call.
  const deletingRef = useRef(false);
  const [socialErr, setSocialErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, auth] = await Promise.all([
        fetch(`/api/providers/${id}`),
        fetchAuthStatus(),
      ]);
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      // Any other non-2xx (500, network proxy error page) must NOT be parsed
      // as a provider payload — doing so left `p` without `rating` and the
      // render crashed the whole page. Surface the same retryable error the
      // homepage shows instead.
      if (!res.ok) throw new Error("无法加载站点信息");
      setP(await res.json());
      setAuthed(auth.authenticated);
      setLoadError(null);
      setLoading(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "无法加载站点信息");
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch my own rating once we know we're logged in.
  useEffect(() => {
    if (!authed) {
      setMyScore(null);
      return;
    }
    void fetch(`/api/providers/${id}/ratings`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((json) => {
        setMyScore(typeof json?.my_score === "number" ? json.my_score : null);
      })
      .catch(() => undefined);
  }, [authed, id]);

  async function onRate(score: number) {
    if (!authed) {
      setSocialErr("请先登录再评分");
      return;
    }
    setRatingBusy(true);
    setSocialErr(null);
    try {
      const { summary } = await rateProvider(id, score);
      setMyScore(score);
      setP((prev) => (prev ? { ...prev, rating: summary } : prev));
    } catch (e) {
      setSocialErr(e instanceof Error ? e.message : "评分失败");
    } finally {
      setRatingBusy(false);
    }
  }

  async function onUnrate() {
    setRatingBusy(true);
    setSocialErr(null);
    try {
      const { summary } = await unrateProvider(id);
      setMyScore(null);
      setP((prev) => (prev ? { ...prev, rating: summary } : prev));
    } catch (e) {
      setSocialErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setRatingBusy(false);
    }
  }

  async function onComment(e: React.FormEvent) {
    e.preventDefault();
    if (!authed) {
      setSocialErr("请先登录再评论");
      return;
    }
    const body = commentText.trim();
    if (!body) return;
    setCommentBusy(true);
    setSocialErr(null);
    try {
      const comment = await postComment(id, body);
      setP((prev) =>
        prev
          ? {
              ...prev,
              comments: [comment, ...prev.comments],
              comment_count: prev.comment_count + 1,
            }
          : prev
      );
      setCommentText("");
    } catch (e) {
      setSocialErr(e instanceof Error ? e.message : "评论失败");
    } finally {
      setCommentBusy(false);
    }
  }

  async function onDeleteComment(commentId: string) {
    if (deletingRef.current) return; // ignore double-clicks (ref, not state)
    deletingRef.current = true;
    setSocialErr(null);
    setDeletingId(commentId);
    try {
      await deleteComment(commentId);
      setP((prev) =>
        prev
          ? {
              ...prev,
              comments: prev.comments.filter((c) => c.id !== commentId),
              comment_count: Math.max(0, prev.comment_count - 1),
            }
          : prev
      );
    } catch (e) {
      setSocialErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }

  // Group models by vendor for the category filter + sectioned list.
  const { vendors, grouped, filteredCount, matchedCount } = useMemo(() => {
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
    // Keep the ACTIVE vendor chip in the row even when the search filter
    // leaves it with zero matches — otherwise the chip the user selected
    // vanishes from the list while still being the active filter.
    if (vendor !== "all" && !vendorList.some((v) => v.key === vendor)) {
      vendorList.push({ key: vendor, count: 0 });
    }

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

    // Count of models ACTUALLY rendered after both filters — the results bar
    // used to report the search-only count (「匹配 14」 while 11 rendered).
    const visibleCount = groups.reduce((n, g) => n + g.models.length, 0);

    return {
      vendors: vendorList,
      grouped: groups,
      /** Search-filtered total; the 「全部」 chip shows this. */
      matchedCount: matched.length,
      /** Rendered count (search + vendor); the results bar shows this. */
      filteredCount: visibleCount,
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
            <h1 className="empty-title">站点不存在</h1>
            你访问的站点可能已被移除。
            <div style={{ marginTop: 16 }}>
              <Link href="/" className="btn secondary">
                返回首页
              </Link>
            </div>
          </div>
        </main>
      </>
    );

  if (loadError)
    return (
      <>
        <SiteHeader authenticated={authed} />
        <main className="shell">
          <div className="empty">
            <h1 className="empty-title">加载失败</h1>
            {loadError}
            <div style={{ marginTop: 16 }}>
              <button
                className="btn secondary"
                onClick={() => {
                  setLoading(true);
                  setLoadError(null);
                  void load();
                }}
              >
                重试
              </button>
            </div>
          </div>
        </main>
      </>
    );

  if (!p) return null;

  return (
    <>
      <SiteHeader
        authenticated={authed}
        onLogout={async () => {
          await apiLogout();
          setAuthed(false);
          router.refresh();
        }}
      />
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
            {p.description && <p className="detail-desc">{p.description}</p>}
            <div className="detail-meta">
              <Stars
                average={p.rating.average}
                count={p.rating.count}
                size={16}
              />
              <span className="card-tag">{p.comment_count} 评论</span>
              {p.author?.slug && (
                <Link href={`/p/${p.author.slug}`} className="back-link">
                  @{p.author.display_name || p.author.username} 的主页
                </Link>
              )}
            </div>
            {p.tags.length > 0 && (
              <div className="detail-tags">
                {p.tags.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/?q=${encodeURIComponent(t.name)}`}
                    className="tag-chip"
                  >
                    #{t.name}
                  </Link>
                ))}
              </div>
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

        {/* ---- ratings ---- */}
        <section className="panel social-panel">
          <h2 className="panel-title">评分</h2>
          <div className="rating-row">
            <Stars
              average={p.rating.average}
              count={p.rating.count}
              size={20}
            />
            <span className="card-domain">
              {p.rating.average === null
                ? "暂无评分"
                : `${p.rating.average} / 5 · ${p.rating.count} 人评分`}
            </span>
          </div>
          {authed ? (
            <div className="rating-row">
              <span className="card-domain">我的评分：</span>
              <StarPicker
                value={myScore ?? 0}
                onPick={onRate}
                disabled={ratingBusy}
              />
              {myScore !== null && (
                <button
                  className="icon-btn"
                  onClick={onUnrate}
                  disabled={ratingBusy}
                >
                  清除
                </button>
              )}
            </div>
          ) : (
            <div className="card-domain">
              <Link href="/login" className="back-link">
                登录
              </Link>{" "}
              后可评分与评论。
            </div>
          )}
          {socialErr && <div className="error-box" role="alert">{socialErr}</div>}
        </section>

        {/* ---- comments ---- */}
        <section className="panel social-panel">
          <h2 className="panel-title">评论（{p.comment_count}）</h2>
          {authed ? (
            <form onSubmit={onComment} className="comment-form">
              <textarea
                className="model-textarea"
                rows={3}
                aria-label="发表评论"
                placeholder="写下你的使用体验…"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={2000}
              />
              <button
                className="btn"
                type="submit"
                disabled={commentBusy || !commentText.trim()}
              >
                {commentBusy ? "发布中…" : "发表评论"}
              </button>
            </form>
          ) : (
            <div className="card-domain">
              <Link href="/login" className="back-link">
                登录
              </Link>{" "}
              后可评论。
            </div>
          )}
          {p.comments.length === 0 ? (
            <div className="card-domain" style={{ marginTop: 12 }}>
              还没有评论。
            </div>
          ) : (
            <ul className="comment-list">
              {p.comments.map((c) => (
                <li key={c.id} className="comment-item">
                  <div className="comment-head">
                    <span className="comment-author">@{c.username}</span>
                    <span className="comment-time">
                      {timeAgo(c.created_at)}
                    </span>
                    {c.mine && (
                      <button
                        className="icon-btn"
                        disabled={deletingId === c.id}
                        onClick={() => onDeleteComment(c.id)}
                      >
                        {deletingId === c.id ? "删除中…" : "删除"}
                      </button>
                    )}
                  </div>
                  <p className="comment-body">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

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
              aria-label="搜索模型"
              placeholder="搜索模型…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {/* Vendor category chips (newapi-style). Kept visible while a
                vendor filter is active even if only one vendor remains after
                the search filter — otherwise an empty intersection hid the
                whole row and the user could not clear the filter. */}
            {(vendors.length > 1 || vendor !== "all") && (
              <div className="vendor-filter">
                <button
                  className={`vendor-chip ${vendor === "all" ? "active" : ""}`}
                  aria-pressed={vendor === "all"}
                  onClick={() => setVendor("all")}
                >
                  全部
                  <span className="vendor-chip-count">{matchedCount}</span>
                </button>
                {vendors.map((v) => (
                  <button
                    key={v.key}
                    className={`vendor-chip ${vendor === v.key ? "active" : ""}`}
                    aria-pressed={vendor === v.key}
                    onClick={() => setVendor(v.key)}
                  >
                    {vendorLabel(v.key)}
                    <span className="vendor-chip-count">{v.count}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredCount === 0 ? (
              <div className="empty">
                {vendor !== "all"
                  ? "当前厂商筛选下没有匹配的模型，可切回「全部」查看。"
                  : "没有匹配的模型。"}
              </div>
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

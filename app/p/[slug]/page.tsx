"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import { TypeBadge, FreeBadge, Stars } from "../../components/badges";
import { hostOf } from "../../lib/display";
import { fetchAuthStatus, logout as apiLogout } from "../../lib/api";
import { usePageTitle } from "../../lib/usePageTitle";

interface PublicProvider {
  id: string;
  name: string;
  description: string | null;
  type: "native" | "proxy" | "newapi" | "custom";
  base_url: string;
  free_tier: "full" | "free" | "none";
  icon: string | null;
  aff_code: string | null;
  invite_url: string | null;
  model_count: number;
  tags: { slug: string; name: string }[];
  rating: { average: number | null; count: number; distribution: number[] };
  comment_count: number;
}

interface PagePayload {
  owner: {
    username: string;
    slug: string | null;
    display_name: string | null;
    bio: string | null;
    avatar: string | null;
  };
  providers: PublicProvider[];
  total_model_count: number;
  total_rating: { average: number | null; count: number };
  total_comments: number;
}

export default function PersonalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const router = useRouter();
  const [page, setPage] = useState<PagePayload | null>(null);
  // Title shows whose page this is once loaded (WCAG 2.4.2).
  usePageTitle(
    page ? `${page.owner.display_name || page.owner.username} 的分享页` : null
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  // The header must reflect the real session: a logged-in visitor previously
  // saw a 「登录」 button here (hardcoded authenticated={false}). A failed
  // status probe keeps the logged-out shape (safe default), never rejects.
  useEffect(() => {
    fetchAuthStatus()
      .then((auth) => setAuthed(auth.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pages/${slug}`);
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      // A non-2xx (500, proxy error page) must not be parsed as a page
      // payload — `owner` was undefined and the render crashed the page.
      if (!res.ok) throw new Error("无法加载个人主页");
      const json = await res.json();
      setPage(json);
      setLoadError(null);
      setLoading(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "无法加载个人主页");
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <>
        <SiteHeader authenticated={authed} />
        <main className="shell">
          <div className="spin">加载中…</div>
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

  if (notFound || !page)
    return (
      <>
        <SiteHeader authenticated={authed} />
        <main className="shell">
          <div className="empty">
            <h1 className="empty-title">页面不存在</h1>
            该分享页可能已被关闭。
            <div style={{ marginTop: 16 }}>
              <Link href="/" className="btn secondary">
                返回首页
              </Link>
            </div>
          </div>
        </main>
      </>
    );

  const { owner, providers, total_model_count, total_rating, total_comments } =
    page;
  const displayName = owner.display_name || owner.username;

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
        <section className="intro">
          <div className="eyebrow">个人分享页</div>
          <div className="author-head">
            <div className="author-avatar">
              {owner.avatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={owner.avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                displayName.slice(0, 1).toUpperCase()
              )}
            </div>
            <div>
              <h1 className="author-name">{displayName}</h1>
              <p className="card-domain">@{owner.username}</p>
              {owner.bio && <p className="author-bio">{owner.bio}</p>}
              <div className="author-stats">
                <span className="stat">
                  <strong>{providers.length}</strong> 站点
                </span>
                <span className="stat">
                  <strong>{total_model_count}</strong> 模型
                </span>
                <Stars
                  average={total_rating.average}
                  count={total_rating.count}
                  size={16}
                />
                <span className="card-tag">{total_comments} 评论</span>
              </div>
            </div>
          </div>
        </section>

        {providers.length === 0 ? (
          <div className="empty">该用户还没有公开的站点。</div>
        ) : (
          <div className="card-grid">
            {providers.map((p) => (
              /* A card is a div, not a Link: the 「前往」 external link used to
                 nest inside the card anchor (invalid HTML; screen readers
                 merged the two link names). The title link is STRETCHED over
                 the card (::after), so the whole card stays clickable while
                 the two links remain siblings. */
              <div key={p.id} className="site-card">
                <div className="card-top">
                  <ProviderAvatar name={p.name} icon={p.icon} />
                  <div className="card-identity">
                    <p className="card-title">
                      <Link
                        href={`/providers/${p.id}`}
                        className="card-stretch"
                      >
                        {p.name}
                      </Link>
                    </p>
                    <div className="card-domain">{hostOf(p.base_url)}</div>
                  </div>
                  <Stars average={p.rating.average} count={p.rating.count} />
                </div>
                {p.description && (
                  <p className="detail-desc" style={{ margin: "6px 0 0" }}>
                    {p.description}
                  </p>
                )}
                <div className="card-bottom">
                  <TypeBadge type={p.type} />
                  <FreeBadge tier={p.free_tier} />
                  <span className="card-tag">{p.model_count} 模型</span>
                  {p.tags.map((t) => (
                    <span key={t.slug} className="card-tag">
                      #{t.name}
                    </span>
                  ))}
                  {p.comment_count > 0 && (
                    <span className="card-tag">{p.comment_count} 评论</span>
                  )}
                  {/* Sibling link above the stretched title link (z-index),
                      opens the site in a new tab. */}
                  {(p.invite_url || p.base_url) && (
                    <a
                      className="card-tag card-go"
                      href={p.invite_url || p.base_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.aff_code ? "前往站点（含邀请码）" : "前往站点"}
                    >
                      前往{p.aff_code ? "（含邀请码）" : ""} ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

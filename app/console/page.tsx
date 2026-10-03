"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import ConsoleShell from "../components/ConsoleShell";
import ProviderAvatar from "../components/ProviderAvatar";
import { TypeBadge, FreeBadge, StatusDot } from "../components/badges";
import { hostOf } from "../lib/display";
import { fetchMyProfile } from "../lib/api";

interface MyProvider {
  id: string;
  name: string;
  description: string | null;
  type: "native" | "proxy" | "newapi" | "custom";
  base_url: string;
  free_tier: "full" | "free" | "none";
  icon: string | null;
  model_count: number;
  tags: { slug: string; name: string }[];
  last_status: "ok" | "error" | "pending" | "needs_key";
  last_error: string | null;
}

/**
 * Console overview (v0.5): a blog-style "dashboard" — author card, quick
 * stats, and a preview of the user's sites. The sidebar (ConsoleShell) is the
 * single navigation surface for every console page.
 */
export default function ConsoleOverview() {
  const [name, setName] = useState("");
  const [bio, setBio] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [providers, setProviders] = useState<MyProvider[]>([]);
  const [personalPagesEnabled, setPersonalPagesEnabled] = useState(false);

  const load = useCallback(async () => {
    const status = await fetch("/api/auth/status", {
      credentials: "same-origin",
    }).then((r) => r.json());
    setSlug(status?.user?.slug ?? null);
    setPersonalPagesEnabled(Boolean(status?.personal_pages_enabled));

    await fetchMyProfile()
      .then((p) => {
        setName(p.display_name || p.account.username);
        setBio(p.bio);
      })
      .catch(() => setName(status?.user?.username ?? ""));

    const json = await fetch("/api/me/providers", {
      credentials: "same-origin",
    }).then((r) => r.json());
    setProviders(json.providers ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalModels = providers.reduce((sum, p) => sum + p.model_count, 0);
  const healthyCount = providers.filter((p) => p.last_status === "ok").length;

  return (
    <ConsoleShell
      title="概览"
      subtitle="你的个人主页、站点与数据的总览。"
      action={
        <Link href="/console/providers" className="btn">
          + 添加站点
        </Link>
      }
    >
      {() => (
        <>
          <div className="console-tiles">
            <div className="console-tile">
              <div className="console-tile-value">{providers.length}</div>
              <div className="console-tile-label">我的站点</div>
            </div>
            <div className="console-tile">
              <div className="console-tile-value">{totalModels}</div>
              <div className="console-tile-label">模型总数</div>
            </div>
            <div className="console-tile">
              <div className="console-tile-value">{healthyCount}</div>
              <div className="console-tile-label">运行正常</div>
            </div>
          </div>

          <section className="panel">
            <h2 className="panel-title">个人主页</h2>
            <div className="author-head" style={{ marginBottom: 14 }}>
              <div className="author-avatar">
                {name ? name.slice(0, 1).toUpperCase() : "?"}
              </div>
              <div>
                <h3 className="author-name" style={{ fontSize: 18 }}>
                  {name}
                </h3>
                {bio ? (
                  <p className="author-bio">{bio}</p>
                ) : (
                  <p className="author-bio" style={{ opacity: 0.7 }}>
                    还没有简介，去个人资料写一句介绍吧。
                  </p>
                )}
              </div>
            </div>
            <div className="admin-bar" style={{ marginTop: 0 }}>
              <Link href="/console/profile" className="icon-btn">
                编辑资料
              </Link>
              {personalPagesEnabled && slug && (
                <Link href={`/p/${slug}`} className="icon-btn">
                  查看公开主页
                </Link>
              )}
              {personalPagesEnabled && !slug && (
                <Link href="/console/profile" className="icon-btn">
                  生成个人页链接
                </Link>
              )}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">我的站点</h2>
            {providers.length === 0 ? (
              <div className="empty" style={{ padding: "30px 0" }}>
                还没有站点。
                <div style={{ marginTop: 16 }}>
                  <Link href="/console/providers" className="btn secondary">
                    添加第一个
                  </Link>
                </div>
              </div>
            ) : (
              <div className="card-grid">
                {providers.slice(0, 6).map((p) => (
                  <Link
                    key={p.id}
                    href={`/console/providers/${p.id}`}
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
                      <FreeBadge tier={p.free_tier} />
                      <span className="card-tag">{p.model_count} 模型</span>
                      <StatusDot status={p.last_status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {providers.length > 6 && (
              <div style={{ marginTop: 16 }}>
                <Link href="/console/providers" className="back-link">
                  查看全部 {providers.length} 个站点 →
                </Link>
              </div>
            )}
          </section>
        </>
      )}
    </ConsoleShell>
  );
}

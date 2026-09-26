"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import ProviderAvatar from "../../components/ProviderAvatar";
import { TypeBadge, FreeBadge } from "../../components/badges";
import { hostOf } from "../../lib/display";

interface PublicProvider {
  id: string;
  name: string;
  type: "native" | "proxy" | "newapi" | "custom";
  base_url: string;
  free_tier: "full" | "free" | "none";
  icon: string | null;
  aff_code: string | null;
  model_count: number;
}

export default function PersonalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [owner, setOwner] = useState<string | null>(null);
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [totalModels, setTotalModels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/pages/${slug}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const json = await res.json();
    setOwner(json.owner?.username ?? null);
    setProviders(json.providers ?? []);
    setTotalModels(json.total_model_count ?? 0);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
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
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="empty">
            页面不存在或已关闭。
            <div style={{ marginTop: 16 }}>
              <Link href="/" className="btn secondary">返回首页</Link>
            </div>
          </div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader authenticated={false} />
      <main className="shell">
        <section className="intro">
          <div className="eyebrow">个人分享页</div>
          <h1>
            {owner}
            <span className="dim"> 的提供商</span>
          </h1>
          <div className="stats">
            <span className="stat">
              <strong>{providers.length}</strong> 提供商
            </span>
            <span className="stat">
              <strong>{totalModels}</strong> 模型
            </span>
          </div>
        </section>

        {providers.length === 0 ? (
          <div className="empty">该用户还没有公开的提供商。</div>
        ) : (
          <div className="card-grid">
            {providers.map((p) => (
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
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

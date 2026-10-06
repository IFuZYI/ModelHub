"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import ConsoleShell from "../../components/ConsoleShell";
import { fetchMyProfile, saveMyProfile } from "../../lib/api";

/**
 * Console → 个人资料. Public author profile shown on the personal page and
 * next to every site the user publishes.
 */
export default function ProfileSettingsPage() {
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [personalPagesEnabled, setPersonalPagesEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await fetch("/api/auth/status", {
        credentials: "same-origin",
      }).then((r) => r.json());
      setPersonalPagesEnabled(Boolean(status?.personal_pages_enabled));
      setSlug(status?.user?.slug ?? null);
      const profile = await fetchMyProfile();
      setUsername(profile.account.username);
      setDisplayName(profile.display_name ?? "");
      setBio(profile.bio ?? "");
      setAvatar(profile.avatar ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await saveMyProfile({
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        avatar: avatar.trim() || null,
      });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function assignSlug() {
    const res = await fetch("/api/me/slug", {
      method: "POST",
      credentials: "same-origin",
    });
    const json = await res.json();
    if (res.ok) setSlug(json.slug);
  }

  return (
    <ConsoleShell
      title="个人资料"
      subtitle="资料会显示在你的个人页和每个站点卡片上。"
    >
      {() =>
        !ready ? (
          <div className="spin">加载中…</div>
        ) : (
          <>
            <form onSubmit={save} className="settings-form">
              <section className="panel">
                <h2 className="panel-title">公开资料</h2>
                <div className="profile-grid">
                  <div className="field">
                    <label htmlFor="profile-90">显示名称（留空用用户名 {username}）</label>
                    <input id="profile-90"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      maxLength={40}
                      placeholder={username}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="profile-99">头像 URL（留空用首字母）</label>
                    <input id="profile-99"
                      value={avatar}
                      onChange={(e) => setAvatar(e.target.value)}
                      maxLength={300}
                      placeholder="https://…"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="profile-108">简介</label>
                    <textarea id="profile-108"
                      className="model-textarea"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      maxLength={500}
                      placeholder="介绍一下你自己或你分享的站点…"
                    />
                  </div>
                </div>
                {err && <div className="error-box" role="alert">{err}</div>}
                {saved && <div className="card-domain" role="status">已保存 ✓</div>}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "保存中…" : "保存资料"}
                </button>
              </section>
            </form>

            {personalPagesEnabled && (
              <section className="panel">
                <h2 className="panel-title">个人分享页</h2>
                {slug ? (
                  <div className="card-domain" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                    <span>
                      你的公开页：
                      <Link href={`/p/${slug}`} className="back-link">
                        /p/{slug}
                      </Link>
                    </span>
                    <a
                      className="icon-btn"
                      href={`/p/${slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="前往站点（分享页），在新标签页打开"
                    >
                      前往站点（分享页）↗
                    </a>
                    <button
                      className="icon-btn"
                      onClick={assignSlug}
                    >
                      重新生成
                    </button>
                  </div>
                ) : (
                  <button className="btn secondary" onClick={assignSlug}>
                    生成个人页链接
                  </button>
                )}
              </section>
            )}
          </>
        )
      }
    </ConsoleShell>
  );
}

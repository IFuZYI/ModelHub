"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import { fetchAuthStatus, logout as apiLogout, fetchMyProfile, saveMyProfile } from "../../lib/api";

/**
 * User settings (v0.4): public author profile shown on the personal page and
 * next to every provider the user publishes. Also hosts password change.
 */
export default function ProfileSettingsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<"admin" | "user" | "guest">("guest");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [personalPagesEnabled, setPersonalPagesEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // password change
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setRole(status.role);
      setPersonalPagesEnabled(status.personal_pages_enabled);
      if (!status.authenticated) {
        return;
      }
      setAuthed(true);
      setSlug(status.user?.slug ?? null);
      const profile = await fetchMyProfile();
      setUsername(profile.account.username);
      setDisplayName(profile.display_name ?? "");
      setBio(profile.bio ?? "");
      setAvatar(profile.avatar ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      // Always leave the loading state, even on fetch failure.
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

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    setPwdErr(null);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          current_password: curPwd,
          new_password: newPwd,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "修改失败");
      setPwdMsg("密码已修改，请重新登录。");
      setCurPwd("");
      setNewPwd("");
      setTimeout(() => router.replace("/login"), 1500);
    } catch (e) {
      setPwdErr(e instanceof Error ? e.message : "修改失败");
    }
  }

  if (!ready)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="spin">加载中…</div>
        </main>
      </>
    );

  if (!authed)
    return (
      <>
        <SiteHeader authenticated={false} role="guest" />
        <main className="shell">
          <div className="empty">
            请先登录。
            <div style={{ marginTop: 16 }}>
              <Link href="/login" className="btn secondary">去登录</Link>
            </div>
          </div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader
        authenticated
        role={role}
        onLogout={async () => {
          await apiLogout();
          router.replace("/login");
        }}
      />
      <main className="shell">
        <div style={{ paddingTop: 40 }}>
          <Link href="/console" className="back-link">← 返回控制台</Link>
        </div>
        <h1 className="detail-title" style={{ marginTop: 16 }}>个人设置</h1>
        <p className="card-domain" style={{ marginTop: 10 }}>
          资料会显示在你的个人页和每个站点卡片上。
        </p>

        <form onSubmit={save} className="settings-form">
          <section className="panel">
            <h2 className="panel-title">公开资料</h2>
            <div className="profile-grid">
              <div className="field">
                <label>显示名称（留空用用户名 {username}）</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={40}
                  placeholder={username}
                />
              </div>
              <div className="field">
                <label>头像 URL（留空用首字母）</label>
                <input
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                  maxLength={300}
                  placeholder="https://…"
                />
              </div>
              <div className="field">
                <label>简介</label>
                <textarea
                  className="model-textarea"
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={500}
                  placeholder="介绍一下你自己或你分享的站点…"
                />
              </div>
            </div>
            {err && <div className="error-box">{err}</div>}
            {saved && <div className="card-domain">已保存 ✓</div>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "保存中…" : "保存资料"}
            </button>
          </section>
        </form>

        {personalPagesEnabled && (
          <section className="panel">
            <h2 className="panel-title">个人分享页</h2>
            {slug ? (
              <p className="card-domain">
                你的公开页：
                <Link href={`/p/${slug}`} className="back-link">/p/{slug}</Link>
                <button className="icon-btn" style={{ marginLeft: 12 }} onClick={assignSlug}>
                  重新生成
                </button>
              </p>
            ) : (
              <button className="btn secondary" onClick={assignSlug}>
                生成个人页链接
              </button>
            )}
          </section>
        )}

        <section className="panel">
          <h2 className="panel-title">修改密码</h2>
          <form onSubmit={changePassword} className="profile-grid">
            <div className="field">
              <label>当前密码</label>
              <input
                type="password"
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>新密码（至少 8 位）</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {pwdErr && <div className="error-box">{pwdErr}</div>}
            {pwdMsg && <div className="card-domain">{pwdMsg}</div>}
            <button className="btn secondary" type="submit">
              修改密码
            </button>
          </form>
        </section>
      </main>
    </>
  );
}

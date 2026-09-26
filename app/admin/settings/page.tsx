"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import Select from "../../components/Select";
import { fetchAuthStatus, logout as apiLogout } from "../../lib/api";

interface Settings {
  registration_enabled: boolean;
  email_verification_required: boolean;
  email_domain_whitelist: string[];
  personal_pages_enabled: boolean;
  key_share_enabled: boolean;
  key_share_consumers: "admin" | "everyone";
  smtp_host: string;
  smtp_port: number | null;
  smtp_username: string;
  smtp_from: string;
  smtp_password_set: boolean;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [s, setS] = useState<Settings | null>(null);
  const [whitelist, setWhitelist] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (!status.authenticated || status.role !== "admin") {
      setAllowed(false);
      setReady(true);
      return;
    }
    setAllowed(true);
    const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
    const json: Settings = await res.json();
    setS(json);
    setWhitelist(json.email_domain_whitelist.join(", "));
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setErr(null);
    setSaved(false);
    const body: Record<string, unknown> = {
      registration_enabled: s.registration_enabled,
      email_verification_required: s.email_verification_required,
      email_domain_whitelist: whitelist
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      personal_pages_enabled: s.personal_pages_enabled,
      key_share_enabled: s.key_share_enabled,
      key_share_consumers: s.key_share_consumers,
      smtp_host: s.smtp_host,
      smtp_username: s.smtp_username,
      smtp_from: s.smtp_from,
    };
    if (s.smtp_port) body.smtp_port = s.smtp_port;
    if (smtpPassword) body.smtp_password = smtpPassword;
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error?.message || "保存失败");
      return;
    }
    setS(json);
    setWhitelist(json.email_domain_whitelist.join(", "));
    setSmtpPassword("");
    setSaved(true);
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

  if (!allowed || !s)
    return (
      <>
        <SiteHeader authenticated role="user" />
        <main className="shell">
          <div className="empty">
            需要管理员权限。
            <div style={{ marginTop: 16 }}>
              <Link href="/console" className="btn secondary">返回控制台</Link>
            </div>
          </div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader
        authenticated
        role="admin"
        onLogout={async () => {
          await apiLogout();
          router.replace("/login");
        }}
      />
      <main className="shell">
        <div className="detail-head" style={{ paddingTop: 40 }}>
          <div>
            <h1 className="detail-title">系统设置</h1>
            <div className="admin-bar" style={{ marginTop: 12 }}>
              <Link href="/admin" className="icon-btn">提供商</Link>
              <Link href="/admin/users" className="icon-btn">用户管理</Link>
              <Link href="/admin/stats" className="icon-btn">全服统计</Link>
            </div>
          </div>
        </div>

        <form onSubmit={save} className="settings-form">
          <section className="panel">
            <h2 className="panel-title">注册</h2>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={s.registration_enabled}
                onChange={(e) => update("registration_enabled", e.target.checked)}
              />
              允许自助注册
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={s.email_verification_required}
                onChange={(e) => update("email_verification_required", e.target.checked)}
              />
              注册需要邮箱验证
            </label>
            <div className="field">
              <label>邮箱域名白名单（逗号分隔，留空不限制）</label>
              <input
                value={whitelist}
                onChange={(e) => setWhitelist(e.target.value)}
                placeholder="example.com, company.org"
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">运维</h2>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={s.personal_pages_enabled}
                onChange={(e) => update("personal_pages_enabled", e.target.checked)}
              />
              允许用户创建个人分享页
            </label>
          </section>

          <section className="panel">
            <h2 className="panel-title">密钥共享池</h2>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={s.key_share_enabled}
                onChange={(e) => update("key_share_enabled", e.target.checked)}
              />
              启用密钥共享池（仅用于探测模型）
            </label>
            <div className="field">
              <label>可消费共享池的角色</label>
              <Select
                ariaLabel="共享池消费者"
                value={s.key_share_consumers}
                onChange={(v) => update("key_share_consumers", v as "admin" | "everyone")}
                options={[
                  { value: "admin", label: "仅管理员" },
                  { value: "everyone", label: "所有登录用户" },
                ]}
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">SMTP（邮件）</h2>
            <div className="field">
              <label>SMTP 主机</label>
              <input value={s.smtp_host} onChange={(e) => update("smtp_host", e.target.value)} />
            </div>
            <div className="field">
              <label>端口（465 隐式 TLS）</label>
              <input
                type="number"
                value={s.smtp_port ?? ""}
                onChange={(e) => update("smtp_port", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="field">
              <label>用户名</label>
              <input value={s.smtp_username} onChange={(e) => update("smtp_username", e.target.value)} />
            </div>
            <div className="field">
              <label>密码{s.smtp_password_set ? "（已设置，留空保持不变）" : ""}</label>
              <input
                type="password"
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                placeholder={s.smtp_password_set ? "••••••••" : ""}
              />
            </div>
            <div className="field">
              <label>发件人地址</label>
              <input value={s.smtp_from} onChange={(e) => update("smtp_from", e.target.value)} />
            </div>
          </section>

          {err && <div className="error-box">{err}</div>}
          {saved && <div className="card-domain">已保存 ✓</div>}
          <button className="btn" type="submit">保存设置</button>
        </form>
      </main>
    </>
  );
}

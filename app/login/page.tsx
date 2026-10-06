"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { fetchAuthStatus, apiErrorMessage } from "../lib/api";
import { usePageTitle } from "../lib/usePageTitle";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  // Tab title follows the mode, not just the initial page (register mode
  // previously kept 「登录 · ModelHub」).
  usePageTitle(mode === "login" ? "登录" : "注册");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // email-verification step: set once register returns verification_required
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    void fetchAuthStatus().then((s) => {
      setRegistrationEnabled(s.registration_enabled);
      if (s.authenticated) router.replace("/console");
    });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { username, password }
          : { username, password, email: email || undefined };
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json));
      if (json.verification_required) {
        setPendingEmail(json.email);
        return;
      }
      router.replace("/console");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, "验证失败"));
      router.replace("/console");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "验证失败");
    } finally {
      setBusy(false);
    }
  }

  // ---- email verification step ----
  if (pendingEmail)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="auth-card">
            <h1 className="auth-title">验证邮箱</h1>
            <p className="card-domain" style={{ marginBottom: 20 }}>
              验证码已发送至 {pendingEmail}，请输入 6 位数字。
            </p>
            <form onSubmit={submitCode} className="auth-form">
              <div className="field">
                <label htmlFor="auth-code">验证码</label>
                <input
                  id="auth-code"
                  value={code}
                  onChange={(ev) => setCode(ev.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
              </div>
              {err && (
                <div className="auth-error" role="alert">
                  {err}
                </div>
              )}
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "验证中…" : "完成注册"}
              </button>
            </form>
            <button
              className="auth-switch"
              onClick={() => {
                setPendingEmail(null);
                setCode("");
                setErr(null);
              }}
            >
              返回
            </button>
          </div>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader authenticated={false} />
      <main className="shell">
        <div className="auth-card">
          <h1 className="auth-title">{mode === "login" ? "登录" : "注册"}</h1>
          <form onSubmit={submit} className="auth-form">
            <div className="field">
              <label htmlFor="auth-username">用户名</label>
              <input
                id="auth-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            {mode === "register" && (
              <div className="field">
                <label htmlFor="auth-email">邮箱（可选）</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="auth-password">密码</label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
            </div>
            {err && (
              <div className="auth-error" role="alert">
                {err}
              </div>
            )}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
            </button>
          </form>
          {registrationEnabled && (
            <button
              className="auth-switch"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setErr(null);
              }}
            >
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
          )}
        </div>
      </main>
    </>
  );
}

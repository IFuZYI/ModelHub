"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { fetchAuthStatus } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (!res.ok) throw new Error(json?.error?.message || "操作失败");
      router.replace(json.user?.role === "admin" ? "/admin" : "/console");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader authenticated={false} />
      <main className="shell">
        <div className="auth-card">
          <h1 className="auth-title">
            {mode === "login" ? "登录" : "注册"}
          </h1>
          <form onSubmit={submit} className="auth-form">
            <div className="field">
              <label>用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            {mode === "register" && (
              <div className="field">
                <label>邮箱（可选）</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            )}
            <div className="field">
              <label>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
            </div>
            {err && <div className="auth-error">{err}</div>}
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

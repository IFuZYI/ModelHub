"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConsoleShell from "../../components/ConsoleShell";
import { apiErrorMessage } from "../../lib/api";

/**
 * Console → 账号安全. Self-service password change; other sessions are
 * invalidated server-side (token_version bump) and the user re-logs in.
 */
export default function AccountSecurityPage() {
  const router = useRouter();
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, "修改失败"));
      setMsg("密码已修改，请重新登录。");
      setCurPwd("");
      setNewPwd("");
      setTimeout(() => router.replace("/login"), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConsoleShell title="账号安全" subtitle="修改登录密码，保护你的账号。">
      {() => (
        <section className="panel" style={{ maxWidth: 520 }}>
          <h2 className="panel-title">修改密码</h2>
          <form onSubmit={changePassword} className="settings-form">
            <div className="field">
              <label htmlFor="account-52">当前密码</label>
              <input id="account-52"
                type="password"
                value={curPwd}
                onChange={(e) => setCurPwd(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="account-61">新密码（至少 8 位）</label>
              <input id="account-61"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {err && <div className="error-box">{err}</div>}
            {msg && <div className="card-domain">{msg}</div>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "提交中…" : "修改密码"}
            </button>
          </form>
        </section>
      )}
    </ConsoleShell>
  );
}

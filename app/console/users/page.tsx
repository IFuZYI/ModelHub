"use client";

import { useEffect, useState, useCallback } from "react";
import ConsoleShell from "../../components/ConsoleShell";
import Select from "../../components/Select";
import { fetchAuthStatus, apiErrorMessage } from "../../lib/api";

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  status: "active" | "disabled";
  slug: string | null;
  created_at: string;
}

export default function AdminUsersPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [err, setErr] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (!status.authenticated || status.role !== "admin") {
      setAllowed(false);
      setReady(true);
      return;
    }
    setAllowed(true);
    setSelfId(status.user?.id ?? null);
    const res = await fetch("/api/admin/users", { credentials: "same-origin" });
    const json = await res.json();
    setUsers(json.users ?? []);
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password, email: email || undefined, role: newRole }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(apiErrorMessage(json, "创建失败"));
      return;
    }
    setShowCreate(false);
    setUsername("");
    setPassword("");
    setEmail("");
    setNewRole("user");
    await load();
  }

  async function setStatus(id: string, status: "active" | "disabled") {
    await fetch(`/api/admin/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ status }),
    });
    await load();
  }

  async function setRole(id: string, role: "admin" | "user") {
    await fetch(`/api/admin/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("确定删除该用户？其提供商将一并删除。")) return;
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(apiErrorMessage(json, "删除失败"));
    }
    await load();
  }

  return (
    <>
      <ConsoleShell
        title="用户管理"
        requireAdmin
        subtitle="管理注册用户、角色与启停状态。"
        action={
          <button className="btn" onClick={() => setShowCreate(true)}>
            + 新建用户
          </button>
        }
      >
        {() =>
          !ready ? (
            <div className="spin">加载中…</div>
          ) : !allowed ? (
            <div className="empty">需要管理员权限。</div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>邮箱</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.email ?? "—"}</td>
                      <td>{u.role === "admin" ? "管理员" : "用户"}</td>
                      <td>{u.status === "active" ? "启用" : "禁用"}</td>
                      <td className="row-actions">
                        {u.id === selfId ? (
                          <span className="card-domain">（当前登录）</span>
                        ) : (
                          <>
                            <button
                              className="icon-btn"
                              onClick={() =>
                                setRole(u.id, u.role === "admin" ? "user" : "admin")
                              }
                            >
                              {u.role === "admin" ? "降为用户" : "升为管理员"}
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() =>
                                setStatus(
                                  u.id,
                                  u.status === "active" ? "disabled" : "active"
                                )
                              }
                            >
                              {u.status === "active" ? "禁用" : "启用"}
                            </button>
                            <button
                              className="icon-btn"
                              style={{ color: "var(--err)" }}
                              onClick={() => remove(u.id)}
                            >
                              删除
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </ConsoleShell>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>新建用户</h2>
            <form onSubmit={createUser}>
              <div className="field">
                <label>用户名</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
              <div className="field">
                <label>邮箱（可选）</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field">
                <label>密码</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="field">
                <label>角色</label>
                <Select
                  ariaLabel="角色"
                  value={newRole}
                  onChange={(v) => setNewRole(v as "admin" | "user")}
                  options={[
                    { value: "user", label: "用户" },
                    { value: "admin", label: "管理员" },
                  ]}
                />
              </div>
              {err && <div className="error-box">{err}</div>}
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setShowCreate(false)}>
                  取消
                </button>
                <button type="submit" className="btn">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

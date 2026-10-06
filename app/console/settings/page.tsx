"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ConsoleShell from "../../components/ConsoleShell";
import Select from "../../components/Select";
import ConfirmDialog from "../../components/ConfirmDialog";
import { fetchAuthStatus, apiErrorMessage } from "../../lib/api";

interface Settings {
  registration_enabled: boolean;
  email_verification_required: boolean;
  email_domain_whitelist: string[];
  personal_pages_enabled: boolean;
  key_share_enabled: boolean;
  key_share_consumers: "admin" | "everyone";
  aff_blank_policy: "none" | "random";
  smtp_host: string;
  smtp_port: number | null;
  smtp_username: string;
  smtp_from: string;
  smtp_password_set: boolean;
}

/** Row-count labels for the migration panel (keys match the export tables). */
const COUNT_LABELS: Record<string, string> = {
  users: "用户",
  user_profiles: "个人资料",
  user_providers: "站点",
  model_caches: "模型缓存",
  tags: "标签",
  provider_tags: "站点标签",
  ratings: "评分",
  comments: "评论",
  provider_stats: "全服统计",
  key_pool: "密钥池",
  settings: "系统设置",
};

export default function AdminSettingsPage() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [s, setS] = useState<Settings | null>(null);
  const [pendingReplaceImport, setPendingReplaceImport] = useState(false);
  const [whitelist, setWhitelist] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ---- migration (export / import) ----
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [withSecrets, setWithSecrets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- invite-code pool ----
  const [pools, setPools] = useState<
    {
      normalized_base_url: string;
      base_url: string;
      codes: {
        code: string;
        source: string;
        id: string | null;
        label: string | null;
      }[];
    }[]
  >([]);
  const [newCodeUrl, setNewCodeUrl] = useState("");
  const [newCodeValue, setNewCodeValue] = useState("");
  const [newCodeNote, setNewCodeNote] = useState("");
  const [poolBusy, setPoolBusy] = useState(false);
  const [poolErr, setPoolErr] = useState<string | null>(null);
  const [poolNote, setPoolNote] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    const res = await fetch("/api/admin/invite-codes", {
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = await res.json();
    setPools(json.pools ?? []);
  }, []);

  async function addPoolCode(e: React.FormEvent) {
    e.preventDefault();
    setPoolBusy(true);
    setPoolErr(null);
    setPoolNote(null);
    try {
      const res = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          base_url: newCodeUrl.trim(),
          code: newCodeValue.trim(),
          note: newCodeNote.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, "添加失败"));
      setNewCodeValue("");
      setNewCodeNote("");
      setPoolNote("已加入邀请码池 ✓");
      await loadPools();
    } catch (e2) {
      setPoolErr(e2 instanceof Error ? e2.message : "添加失败");
    } finally {
      setPoolBusy(false);
    }
  }

  async function removePoolCode(id: string) {
    setPoolBusy(true);
    setPoolErr(null);
    try {
      const res = await fetch(`/api/admin/invite-codes/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(json, "删除失败"));
      }
      await loadPools();
    } catch (e2) {
      setPoolErr(e2 instanceof Error ? e2.message : "删除失败");
    } finally {
      setPoolBusy(false);
    }
  }

  const loadCounts = useCallback(async () => {
    const res = await fetch("/api/admin/transfer", {
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = await res.json();
    setCounts(json.counts ?? null);
  }, []);

  async function doExport() {
    setExporting(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/transfer/export${withSecrets ? "?secrets=1" : ""}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(json, "导出失败"));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelhub-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function doImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    if (importMode === "replace") {
      setPendingReplaceImport(true);
      return;
    }
    await runImport(file);
  }

  async function runImport(file: File) {
    setPendingReplaceImport(false);
    setImporting(true);
    setImportErr(null);
    setImportNote(null);
    try {
      const text = await file.text();
      const res = await fetch(`/api/admin/transfer/import?mode=${importMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: text,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(json, "导入失败"));
      const total = Object.values(
        (json.imported ?? {}) as Record<string, number>
      ).reduce((a, b) => a + b, 0);
      setImportNote(
        `导入完成：写入 ${total} 行${json.skipped ? `，跳过 ${json.skipped} 行（缺少上级数据）` : ""}。`
      );
      if (fileRef.current) fileRef.current.value = "";
      await loadCounts();
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (!status.authenticated || status.role !== "admin") {
      setAllowed(false);
      setReady(true);
      return;
    }
    setAllowed(true);
    const res = await fetch("/api/admin/settings", {
      credentials: "same-origin",
    });
    const json: Settings = await res.json();
    setS(json);
    setWhitelist(json.email_domain_whitelist.join(", "));
    await loadCounts();
    await loadPools();
    setReady(true);
  }, [loadCounts, loadPools]);

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
      aff_blank_policy: s.aff_blank_policy,
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
      setErr(apiErrorMessage(json, "保存失败"));
      return;
    }
    setS(json);
    setWhitelist(json.email_domain_whitelist.join(", "));
    setSmtpPassword("");
    setSaved(true);
  }

  return (
    <>
      <ConsoleShell
        title="系统设置"
        requireAdmin
        subtitle="注册、邮件、个人页与密钥共享等全站配置。"
      >
        {() =>
          !ready ? (
            <div className="spin">加载中…</div>
          ) : !allowed || !s ? (
            <div className="empty">需要管理员权限。</div>
          ) : (
            <>
              <form onSubmit={save} className="settings-form">
                <section className="panel">
                  <h2 className="panel-title">注册</h2>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={s.registration_enabled}
                      onChange={(e) =>
                        update("registration_enabled", e.target.checked)
                      }
                    />
                    允许自助注册
                  </label>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={s.email_verification_required}
                      onChange={(e) =>
                        update("email_verification_required", e.target.checked)
                      }
                    />
                    注册需要邮箱验证
                  </label>
                  <div className="field">
                    <label htmlFor="settings-297">
                      邮箱域名白名单（逗号分隔，留空不限制）
                    </label>
                    <input
                      id="settings-297"
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
                      onChange={(e) =>
                        update("personal_pages_enabled", e.target.checked)
                      }
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
                      onChange={(e) =>
                        update("key_share_enabled", e.target.checked)
                      }
                    />
                    启用密钥共享池（仅用于探测模型）
                  </label>
                  <div className="field">
                    <label htmlFor="settings-329">可消费共享池的角色</label>
                    <Select
                      id="settings-329"
                      ariaLabel="共享池消费者"
                      value={s.key_share_consumers}
                      onChange={(v) =>
                        update("key_share_consumers", v as "admin" | "everyone")
                      }
                      options={[
                        { value: "admin", label: "仅管理员" },
                        { value: "everyone", label: "所有登录用户" },
                      ]}
                    />
                  </div>
                </section>

                <section className="panel">
                  <h2 className="panel-title">邀请码</h2>
                  <div className="field">
                    <label htmlFor="settings-345">
                      站点「邀请码 aff」留空时的策略
                    </label>
                    <Select
                      id="settings-345"
                      ariaLabel="邀请码留空策略"
                      value={s.aff_blank_policy}
                      onChange={(v) =>
                        update("aff_blank_policy", v as "none" | "random")
                      }
                      options={[
                        {
                          value: "none",
                          label: "不使用邀请码（链接不带 ?aff=）",
                        },
                        { value: "random", label: "随机：从平台邀请码池抽取" },
                      ]}
                    />
                    <p className="field-hint">
                      站点上填了具体邀请码时始终以填写的为准；填{" "}
                      <code>RANDOM</code> 时同样从池中随机抽取。个人分享页
                      <code>/p/&lt;slug&gt;</code>{" "}
                      始终展示站点主人自己的邀请码，不参与随机。
                    </p>
                  </div>
                </section>

                <section className="panel">
                  <h2 className="panel-title">SMTP（邮件）</h2>
                  <div className="field">
                    <label htmlFor="settings-368">SMTP 主机</label>
                    <input
                      id="settings-368"
                      value={s.smtp_host}
                      onChange={(e) => update("smtp_host", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-372">端口（465 隐式 TLS）</label>
                    <input
                      id="settings-372"
                      type="number"
                      value={s.smtp_port ?? ""}
                      onChange={(e) =>
                        update(
                          "smtp_port",
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-380">用户名</label>
                    <input
                      id="settings-380"
                      value={s.smtp_username}
                      onChange={(e) => update("smtp_username", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-384">
                      密码
                      {s.smtp_password_set ? "（已设置，留空保持不变）" : ""}
                    </label>
                    <input
                      id="settings-384"
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder={s.smtp_password_set ? "••••••••" : ""}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="settings-393">发件人地址</label>
                    <input
                      id="settings-393"
                      value={s.smtp_from}
                      onChange={(e) => update("smtp_from", e.target.value)}
                    />
                  </div>
                </section>

                {err && <div className="error-box" role="alert">{err}</div>}
                {saved && <div className="card-domain" role="status">已保存 ✓</div>}
                <button className="btn" type="submit">
                  保存设置
                </button>
              </form>

              {/* ---- invite-code pool (a separate section, outside the settings form) ---- */}
              {allowed && (
                <section className="panel" style={{ marginTop: 24 }}>
                  <h2 className="panel-title">邀请码池</h2>
                  <p
                    className="card-domain"
                    style={{ marginTop: 0, lineHeight: 1.7 }}
                  >
                    池子由两部分自动合并：
                    <strong>用户在自己站点上填写的邀请码</strong>，
                    以及管理员在此处手动添加的邀请码。主页与站点详情页会从池中随机抽取一个展示；
                    个人分享页始终展示站点主人自己的邀请码。
                  </p>

                  {pools.length === 0 ? (
                    <div className="empty">还没有可用的邀请码。</div>
                  ) : (
                    pools.map((p) => (
                      <div
                        key={p.normalized_base_url}
                        className="admin-subgroup"
                      >
                        <div className="admin-subgroup-label">
                          {p.base_url}
                          <span className="admin-subgroup-count">
                            {p.codes.length}
                          </span>
                        </div>
                        <div className="tag-edit-list">
                          {p.codes.map((c) => (
                            <span
                              key={c.code}
                              className="tag-edit-item"
                              title={
                                c.source === "admin"
                                  ? `管理员添加${c.label ? `：${c.label}` : ""}`
                                  : `来自站点「${c.label ?? "?"}」`
                              }
                            >
                              {c.code}
                              <span
                                className="card-domain"
                                style={{ marginLeft: 6 }}
                              >
                                {c.source === "admin" ? "管理员" : c.label}
                              </span>
                              {c.source === "admin" && c.id && (
                                <button
                                  type="button"
                                  onClick={() => removePoolCode(c.id!)}
                                  disabled={poolBusy}
                                  aria-label={`删除邀请码 ${c.code}`}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))
                  )}

                  <form onSubmit={addPoolCode} style={{ marginTop: 16 }}>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="settings-460">站点地址</label>
                        <input
                          id="settings-460"
                          value={newCodeUrl}
                          onChange={(e) => setNewCodeUrl(e.target.value)}
                          placeholder="https://api.example.com"
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="settings-469">邀请码</label>
                        <input
                          id="settings-469"
                          value={newCodeValue}
                          onChange={(e) => setNewCodeValue(e.target.value)}
                          placeholder="如 dl7w"
                          required
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="settings-479">备注（可选）</label>
                      <input
                        id="settings-479"
                        value={newCodeNote}
                        onChange={(e) => setNewCodeNote(e.target.value)}
                        placeholder="如：站长自己的码"
                      />
                    </div>
                    {poolErr && <div className="error-box" role="alert">{poolErr}</div>}
                    {poolNote && <div className="note-box" role="status">{poolNote}</div>}
                    <button type="submit" className="btn" disabled={poolBusy}>
                      {poolBusy ? "处理中…" : "添加到邀请码池"}
                    </button>
                  </form>
                </section>
              )}

              {/* ---- migration: export / import (outside the settings form) ---- */}
              {allowed && (
                <section className="panel" style={{ marginTop: 24 }}>
                  <h2 className="panel-title">数据迁移</h2>
                  <p
                    className="card-domain"
                    style={{ marginTop: 0, lineHeight: 1.7 }}
                  >
                    导出整站数据（用户、站点、模型缓存、标签、评分、评论、统计与设置），
                    在新服务器上导入即可完成迁移。用户密码以哈希形式携带，迁移后无需重置。
                  </p>

                  {counts && (
                    <div className="seed-models" style={{ marginBottom: 16 }}>
                      {Object.entries(COUNT_LABELS).map(([key, label]) => (
                        <span key={key} className="seed-model">
                          {label} {counts[key] ?? 0}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="field">
                    <h3 className="field-heading">导出</h3>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={withSecrets}
                        onChange={(e) => setWithSecrets(e.target.checked)}
                      />
                      包含密钥（API Key、SMTP 密码）——
                      文件将含明文密钥，请安全保管
                    </label>
                    <button
                      type="button"
                      className="btn"
                      onClick={doExport}
                      disabled={exporting}
                    >
                      {exporting ? "导出中…" : "导出全部数据"}
                    </button>
                  </div>

                  <div className="field" style={{ marginTop: 20 }}>
                    <h3 className="field-heading">导入</h3>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="settings-538">导入方式</label>
                        <Select
                          id="settings-538"
                          ariaLabel="导入方式"
                          value={importMode}
                          onChange={(v) =>
                            setImportMode(v as "merge" | "replace")
                          }
                          options={[
                            {
                              value: "merge",
                              label: "合并（按 ID 更新，保留现有数据）",
                            },
                            { value: "replace", label: "覆盖（先清空再导入）" },
                          ]}
                        />
                      </div>
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      aria-label="选择要导入的 JSON 文件"
                      className="model-textarea"
                      style={{ paddingTop: 10 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={doImport}
                      disabled={importing}
                      style={{ marginTop: 10 }}
                    >
                      {importing ? "导入中…" : "导入数据"}
                    </button>
                  </div>

                  {importErr && <div className="error-box" role="alert">{importErr}</div>}
                  {importNote && <div className="note-box" role="status">{importNote}</div>}
                </section>
              )}
            </>
          )
        }
      </ConsoleShell>

      <ConfirmDialog
        open={pendingReplaceImport}
        title="覆盖导入？"
        body="覆盖导入会先清空本服务器的用户、站点、评论、评分等数据，再写入文件内容。此操作不可撤销。"
        confirmLabel="确认覆盖"
        busy={importing}
        onConfirm={() => {
          const file = fileRef.current?.files?.[0];
          if (file) void runImport(file);
        }}
        onCancel={() => setPendingReplaceImport(false)}
      />
    </>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import Select from "../components/Select";
import { TypeBadge, StatusDot } from "../components/badges";
import ProviderAvatar from "../components/ProviderAvatar";
import { fetchAuthStatus, importNewapiSite } from "../lib/api";
import { typeLabel } from "../lib/display";
import { ProviderView, ProviderType } from "@/lib";
import { OFFICIAL_PRESETS, faviconUrl } from "@/lib/domain/presets";
import type { OfficialPreset } from "@/lib/domain/presets";

interface FormState {
  id?: string;
  name: string;
  type: ProviderType;
  base_url: string;
  aff_code: string;
  key: string;
  /** Emoji/glyph or favicon-URL avatar. */
  icon: string;
  /** Built-in seed models carried from a preset. */
  models: string[];
  /** True for presets whose models are manual (no live listing). */
  manual_models: boolean;
  /** Official website URL shown as the "前往官网" link. */
  site_url: string;
  /** models.dev catalog slug for the models-dev adapter (empty = unused). */
  models_dev_slug: string;
  /** LLMRates dataset provider slug for the llmrates adapter (empty = unused). */
  llmrates_slug: string;
  /** Upstream adapter id (empty = server default openai-compatible). */
  adapter: string;
  /** Sign-up / login methods (NewAPI sites). */
  register_methods: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "native",
  base_url: "",
  aff_code: "",
  key: "",
  icon: "",
  models: [],
  manual_models: false,
  site_url: "",
  models_dev_slug: "",
  llmrates_slug: "",
  adapter: "",
  register_methods: [],
};

/**
 * Add-provider flow. Two-level taxonomy:
 *   menu → official → (原生 / 中转 presets) → form
 *   menu → other    → newapi (quick-import or manual) | custom → form
 */
type Flow = "menu" | "official" | "other" | "newapi" | "form";

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [adminConfigured, setAdminConfigured] = useState(true);

  // login form
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // providers
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [flow, setFlow] = useState<Flow>("menu");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  // newapi quick-import
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  // preset note (caveats for a picked vendor)
  const [presetNote, setPresetNote] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/providers?includeModels=1");
    const json = await res.json();
    setProviders(json.providers ?? []);
  }, []);

  const checkAuth = useCallback(async () => {
    const { authenticated, adminConfigured } = await fetchAuthStatus();
    setAuthed(authenticated);
    setAdminConfigured(adminConfigured);
    if (authenticated) await loadProviders();
    setReady(true);
  }, [loadProviders]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "登录失败");
      setPassword("");
      await checkAuth();
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthed(false);
    setProviders([]);
  }

  function resetModalState() {
    setForm(EMPTY_FORM);
    setFormErr(null);
    setImportUrl("");
    setImportErr(null);
    setImportNote(null);
    setPresetNote(null);
  }

  function openCreate() {
    resetModalState();
    setFlow("menu");
    setShowModal(true);
  }

  function openEdit(p: ProviderView) {
    resetModalState();
    setForm({
      id: p.id,
      name: p.name,
      type: p.type,
      base_url: p.base_url,
      aff_code: p.aff_code ?? "",
      key: "",
      icon: p.icon ?? "",
      models: p.models,
      manual_models: p.manual_models,
      site_url: p.site_url ?? "",
      models_dev_slug: p.models_dev_slug ?? "",
      llmrates_slug: p.llmrates_slug ?? "",
      adapter: p.adapter ?? "",
      register_methods: p.register_methods ?? [],
    });
    setFlow("form");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  // ---- NewAPI quick-import: probe /api/status, then hand off to the form ----
  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setImportErr(null);
    setImportNote(null);
    try {
      const r = await importNewapiSite(importUrl);
      setForm({
        name: r.name ?? "",
        type: "newapi",
        base_url: r.base_url,
        aff_code: r.aff_code ?? "",
        key: "",
        icon: r.icon ?? "",
        models: [],
        manual_models: false,
        site_url: "",
        models_dev_slug: "",
        llmrates_slug: "",
        adapter: "",
        register_methods: r.register_methods ?? [],
      });
      if (!r.reachable) {
        setImportNote(
          "未能读取站点 /api/status（可能不是 NewAPI 站或暂时不可达）。已带入站点地址与邀请码，请手动补全名称。"
        );
      } else if (!r.name) {
        setImportNote("站点已连通，但未返回 system_name，请手动填写名称。");
      }
      setFormErr(null);
      setFlow("form");
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  // ---- preset: seed the form from a built-in vendor (native or proxy) ----
  function pickPreset(preset: OfficialPreset) {
    setForm({
      name: preset.name,
      type: preset.type,
      base_url: preset.base_url,
      aff_code: "",
      key: "",
      icon: faviconUrl(preset.domain),
      models: preset.models,
      manual_models: preset.manual_models ?? false,
      site_url: preset.site_url ?? "",
      models_dev_slug: preset.models_dev_slug ?? "",
      llmrates_slug: preset.llmrates_slug ?? "",
      // Catalog slugs are FALLBACKS, not the primary source: keep the live
      // adapter (openai-compatible, unless the preset forces one) so a keyed
      // fetch uses the real API, and the fetcher falls back to models.dev /
      // LLMRates only when the live listing fails or there's no key.
      adapter: preset.adapter ?? "",
      register_methods: [],
    });
    setPresetNote(preset.note ?? null);
    setFormErr(null);
    setFlow("form");
  }

  function startBlank(type: ProviderType) {
    setForm({ ...EMPTY_FORM, type });
    setPresetNote(null);
    setImportNote(null);
    setFormErr(null);
    setFlow("form");
  }

  // Which flow the form's "← 返回" should go back to.
  function backFlowForType(type: ProviderType): Flow {
    if (type === "native" || type === "proxy") return "official";
    if (type === "newapi") return "newapi";
    return "other";
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErr(null);
    try {
      const isEdit = Boolean(form.id);
      const url = isEdit ? `/api/providers/${form.id}` : "/api/providers";
      const body: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        base_url: form.base_url,
        // always send aff_code so clearing it on edit works ("" clears)
        aff_code: form.aff_code.trim(),
      };
      // On edit, omit an unchanged key; an explicit clear is a separate action.
      if (!isEdit || form.key) body.key = form.key;
      // site_url: official website link. On edit always send so clearing works.
      if (!isEdit) {
        if (form.site_url.trim()) body.site_url = form.site_url.trim();
      } else {
        body.site_url = form.site_url.trim();
      }
      // Adapter + models.dev/LLMRates slug: carry them so a catalog-backed
      // provider syncs from the chosen source. On edit, always send so clearing
      // works.
      if (form.adapter) body.adapter = form.adapter;
      if (!isEdit) {
        if (form.models_dev_slug) body.models_dev_slug = form.models_dev_slug;
        if (form.llmrates_slug) body.llmrates_slug = form.llmrates_slug;
      } else {
        body.models_dev_slug = form.models_dev_slug.trim();
        body.llmrates_slug = form.llmrates_slug.trim();
      }
      // On create, carry the preset's built-in model list + manual flag.
      // For custom/newapi providers the user may edit the model list too.
      if (!isEdit) {
        if (form.models.length > 0) body.models = form.models;
        if (form.manual_models) body.manual_models = true;
      } else if (form.type === "custom" || form.type === "newapi") {
        // allow editing the manual model list on these types
        body.models = form.models;
        body.manual_models = form.manual_models;
      }
      // icon: always send (empty string clears on edit).
      body.icon = form.icon.trim();
      // register_methods: send when present (NewAPI import fills these).
      if (form.register_methods.length > 0) {
        body.register_methods = form.register_methods;
      }

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "保存失败");
      setShowModal(false);
      await loadProviders();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh(id: string) {
    await fetch(`/api/providers/${id}/refresh`, { method: "POST" });
    await loadProviders();
  }

  async function remove(id: string) {
    if (!confirm("确定删除这个提供商？")) return;
    await fetch(`/api/providers/${id}`, { method: "DELETE" });
    await loadProviders();
  }

  // ---- grouped admin listing: 官方(原生/中转) / 其他(NewAPI/自建) ----
  function ProviderCard({ p }: { p: ProviderView }) {
    return (
      <div className="site-card" style={{ cursor: "default" }}>
        <div className="card-top">
          <ProviderAvatar name={p.name} icon={p.icon} />
          <div className="card-identity">
            <p className="card-title">{p.name}</p>
            <div className="card-domain">{p.base_url}</div>
          </div>
        </div>
        <div className="card-bottom">
          <TypeBadge type={p.type} />
          <span className="card-tag">{p.model_count} 模型</span>
          <StatusDot status={p.last_status} />
        </div>
        {p.last_error && (
          <div className="error-box" style={{ marginBottom: 0 }}>
            {p.last_error}
          </div>
        )}
        <div className="admin-bar" style={{ marginBottom: 0 }}>
          <button className="icon-btn" onClick={() => refresh(p.id)}>
            刷新
          </button>
          <button className="icon-btn" onClick={() => openEdit(p)}>
            编辑
          </button>
          <button
            className="icon-btn"
            style={{ color: "var(--err)" }}
            onClick={() => remove(p.id)}
          >
            删除
          </button>
        </div>
      </div>
    );
  }

  function renderGroupedProviders() {
    // Sub-group definitions: 官方 → 原生/中转, 其他 → NewAPI/自建.
    const groups: {
      category: string;
      subs: { type: ProviderType; items: ProviderView[] }[];
    }[] = [
      {
        category: "官方",
        subs: [
          { type: "native", items: [] },
          { type: "proxy", items: [] },
        ],
      },
      {
        category: "其他",
        subs: [
          { type: "newapi", items: [] },
          { type: "custom", items: [] },
        ],
      },
    ];
    for (const p of providers) {
      for (const g of groups) {
        const sub = g.subs.find((s) => s.type === p.type);
        if (sub) sub.items.push(p);
      }
    }
    return (
      <div className="admin-groups">
        {groups.map((g) => {
          const total = g.subs.reduce((n, s) => n + s.items.length, 0);
          if (total === 0) return null;
          return (
            <section key={g.category} className="admin-group">
              <h2 className="admin-group-title">
                {g.category}
                <span className="admin-group-count">{total}</span>
              </h2>
              {g.subs.map((s) =>
                s.items.length === 0 ? null : (
                  <div key={s.type} className="admin-subgroup">
                    <div className="admin-subgroup-label">
                      {typeLabel(s.type)}
                      <span className="admin-subgroup-count">
                        {s.items.length}
                      </span>
                    </div>
                    <div className="card-grid">
                      {s.items.map((p) => (
                        <ProviderCard key={p.id} p={p} />
                      ))}
                    </div>
                  </div>
                )
              )}
            </section>
          );
        })}
      </div>
    );
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

  // ---- not authenticated: login screen ----
  if (!authed)
    return (
      <>
        <SiteHeader authenticated={false} />
        <main className="shell">
          <div className="login-wrap">
            <div className="login-card">
              <h1>管理后台</h1>
              <p>
                {adminConfigured
                  ? "输入管理员密码以配置提供商。"
                  : "未设置 MODELHUB_ADMIN_PASSWORD，后台已禁用。请在环境变量中配置后重启。"}
              </p>
              {adminConfigured && (
                <form onSubmit={login}>
                  <div className="field">
                    <label>密码</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="管理员密码"
                      required
                    />
                  </div>
                  {loginErr && <div className="error-box">{loginErr}</div>}
                  <button
                    type="submit"
                    className="btn"
                    style={{ width: "100%" }}
                    disabled={loggingIn}
                  >
                    {loggingIn ? "登录中…" : "登录"}
                  </button>
                </form>
              )}
              <div style={{ marginTop: 18, textAlign: "center" }}>
                <Link href="/" className="back-link">
                  ← 返回前台
                </Link>
              </div>
            </div>
          </div>
        </main>
      </>
    );

  // ---- authenticated: admin console ----
  return (
    <>
      <SiteHeader authenticated onLogout={logout} />
      <main className="shell">
        <div className="detail-head" style={{ paddingTop: 40 }}>
          <div>
            <h1 className="detail-title">后台 · 提供商配置</h1>
            <p className="card-domain" style={{ marginTop: 10 }}>
              添加、编辑、删除提供商，密钥加密存储，永不下发前台。
            </p>
          </div>
          <button className="btn" onClick={openCreate}>
            + 添加提供商
          </button>
        </div>

        {providers.length === 0 ? (
          <div className="empty">还没有提供商，点击右上角添加。</div>
        ) : (
          renderGroupedProviders()
        )}
      </main>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {/* ---- flow: level-1 menu (官方 / 其他) ---- */}
            {flow === "menu" && (
              <>
                <h2>添加提供商</h2>
                <div className="choice-grid">
                  <button
                    type="button"
                    className="choice-card"
                    onClick={() => setFlow("official")}
                  >
                    <span className="choice-icon">✦</span>
                    <span className="choice-title">官方</span>
                    <span className="choice-desc">
                      各厂商原生 API 与中转平台，从内置列表一键选择
                    </span>
                  </button>
                  <button
                    type="button"
                    className="choice-card"
                    onClick={() => setFlow("other")}
                  >
                    <span className="choice-icon">⇄</span>
                    <span className="choice-title">其他</span>
                    <span className="choice-desc">
                      NewAPI 中转站（支持快捷导入）或自建站点
                    </span>
                  </button>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={closeModal}
                  >
                    取消
                  </button>
                </div>
              </>
            )}

            {/* ---- flow: 官方 preset picker (原生 + 中转) ---- */}
            {flow === "official" && (
              <>
                <h2>选择官方提供商</h2>
                <div className="preset-scroll">
                  {/* 原生: grouped by region */}
                  {(["国际", "中国", "企业"] as const).map((region) => {
                    const items = OFFICIAL_PRESETS.filter(
                      (p) => p.type === "native" && p.region === region
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={region} className="preset-group">
                        <div className="preset-group-label">
                          原生 · {region}
                        </div>
                        <div className="preset-grid">
                          {items.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className="preset-item"
                              onClick={() => pickPreset(preset)}
                              title={preset.models.join(", ")}
                            >
                              <ProviderAvatar
                                name={preset.name}
                                icon={faviconUrl(preset.domain)}
                                className="preset-avatar"
                              />
                              <span className="preset-name">{preset.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {/* 中转 */}
                  <div className="preset-group">
                    <div className="preset-group-label">中转 · 聚合路由</div>
                    <div className="preset-grid">
                      {OFFICIAL_PRESETS.filter((p) => p.type === "proxy").map(
                        (preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className="preset-item"
                            onClick={() => pickPreset(preset)}
                            title={preset.models.join(", ")}
                          >
                            <ProviderAvatar
                              name={preset.name}
                              icon={faviconUrl(preset.domain)}
                              className="preset-avatar"
                            />
                            <span className="preset-name">{preset.name}</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setFlow("menu")}
                  >
                    ← 返回
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => startBlank("native")}
                  >
                    手动·原生
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => startBlank("proxy")}
                  >
                    手动·中转
                  </button>
                </div>
              </>
            )}

            {/* ---- flow: 其他 sub-menu (NewAPI / 自建) ---- */}
            {flow === "other" && (
              <>
                <h2>其他提供商</h2>
                <div className="choice-grid">
                  <button
                    type="button"
                    className="choice-card"
                    onClick={() => {
                      setImportUrl("");
                      setImportErr(null);
                      setFlow("newapi");
                    }}
                  >
                    <span className="choice-icon">🔗</span>
                    <span className="choice-title">NewAPI</span>
                    <span className="choice-desc">
                      粘贴站点链接快捷导入，或手动填表
                    </span>
                  </button>
                  <button
                    type="button"
                    className="choice-card"
                    onClick={() => startBlank("custom")}
                  >
                    <span className="choice-icon">⚙</span>
                    <span className="choice-title">其他 / 自建</span>
                    <span className="choice-desc">
                      任意 OpenAI 兼容站点，手动填写
                    </span>
                  </button>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setFlow("menu")}
                  >
                    ← 返回
                  </button>
                </div>
              </>
            )}

            {/* ---- flow: NewAPI quick-import ---- */}
            {flow === "newapi" && (
              <>
                <h2>NewAPI 快捷导入</h2>
                <form onSubmit={runImport}>
                  <div className="field">
                    <label>站点链接（首页 / 注册链接 / 含 ?aff= 均可）</label>
                    <input
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder="https://api.example.top/sign-up?aff=XXXX"
                      autoFocus
                      required
                    />
                  </div>
                  <p className="field-hint">
                    将读取 <code>站点/api/status</code> 的{" "}
                    <code>system_name</code> 作为名称、<code>logo</code>{" "}
                    作为图标，并从 <code>?aff=</code> 解析邀请码。
                  </p>
                  {importErr && <div className="error-box">{importErr}</div>}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setFlow("other")}
                    >
                      ← 返回
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => startBlank("newapi")}
                    >
                      手动填写
                    </button>
                    <button type="submit" className="btn" disabled={importing}>
                      {importing ? "解析中…" : "解析并继续"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* ---- flow: the actual form (create/edit) ---- */}
            {flow === "form" && (
              <>
                <h2>
                  {form.id
                    ? "编辑提供商"
                    : form.type === "native"
                      ? "添加官方·原生 API"
                      : form.type === "proxy"
                        ? "添加官方·中转"
                        : form.type === "newapi"
                          ? "添加 NewAPI 站点"
                          : "添加其他 / 自建"}
                </h2>
                <form onSubmit={submitForm}>
                  {importNote && <div className="note-box">{importNote}</div>}
                  {presetNote && <div className="note-box">{presetNote}</div>}
                  {!form.id && form.register_methods.length > 0 && (
                    <div className="note-box">
                      支持的注册方式：
                      <div className="reg-methods">
                        {form.register_methods.map((m) => (
                          <span key={m} className="reg-chip">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {!form.id && form.models.length > 0 && (
                    <div className="note-box">
                      已内置 {form.models.length} 个模型
                      {form.manual_models
                        ? "（该厂商无模型列表接口，将始终使用内置列表）"
                        : "（作为初始列表，抓取成功后会自动更新）"}
                      ：
                      <div className="seed-models">
                        {form.models.map((m) => (
                          <span key={m} className="seed-model">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="field">
                    <label>名称</label>
                    <input
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="My OpenAI"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>
                      图标 icon（可选，emoji 或图标 URL；留空用名称首字母）
                    </label>
                    <div className="icon-field">
                      <ProviderAvatar
                        name={form.name || "?"}
                        icon={form.icon}
                        className="icon-preview"
                      />
                      <input
                        value={form.icon}
                        onChange={(e) =>
                          setForm({ ...form, icon: e.target.value })
                        }
                        placeholder="🟢 或 https://.../favicon.ico"
                        maxLength={300}
                      />
                    </div>
                  </div>
                  {/* Type is only editable when editing; new providers keep the
                      type chosen in the flow above. */}
                  {form.id && (
                    <div className="field">
                      <label>类型</label>
                      <Select
                        ariaLabel="提供商类型"
                        value={form.type}
                        onChange={(v) =>
                          setForm({ ...form, type: v as ProviderType })
                        }
                        options={[
                          { value: "native", label: "官方·原生" },
                          { value: "proxy", label: "官方·中转" },
                          { value: "newapi", label: "NewAPI" },
                          { value: "custom", label: "其他 / 自建" },
                        ]}
                      />
                    </div>
                  )}
                  <div className="field">
                    <label>Base URL（不带 /v1）</label>
                    <input
                      value={form.base_url}
                      onChange={(e) =>
                        setForm({ ...form, base_url: e.target.value })
                      }
                      placeholder="https://api.openai.com"
                      required
                    />
                  </div>
                  {/* 官网地址：用户点「前往官网」跳转的落地页，与 API 地址区分。 */}
                  <div className="field">
                    <label>官网地址（可选，用户点“前往官网”跳转，留空则用 Base URL）</label>
                    <input
                      value={form.site_url}
                      onChange={(e) =>
                        setForm({ ...form, site_url: e.target.value })
                      }
                      placeholder="https://openai.com"
                    />
                  </div>
                  {form.type === "newapi" && (
                    <div className="field">
                      <label>邀请码 aff（可选，NewAPI 站点用）</label>
                      <input
                        value={form.aff_code}
                        onChange={(e) =>
                          setForm({ ...form, aff_code: e.target.value })
                        }
                        placeholder="如 XXX，将拼接为 站点?aff=XXX"
                      />
                    </div>
                  )}
                  {/* 自定义模型：其他/自建，或任何抓取不到模型的场景手动补充。 */}
                  {(form.type === "custom" || form.type === "newapi") && (
                    <div className="field">
                      <label>
                        自定义模型（可选，每行一个；填写后视为固定列表，不再自动抓取覆盖）
                      </label>
                      <textarea
                        className="model-textarea"
                        value={form.models.join("\n")}
                        onChange={(e) => {
                          const list = e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setForm({
                            ...form,
                            models: list,
                            manual_models: list.length > 0,
                          });
                        }}
                        placeholder={"gpt-4o\nclaude-sonnet-4\ndeepseek-chat"}
                        rows={4}
                      />
                    </div>
                  )}
                  <div className="field">
                    <label>
                      API Key（
                      {form.type === "newapi"
                        ? "可选，公开 /api/pricing 可不填"
                        : "通常必填"}
                      {form.id ? "；留空不修改已存密钥" : ""}）
                    </label>
                    <input
                      type="password"
                      value={form.key}
                      onChange={(e) =>
                        setForm({ ...form, key: e.target.value })
                      }
                      placeholder="sk-...（可留空）"
                    />
                  </div>
                  {/* models.dev 目录同步：填写 slug 后用 models-dev 适配器
                      从公共目录抓取模型列表，无需 API Key。 */}
                  <div className="field">
                    <label>
                      models.dev 目录 slug（可选，填写后从 models.dev 同步模型，无需
                      Key）
                    </label>
                    <input
                      value={form.models_dev_slug}
                      onChange={(e) =>
                        setForm({ ...form, models_dev_slug: e.target.value })
                      }
                      placeholder="如 openai、anthropic、google、openrouter"
                    />
                  </div>
                  {/* LLMRates 数据集同步：models.dev 缺失的厂商（如
                      SambaNova、Perplexity）可用它，无需 API Key。 */}
                  <div className="field">
                    <label>
                      LLMRates 数据集 slug（可选，models.dev
                      缺的厂商用它同步模型，无需 Key）
                    </label>
                    <input
                      value={form.llmrates_slug}
                      onChange={(e) =>
                        setForm({ ...form, llmrates_slug: e.target.value })
                      }
                      placeholder="如 sambanova、perplexity、volcano-ark"
                    />
                  </div>
                  {formErr && <div className="error-box">{formErr}</div>}
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() =>
                        form.id
                          ? closeModal()
                          : setFlow(backFlowForType(form.type))
                      }
                    >
                      {form.id ? "取消" : "← 返回"}
                    </button>
                    <button type="submit" className="btn" disabled={submitting}>
                      {submitting ? "保存中…" : "保存并抓取"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

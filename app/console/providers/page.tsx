"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import ConsoleShell from "../../components/ConsoleShell";
import Select from "../../components/Select";
import ConfirmDialog from "../../components/ConfirmDialog";
import ModalShell from "../../components/ModalShell";
import { TypeBadge, StatusDot } from "../../components/badges";
import ProviderAvatar from "../../components/ProviderAvatar";
import {
  fetchAuthStatus,
  importNewapiSite,
  apiErrorMessage,
} from "../../lib/api";
import { ProviderType, FreeTier } from "@/lib";
import { OFFICIAL_PRESETS, faviconUrl } from "@/lib/domain/presets";
import type { OfficialPreset } from "@/lib/domain/presets";
import { CATALOG_SLUG_FIELDS } from "../../lib/providerForm";

/** The current user's provider (mirror of lib UserProviderView, client-side). */
interface ProviderView {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  icon: string | null;
  aff_code: string | null;
  adapter: string;
  catalog_slugs: Record<string, string>;
  has_key: boolean;
  manual_models: boolean;
  register_methods: string[];
  invite_url: string | null;
  model_count: number;
  /**
   * Model names are NOT part of this list projection (the endpoint returns the
   * count-only meta view for performance). Load them from
   * `/api/providers/{id}` before populating an edit form.
   */
  models?: string[];
  last_status: "ok" | "error" | "pending" | "needs_key";
  last_error: string | null;
  tags: { slug: string; name: string }[];
}

interface FormState {
  name: string;
  /** Optional human description of the provider. */
  description: string;
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
  /** Free-tier grade: "full" | "free" | "none". */
  free_tier: FreeTier;
  /** Per-source catalog slugs (adapter id → slug) for no-key model sync. */
  catalog_slugs: Record<string, string>;
  /** Upstream adapter id (empty = server default openai-compatible). */
  adapter: string;
  /** Sign-up / login methods (NewAPI sites). */
  register_methods: string[];
  /** Custom tags (blog taxonomy). */
  tags: string[];
}

/**
 * Catalog slug inputs shown for official providers (adapter id + labels).
 *
 * Declared once in lib/providerForm.ts, shared with the full-page editor —
 * two copies of this list would drift.
 */

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  type: "native",
  base_url: "",
  aff_code: "",
  key: "",
  icon: "",
  models: [],
  manual_models: false,
  free_tier: "none",
  catalog_slugs: {},
  adapter: "",
  register_methods: [],
  tags: [],
};

/**
 * Add-provider flow. Two-level taxonomy:
 *   menu → official → (原生 / 中转 presets) → form
 *   menu → other    → newapi (quick-import or manual) | custom → form
 */
type Flow = "menu" | "official" | "other" | "newapi" | "form";

/**
 * Tag editor: comma/enter-separated input rendered as removable chips.
 * Tags are free-form; the server resolves names into the global vocabulary.
 */
function TagsField({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const parts = draft
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...tags];
    for (const p of parts) {
      if (!next.includes(p) && next.length < 12) next.push(p);
    }
    onChange(next);
    setDraft("");
  }

  return (
    <div className="field">
      <label htmlFor="tag-input">标签（可选，逗号分隔，最多 12 个）</label>
      <div className="tag-input-row">
        <input
          id="tag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "，") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder="如：免费、稳定、国产模型…（回车或逗号确认）"
        />
        <button type="button" className="icon-btn" onClick={commit}>
          添加
        </button>
      </div>
      {tags.length > 0 && (
        <div className="tag-edit-list">
          {tags.map((t) => (
            <span key={t} className="tag-edit-item">
              #{t}
              <button
                type="button"
                onClick={() => onChange(tags.filter((x) => x !== t))}
                aria-label={`移除标签 ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Progressive-disclosure section for the add/edit form. Sections start
 * collapsed unless the provider already has content for them, so a fresh
 * NewAPI form shows only the core fields while an existing site shows what it
 * has. Some content (the model list) only arrives after an async fetch, so the
 * section keeps following `defaultOpen` until the user toggles it themselves —
 * after that the user's choice wins.
 */
function FormSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <details
      className="field-group"
      open={open}
      onToggle={(e) => {
        const next = (e.target as HTMLDetailsElement).open;
        touched.current = true;
        setOpen(next);
      }}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export default function AdminPage() {
  const [ready, setReady] = useState(false);

  // providers
  const [providers, setProviders] = useState<ProviderView[]>([]);
  /** Active type filter on the site list; "all" keeps the grouped view. */
  const [typeFilter, setTypeFilter] = useState<ProviderType | "all">("all");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [flow, setFlow] = useState<Flow>("menu");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  // Refresh guard: state drives the label, the ref blocks same-tick double
  // clicks (two rapid clicks both run before React re-renders). Without it a
  // triple-click fired three concurrent refresh+reload cycles at the upstream
  // site, and the button gave no feedback at all.
  const refreshingRef = useRef<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  // newapi quick-import
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  // preset note (caveats for a picked vendor)
  const [presetNote, setPresetNote] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    const res = await fetch("/api/me/providers", {
      credentials: "same-origin",
    });
    const json = await res.json();
    setProviders(json.providers ?? []);
  }, []);

  const checkAuth = useCallback(async () => {
    const status = await fetchAuthStatus();
    if (status.authenticated) await loadProviders();
    setReady(true);
  }, [loadProviders]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

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
        description: "",
        type: "newapi",
        base_url: r.base_url,
        aff_code: r.aff_code ?? "",
        key: "",
        icon: r.icon ?? "",
        models: [],
        manual_models: false,
        free_tier: "none",
        catalog_slugs: {},
        adapter: "",
        register_methods: r.register_methods ?? [],
        tags: [],
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
      description: preset.description ?? "",
      type: preset.type,
      base_url: preset.base_url,
      aff_code: "",
      key: "",
      icon: faviconUrl(preset.domain),
      models: preset.models,
      manual_models: preset.manual_models ?? false,
      free_tier: preset.free_tier ?? "none",
      catalog_slugs: { ...(preset.catalog_slugs ?? {}) },
      adapter: preset.adapter ?? "",
      register_methods: [],
      tags: [],
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

  // The modal creates a provider; editing an existing one navigates to the
  // full-page editor (/console/providers/{id}), so there is no edit branch here.
  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErr(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description.trim(),
        type: form.type,
        base_url: form.base_url.trim(),
        aff_code: form.aff_code.trim(),
      };
      body.key = form.key;
      body.free_tier = form.free_tier;
      if (form.adapter) body.adapter = form.adapter;
      // catalog_slugs: keep only non-empty entries.
      const slugs = Object.fromEntries(
        Object.entries(form.catalog_slugs)
          .map(([id, v]) => [id, v.trim()])
          .filter(([, v]) => v)
      );
      if (Object.keys(slugs).length > 0) {
        body.catalog_slugs = slugs;
      }
      // Carry the preset's built-in model list + manual flag.
      if (form.models.length > 0) body.models = form.models;
      if (form.manual_models) body.manual_models = true;
      body.icon = form.icon.trim();
      // register_methods: send when present (NewAPI import fills these).
      if (form.register_methods.length > 0) {
        body.register_methods = form.register_methods;
      }
      body.tags = form.tags;

      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "保存失败"));
      setShowModal(false);
      await loadProviders();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function refresh(id: string) {
    if (refreshingRef.current.has(id)) return;
    refreshingRef.current.add(id);
    setRefreshing(new Set(refreshingRef.current));
    try {
      await fetch(`/api/providers/${id}/refresh`, { method: "POST" });
      await loadProviders();
    } finally {
      refreshingRef.current.delete(id);
      setRefreshing(new Set(refreshingRef.current));
    }
  }

  async function remove(id: string) {
    setDeleteErr(null);
    setPendingDelete(id);
  }

  async function confirmDelete() {
    const id = pendingDelete;
    if (!id) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDeleteErr(apiErrorMessage(json, "删除失败"));
        return;
      }
      setPendingDelete(null);
      setDeleteErr(null);
      await loadProviders();
    } finally {
      setDeleteBusy(false);
    }
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
          <div className="error-box" role="alert" style={{ marginBottom: 0 }}>
            {p.last_error}
          </div>
        )}
        <div className="admin-bar" style={{ marginBottom: 0 }}>
          <button
            className="icon-btn"
            disabled={refreshing.has(p.id)}
            onClick={() => refresh(p.id)}
          >
            {refreshing.has(p.id) ? "刷新中…" : "刷新"}
          </button>
          <Link className="icon-btn" href={`/console/providers/${p.id}`}>
            编辑
          </Link>
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

  /**
   * Site list with a type switcher instead of every group stacked in one long
   * column: chips filter to a single type (官方·原生 / 官方·中转 / NewAPI /
   * 其他·自建), and "全部" keeps the grouped view.
   */
  function renderGroupedProviders() {
    const subs: { type: ProviderType; label: string }[] = [
      { type: "native", label: "官方·原生" },
      { type: "proxy", label: "官方·中转" },
      { type: "newapi", label: "NewAPI" },
      { type: "custom", label: "其他 / 自建" },
    ];
    const byType = new Map<ProviderType, ProviderView[]>(
      subs.map((s) => [s.type, []])
    );
    for (const p of providers) byType.get(p.type)?.push(p);

    const shown =
      typeFilter === "all" ? providers : (byType.get(typeFilter) ?? []);

    return (
      <>
        <div className="vendor-filter">
          <button
            className={`vendor-chip ${typeFilter === "all" ? "active" : ""}`}
            onClick={() => setTypeFilter("all")}
          >
            全部
            <span className="vendor-chip-count">{providers.length}</span>
          </button>
          {subs.map((s) => {
            const items = byType.get(s.type) ?? [];
            if (items.length === 0) return null;
            return (
              <button
                key={s.type}
                className={`vendor-chip ${
                  typeFilter === s.type ? "active" : ""
                }`}
                onClick={() => setTypeFilter(s.type)}
              >
                {s.label}
                <span className="vendor-chip-count">{items.length}</span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <div className="empty">该分类下还没有站点。</div>
        ) : typeFilter === "all" ? (
          // Grouped view: only the labels of types that actually have items.
          <div className="admin-groups">
            {subs.map((s) => {
              const items = byType.get(s.type) ?? [];
              if (items.length === 0) return null;
              return (
                <section key={s.type} className="admin-subgroup">
                  <div className="admin-subgroup-label">
                    {s.label}
                    <span className="admin-subgroup-count">{items.length}</span>
                  </div>
                  <div className="card-grid">
                    {items.map((p) => (
                      <ProviderCard key={p.id} p={p} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="card-grid">
            {shown.map((p) => (
              <ProviderCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </>
    );
  }

  if (!ready)
    return (
      <ConsoleShell
        title="我的站点"
        subtitle="管理你自己的站点，密钥加密存储、永不下发前台。"
      >
        {() => <div className="spin">加载中…</div>}
      </ConsoleShell>
    );

  // ---- authenticated: unified console (manage YOUR providers) ----
  return (
    <>
      <ConsoleShell
        title="我的站点"
        subtitle="管理你自己的站点，密钥加密存储、永不下发前台。"
        action={
          <button className="btn" onClick={openCreate}>
            + 添加站点
          </button>
        }
      >
        {() => (
          <>
            {providers.length === 0 ? (
              <div className="empty">还没有站点，点击右上角添加。</div>
            ) : (
              renderGroupedProviders()
            )}
          </>
        )}
      </ConsoleShell>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个站点？"
        body="站点配置与模型缓存将被移除，此操作无法撤销。"
        busy={deleteBusy}
        error={deleteErr}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteErr(null);
          setPendingDelete(null);
        }}
      />

      {showModal && (
        <ModalShell label="添加提供商" onClose={closeModal}>
          {/* ---- flow: level-1 menu (官方 / 其他) ---- */}
          {flow === "menu" && (
            <>
              <h2>添加提供商</h2>
              <div className="modal-scroll">
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
              <div className="modal-scroll">
                {/* 原生: grouped by region */}
                {(["国际", "中国", "企业"] as const).map((region) => {
                  const items = OFFICIAL_PRESETS.filter(
                    (p) => p.type === "native" && p.region === region
                  );
                  if (items.length === 0) return null;
                  return (
                    <div key={region} className="preset-group">
                      <div className="preset-group-label">原生 · {region}</div>
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
              <div className="modal-scroll">
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
              <div className="modal-scroll">
                <form id="newapi-import-form" onSubmit={runImport}>
                  <div className="field">
                    <label htmlFor="providers-840">
                      站点链接（首页 / 注册链接 / 含 ?aff= 均可）
                    </label>
                    <input
                      id="providers-840"
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
                  {importErr && (
                    <div className="error-box" role="alert">
                      {importErr}
                    </div>
                  )}
                </form>
              </div>
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
                <button
                  type="submit"
                  form="newapi-import-form"
                  className="btn"
                  disabled={importing}
                >
                  {importing ? "解析中…" : "解析并继续"}
                </button>
              </div>
            </>
          )}

          {/* ---- flow: the actual form (create) ---- */}
          {flow === "form" && (
            <>
              <h2>
                {form.type === "native"
                  ? "添加官方·原生 API"
                  : form.type === "proxy"
                    ? "添加官方·中转"
                    : form.type === "newapi"
                      ? "添加 NewAPI 站点"
                      : "添加其他 / 自建"}
              </h2>
              <div className="modal-scroll">
                <form id="provider-form" onSubmit={submitForm}>
                  {importNote && (
                    <div className="note-box" role="status">
                      {importNote}
                    </div>
                  )}
                  {presetNote && (
                    <div className="note-box" role="status">
                      {presetNote}
                    </div>
                  )}
                  {form.register_methods.length > 0 && (
                    <div className="note-box" role="status">
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
                  {form.models.length > 0 && (
                    // Plain text, not role="status": this count changes while
                    // the user types in the model textarea, and a live region
                    // would re-announce on every keystroke.
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
                    <label htmlFor="providers-931">名称</label>
                    <input
                      id="providers-931"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="My OpenAI"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="provider-icon-new">
                      图标 icon（可选，emoji 或图标 URL；留空用名称首字母）
                    </label>
                    <div className="icon-field">
                      <ProviderAvatar
                        name={form.name || "?"}
                        icon={form.icon}
                        className="icon-preview"
                      />
                      <input
                        id="provider-icon-new"
                        value={form.icon}
                        onChange={(e) =>
                          setForm({ ...form, icon: e.target.value })
                        }
                        placeholder="🟢 或 https://.../favicon.ico"
                        maxLength={300}
                      />
                    </div>
                  </div>
                  {/* FREE flag; the type was chosen in the flow above. */}
                  <div className="field-row">
                    {/* Free-tier grade: 三档单选 ALL FREE / FREE / NO. */}
                    <div className="field">
                      <label htmlFor="providers-984">免费额度</label>
                      <Select
                        id="providers-984"
                        ariaLabel="免费额度分级"
                        value={form.free_tier}
                        onChange={(v) =>
                          setForm({ ...form, free_tier: v as FreeTier })
                        }
                        options={[
                          { value: "none", label: "NO（付费）" },
                          { value: "free", label: "FREE（有免费额度）" },
                          { value: "full", label: "ALL FREE（完全免费）" },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="providers-1000">官网地址</label>
                    <input
                      id="providers-1000"
                      value={form.base_url}
                      onChange={(e) =>
                        setForm({ ...form, base_url: e.target.value })
                      }
                      placeholder="https://openai.com"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="providers-1011">描述（可选）</label>
                    <textarea
                      id="providers-1011"
                      className="model-textarea"
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      placeholder="一句话介绍这个提供商，展示在详情页。"
                      rows={2}
                    />
                  </div>
                  {form.type === "newapi" && (
                    <FormSection
                      title="邀请码 aff"
                      defaultOpen={Boolean(form.aff_code)}
                    >
                      <div className="field">
                        <label htmlFor="providers-1028">
                          邀请码 aff（可选）
                        </label>
                        <input
                          id="providers-1028"
                          value={form.aff_code}
                          onChange={(e) =>
                            setForm({ ...form, aff_code: e.target.value })
                          }
                          placeholder="留空不拼邀请码；填 RANDOM 从平台邀请码池随机抽取"
                        />
                        <p className="field-hint">
                          填 <code>RANDOM</code>{" "}
                          表示每次展示时从平台邀请码池随机取一个。
                        </p>
                      </div>
                    </FormSection>
                  )}
                  {(form.type === "custom" || form.type === "newapi") && (
                    <FormSection
                      title="自定义模型（每行一个）"
                      defaultOpen={form.manual_models || form.models.length > 0}
                    >
                      <div className="field">
                        <label htmlFor="providers-1051">
                          自定义模型（可选，每行一个）
                        </label>
                        <textarea
                          id="providers-1051"
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
                          placeholder={"每行一个模型名称"}
                          rows={4}
                        />
                      </div>
                    </FormSection>
                  )}
                  <FormSection title="标签" defaultOpen={form.tags.length > 0}>
                    <TagsField
                      tags={form.tags}
                      onChange={(tags) => setForm({ ...form, tags })}
                    />
                  </FormSection>
                  {/* Advanced settings (API Key + model sync sources), always
                        collapsed by default. Field docs: docs/PROVIDER_FORM.md. */}
                  <FormSection title="高级设置（API Key、模型同步来源）">
                    <div className="field">
                      <label htmlFor="providers-1086">
                        API Key{form.type === "newapi" ? "（可选）" : ""}
                      </label>
                      <input
                        id="providers-1086"
                        type="password"
                        value={form.key}
                        onChange={(e) =>
                          setForm({ ...form, key: e.target.value })
                        }
                        placeholder="sk-...（可留空）"
                      />
                    </div>
                    {(form.type === "native" || form.type === "proxy") &&
                      CATALOG_SLUG_FIELDS.map((f) => (
                        <div className="field" key={f.id}>
                          <label htmlFor={`catalog-${f.id}`}>{f.label}</label>
                          <input
                            id={`catalog-${f.id}`}
                            value={form.catalog_slugs[f.id] ?? ""}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                catalog_slugs: {
                                  ...form.catalog_slugs,
                                  [f.id]: e.target.value,
                                },
                              })
                            }
                            placeholder={f.placeholder}
                          />
                        </div>
                      ))}
                  </FormSection>
                  {formErr && (
                    <div className="error-box" role="alert">
                      {formErr}
                    </div>
                  )}
                </form>
              </div>
              {/* Footer lives outside the scroll area and submits the form
                    via its id, so 保存并抓取 stays reachable on any height. */}
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setFlow(backFlowForType(form.type))}
                >
                  ← 返回
                </button>
                <button
                  type="submit"
                  form="provider-form"
                  className="btn"
                  disabled={submitting}
                >
                  {submitting ? "保存中…" : "保存并抓取"}
                </button>
              </div>
            </>
          )}
        </ModalShell>
      )}
    </>
  );
}

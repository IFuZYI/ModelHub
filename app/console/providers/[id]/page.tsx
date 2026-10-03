"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConsoleShell from "../../../components/ConsoleShell";
import Select from "../../../components/Select";
import ProviderAvatar from "../../../components/ProviderAvatar";
import { fetchAuthStatus } from "../../../lib/api";
import type { FreeTier, ProviderType } from "@/lib";

interface MyProvider {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  icon: string | null;
  aff_code: string | null;
  has_key: boolean;
  manual_models: boolean;
  models?: string[];
  tags?: { slug: string; name: string }[];
}

/**
 * Tag editor shared with the admin form (comma/enter-separated chips).
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
      <label>标签（可选，逗号分隔，最多 12 个）</label>
      <div className="tag-input-row">
        <input
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

export default function EditProviderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<ProviderType>("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [freeTier, setFreeTier] = useState<FreeTier>("none");
  const [icon, setIcon] = useState("");
  const [affCode, setAffCode] = useState("");
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    setAuthed(status.authenticated);

    if (!status.authenticated) {
      setReady(true);
      return;
    }
    const res = await fetch("/api/me/providers", { credentials: "same-origin" });
    const json = await res.json();
    const p: MyProvider | undefined = (json.providers ?? []).find(
      (x: MyProvider) => x.id === id
    );
    if (!p) {
      setNotFound(true);
      setReady(true);
      return;
    }
    setName(p.name);
    setDescription(p.description ?? "");
    setType(p.type);
    setBaseUrl(p.base_url);
    setFreeTier(p.free_tier);
    setIcon(p.icon ?? "");
    setAffCode(p.aff_code ?? "");
    setHasKey(p.has_key);
    setTags((p.tags ?? []).map((t) => t.name));
    // /api/me/providers returns the count-only meta view (no `models`); the
    // public detail endpoint carries the full model list.
    const detailRes = await fetch(`/api/providers/${id}`, {
      credentials: "same-origin",
    });
    if (detailRes.ok) {
      const detail = await detailRes.json();
      setModels(((detail?.models as string[] | undefined) ?? []).join("\n"));
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name,
        description: description.trim(),
        type,
        base_url: baseUrl.trim(),
        free_tier: freeTier,
        icon: icon.trim(),
        aff_code: affCode.trim(),
        tags,
      };
      if (key) body.key = key;
      if (type === "custom" || type === "newapi") {
        const list = models
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        body.models = list;
        body.manual_models = list.length > 0;
      }
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "保存失败");
      router.replace("/console");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ConsoleShell
        title="编辑站点"
        subtitle="修改站点信息、模型与标签。"
      >
        {() =>
          !ready ? (
            <div className="spin">加载中…</div>
          ) : !authed ? (
            <div className="empty">
              请先登录。
              <div style={{ marginTop: 16 }}>
                <Link href="/login" className="btn secondary">
                  去登录
                </Link>
              </div>
            </div>
          ) : notFound ? (
            <div className="empty">站点不存在或不属于你。</div>
          ) : (
            <form onSubmit={save} className="settings-form" style={{ marginTop: 4 }}>
              <div className="field">
                <label>名称</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
          <div className="field">
            <label>图标（emoji 或 URL，留空用首字母）</label>
            <div className="icon-field">
              <ProviderAvatar name={name || "?"} icon={icon} className="icon-preview" />
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={300} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>类型</label>
              <Select
                ariaLabel="站点类型"
                value={type}
                onChange={(v) => setType(v as ProviderType)}
                options={[
                  { value: "native", label: "官方·原生" },
                  { value: "proxy", label: "官方·中转" },
                  { value: "newapi", label: "NewAPI" },
                  { value: "custom", label: "其他 / 自建" },
                ]}
              />
            </div>
            <div className="field">
              <label>免费额度</label>
              <Select
                ariaLabel="免费额度分级"
                value={freeTier}
                onChange={(v) => setFreeTier(v as FreeTier)}
                options={[
                  { value: "none", label: "NO（付费）" },
                  { value: "free", label: "FREE（有免费额度）" },
                  { value: "full", label: "FULL FREE（完全免费）" },
                ]}
              />
            </div>
          </div>
          <div className="field">
            <label>官网地址</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
          </div>
          <div className="field">
            <label>描述（可选）</label>
            <textarea
              className="model-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <TagsField tags={tags} onChange={setTags} />
          {type === "newapi" && (
            <div className="field">
              <label>邀请码 aff（可选）</label>
              <input value={affCode} onChange={(e) => setAffCode(e.target.value)} />
            </div>
          )}
          {(type === "custom" || type === "newapi") && (
            <div className="field">
              <label>自定义模型（每行一个）</label>
              <textarea
                className="model-textarea"
                value={models}
                onChange={(e) => setModels(e.target.value)}
                rows={4}
              />
            </div>
          )}
          <details className="field-group">
            <summary>API Key</summary>
            <div className="field">
              <label>API Key{hasKey ? "（已设置，留空保持不变）" : ""}</label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={hasKey ? "••••••••" : "sk-...（可留空）"}
              />
            </div>
          </details>
          {err && <div className="error-box">{err}</div>}
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "保存中…" : "保存并抓取"}
          </button>
        </form>
          )
        }
      </ConsoleShell>
    </>
  );
}

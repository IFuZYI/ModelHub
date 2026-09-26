"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../../../components/SiteHeader";
import Select from "../../../components/Select";
import ProviderAvatar from "../../../components/ProviderAvatar";
import { fetchAuthStatus, logout as apiLogout } from "../../../lib/api";
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
  const [role, setRole] = useState<"admin" | "user" | "guest">("guest");
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
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const status = await fetchAuthStatus();
    setAuthed(status.authenticated);
    setRole(status.role);
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
    setModels((p.models ?? []).join("\n"));
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

  if (notFound)
    return (
      <>
        <SiteHeader authenticated role={role} />
        <main className="shell">
          <div className="empty">
            提供商不存在或不属于你。
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
        <h1 className="detail-title" style={{ marginTop: 16 }}>编辑提供商</h1>

        <form onSubmit={save} className="settings-form" style={{ marginTop: 20 }}>
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
                ariaLabel="提供商类型"
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
      </main>
    </>
  );
}

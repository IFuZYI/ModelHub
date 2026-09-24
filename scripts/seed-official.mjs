// One-shot: log in as admin and add every built-in preset to the running
// dev server (http://localhost:3000). Reads the admin password from .env
// (never printed). Idempotent: updates icon/type on existing names.
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const favicon = (domain) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

// Mirror of lib/domain/presets.ts (inline so this script needs no TS build).
const PRESETS = [
  // 官方 · 国际
  {
    name: "OpenAI",
    type: "native",
    domain: "openai.com",
    base_url: "https://api.openai.com",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"],
  },
  {
    name: "Anthropic",
    type: "native",
    domain: "anthropic.com",
    base_url: "https://api.anthropic.com",
    models: [
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
    ],
    manual_models: true,
  },
  {
    name: "Google Gemini",
    type: "native",
    domain: "ai.google.dev",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ],
    manual_models: true,
  },
  {
    name: "DeepSeek 深度求索",
    type: "native",
    domain: "deepseek.com",
    base_url: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    name: "Mistral AI",
    type: "native",
    domain: "mistral.ai",
    base_url: "https://api.mistral.ai",
    models: [
      "mistral-large-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
  },
  {
    name: "xAI Grok",
    type: "native",
    domain: "x.ai",
    base_url: "https://api.x.ai",
    models: ["grok-4", "grok-3", "grok-3-mini", "grok-2-vision"],
  },
  {
    name: "Groq",
    type: "native",
    domain: "groq.com",
    base_url: "https://api.groq.com/openai",
    models: [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ],
  },
  {
    name: "NVIDIA NIM",
    type: "native",
    domain: "nvidia.com",
    base_url: "https://integrate.api.nvidia.com",
    models: [
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
      "qwen/qwen2.5-coder-32b-instruct",
    ],
  },
  {
    name: "Cerebras",
    type: "native",
    domain: "cerebras.ai",
    base_url: "https://api.cerebras.ai",
    models: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"],
  },
  // 官方 · 国内
  {
    name: "阿里云百炼（通义千问）",
    type: "native",
    domain: "aliyun.com",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
  },
  {
    name: "字节火山方舟",
    type: "native",
    domain: "volcengine.com",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-pro-32k", "doubao-lite-32k", "deepseek-v3"],
  },
  {
    name: "MiniMax",
    type: "native",
    domain: "minimaxi.com",
    base_url: "https://api.minimaxi.com",
    models: ["MiniMax-M2", "abab6.5s-chat"],
  },
  {
    name: "智谱 AI（GLM）",
    type: "native",
    domain: "bigmodel.cn",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v"],
  },
  {
    name: "月之暗面 Kimi",
    type: "native",
    domain: "moonshot.cn",
    base_url: "https://api.moonshot.cn",
    models: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-k2",
    ],
  },
  {
    name: "百度千帆（文心）",
    type: "native",
    domain: "baidu.com",
    base_url: "https://qianfan.baidubce.com/v2",
    models: ["ernie-4.0-8k", "ernie-3.5-8k"],
  },
  // 官方 · 中转（聚合路由）
  {
    name: "OpenRouter",
    type: "proxy",
    domain: "openrouter.ai",
    base_url: "https://openrouter.ai/api",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
    ],
  },
  {
    name: "Vercel AI Gateway",
    type: "proxy",
    domain: "vercel.com",
    base_url: "https://ai-gateway.vercel.sh",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  },
  {
    name: "Portkey",
    type: "proxy",
    domain: "portkey.ai",
    base_url: "https://api.portkey.ai",
    models: ["gpt-4o", "claude-sonnet-4"],
    manual_models: true,
  },
  {
    name: "Requesty",
    type: "proxy",
    domain: "requesty.ai",
    base_url: "https://router.requesty.ai",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  },
  {
    name: "FastRouter",
    type: "proxy",
    domain: "fastrouter.ai",
    base_url: "https://go.fastrouter.ai/api/v1",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  },
];

function readEnvPassword() {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = env.match(/^MODELHUB_ADMIN_PASSWORD=(.*)$/m);
  if (!m) throw new Error("MODELHUB_ADMIN_PASSWORD not found in .env");
  return m[1].trim();
}

async function main() {
  const password = readEnvPassword();

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("no session cookie returned");

  const listRes = await fetch(`${BASE}/api/providers`);
  const list = await listRes.json();
  const existing = new Map((list.providers ?? []).map((p) => [p.name, p]));

  let added = 0,
    updated = 0,
    skipped = 0;
  for (const p of PRESETS) {
    const cur = existing.get(p.name);
    const icon = favicon(p.domain);
    if (cur) {
      // Update icon + type on an existing provider; don't resend models.
      const res = await fetch(`${BASE}/api/providers/${cur.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ icon, type: p.type }),
      });
      if (res.ok) {
        console.log(`upd   ${p.name} [${p.type}]`);
        updated++;
      } else {
        console.log(`skip  ${p.name} (update ${res.status})`);
        skipped++;
      }
      continue;
    }
    const res = await fetch(`${BASE}/api/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: p.name,
        type: p.type,
        base_url: p.base_url,
        icon,
        models: p.models,
        ...(p.manual_models ? { manual_models: true } : {}),
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(
        `add   ${p.name} [${p.type}]: models=${j.model_count} status=${j.last_status}`
      );
      added++;
    } else {
      console.log(
        `FAIL  ${p.name}: ${res.status} ${JSON.stringify(j).slice(0, 120)}`
      );
    }
  }
  console.log(
    `\nDone: +${added} added, ${updated} updated, ${skipped} skipped, ${PRESETS.length} total presets.`
  );
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

// One-shot: log in as admin and add every built-in preset to the running
// dev server (http://localhost:3000). Reads the admin password from .env
// (never printed). Idempotent: updates icon/type on existing names.
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const favicon = (domain) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

// Mirror of lib/domain/presets.ts (inline so this script needs no TS build).
// `slug` is the models.dev api.json key; `llmratesSlug` is the LLMRates
// dataset provider slug. A preset with either creates a provider on the
// matching catalog adapter so its model list syncs without an API key.
const PRESETS = [
  // 官方 · 国际
  {
    name: "OpenAI",
    type: "native",
    domain: "openai.com",
    base_url: "https://api.openai.com",
    site_url: "https://openai.com",
    slug: "openai",
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "o3", "o4-mini", "gpt-4o"],
  },
  {
    name: "Anthropic",
    type: "native",
    domain: "claude.com",
    base_url: "https://api.anthropic.com",
    site_url: "https://www.anthropic.com",
    slug: "anthropic",
    models: [
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ],
  },
  {
    name: "Google Gemini",
    type: "native",
    domain: "ai.google.dev",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    site_url: "https://gemini.google.com",
    slug: "google",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    name: "DeepSeek 深度求索",
    type: "native",
    domain: "deepseek.com",
    base_url: "https://api.deepseek.com",
    site_url: "https://www.deepseek.com",
    slug: "deepseek",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash"],
  },
  {
    name: "Mistral AI",
    type: "native",
    domain: "mistral.ai",
    base_url: "https://api.mistral.ai",
    site_url: "https://mistral.ai",
    slug: "mistral",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
  },
  {
    name: "xAI Grok",
    type: "native",
    domain: "x.ai",
    base_url: "https://api.x.ai",
    site_url: "https://x.ai",
    slug: "xai",
    models: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3"],
  },
  {
    name: "Groq",
    type: "native",
    domain: "groq.com",
    base_url: "https://api.groq.com/openai",
    site_url: "https://groq.com",
    slug: "groq",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "groq/compound"],
  },
  {
    name: "NVIDIA NIM",
    type: "native",
    domain: "nvidia.com",
    base_url: "https://integrate.api.nvidia.com",
    site_url: "https://build.nvidia.com",
    slug: "nvidia",
    models: [
      "deepseek-ai/deepseek-v4-pro",
      "qwen/qwen2.5-coder-32b-instruct",
    ],
  },
  {
    name: "Cerebras",
    type: "native",
    domain: "cerebras.ai",
    base_url: "https://api.cerebras.ai",
    site_url: "https://cerebras.ai",
    slug: "cerebras",
    models: ["gpt-oss-120b", "qwen-3.8-27b"],
  },
  {
    name: "SambaNova",
    type: "native",
    domain: "sambanova.ai",
    base_url: "https://api.sambanova.ai",
    site_url: "https://sambanova.ai",
    llmratesSlug: "sambanova",
    models: [
      "meta-llama-3-3-70b-instruct",
      "deepseek-v3-2",
      "gpt-oss-120b",
      "minimax-m3",
    ],
  },
  // 官方 · 国内
  {
    name: "阿里云百炼（通义千问）",
    type: "native",
    domain: "aliyun.com",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode",
    site_url: "https://www.aliyun.com/product/bailian",
    slug: "alibaba",
    models: ["qwen-max", "qwen-plus", "qwen-flash"],
  },
  {
    name: "字节火山方舟",
    type: "native",
    domain: "volcengine.com",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    site_url: "https://www.volcengine.com/product/ark",
    slug: "volcengine",
    models: [
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-1-8-251228",
      "deepseek-v4-pro-ga-260813",
    ],
  },
  {
    name: "MiniMax",
    type: "native",
    domain: "minimaxi.com",
    base_url: "https://api.minimaxi.com",
    site_url: "https://www.minimaxi.com",
    slug: "minimax",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2"],
  },
  {
    name: "智谱 AI（GLM）",
    type: "native",
    domain: "bigmodel.cn",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    site_url: "https://www.zhipuai.cn",
    slug: "zhipuai",
    models: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
  },
  {
    name: "月之暗面 Kimi",
    type: "native",
    domain: "moonshot.cn",
    base_url: "https://api.moonshot.cn",
    site_url: "https://www.moonshot.cn",
    slug: "moonshotai",
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"],
  },
  {
    name: "百度千帆（文心）",
    type: "native",
    domain: "baidu.com",
    base_url: "https://qianfan.baidubce.com/v2",
    site_url: "https://cloud.baidu.com/product/wenxinworkshop",
    models: ["ernie-4.0-8k", "ernie-3.5-8k"],
  },
  // 官方 · 中转（聚合路由）
  {
    name: "OpenRouter",
    type: "proxy",
    domain: "openrouter.ai",
    base_url: "https://openrouter.ai/api",
    site_url: "https://openrouter.ai",
    slug: "openrouter",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-opus-4.8",
      "google/gemini-2.5-pro",
    ],
  },
  {
    name: "Vercel AI Gateway",
    type: "proxy",
    domain: "vercel.com",
    base_url: "https://ai-gateway.vercel.sh",
    site_url: "https://vercel.com/ai-gateway",
    slug: "vercel",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-opus-4.8",
      "google/gemini-2.5-pro",
    ],
  },
  {
    name: "Portkey",
    type: "proxy",
    domain: "portkey.ai",
    base_url: "https://api.portkey.ai",
    site_url: "https://portkey.ai",
    models: ["gpt-4o", "claude-sonnet-4"],
    manual_models: true,
  },
  {
    name: "Requesty",
    type: "proxy",
    domain: "requesty.ai",
    base_url: "https://router.requesty.ai",
    site_url: "https://requesty.ai",
    slug: "requesty",
    models: ["claude-opus-4-6", "gemini-2.5-pro@eu"],
  },
  {
    name: "FastRouter",
    type: "proxy",
    domain: "fastrouter.ai",
    base_url: "https://go.fastrouter.ai/api/v1",
    site_url: "https://fastrouter.ai",
    slug: "fastrouter",
    models: ["anthropic/claude-opus-4.8", "google/gemini-2.5-pro"],
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
      // Update icon + type + models.dev sync on an existing provider.
      const res = await fetch(`${BASE}/api/providers/${cur.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          icon,
          type: p.type,
          ...(p.site_url ? { site_url: p.site_url } : {}),
          // Slugs are no-key FALLBACKS; keep the live adapter as primary.
          ...(p.slug ? { models_dev_slug: p.slug } : {}),
          ...(p.llmratesSlug ? { llmrates_slug: p.llmratesSlug } : {}),
        }),
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
        ...(p.site_url ? { site_url: p.site_url } : {}),
        // Slugs are no-key FALLBACKS; keep the live adapter as primary.
        ...(p.slug ? { models_dev_slug: p.slug } : {}),
        ...(p.llmratesSlug ? { llmrates_slug: p.llmratesSlug } : {}),
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

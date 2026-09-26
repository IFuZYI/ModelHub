// One-shot: log in as admin and upsert every built-in preset into the running
// server (http://localhost:3000). Reads the admin password from .env (never
// printed). Idempotent: updates existing providers by name.
//
// Mirror of lib/domain/presets.ts (inline so this script needs no TS build).
// `catalogSlugs` maps a catalog adapter id → this provider's slug in that
// source; the server falls back to those no-key catalogs after the live API.
import { readFileSync } from "fs";

const BASE = "http://localhost:3000";
const favicon = (domain) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

const PRESETS = [
  // 官方 · 国际
  {
    name: "OpenAI",
    description: "ChatGPT 背后的公司，GPT 系列旗舰模型的原厂，通用能力与生态最成熟。",
    type: "native",
    domain: "openai.com",
    url: "https://platform.openai.com",
    catalogSlugs: { spullara: "openai", "models-dev": "openai", litellm: "openai" },
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "o3", "o4-mini", "gpt-4o"],
  },
  {
    name: "Anthropic",
    description: "Claude 系列模型原厂，主打长上下文、可靠性与安全对齐，代码与推理能力突出。",
    type: "native",
    domain: "claude.com",
    url: "https://platform.claude.com",
    catalogSlugs: { spullara: "anthropic", "models-dev": "anthropic", litellm: "anthropic" },
    models: ["claude-opus-4-8", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  },
  {
    name: "Google Gemini",
    description: "Google 官方 Gemini 系列，原生多模态、超长上下文，AI Studio 提供永久免费层。",
    type: "native",
    domain: "ai.google.dev",
    url: "https://aistudio.google.com",
    catalogSlugs: { spullara: "gemini", "models-dev": "google", litellm: "gemini" },
    free_tier: "free",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    name: "xAI Grok",
    description: "马斯克 xAI 出品的 Grok 系列，接入 X 实时数据，主打推理与实时性。",
    type: "native",
    domain: "x.ai",
    url: "https://x.ai",
    catalogSlugs: { spullara: "grok", "models-dev": "xai", litellm: "xai" },
    models: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3"],
  },
  {
    name: "Mistral AI",
    description: "欧洲（法国）开源模型厂商，Mistral / Codestral 系列兼顾开放权重与商用 API。",
    type: "native",
    domain: "mistral.ai",
    url: "https://mistral.ai",
    catalogSlugs: { spullara: "mistral", "models-dev": "mistral", litellm: "mistral" },
    free_tier: "free",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
  },
  {
    name: "Cohere",
    description: "面向企业的 Command 系列模型厂商，擅长 RAG、检索与多语言，另有 Rerank/Embed。",
    type: "native",
    domain: "cohere.com",
    url: "https://cohere.com",
    catalogSlugs: { "models-dev": "cohere", litellm: "cohere" },
    free_tier: "free",
    models: ["command-a-03-2025", "command-a-plus-05-2026", "command-r-plus-08-2024"],
  },
  // 官方 · 推理云
  {
    name: "Groq",
    description: "自研 LPU 推理硬件的高速推理云，托管 Llama、GPT-OSS 等开源模型，速度极快。",
    type: "native",
    domain: "groq.com",
    url: "https://groq.com",
    catalogSlugs: { "models-dev": "groq", litellm: "groq" },
    free_tier: "free",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "groq/compound"],
  },
  {
    name: "Cerebras",
    description: "晶圆级芯片（WSE）推理云，主打超高吞吐的开源模型推理，有每日免费额度。",
    type: "native",
    domain: "cerebras.ai",
    url: "https://www.cerebras.ai",
    catalogSlugs: { "models-dev": "cerebras", litellm: "cerebras" },
    free_tier: "free",
    models: ["gpt-oss-120b", "qwen-3.8-27b"],
  },
  {
    name: "Together AI",
    description: "开源模型推理与微调平台，覆盖 Llama、Qwen、DeepSeek 等数百款模型，OpenAI 兼容。",
    type: "native",
    domain: "together.ai",
    url: "https://www.together.ai",
    catalogSlugs: { "models-dev": "togetherai", litellm: "together_ai" },
    models: ["Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", "MiniMaxAI/MiniMax-M3"],
  },
  {
    name: "Fireworks AI",
    description: "高速开源模型推理平台，主打低延迟与函数调用，OpenAI 兼容，注册送试用额度。",
    type: "native",
    domain: "fireworks.ai",
    url: "https://fireworks.ai",
    catalogSlugs: { "models-dev": "fireworks-ai", litellm: "fireworks_ai" },
    free_tier: "free",
    models: ["accounts/fireworks/models/gpt-oss-120b", "accounts/fireworks/models/glm-5p3"],
  },
  {
    name: "NVIDIA NIM",
    description: "NVIDIA 官方推理微服务，托管 70+ 开源模型，提供免费开发额度（需手机验证）。",
    type: "native",
    domain: "nvidia.com",
    url: "https://build.nvidia.com",
    catalogSlugs: { "models-dev": "nvidia", litellm: "nvidia_nim" },
    free_tier: "free",
    models: ["deepseek-ai/deepseek-v4-pro", "qwen/qwen2.5-coder-32b-instruct"],
  },
  {
    name: "SambaNova",
    description: "自研 RDU 芯片的企业级高速推理云，托管 Llama、DeepSeek 等，注册送 $5 额度。",
    type: "native",
    domain: "sambanova.ai",
    url: "https://sambanova.ai",
    catalogSlugs: { litellm: "sambanova" },
    free_tier: "free",
    models: ["meta-llama-3-3-70b-instruct", "deepseek-v3-2", "gpt-oss-120b", "minimax-m3"],
  },
  // 官方 · 国内
  {
    name: "DeepSeek 深度求索",
    description: "国产开源模型厂商，DeepSeek 系列以极致性价比和强推理著称，OpenAI 兼容。",
    type: "native",
    domain: "deepseek.com",
    url: "https://platform.deepseek.com",
    catalogSlugs: { spullara: "deepseek", "models-dev": "deepseek", litellm: "deepseek" },
    free_tier: "free",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash"],
  },
  {
    name: "阿里云百炼（通义千问）",
    description: "阿里云一站式大模型平台，主打通义千问（Qwen）系列，新用户赠大额免费 token。",
    type: "native",
    domain: "aliyun.com",
    url: "https://bailian.console.alibabacloud.com",
    catalogSlugs: { spullara: "qwen", "models-dev": "alibaba", litellm: "dashscope" },
    free_tier: "free",
    models: ["qwen-max", "qwen-plus", "qwen-flash"],
  },
  {
    name: "月之暗面 Kimi",
    description: "月之暗面出品的 Kimi 系列，主打超长上下文，开源旗舰 K2 系列表现强劲。",
    type: "native",
    domain: "moonshot.cn",
    url: "https://platform.kimi.ai",
    catalogSlugs: { spullara: "kimi", "models-dev": "moonshotai", litellm: "moonshot" },
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"],
  },
  {
    name: "智谱 AI（GLM）",
    type: "native",
    domain: "bigmodel.cn",
    url: "https://open.bigmodel.cn",
    catalogSlugs: { spullara: "zai", "models-dev": "zhipuai", litellm: "zai" },
    free_tier: "free",
    models: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
  },
  {
    name: "MiniMax",
    description: "MiniMax（稀宇科技）自研模型，主打高性价比与多模态（文本 / 语音 / 视频）。",
    type: "native",
    domain: "minimaxi.com",
    url: "https://www.minimax.io",
    catalogSlugs: { "models-dev": "minimax", litellm: "minimax" },
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2"],
  },
  {
    name: "字节火山方舟",
    type: "native",
    domain: "volcengine.com",
    url: "https://console.volcengine.com",
    catalogSlugs: { "models-dev": "volcengine", litellm: "volcengine" },
    models: ["doubao-seed-2-0-pro-260215", "doubao-seed-1-8-251228", "deepseek-v4-pro-ga-260813"],
  },
  {
    name: "百度千帆（文心）",
    description: "百度智能云大模型平台，主打文心一言（ERNIE）系列，企业级全栈能力。",
    type: "native",
    domain: "baidu.com",
    url: "https://cloud.baidu.com/product-s/qianfan_home",
    models: ["ernie-4.0-8k", "ernie-3.5-8k"],
    manual_models: true,
  },
  // 官方 · 云厂商企业级平台
  {
    name: "Azure OpenAI",
    description: "微软 Azure 托管的 OpenAI 服务，企业级 GPT，需替换为你的资源域名 + api-version。",
    type: "native",
    domain: "azure.microsoft.com",
    url: "https://azure.microsoft.com",
    catalogSlugs: { "models-dev": "azure", litellm: "azure" },
    models: ["gpt-5.5", "gpt-4o", "o3"],
  },
  {
    name: "AWS Bedrock",
    description: "亚马逊云的多模型托管服务，覆盖 Claude、Llama、Nova 等，使用 SigV4 签名鉴权。",
    type: "native",
    domain: "aws.amazon.com",
    url: "https://aws.amazon.com/bedrock",
    catalogSlugs: { "models-dev": "amazon-bedrock", litellm: "bedrock" },
    models: [
      "anthropic.claude-opus-4-1-20250805-v1:0",
      "meta.llama3-3-70b-instruct-v1:0",
      "amazon.nova-pro-v1:0",
    ],
  },
  {
    name: "Google Vertex AI",
    description: "Google Cloud 的企业级 AI 平台，托管 Gemini 与 Claude，使用 GCP OAuth 鉴权。",
    type: "native",
    domain: "cloud.google.com",
    url: "https://cloud.google.com/vertex-ai",
    catalogSlugs: { "models-dev": "google-vertex", litellm: "vertex_ai" },
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "claude-opus-4-8@default"],
  },
  // 官方 · 中转（聚合路由）
  {
    name: "OpenRouter",
    description: "全球最大 LLM 聚合平台，一个 key 调 400+ 模型，:free 后缀模型免费额度。",
    type: "proxy",
    domain: "openrouter.ai",
    url: "https://openrouter.ai",
    catalogSlugs: { "models-dev": "openrouter", litellm: "openrouter" },
    free_tier: "free",
    models: ["openai/gpt-4o", "anthropic/claude-opus-4.8", "google/gemini-2.5-pro"],
  },
  {
    name: "Portkey",
    description: "企业级 AI 网关，聚合 200+ LLM，提供路由、缓存、可观测性与治理能力。",
    type: "proxy",
    domain: "portkey.ai",
    url: "https://portkey.ai",
    models: ["gpt-4o", "claude-sonnet-4"],
    manual_models: true,
  },
  {
    name: "Vercel AI Gateway",
    description: "Vercel 托管的 AI 网关，与 Next.js 深度集成，一个入口访问数百款模型。",
    type: "proxy",
    domain: "vercel.com",
    url: "https://vercel.com/docs/ai-gateway",
    catalogSlugs: { "models-dev": "vercel", litellm: "vercel_ai_gateway" },
    models: ["openai/gpt-4o", "anthropic/claude-opus-4.8", "google/gemini-2.5-pro"],
  },
  {
    name: "Cloudflare AI Gateway",
    description: "Cloudflare 边缘 AI 网关，提供缓存、限流与支出控制，需替换为你的账号/网关。",
    type: "proxy",
    domain: "cloudflare.com",
    url: "https://developers.cloudflare.com/ai-gateway",
    catalogSlugs: { "models-dev": "cloudflare-workers-ai" },
    models: ["@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/deepseek-ai/deepseek-v4-pro-0813"],
  },
  {
    name: "Requesty",
    description: "多模型路由网关，接入 300+ 模型，免费层约 200 次请求/天。",
    type: "proxy",
    domain: "requesty.ai",
    url: "https://requesty.ai",
    catalogSlugs: { "models-dev": "requesty" },
    free_tier: "free",
    models: ["claude-opus-4-6", "gemini-2.5-pro@eu"],
  },
  {
    name: "FastRouter",
    description: "多模型路由聚合平台，:free 后缀模型每组织每天 10 次免费额度。",
    type: "proxy",
    domain: "fastrouter.ai",
    url: "https://fastrouter.ai",
    catalogSlugs: { "models-dev": "fastrouter" },
    free_tier: "free",
    models: ["anthropic/claude-opus-4.8", "google/gemini-2.5-pro"],
  },
];

function readEnvPassword() {
  const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const m = env.match(/^MODELHUB_ADMIN_PASSWORD=(.*)$/m);
  if (!m) throw new Error("MODELHUB_ADMIN_PASSWORD not found in .env");
  return m[1].trim();
}

/** Build the create/update payload shared by both code paths. */
function payload(p, icon, { create }) {
  return {
    ...(create ? { name: p.name, models: p.models } : {}),
    // base_url is the canonical URL (official homepage / console).
    base_url: p.url,
    ...(p.description ? { description: p.description } : {}),
    icon,
    type: p.type,
    free_tier: p.free_tier ?? "none",
    manual_models: Boolean(p.manual_models),
    catalog_slugs: p.catalogSlugs ?? {},
  };
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

  const list = await (await fetch(`${BASE}/api/providers`)).json();
  const existing = new Map((list.providers ?? []).map((p) => [p.name, p]));

  let added = 0,
    updated = 0,
    skipped = 0;
  for (const p of PRESETS) {
    const cur = existing.get(p.name);
    const icon = favicon(p.domain);
    const url = cur ? `${BASE}/api/providers/${cur.id}` : `${BASE}/api/providers`;
    const res = await fetch(url, {
      method: cur ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload(p, icon, { create: !cur })),
    });
    if (res.ok) {
      console.log(`${cur ? "upd  " : "add  "} ${p.name} [${p.type}]`);
      if (cur) updated++;
      else added++;
    } else {
      console.log(`skip  ${p.name} (${res.status})`);
      skipped++;
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

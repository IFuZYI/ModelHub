/**
 * Built-in presets for well-known API providers, so the admin can add a
 * big-name vendor in one click. Curated from the 2026 mainstream-API list
 * and verified with live endpoint + link probes.
 *
 * Two preset kinds map to the app's provider types:
 *   category 官方 (official) → type native (原生) | proxy (中转)
 *   category 其他 (other)    → type newapi (NewAPI) | custom (自建)
 * The third homepage tab, 其他 (relay / newapi), is populated only by
 * user-added sites via quick-import — it has no built-in presets.
 *
 * base_url is the OpenAI-compatible API root; the adapter tries /api/pricing,
 * then {base}/v1/models, then {base}/models. Icons use each brand's real
 * favicon (faviconUrl(domain)). `models` seeds the initial list; a refresh
 * replaces it unless `manual_models` is set. `site_url` is the official site.
 */

/** Official brand favicon via Google's favicon service (resolves real icon). */
export function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

/**
 * Preset leaf type: presets only populate the 官方 category, either as
 * 原生 (native) first-party APIs or 中转 (proxy) multi-vendor routers.
 * The 其他 category (newapi/custom) is user-added and has no presets.
 */
export type PresetType = "native" | "proxy";

/** Region groupings shown in the official picker. */
export type PresetRegion = "国际" | "中国" | "企业" | "路由";

/** Ordered regions for the native (原生) picker. */
export const NATIVE_REGIONS: PresetRegion[] = ["国际", "中国", "企业"];

export interface OfficialPreset {
  /** Stable id (used as React key + form seed + server-side lookup). */
  id: string;
  /** Provider leaf type this preset creates (native = 原生, proxy = 中转). */
  type: PresetType;
  /** Display name pre-filled into the form. */
  name: string;
  /** Root domain used to fetch the official favicon. */
  domain: string;
  /** OpenAI-compatible API root, no trailing /v1. */
  base_url: string;
  /** Official site users visit to get a key / open the console. */
  site_url: string;
  /** Region tag for grouping in the picker. */
  region: PresetRegion;
  /** Built-in model list; seeds a new provider and is shown as a hint. */
  models: string[];
  /**
   * Whether this vendor lacks a usable Bearer + /v1/models listing endpoint,
   * so the built-in `models` list is authoritative (refresh will not overwrite
   * it). Used for Gemini/Anthropic and enterprise clouds (Azure/Bedrock/Vertex)
   * whose auth is non-standard.
   */
  manual_models?: boolean;
  /** Optional caveat shown when the preset is picked. */
  note?: string;
}

export const OFFICIAL_PRESETS: OfficialPreset[] = [
  // ===== 官方 · 国际原生 =====
  {
    id: "openai",
    type: "native",
    name: "OpenAI",
    domain: "openai.com",
    base_url: "https://api.openai.com",
    site_url: "https://platform.openai.com",
    region: "国际",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"],
  },
  {
    id: "anthropic",
    type: "native",
    name: "Anthropic",
    domain: "claude.com",
    base_url: "https://api.anthropic.com",
    site_url: "https://platform.claude.com",
    region: "国际",
    models: [
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
    ],
    manual_models: true,
    note: "Anthropic 原生 API 用 x-api-key + anthropic-version 头，本工具的 Bearer 抓取不可用；已内置模型列表，刷新不会覆盖。",
  },
  {
    id: "google-gemini",
    type: "native",
    name: "Google Gemini",
    domain: "ai.google.dev",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    site_url: "https://aistudio.google.com",
    region: "国际",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ],
    manual_models: true,
    note: "Gemini 的 OpenAI 兼容端点不提供模型列表接口；已内置模型列表。永久免费层：60 RPM / 1500 RPD。",
  },
  {
    id: "xai",
    type: "native",
    name: "xAI Grok",
    domain: "x.ai",
    base_url: "https://api.x.ai",
    site_url: "https://x.ai",
    region: "国际",
    models: ["grok-4", "grok-3", "grok-3-mini", "grok-2-vision"],
  },
  {
    id: "mistral",
    type: "native",
    name: "Mistral AI",
    domain: "mistral.ai",
    base_url: "https://api.mistral.ai",
    site_url: "https://mistral.ai",
    region: "国际",
    models: [
      "mistral-large-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
  },
  {
    id: "cohere",
    type: "native",
    name: "Cohere",
    domain: "cohere.com",
    base_url: "https://api.cohere.ai/compatibility",
    site_url: "https://cohere.com",
    region: "国际",
    models: ["command-a-03-2025", "command-r-plus", "command-r"],
  },
  // ===== 官方 · 推理云（开源模型托管，国际） =====
  {
    id: "groq",
    type: "native",
    name: "Groq",
    domain: "groq.com",
    base_url: "https://api.groq.com/openai",
    site_url: "https://groq.com",
    region: "国际",
    models: [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ],
    note: "LPU 高速推理；免费额度 30 RPM / 14.4K RPD，无需信用卡。",
  },
  {
    id: "cerebras",
    type: "native",
    name: "Cerebras",
    domain: "cerebras.ai",
    base_url: "https://api.cerebras.ai",
    site_url: "https://cerebras.ai",
    region: "国际",
    models: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"],
    note: "晶圆级芯片推理；免费 100 万 token/天。",
  },
  {
    id: "together",
    type: "native",
    name: "Together AI",
    domain: "together.ai",
    base_url: "https://api.together.xyz",
    site_url: "https://together.ai",
    region: "国际",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V3",
    ],
    note: "开源模型推理平台，OpenAI 兼容。",
  },
  {
    id: "fireworks",
    type: "native",
    name: "Fireworks AI",
    domain: "fireworks.ai",
    base_url: "https://api.fireworks.ai/inference",
    site_url: "https://fireworks.ai",
    region: "国际",
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/deepseek-v3",
    ],
    note: "高速推理，OpenAI 兼容。",
  },
  {
    id: "nvidia-nim",
    type: "native",
    name: "NVIDIA NIM",
    domain: "nvidia.com",
    base_url: "https://integrate.api.nvidia.com",
    site_url: "https://build.nvidia.com",
    region: "国际",
    models: [
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
      "qwen/qwen2.5-coder-32b-instruct",
    ],
    note: "NVIDIA 官方推理；免费约 40 RPM、70+ 模型，需手机验证。",
  },
  {
    id: "sambanova",
    type: "native",
    name: "SambaNova",
    domain: "sambanova.ai",
    base_url: "https://api.sambanova.ai",
    site_url: "https://sambanova.ai",
    region: "国际",
    models: [
      "Meta-Llama-3.3-70B-Instruct",
      "DeepSeek-R1",
      "Qwen2.5-72B-Instruct",
    ],
    note: "企业级高速推理，OpenAI 兼容。",
  },
  // ===== 官方 · 国内 =====
  {
    id: "deepseek",
    type: "native",
    name: "DeepSeek 深度求索",
    domain: "deepseek.com",
    base_url: "https://api.deepseek.com",
    site_url: "https://platform.deepseek.com",
    region: "中国",
    models: ["deepseek-chat", "deepseek-reasoner"],
    note: "极致低价、OpenAI 兼容；注册送 500 万 Token（30 天）。",
  },
  {
    id: "dashscope",
    type: "native",
    name: "阿里云百炼（通义千问）",
    domain: "aliyun.com",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode",
    site_url: "https://bailian.console.alibabacloud.com",
    region: "中国",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
    note: "企业级全栈；新用户 7000 万免费 Tokens（90 天）。",
  },
  {
    id: "moonshot",
    type: "native",
    name: "月之暗面 Kimi",
    domain: "moonshot.cn",
    base_url: "https://api.moonshot.cn",
    site_url: "https://platform.moonshot.cn",
    region: "中国",
    models: [
      "moonshot-v1-8k",
      "moonshot-v1-32k",
      "moonshot-v1-128k",
      "kimi-k2",
    ],
    note: "长上下文，开源旗舰。",
  },
  {
    id: "zhipu",
    type: "native",
    name: "智谱 Z.AI（GLM）",
    domain: "bigmodel.cn",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    site_url: "https://open.bigmodel.cn",
    region: "中国",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v"],
    note: "GLM-4-Flash 长期免费；注册送 2500 万 Token。",
  },
  {
    id: "minimax",
    type: "native",
    name: "MiniMax",
    domain: "minimaxi.com",
    base_url: "https://api.minimaxi.com",
    site_url: "https://minimax.io",
    region: "中国",
    models: ["MiniMax-M2", "abab6.5s-chat"],
    note: "性价比突出，支持多模态。",
  },
  {
    id: "volcengine-doubao",
    type: "native",
    name: "字节豆包（火山方舟）",
    domain: "volcengine.com",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    site_url: "https://console.volcengine.com",
    region: "中国",
    models: ["doubao-pro-32k", "doubao-lite-32k", "deepseek-v3"],
    note: "需用推理接入点(endpoint id)作为 model，/v1/models 可能不可用。",
  },
  {
    id: "baidu-qianfan",
    type: "native",
    name: "百度千帆（文心）",
    domain: "baidu.com",
    base_url: "https://qianfan.baidubce.com/v2",
    site_url: "https://cloud.baidu.com",
    region: "中国",
    models: ["ernie-4.0-8k", "ernie-3.5-8k"],
  },
  // ===== 官方 · 云厂商企业级平台 =====
  {
    id: "azure-openai",
    type: "native",
    name: "Azure OpenAI",
    domain: "azure.microsoft.com",
    base_url: "https://YOUR-RESOURCE.openai.azure.com/openai",
    site_url: "https://azure.microsoft.com",
    region: "企业",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
    manual_models: true,
    note: "企业级 GPT 服务。base_url 需替换为你的资源域名，且用 api-key 头 + api-version 参数，非标准 Bearer；已内置示例模型。",
  },
  {
    id: "aws-bedrock",
    type: "native",
    name: "AWS Bedrock",
    domain: "aws.amazon.com",
    base_url: "https://bedrock-runtime.us-east-1.amazonaws.com",
    site_url: "https://aws.amazon.com/bedrock",
    region: "企业",
    models: [
      "anthropic.claude-sonnet-4",
      "meta.llama3-3-70b-instruct-v1:0",
      "amazon.nova-pro-v1:0",
    ],
    manual_models: true,
    note: "多模型托管。使用 AWS SigV4 签名鉴权，非 Bearer，本工具无法直接抓取；已内置示例模型。",
  },
  {
    id: "google-vertex-ai",
    type: "native",
    name: "Google Vertex AI",
    domain: "cloud.google.com",
    base_url:
      "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR-PROJECT/locations/us-central1/endpoints/openapi",
    site_url: "https://cloud.google.com/vertex-ai",
    region: "企业",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "claude-sonnet-4"],
    manual_models: true,
    note: "GCP 原生 AI。使用 GCP OAuth token 鉴权、base_url 含项目/区域，非标准；已内置示例模型。",
  },
  // ===== 聚合 / 路由 =====
  {
    id: "openrouter",
    type: "proxy",
    name: "OpenRouter",
    domain: "openrouter.ai",
    base_url: "https://openrouter.ai/api",
    site_url: "https://openrouter.ai",
    region: "路由",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
    ],
    note: "全球最大 LLM 聚合平台，400+ 模型；:free 后缀模型 20 RPM/200 RPD 免费。",
  },
  {
    id: "portkey",
    type: "proxy",
    name: "Portkey",
    domain: "portkey.ai",
    base_url: "https://api.portkey.ai",
    site_url: "https://portkey.ai",
    region: "路由",
    models: ["gpt-4o", "claude-sonnet-4"],
    manual_models: true,
    note: "企业级 AI 网关（200+ LLM），模型列表接口需鉴权与 provider 配置，已内置示例。",
  },
  {
    id: "vercel-ai-gateway",
    type: "proxy",
    name: "Vercel AI Gateway",
    domain: "vercel.com",
    base_url: "https://ai-gateway.vercel.sh",
    site_url: "https://vercel.com/docs/ai-gateway",
    region: "路由",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
    note: "托管网关，与 Next.js 深度集成，数百模型。",
  },
  {
    id: "cloudflare-ai-gateway",
    type: "proxy",
    name: "Cloudflare AI Gateway",
    domain: "cloudflare.com",
    base_url:
      "https://gateway.ai.cloudflare.com/v1/YOUR-ACCOUNT/YOUR-GATEWAY/compat",
    site_url: "https://developers.cloudflare.com/ai-gateway",
    region: "路由",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
    manual_models: true,
    note: "边缘网关，缓存与支出控制。base_url 需替换为你的账号/网关；已内置示例模型。",
  },
  {
    id: "requesty",
    type: "proxy",
    name: "Requesty",
    domain: "requesty.ai",
    base_url: "https://router.requesty.ai",
    site_url: "https://requesty.ai",
    region: "路由",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
    note: "300+ 模型，免费层约 200 次请求/天。",
  },
  {
    id: "fastrouter",
    type: "proxy",
    name: "FastRouter",
    domain: "fastrouter.ai",
    base_url: "https://go.fastrouter.ai/api/v1",
    site_url: "https://fastrouter.ai",
    region: "路由",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
    note: ":free 后缀模型每天 10 次/组织。",
  },
];

/** Look up a preset by its id. */
export function getOfficialPreset(id: string): OfficialPreset | undefined {
  return OFFICIAL_PRESETS.find((p) => p.id === id);
}

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
 * replaces it unless `manual_models` is set. `base_url` is the canonical URL.
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
  /** Short description of the provider, shown on the detail page. */
  description: string;
  /** Root domain used to fetch the official favicon. */
  domain: string;
  /** The provider's canonical URL — official homepage / console; also the
   *  model-fetch base and the "前往官网" link target. */
  base_url: string;
  /** Region tag for grouping in the picker. */
  region: PresetRegion;
  /** Built-in model list; seeds a new provider and is shown as a hint. */
  models: string[];
  /**
   * Per-source catalog slugs (adapter id → slug) for no-key model sync, e.g.
   * { "spullara": "openai", "models-dev": "openai", "litellm": "openai" }.
   * When set, the fetcher falls back to those public catalogs after the live
   * API — so official platforms list models without an API key.
   */
  catalog_slugs?: Record<string, string>;
  /** Upstream adapter id; defaults to openai-compatible when omitted. */
  adapter?: string;
  /**
   * Whether this vendor lacks a usable Bearer + /v1/models listing endpoint,
   * so the built-in `models` list is authoritative (refresh will not overwrite
   * it). Used for Gemini/Anthropic and enterprise clouds (Azure/Bedrock/Vertex)
   * whose auth is non-standard.
   */
  manual_models?: boolean;
  /** Optional caveat shown when the preset is picked. */
  note?: string;
  /** Whether this provider offers a free tier / free tokens (FREE tag). */
  free?: boolean;
}

export const OFFICIAL_PRESETS: OfficialPreset[] = [
  // ===== 官方 · 国际原生 =====
  {
    id: "openai",
    type: "native",
    name: "OpenAI",
    description:
      "ChatGPT 背后的公司，GPT 系列旗舰模型的原厂，通用能力与生态最成熟。",
    domain: "openai.com",
    base_url: "https://platform.openai.com",
    region: "国际",
    catalog_slugs: { "spullara": "openai", "models-dev": "openai", "litellm": "openai" },
    models: ["gpt-5.6", "gpt-5.5", "gpt-5.4", "o3", "o4-mini", "gpt-4o"],
  },
  {
    id: "anthropic",
    type: "native",
    name: "Anthropic",
    description:
      "Claude 系列模型原厂，主打长上下文、可靠性与安全对齐，代码与推理能力突出。",
    domain: "claude.com",
    base_url: "https://platform.claude.com",
    region: "国际",
    catalog_slugs: { "spullara": "anthropic", "models-dev": "anthropic", "litellm": "anthropic" },
    models: [
      "claude-opus-4-8",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ],
    note: "Anthropic 原生 API 用 x-api-key + anthropic-version 头，Bearer 抓取不可用；模型列表通过 models.dev / LLMRates 目录同步。",
  },
  {
    id: "google-gemini",
    type: "native",
    name: "Google Gemini",
    description:
      "Google 官方 Gemini 系列，原生多模态、超长上下文，AI Studio 提供永久免费层。",
    domain: "ai.google.dev",
    base_url: "https://aistudio.google.com",
    region: "国际",
    catalog_slugs: { "spullara": "gemini", "models-dev": "google", "litellm": "gemini" },
    free: true,
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
    note: "Gemini 的 OpenAI 兼容端点不提供模型列表接口；模型列表通过 models.dev / LLMRates 目录同步。永久免费层：60 RPM / 1500 RPD。",
  },
  {
    id: "xai",
    type: "native",
    name: "xAI Grok",
    description:
      "马斯克 xAI 出品的 Grok 系列，接入 X 实时数据，主打推理与实时性。",
    domain: "x.ai",
    base_url: "https://x.ai",
    region: "国际",
    catalog_slugs: { "spullara": "grok", "models-dev": "xai", "litellm": "xai" },
    models: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3"],
  },
  {
    id: "mistral",
    type: "native",
    name: "Mistral AI",
    description:
      "欧洲（法国）开源模型厂商，Mistral / Codestral 系列兼顾开放权重与商用 API。",
    domain: "mistral.ai",
    base_url: "https://mistral.ai",
    region: "国际",
    catalog_slugs: { "spullara": "mistral", "models-dev": "mistral", "litellm": "mistral" },
    free: true,
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
  },
  {
    id: "cohere",
    type: "native",
    name: "Cohere",
    description:
      "面向企业的 Command 系列模型厂商，擅长 RAG、检索与多语言，另有 Rerank/Embed。",
    domain: "cohere.com",
    base_url: "https://cohere.com",
    region: "国际",
    catalog_slugs: { "models-dev": "cohere", "litellm": "cohere" },
    free: true,
    models: [
      "command-a-03-2025",
      "command-a-plus-05-2026",
      "command-r-plus-08-2024",
    ],
  },
  // ===== 官方 · 推理云（开源模型托管，国际） =====
  {
    id: "groq",
    type: "native",
    name: "Groq",
    description:
      "自研 LPU 推理硬件的高速推理云，托管 Llama、GPT-OSS 等开源模型，速度极快。",
    domain: "groq.com",
    base_url: "https://groq.com",
    region: "国际",
    catalog_slugs: { "models-dev": "groq", "litellm": "groq" },
    free: true,
    models: [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "groq/compound",
    ],
    note: "LPU 高速推理；免费额度 30 RPM / 14.4K RPD，无需信用卡。",
  },
  {
    id: "cerebras",
    type: "native",
    name: "Cerebras",
    description:
      "晶圆级芯片（WSE）推理云，主打超高吞吐的开源模型推理，有每日免费额度。",
    domain: "cerebras.ai",
    base_url: "https://www.cerebras.ai",
    region: "国际",
    catalog_slugs: { "models-dev": "cerebras", "litellm": "cerebras" },
    free: true,
    models: ["gpt-oss-120b", "qwen-3.8-27b"],
    note: "晶圆级芯片推理；免费 100 万 token/天。",
  },
  {
    id: "together",
    type: "native",
    name: "Together AI",
    description:
      "开源模型推理与微调平台，覆盖 Llama、Qwen、DeepSeek 等数百款模型，OpenAI 兼容。",
    domain: "together.ai",
    base_url: "https://www.together.ai",
    region: "国际",
    catalog_slugs: { "models-dev": "togetherai", "litellm": "together_ai" },
    models: [
      "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
      "MiniMaxAI/MiniMax-M3",
    ],
    note: "开源模型推理平台，OpenAI 兼容。",
  },
  {
    id: "fireworks",
    type: "native",
    name: "Fireworks AI",
    description:
      "高速开源模型推理平台，主打低延迟与函数调用，OpenAI 兼容，注册送试用额度。",
    domain: "fireworks.ai",
    base_url: "https://fireworks.ai",
    region: "国际",
    catalog_slugs: { "models-dev": "fireworks-ai", "litellm": "fireworks_ai" },
    free: true,
    models: [
      "accounts/fireworks/models/gpt-oss-120b",
      "accounts/fireworks/models/glm-5p3",
    ],
    note: "高速推理，OpenAI 兼容。",
  },
  {
    id: "nvidia-nim",
    type: "native",
    name: "NVIDIA NIM",
    description:
      "NVIDIA 官方推理微服务，托管 70+ 开源模型，提供免费开发额度（需手机验证）。",
    domain: "nvidia.com",
    base_url: "https://build.nvidia.com",
    region: "国际",
    catalog_slugs: { "models-dev": "nvidia", "litellm": "nvidia_nim" },
    free: true,
    models: [
      "deepseek-ai/deepseek-v4-pro",
      "qwen/qwen2.5-coder-32b-instruct",
    ],
    note: "NVIDIA 官方推理；免费约 40 RPM、70+ 模型，需手机验证。",
  },
  {
    id: "sambanova",
    type: "native",
    name: "SambaNova",
    description:
      "自研 RDU 芯片的企业级高速推理云，托管 Llama、DeepSeek 等，注册送 $5 额度。",
    domain: "sambanova.ai",
    base_url: "https://sambanova.ai",
    region: "国际",
    catalog_slugs: { "litellm": "sambanova" },
    free: true,
    models: [
      "meta-llama-3-3-70b-instruct",
      "deepseek-v3-2",
      "gpt-oss-120b",
      "minimax-m3",
    ],
    note: "企业级高速推理，OpenAI 兼容。models.dev 无此厂商，模型列表通过 LLMRates 数据集同步。",
  },
  // ===== 官方 · 国内 =====
  {
    id: "deepseek",
    type: "native",
    name: "DeepSeek 深度求索",
    description:
      "国产开源模型厂商，DeepSeek 系列以极致性价比和强推理著称，OpenAI 兼容。",
    domain: "deepseek.com",
    base_url: "https://platform.deepseek.com",
    region: "中国",
    catalog_slugs: { "spullara": "deepseek", "models-dev": "deepseek", "litellm": "deepseek" },
    free: true,
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-flash"],
    note: "极致低价、OpenAI 兼容；注册送 500 万 Token（30 天）。",
  },
  {
    id: "dashscope",
    type: "native",
    name: "阿里云百炼（通义千问）",
    description:
      "阿里云一站式大模型平台，主打通义千问（Qwen）系列，新用户赠大额免费 token。",
    domain: "aliyun.com",
    base_url: "https://bailian.console.alibabacloud.com",
    region: "中国",
    catalog_slugs: { "spullara": "qwen", "models-dev": "alibaba", "litellm": "dashscope" },
    free: true,
    models: ["qwen-max", "qwen-plus", "qwen-flash"],
    note: "企业级全栈；新用户 7000 万免费 Tokens（90 天）。",
  },
  {
    id: "moonshot",
    type: "native",
    name: "月之暗面 Kimi",
    description:
      "月之暗面出品的 Kimi 系列，主打超长上下文，开源旗舰 K2 系列表现强劲。",
    domain: "moonshot.cn",
    base_url: "https://platform.kimi.ai",
    region: "中国",
    catalog_slugs: { "spullara": "kimi", "models-dev": "moonshotai", "litellm": "moonshot" },
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"],
    note: "长上下文，开源旗舰。",
  },
  {
    id: "zhipu",
    type: "native",
    name: "智谱 Z.AI（GLM）",
    description:
      "智谱 AI 的 GLM 系列，通用与代码能力均衡，GLM-Flash 长期免费，注册赠 token。",
    domain: "bigmodel.cn",
    base_url: "https://open.bigmodel.cn",
    region: "中国",
    catalog_slugs: { "spullara": "zai", "models-dev": "zhipuai", "litellm": "zai" },
    free: true,
    models: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
    note: "GLM-4.5-Flash 长期免费；注册送 2500 万 Token。",
  },
  {
    id: "minimax",
    type: "native",
    name: "MiniMax",
    description:
      "MiniMax（稀宇科技）自研模型，主打高性价比与多模态（文本 / 语音 / 视频）。",
    domain: "minimaxi.com",
    base_url: "https://www.minimax.io",
    region: "中国",
    catalog_slugs: { "models-dev": "minimax", "litellm": "minimax" },
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2"],
    note: "性价比突出，支持多模态。",
  },
  {
    id: "volcengine-doubao",
    type: "native",
    name: "字节豆包（火山方舟）",
    description:
      "字节跳动火山引擎大模型平台，主打豆包（Doubao）系列，需用推理接入点作为 model。",
    domain: "volcengine.com",
    base_url: "https://console.volcengine.com",
    region: "中国",
    catalog_slugs: { "models-dev": "volcengine", "litellm": "volcengine" },
    models: [
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-1-8-251228",
      "deepseek-v4-pro-ga-260813",
    ],
    note: "需用推理接入点(endpoint id)作为 model；模型列表通过 models.dev 目录同步。",
  },
  {
    id: "baidu-qianfan",
    type: "native",
    name: "百度千帆（文心）",
    description:
      "百度智能云大模型平台，主打文心一言（ERNIE）系列，企业级全栈能力。",
    domain: "baidu.com",
    base_url: "https://cloud.baidu.com/product-s/qianfan_home",
    region: "中国",
    models: ["ernie-4.0-8k", "ernie-3.5-8k"],
    manual_models: true,
    note: "各公共目录均无此厂商；已内置示例模型，刷新不会覆盖。",
  },
  // ===== 官方 · 云厂商企业级平台 =====
  {
    id: "azure-openai",
    type: "native",
    name: "Azure OpenAI",
    description:
      "微软 Azure 托管的 OpenAI 服务，企业级 GPT，需替换为你的资源域名 + api-version。",
    domain: "azure.microsoft.com",
    base_url: "https://azure.microsoft.com",
    region: "企业",
    catalog_slugs: { "models-dev": "azure", "litellm": "azure" },
    models: ["gpt-5.5", "gpt-4o", "o3"],
    note: "企业级 GPT 服务。base_url 需替换为你的资源域名（用 api-key 头 + api-version 参数）；模型列表通过 models.dev 目录同步。",
  },
  {
    id: "aws-bedrock",
    type: "native",
    name: "AWS Bedrock",
    description:
      "亚马逊云的多模型托管服务，覆盖 Claude、Llama、Nova 等，使用 SigV4 签名鉴权。",
    domain: "aws.amazon.com",
    base_url: "https://aws.amazon.com/bedrock",
    region: "企业",
    catalog_slugs: { "models-dev": "amazon-bedrock", "litellm": "bedrock" },
    models: [
      "anthropic.claude-opus-4-1-20250805-v1:0",
      "meta.llama3-3-70b-instruct-v1:0",
      "amazon.nova-pro-v1:0",
    ],
    note: "多模型托管。使用 AWS SigV4 签名鉴权，非 Bearer；模型列表通过 models.dev 目录同步。",
  },
  {
    id: "google-vertex-ai",
    type: "native",
    name: "Google Vertex AI",
    description:
      "Google Cloud 的企业级 AI 平台，托管 Gemini 与 Claude，使用 GCP OAuth 鉴权。",
    domain: "cloud.google.com",
    base_url: "https://cloud.google.com/vertex-ai",
    region: "企业",
    catalog_slugs: { "models-dev": "google-vertex", "litellm": "vertex_ai" },
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "claude-opus-4-8@default"],
    note: "GCP 原生 AI。使用 GCP OAuth token 鉴权、base_url 含项目/区域；模型列表通过 models.dev 目录同步。",
  },
  // ===== 聚合 / 路由 =====
  {
    id: "openrouter",
    type: "proxy",
    name: "OpenRouter",
    description:
      "全球最大 LLM 聚合平台，一个 key 调 400+ 模型，:free 后缀模型免费额度。",
    domain: "openrouter.ai",
    base_url: "https://openrouter.ai",
    region: "路由",
    catalog_slugs: { "models-dev": "openrouter", "litellm": "openrouter" },
    free: true,
    models: [
      "openai/gpt-4o",
      "anthropic/claude-opus-4.8",
      "google/gemini-2.5-pro",
    ],
    note: "全球最大 LLM 聚合平台，400+ 模型；:free 后缀模型 20 RPM/200 RPD 免费。",
  },
  {
    id: "portkey",
    type: "proxy",
    name: "Portkey",
    description:
      "企业级 AI 网关，聚合 200+ LLM，提供路由、缓存、可观测性与治理能力。",
    domain: "portkey.ai",
    base_url: "https://portkey.ai",
    region: "路由",
    models: ["gpt-4o", "claude-sonnet-4"],
    manual_models: true,
    note: "企业级 AI 网关（200+ LLM），models.dev 暂无此聚合商，已内置示例；模型列表接口需鉴权与 provider 配置。",
  },
  {
    id: "vercel-ai-gateway",
    type: "proxy",
    name: "Vercel AI Gateway",
    description:
      "Vercel 托管的 AI 网关，与 Next.js 深度集成，一个入口访问数百款模型。",
    domain: "vercel.com",
    base_url: "https://vercel.com/docs/ai-gateway",
    region: "路由",
    catalog_slugs: { "models-dev": "vercel", "litellm": "vercel_ai_gateway" },
    models: [
      "openai/gpt-4o",
      "anthropic/claude-opus-4.8",
      "google/gemini-2.5-pro",
    ],
    note: "托管网关，与 Next.js 深度集成，数百模型。",
  },
  {
    id: "cloudflare-ai-gateway",
    type: "proxy",
    name: "Cloudflare AI Gateway",
    description:
      "Cloudflare 边缘 AI 网关，提供缓存、限流与支出控制，需替换为你的账号/网关。",
    domain: "cloudflare.com",
    base_url: "https://developers.cloudflare.com/ai-gateway",
    region: "路由",
    catalog_slugs: { "models-dev": "cloudflare-workers-ai" },
    models: [
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      "@cf/deepseek-ai/deepseek-v4-pro-0813",
    ],
    note: "边缘网关，缓存与支出控制。base_url 需替换为你的账号/网关；模型列表通过 models.dev 目录（Workers AI）同步。",
  },
  {
    id: "requesty",
    type: "proxy",
    name: "Requesty",
    description:
      "多模型路由网关，接入 300+ 模型，免费层约 200 次请求/天。",
    domain: "requesty.ai",
    base_url: "https://requesty.ai",
    region: "路由",
    catalog_slugs: { "models-dev": "requesty" },
    free: true,
    models: ["claude-opus-4-6", "gemini-2.5-pro@eu"],
    note: "300+ 模型，免费层约 200 次请求/天。",
  },
  {
    id: "fastrouter",
    type: "proxy",
    name: "FastRouter",
    description:
      "多模型路由聚合平台，:free 后缀模型每组织每天 10 次免费额度。",
    domain: "fastrouter.ai",
    base_url: "https://fastrouter.ai",
    region: "路由",
    catalog_slugs: { "models-dev": "fastrouter" },
    free: true,
    models: ["anthropic/claude-opus-4.8", "google/gemini-2.5-pro"],
    note: ":free 后缀模型每天 10 次/组织。",
  },
];

/** Look up a preset by its id. */
export function getOfficialPreset(id: string): OfficialPreset | undefined {
  return OFFICIAL_PRESETS.find((p) => p.id === id);
}

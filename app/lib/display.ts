import type { ProviderType, FetchStatus } from "@/lib";

/** Map a leaf type to its top-level category (官方 / 其他). */
export function categoryOf(type: ProviderType): "official" | "other" {
  return type === "native" || type === "proxy" ? "official" : "other";
}

/**
 * Presentation helpers shared by the front-end pages. Keeping the
 * domain-enum → Chinese-label mappings in one place avoids drift (e.g. the
 * "error" status previously rendered as both "异常" and "刷新失败").
 */

export function typeLabel(type: ProviderType): string {
  switch (type) {
    case "native":
      return "原生";
    case "proxy":
      return "中转";
    case "newapi":
      return "NewAPI";
    default:
      return "其他";
  }
}

/** Top-level category label (homepage tabs). */
export function categoryLabel(category: "official" | "other"): string {
  return category === "official" ? "官方" : "其他";
}

export function statusLabel(status: FetchStatus): string {
  switch (status) {
    case "ok":
      return "正常";
    case "error":
      return "刷新失败";
    case "needs_key":
      return "待配置密钥";
    default:
      return "待刷新";
  }
}

/** First character of a name, uppercased — used as a card avatar glyph. */
export function providerInitial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

/** Avatar glyph for a provider: its custom icon if set, else the name initial. */
export function providerGlyph(
  name: string,
  icon: string | null | undefined
): string {
  return icon && icon.trim().length ? icon : providerInitial(name);
}

/** Whether an icon value is an image URL (favicon) rather than an emoji/glyph. */
export function isIconUrl(icon: string | null | undefined): boolean {
  return !!icon && /^https?:\/\//i.test(icon.trim());
}

/**
 * Normalize a model id for cross-provider dedup counting. Strips a leading
 * `provider/` (or vendor path) prefix that aggregators prepend — e.g.
 * "openai/gpt-4o" and "gpt-4o" count as the same model — and lowercases.
 * Only the last path segment is kept, so "meta-llama/Llama-3.3-70B" →
 * "llama-3.3-70b".
 */
export function modelDedupeKey(model: string): string {
  const trimmed = model.trim();
  const lastSeg = trimmed.includes("/")
    ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
    : trimmed;
  return lastSeg.toLowerCase();
}

/** Count distinct models across providers, deduped by modelDedupeKey. */
export function distinctModelCount(providerModels: string[][]): number {
  const set = new Set<string>();
  for (const models of providerModels) {
    for (const m of models) {
      const key = modelDedupeKey(m);
      if (key) set.add(key);
    }
  }
  return set.size;
}

/**
 * Canonicalize a raw `vendor/` prefix from an aggregator id into a stable
 * vendor key. Aggregators (e.g. OpenRouter) emit noisy variants of the same
 * vendor: a leading `~` (fallback/free routing), a provider suffix like
 * `-ai` / `mistralai`, or vendor synonyms (`z-ai` == `zhipu`). Collapsing
 * them here keeps the category counts from splitting one vendor into several.
 */
export function normalizeVendorKey(raw: string): string {
  let key = raw.trim().toLowerCase();
  if (!key) return key;
  // Strip aggregator routing markers/prefixes.
  key = key.replace(/^~+/, "").replace(/^@/, "");
  const aliases: Record<string, string> = {
    "openai-chat": "openai",
    anthropic: "anthropic",
    "google-vertex": "google",
    "google-ai-studio": "google",
    googleai: "google",
    "x-ai": "xai",
    "xai-org": "xai",
    "deepseek-ai": "deepseek",
    "deepseek-v3": "deepseek",
    qwen3: "qwen",
    tongyi: "qwen",
    alibaba: "qwen",
    "z-ai": "zhipu",
    zai: "zhipu",
    zhipuai: "zhipu",
    "moonshot-ai": "moonshot",
    moonshotai: "moonshot",
    "meta-llama": "meta",
    metaai: "meta",
    "meta-ai": "meta",
    mistralai: "mistral",
    "cohere-ai": "cohere",
    "minimax-ai": "minimax",
    "bytedance-seed": "bytedance",
    "step-ai": "stepfun",
    阶跃星辰: "stepfun",
    通义千问: "qwen",
    腾讯混元: "tencent",
    百度文心: "baidu",
  };
  return aliases[key] ?? key;
}

/**
 * Vendor group for a model id, used to categorize the model list (newapi
 * style). Uses the `vendor/` prefix when present (e.g. "openai/gpt-4o" →
 * "openai"); otherwise infers from a leading token before the first "-" for
 * common bare names (gpt-* → openai, claude-* → anthropic, ...). Falls back
 * to "其他".
 */
export function modelVendor(model: string): string {
  const m = model.trim();
  if (m.includes("/")) {
    const prefix = m.slice(0, m.indexOf("/")).toLowerCase();
    return normalizeVendorKey(prefix) || "其他";
  }
  const lower = m.toLowerCase();
  const rules: [RegExp, string][] = [
    [/^(gpt|o[134]|chatgpt|text-|dall-e|whisper|tts|davinci)/, "openai"],
    [/^claude/, "anthropic"],
    [/^gemini|^gemma/, "google"],
    [/^grok/, "xai"],
    [/^(deepseek)/, "deepseek"],
    [/^(qwen|qwq|tongyi|通义)/, "qwen"],
    [/^(glm|chatglm|cogview|cogvideo)/, "zhipu"],
    [/^(moonshot|kimi)/, "moonshot"],
    [
      /^(mistral|codestral|mixtral|magistral|ministral|devstral|pixtral)/,
      "mistral",
    ],
    [/^(llama|meta-llama|codellama)/, "meta"],
    [/^(command|c4ai|cohere|rerank|embed-)/, "cohere"],
    [/^(minimax|abab)/, "minimax"],
    [/^(doubao|豆包)/, "doubao"],
    [/^(ernie|文心)/, "baidu"],
    [/^(hunyuan|混元)/, "tencent"],
    [/^(step|阶跃)/, "stepfun"],
    [/^(spark|星火|generalv|4\.0ultra)/, "spark"],
    [/^(baichuan|百川)/, "baichuan"],
    [/^(sonar|perplexity)/, "perplexity"],
    [/^(nova)/, "amazon"],
    [/^(yi-|yi_|零一)/, "lingyiwanwu"],
    [/^(360|zhinao|360gpt|360智脑)/, "360"],
    [/^jina/, "jina"],
    [/^vidu/, "vidu"],
    [/^(jimeng|即梦|seedream|seededit|seedance)/, "jimeng"],
    [/^(kling|kwai|可灵|快手)/, "kuaishou"],
    [/^@cf\//, "cloudflare"],
  ];
  for (const [re, vendor] of rules) if (re.test(lower)) return vendor;
  return "其他";
}

/** Human label for a vendor key (from modelVendor). */
export function vendorLabel(vendor: string): string {
  const map: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    "google-vertex": "Google",
    xai: "xAI",
    deepseek: "DeepSeek",
    qwen: "通义千问",
    qwen3: "通义千问",
    zhipu: "智谱 GLM",
    moonshot: "月之暗面",
    mistral: "Mistral",
    mistralai: "Mistral",
    "meta-llama": "Meta Llama",
    meta: "Meta Llama",
    cohere: "Cohere",
    minimax: "MiniMax",
    doubao: "豆包",
    baidu: "百度文心",
    tencent: "腾讯混元",
    stepfun: "阶跃星辰",
    spark: "讯飞星火",
    baichuan: "百川",
    perplexity: "Perplexity",
    amazon: "Amazon",
    "deepseek-ai": "DeepSeek",
    lingyiwanwu: "零一万物",
    "360": "360 智脑",
    jina: "Jina AI",
    vidu: "Vidu",
    jimeng: "即梦",
    kuaishou: "快手可灵",
    cloudflare: "Cloudflare",
    bytedance: "字节跳动",
    其他: "其他",
  };
  return map[vendor] ?? vendor;
}

/** Host portion of a base_url, falling back to the raw string if unparseable. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

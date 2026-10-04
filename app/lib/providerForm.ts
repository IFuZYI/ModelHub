/**
 * Shared provider-form field definitions.
 *
 * These were inline in the sites list page; the full-page editor needs the
 * same fields, so they live here rather than in two copies that drift.
 */

/** Catalog slug inputs shown for official providers (adapter id + labels). */
export const CATALOG_SLUG_FIELDS: {
  id: string;
  label: string;
  placeholder: string;
}[] = [
  {
    id: "spullara",
    label: "模型接口",
    placeholder:
      "如 openai，或完整链接 https://raw.githubusercontent.com/spullara/models/refs/heads/main/openai.txt",
  },
  {
    id: "models-dev",
    label: "models.dev 目录 slug",
    placeholder: "如 openai、anthropic、google、openrouter",
  },
  {
    id: "litellm",
    label: "LiteLLM 目录 slug",
    placeholder: "如 openai、together_ai、vercel_ai_gateway",
  },
];

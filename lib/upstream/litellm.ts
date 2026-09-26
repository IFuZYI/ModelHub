import { z } from "zod";
import { createCatalogAdapter, catalogParse } from "./catalogAdapter";

/**
 * LiteLLM adapter — BerriAI/LiteLLM's model→pricing map. Each entry is keyed
 * by model id and tagged with `litellm_provider`. Queried by that provider
 * value (e.g. "openai", "together_ai", "vercel_ai_gateway"); strips a leading
 * `<slug>/` path segment and drops `ft:` fine-tune stubs + the sample_spec doc.
 */

export const LITELLM_CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json";

const catalogSchema = z.record(
  z.string(),
  z.object({ litellm_provider: z.string().optional() }).passthrough()
);

export const litellmAdapter = createCatalogAdapter({
  id: "litellm",
  label: "LiteLLM 价格目录 (model_prices_and_context_window.json)",
  url: () => LITELLM_CATALOG_URL,
  fromJson(json, slug) {
    const catalog = catalogParse(catalogSchema, json, "LiteLLM catalog");
    const prefix = `${slug}/`;
    const ids = new Set<string>();
    let matched = false;
    for (const [key, entry] of Object.entries(catalog)) {
      if (key === "sample_spec" || key.startsWith("ft:")) continue;
      if (entry.litellm_provider !== slug) continue;
      matched = true;
      const id = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      if (id) ids.add(id);
    }
    if (!matched) {
      throw new Error(`LiteLLM catalog has no provider "${slug}"`);
    }
    return [...ids];
  },
});

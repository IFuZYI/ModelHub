import { DEFAULT_ADAPTER, CATALOG_ADAPTERS } from "../domain/provider";
import type { CatalogAdapterId, CatalogSlugs } from "../domain/provider";
import type { UpstreamAdapter, UpstreamAttempt } from "./types";
import { openaiCompatibleAdapter } from "./openaiCompatible";
import { modelsDevAdapter } from "./modelsDev";
import { litellmAdapter } from "./litellm";
import { spullaraAdapter } from "./spullara";

/**
 * Adapter registry. Register new upstream protocols here; everything else
 * (fetcher, service, routes) resolves adapters through getAdapter().
 */
const registry = new Map<string, UpstreamAdapter>();

export function registerAdapter(adapter: UpstreamAdapter): void {
  registry.set(adapter.id, adapter);
}

registerAdapter(openaiCompatibleAdapter);
registerAdapter(modelsDevAdapter);
registerAdapter(litellmAdapter);
registerAdapter(spullaraAdapter);

/** Resolve an adapter by id, falling back to the default when unknown. */
export function getAdapter(id: string | undefined | null): UpstreamAdapter {
  return registry.get(id ?? DEFAULT_ADAPTER) ?? openaiCompatibleAdapter;
}

/**
 * Build the full ordered attempt list for a provider fetch.
 *
 * The primary adapter's attempts run first (the live API — best when a key is
 * present). Then each configured no-key catalog is APPENDED as a fallback in
 * CATALOG_ADAPTERS priority order (spullara → models.dev → litellm). So a
 * provider tries its real endpoint first and only falls back to a catalog when
 * the live listing fails or no key is available — which is what official
 * platforms need to show models without a key. A catalog is skipped when it
 * would duplicate the primary adapter.
 */
export function buildModelFetchAttempts(args: {
  adapter: string | null | undefined;
  baseUrl: string;
  key: string | null;
  catalogSlugs?: CatalogSlugs;
}): UpstreamAttempt[] {
  const primary = getAdapter(args.adapter);
  const slugs = args.catalogSlugs ?? {};
  const attempts = [
    ...primary.buildAttempts(args.baseUrl, args.key, { catalogSlug: null }),
  ];
  for (const id of CATALOG_ADAPTERS) {
    const slug = slugs[id as CatalogAdapterId];
    if (!slug || primary.id === id) continue;
    attempts.push(
      ...getAdapter(id).buildAttempts(args.baseUrl, null, { catalogSlug: slug })
    );
  }
  return attempts;
}

/** All registered adapters (for admin UI dropdowns, etc.). */
export function listAdapters(): UpstreamAdapter[] {
  return [...registry.values()];
}

export type {
  UpstreamAdapter,
  UpstreamAttempt,
  UpstreamRequest,
  UpstreamAttemptOptions,
} from "./types";
export { MODELS_DEV_API_URL } from "./modelsDev";
export { LITELLM_CATALOG_URL } from "./litellm";
export { SPULLARA_BASE_URL, spullaraUrl } from "./spullara";


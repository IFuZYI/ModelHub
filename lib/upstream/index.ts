import { DEFAULT_ADAPTER } from "../domain/provider";
import type { UpstreamAdapter, UpstreamAttempt } from "./types";
import { openaiCompatibleAdapter } from "./openaiCompatible";
import { modelsDevAdapter } from "./modelsDev";
import { llmratesAdapter } from "./llmrates";

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
registerAdapter(llmratesAdapter);

/** Resolve an adapter by id, falling back to the default when unknown. */
export function getAdapter(id: string | undefined | null): UpstreamAdapter {
  return registry.get(id ?? DEFAULT_ADAPTER) ?? openaiCompatibleAdapter;
}

/**
 * Build the full ordered attempt list for a provider fetch.
 *
 * The primary adapter's attempts run first (the live API — best when a key is
 * present). Then, when configured, the no-key catalog sources are APPENDED as
 * fallbacks: models.dev, then LLMRates. So a provider tries its real endpoint
 * first and only falls back to a catalog when the live listing fails or no key
 * is available — which is exactly what official platforms need to show models
 * without a key. Catalog attempts are skipped when they'd duplicate the
 * primary adapter (e.g. a provider whose primary adapter already IS models-dev).
 */
export function buildModelFetchAttempts(args: {
  adapter: string | null | undefined;
  baseUrl: string;
  key: string | null;
  modelsDevSlug?: string | null;
  llmratesSlug?: string | null;
}): UpstreamAttempt[] {
  const primary = getAdapter(args.adapter);
  const opts = {
    modelsDevSlug: args.modelsDevSlug ?? null,
    llmratesSlug: args.llmratesSlug ?? null,
  };
  const attempts = [...primary.buildAttempts(args.baseUrl, args.key, opts)];
  if (args.modelsDevSlug && primary.id !== modelsDevAdapter.id) {
    attempts.push(...modelsDevAdapter.buildAttempts(args.baseUrl, null, opts));
  }
  if (args.llmratesSlug && primary.id !== llmratesAdapter.id) {
    attempts.push(...llmratesAdapter.buildAttempts(args.baseUrl, null, opts));
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
export { LLMRATES_DATASET_URL } from "./llmrates";

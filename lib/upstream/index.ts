import { DEFAULT_ADAPTER } from "../domain/provider";
import type { UpstreamAdapter } from "./types";
import { openaiCompatibleAdapter } from "./openaiCompatible";

/**
 * Adapter registry. Register new upstream protocols here; everything else
 * (fetcher, service, routes) resolves adapters through getAdapter().
 */
const registry = new Map<string, UpstreamAdapter>();

export function registerAdapter(adapter: UpstreamAdapter): void {
  registry.set(adapter.id, adapter);
}

registerAdapter(openaiCompatibleAdapter);

/** Resolve an adapter by id, falling back to the default when unknown. */
export function getAdapter(id: string | undefined | null): UpstreamAdapter {
  return registry.get(id ?? DEFAULT_ADAPTER) ?? openaiCompatibleAdapter;
}

/** All registered adapters (for admin UI dropdowns, etc.). */
export function listAdapters(): UpstreamAdapter[] {
  return [...registry.values()];
}

export type {
  UpstreamAdapter,
  UpstreamAttempt,
  UpstreamRequest,
} from "./types";

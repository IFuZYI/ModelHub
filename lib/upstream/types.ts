/**
 * Upstream adapter contract. Each adapter knows how to talk to one flavor of
 * model-listing API. Adding a new provider protocol = add one adapter +
 * register it; the fetch/retry/persist pipeline stays untouched.
 */
export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
}

/** Extra per-provider context an adapter may need to build its attempts. */
export interface UpstreamAttemptOptions {
  /**
   * The catalog slug for this provider under the adapter being invoked — the
   * key/provider name the no-key catalog sources look up (e.g. models.dev's
   * "openai", LiteLLM's "together_ai", spullara's "grok"). Null when unused.
   */
  catalogSlug?: string | null;
}

export interface UpstreamAdapter {
  /** Stable id persisted on the provider (StoredProvider.adapter). */
  id: string;
  /** Human-readable label for the admin UI. */
  label: string;
  /**
   * Ordered attempts to list models. The fetcher tries each in order and uses
   * the first that returns a non-empty, parseable list. Later attempts are the
   * fallback when earlier ones fail or yield nothing.
   *
   * @param baseUrl provider base URL WITHOUT a trailing /v1 (e.g. https://x.com)
   * @param key decrypted API key, or null when the provider has no key
   * @param opts extra per-provider context (e.g. models.dev slug)
   */
  buildAttempts(
    baseUrl: string,
    key: string | null,
    opts?: UpstreamAttemptOptions
  ): UpstreamAttempt[];
}

export interface UpstreamAttempt {
  /** Short label for logs (e.g. "pricing", "models"). */
  name: string;
  request: UpstreamRequest;
  /** Parse this attempt's JSON into a flat list of model ids (unsorted). */
  parse(json: unknown): string[];
  /**
   * Optional: parse a text/plain response body into model ids. When present,
   * the fetcher reads the body as text and calls this instead of `parse`
   * (used by sources that serve newline-delimited lists, e.g. spullara).
   */
  parseText?(body: string): string[];
}

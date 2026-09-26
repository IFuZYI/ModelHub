import { z } from "zod";
import { AppError } from "../domain/errors";
import type { UpstreamAdapter, UpstreamAttempt } from "./types";

/**
 * Shared builder for no-key "catalog" adapters — sources that publish a public
 * model list at a fixed URL and are queried by a per-provider slug. Each such
 * adapter differs only in: its id/label, the catalog URL, and how it extracts
 * one provider's model ids from the downloaded document. This factory captures
 * the identical scaffolding (single attempt, slug guard, JSON-vs-text parsing)
 * so the concrete adapters (models.dev, LiteLLM, spullara) stay tiny.
 */
export interface CatalogAdapterSpec {
  id: string;
  label: string;
  /** Build the catalog URL for a given slug (fixed for JSON catalogs). */
  url(slug: string): string;
  /** Accept header (application/json by default; text/plain for line lists). */
  accept?: string;
  /** Extract this slug's model ids from a parsed JSON document. */
  fromJson?(json: unknown, slug: string): string[];
  /** Extract this slug's model ids from a plain-text body (newline list). */
  fromText?(body: string, slug: string): string[];
}

export function createCatalogAdapter(spec: CatalogAdapterSpec): UpstreamAdapter {
  return {
    id: spec.id,
    label: spec.label,
    buildAttempts(_baseUrl, _key, opts): UpstreamAttempt[] {
      const slug = opts?.catalogSlug?.trim();
      const attempt: UpstreamAttempt = {
        name: spec.id,
        request: {
          url: slug ? spec.url(slug) : spec.url(""),
          headers: { Accept: spec.accept ?? "application/json" },
        },
        parse(json): string[] {
          if (!spec.fromJson) {
            throw AppError.upstream(`${spec.id}: expected a text response`);
          }
          if (!slug) {
            throw AppError.upstream(`${spec.id} adapter requires a slug`);
          }
          return spec.fromJson(json, slug);
        },
      };
      if (spec.fromText) {
        attempt.parseText = (body: string) => {
          if (!slug) {
            throw AppError.upstream(`${spec.id} adapter requires a slug`);
          }
          return spec.fromText!(body, slug);
        };
      }
      return [attempt];
    },
  };
}

/** Zod guard shared by dataset parsers. */
export const catalogParse = <T>(schema: z.ZodType<T>, json: unknown, id: string): T => {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw AppError.upstream(`Unexpected ${id} response shape`);
  }
  return parsed.data;
};

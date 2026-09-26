import { createCatalogAdapter } from "./catalogAdapter";

/**
 * Text model-list adapter (a.k.a. "模型接口").
 *
 * Fetches a newline-delimited list of model ids from any public .txt URL and
 * parses it — no API key. The spullara/models repo is the canonical source
 * (one `<slug>.txt` per vendor, closest to each vendor's own /models), but the
 * catalog slug may also be a FULL URL to any compatible text list, so new
 * sources can be added without code changes.
 */

export const SPULLARA_BASE_URL =
  "https://raw.githubusercontent.com/spullara/models/refs/heads/main";

/** Build the spullara raw URL for a vendor slug. */
export function spullaraUrl(slug: string): string {
  return `${SPULLARA_BASE_URL}/${encodeURIComponent(slug)}.txt`;
}

/**
 * Resolve a catalog value to a fetch URL. A full http(s) URL is used as-is;
 * a bare token is treated as a spullara/models vendor slug (back-compat).
 */
function resolveUrl(value: string): string {
  if (!value) return SPULLARA_BASE_URL;
  return /^https?:\/\//i.test(value) ? value : spullaraUrl(value);
}

export const spullaraAdapter = createCatalogAdapter({
  id: "spullara",
  label: "模型接口 (txt 列表)",
  accept: "text/plain",
  url: resolveUrl,
  fromText(body, slug) {
    const ids = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    if (ids.length === 0) {
      throw new Error(`text model list "${slug}" returned no models`);
    }
    return [...new Set(ids)];
  },
});

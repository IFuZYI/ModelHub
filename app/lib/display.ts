import type { ProviderType, FetchStatus } from "@/lib";

/**
 * Presentation helpers shared by the front-end pages. Keeping the
 * domain-enum → Chinese-label mappings in one place avoids drift (e.g. the
 * "error" status previously rendered as both "异常" and "刷新失败").
 *
 * Model/vendor helpers live in `lib/domain/vendor.ts` (shared with the
 * server-side search service) and are re-exported here so existing page
 * imports keep working.
 */

export {
  modelDedupeKey,
  distinctModelCount,
  modelVendor,
  vendorLabel,
  normalizeVendorKey,
} from "@/lib/domain/vendor";

/** Map a leaf type to its top-level category (官方 / 其他). */
export function categoryOf(type: ProviderType): "official" | "other" {
  return type === "native" || type === "proxy" ? "official" : "other";
}

/**
 * Filter search hits by top-level category. The homepage chips apply to both
 * the directory list and the search results, so the same taxonomy
 * (official = native/proxy, other = newapi/custom) must hold in both places.
 */
export function filterHitsByCategory<T extends { type: ProviderType }>(
  hits: T[],
  category: "all" | "official" | "other"
): T[] {
  if (category === "all") return hits;
  return hits.filter((h) => categoryOf(h.type) === category);
}

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

/** Host portion of a base_url, falling back to the raw string if unparseable. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** Short relative time label (e.g. "3 天前") for comment/rating timestamps. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "刚刚";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

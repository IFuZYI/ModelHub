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

import { NextResponse } from "next/server";
import { withErrorHandling, searchService, publicService } from "@/lib";

export const dynamic = "force-dynamic";

// Public homepage search: find which sites carry a model ("gpt-6") or come
// from a source/vendor ("openai"), plus name/tag matches.
//
// Scope is the homepage directory's owner (the primary admin) — resolved via
// publicService.homepageOwnerId(), the SAME owner /api/providers lists — so
// search can never surface another user's sites.
//
// Query params: q, tag (slug), type, limit.
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const tag = url.searchParams.get("tag") ?? undefined;
  const typeParam = url.searchParams.get("type") ?? undefined;

  // `limit` must only override the service default when actually provided:
  // Number("") is 0 (finite!), which previously clamped every default call
  // down to a single hit.
  const rawLimit = url.searchParams.get("limit");
  let limit: number | undefined;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed)) {
      limit = Math.min(Math.max(Math.trunc(parsed), 1), 200);
    }
  }

  const type =
    typeParam === "native" ||
    typeParam === "proxy" ||
    typeParam === "newapi" ||
    typeParam === "custom"
      ? typeParam
      : undefined;

  const ownerId = await publicService.homepageOwnerId();
  if (!ownerId) return NextResponse.json({ query: q, hits: [], total: 0 });

  const result = await searchService.search(q, {
    ownerId,
    tag: tag || undefined,
    type,
    limit,
  });
  return NextResponse.json(result);
});

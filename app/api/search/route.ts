import { NextResponse } from "next/server";
import { withErrorHandling, searchService } from "@/lib";

export const dynamic = "force-dynamic";

// Public cross-site search: find sites that carry a model ("gpt-6") or come
// from a source/vendor ("openai"), plus name/tag matches.
// Query params: q, author (slug), tag (slug), type, limit.
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const author = url.searchParams.get("author") ?? undefined;
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

  const result = await searchService.search(q, {
    author: author || undefined,
    tag: tag || undefined,
    type,
    limit,
  });
  return NextResponse.json(result);
});

import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  currentUser,
  blogService,
  ratingScoreSchema,
} from "@/lib";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Reuses the domain schema so the 0-5 int bounds never drift from lib/domain.
const bodySchema = z.object({ score: ratingScoreSchema });

// Public: rating summary + list for a provider. `my_score` is resolved for
// the current viewer when logged in.
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = await currentUser();
  const [summary, list, myScore] = await Promise.all([
    blogService.ratingSummary(id),
    blogService.ratingList(id),
    viewer ? blogService.myRating(id, viewer.userId) : Promise.resolve(null),
  ]);
  return NextResponse.json({ summary, ratings: list, my_score: myScore });
});

// Authenticated: upsert my rating (0-5).
export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  const { score } = await parseJson(req, bodySchema);
  const result = await blogService.rate(session.userId, id, score);
  return NextResponse.json(result);
});

// Authenticated: remove my rating.
export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json({
    summary: await blogService.unrate(session.userId, id),
  });
});

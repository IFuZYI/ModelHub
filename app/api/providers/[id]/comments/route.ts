import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  blogService,
  currentUser,
  commentBodySchema,
} from "@/lib";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Reuses the domain schema so length limits never drift from lib/domain.
const bodySchema = z.object({ body: commentBodySchema });

// Public: comments for a provider (mine flag when logged in).
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = await currentUser();
  return NextResponse.json({
    comments: await blogService.commentList(id, viewer?.userId),
  });
});

// Authenticated: post a comment.
export const POST = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  const { body } = await parseJson(req, bodySchema);
  const comment = await blogService.comment(session.userId, id, body);
  return NextResponse.json(comment, { status: 201 });
});

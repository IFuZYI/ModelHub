import { NextResponse } from "next/server";
import { withErrorHandling, requireUser, blogService } from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Authenticated: delete a comment (author or provider owner).
export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  await blogService.deleteComment(session.userId, id);
  return NextResponse.json({ ok: true });
});

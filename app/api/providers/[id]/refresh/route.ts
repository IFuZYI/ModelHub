import { NextResponse } from "next/server";
import { withErrorHandling, requireUser, userProviderService } from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Owner-only: trigger a live upstream fetch for one of the user's providers.
export const POST = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  return NextResponse.json(
    await userProviderService.refresh(session.userId, session.role, id)
  );
});

import { NextResponse } from "next/server";
import { withErrorHandling, requireAdmin, providerService } from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Admin-only: triggering a live upstream fetch is a privileged action.
export const POST = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return NextResponse.json(await providerService.refresh(id));
});

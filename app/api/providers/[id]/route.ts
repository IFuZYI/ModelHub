import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  updateUserProviderSchema,
  userProviderService,
  publicService,
  currentUser,
  assertMasterKey,
} from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Public detail (models + social data, no key). The `mine` flag on comments
// is resolved for the current viewer when logged in.
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const viewer = await currentUser();
  return NextResponse.json(await publicService.detail(id, viewer?.userId));
});

// Owner-only update.
export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, updateUserProviderSchema);
  if (input.key) assertMasterKey();
  return NextResponse.json(
    await userProviderService.update(session.userId, session.role, id, input)
  );
});

// Owner-only delete.
export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  await userProviderService.remove(session.userId, id);
  return NextResponse.json({ ok: true });
});

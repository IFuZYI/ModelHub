import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  updateUserProviderSchema,
  userProviderService,
  publicService,
  assertMasterKey,
} from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Public detail (models only, no key).
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await publicService.detail(id));
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

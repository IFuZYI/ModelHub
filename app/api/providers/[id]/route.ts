import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  updateProviderSchema,
  assertMasterKey,
  requireAdmin,
  providerService,
} from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Public detail (models only, no key).
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await providerService.getView(id));
});

// Admin-only.
export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const input = await parseJson(req, updateProviderSchema);
  if (input.key) assertMasterKey();
  return NextResponse.json(await providerService.update(id, input));
});

// Admin-only.
export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await providerService.remove(id);
  return NextResponse.json({ ok: true });
});

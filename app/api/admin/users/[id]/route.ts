import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  adminUpdateUserSchema,
  userService,
} from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const input = await parseJson(req, adminUpdateUserSchema);
  return NextResponse.json(await userService.update(id, input));
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await userService.remove(id);
  return NextResponse.json({ ok: true });
});

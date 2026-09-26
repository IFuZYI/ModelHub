import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  adminUpdateUserSchema,
  userService,
  AppError,
} from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const session = await requireAdmin();
  const { id } = await ctx.params;
  const input = await parseJson(req, adminUpdateUserSchema);
  // An admin may not demote or disable their own account (self-lockout guard).
  if (id === session.userId) {
    if (input.role !== undefined && input.role !== "admin") {
      throw AppError.validation("不能修改自己的角色");
    }
    if (input.status !== undefined && input.status !== "active") {
      throw AppError.validation("不能停用自己的账号");
    }
  }
  return NextResponse.json(await userService.update(id, input));
});

export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await userService.remove(id);
  return NextResponse.json({ ok: true });
});

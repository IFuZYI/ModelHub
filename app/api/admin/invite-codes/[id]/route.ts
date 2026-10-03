import { NextResponse } from "next/server";
import { withErrorHandling, requireAdmin, inviteCodeService } from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Remove a registered pool code. Codes users typed on their own sites are
// removed by editing that site, not here.
export const DELETE = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  await inviteCodeService.removeCode(id);
  return NextResponse.json({ ok: true });
});

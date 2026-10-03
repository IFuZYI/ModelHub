import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, requireAdmin, inviteCodeService } from "@/lib";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Every site's invite-code pool (admin-registered + user-typed codes).
export const GET = withErrorHandling(async () => {
  await requireAdmin();
  return NextResponse.json({ pools: await inviteCodeService.listPools() });
});

const addSchema = z.object({
  base_url: z.string().trim().min(1, "请填写站点地址").max(500),
  code: z.string().trim().min(1, "邀请码不能为空").max(120),
  note: z.string().trim().max(200).optional(),
});

// Register a code for a site.
export const POST = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const input = await parseJson(req, addSchema);
  const codes = await inviteCodeService.addCode(
    input.base_url,
    input.code,
    input.note ?? null
  );
  return NextResponse.json({ codes }, { status: 201 });
});

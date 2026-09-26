import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  adminCreateUserSchema,
  userService,
} from "@/lib";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireAdmin();
  return NextResponse.json({ users: await userService.list() });
});

export const POST = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const input = await parseJson(req, adminCreateUserSchema);
  const user = await userService.create(input);
  return NextResponse.json(user, { status: 201 });
});

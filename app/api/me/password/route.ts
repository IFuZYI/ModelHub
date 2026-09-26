import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  changePasswordSchema,
  userService,
} from "@/lib";

export const dynamic = "force-dynamic";

// Self password change (invalidates other sessions via token_version bump).
export const POST = withErrorHandling(async (req: Request) => {
  const session = await requireUser();
  const input = await parseJson(req, changePasswordSchema);
  await userService.changePassword(
    session.userId,
    input.current_password,
    input.new_password
  );
  return NextResponse.json({ ok: true });
});

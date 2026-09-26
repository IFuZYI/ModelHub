import { NextResponse } from "next/server";
import { withErrorHandling, requireUser, userService, currentUser } from "@/lib";

export const dynamic = "force-dynamic";

// Assign (or rotate) the caller's personal-page slug.
export const POST = withErrorHandling(async () => {
  const session = await requireUser();
  const slug = await userService.assignSlug(session.userId);
  return NextResponse.json({ slug });
});

// Clear the caller's personal-page slug.
export const DELETE = withErrorHandling(async () => {
  const session = await requireUser();
  void currentUser;
  await userService.clearSlug(session.userId);
  return NextResponse.json({ ok: true });
});

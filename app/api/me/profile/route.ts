import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, requireUser, blogService, profileUpdateSchema } from "@/lib";

export const dynamic = "force-dynamic";

// Reuses the domain schema (includes the http(s)-only avatar rule).
const bodySchema = profileUpdateSchema;

// Authenticated: read own profile.
export const GET = withErrorHandling(async () => {
  const session = await requireUser();
  return NextResponse.json(await blogService.myProfile(session.userId));
});

// Authenticated: update own profile (empty string clears a field).
export const PUT = withErrorHandling(async (req: Request) => {
  const session = await requireUser();
  const patch = await parseJson(req, bodySchema);
  return NextResponse.json(
    await blogService.updateProfile(session.userId, patch)
  );
});

import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  userProviderService,
  publicService,
  createUserProviderSchema,
} from "@/lib";

export const dynamic = "force-dynamic";

// Public homepage list = the primary admin's providers (summaries, no keys).
export const GET = withErrorHandling(async () => {
  return NextResponse.json(await publicService.homepage());
});

// Authenticated: create a provider owned by the current user.
export const POST = withErrorHandling(async (req: Request) => {
  const session = await requireUser();
  const input = await parseJson(req, createUserProviderSchema);
  const view = await userProviderService.create(session.userId, session.role, input);
  return NextResponse.json(view, { status: 201 });
});

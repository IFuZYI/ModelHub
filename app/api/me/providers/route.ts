import { NextResponse } from "next/server";
import { withErrorHandling, requireUser, userProviderService } from "@/lib";

export const dynamic = "force-dynamic";

// The current user's own providers (full view incl. status, no key material).
export const GET = withErrorHandling(async () => {
  const session = await requireUser();
  return NextResponse.json({
    providers: await userProviderService.listByUser(session.userId),
  });
});

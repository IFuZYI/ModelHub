import { NextResponse } from "next/server";
import { withErrorHandling, isAuthenticated, adminConfigured } from "@/lib";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  return NextResponse.json({
    authenticated: await isAuthenticated(),
    adminConfigured: adminConfigured(),
  });
});

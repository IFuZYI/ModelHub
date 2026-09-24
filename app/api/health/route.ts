import { NextResponse } from "next/server";
import { withErrorHandling, config } from "@/lib";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  return NextResponse.json({
    status: "ok",
    masterKeyConfigured: config.masterKey !== null,
    adminConfigured: config.adminPassword !== null,
    time: new Date().toISOString(),
  });
});

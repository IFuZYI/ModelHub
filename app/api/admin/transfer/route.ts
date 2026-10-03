import { NextResponse } from "next/server";
import { withErrorHandling, requireAdmin, transferService } from "@/lib";

export const dynamic = "force-dynamic";

// Current row counts, so the admin UI can show what would move.
export const GET = withErrorHandling(async () => {
  await requireAdmin();
  return NextResponse.json({ counts: await transferService.summary() });
});

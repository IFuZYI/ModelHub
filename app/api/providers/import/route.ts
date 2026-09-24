import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  importNewapiSite,
} from "@/lib";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().trim().min(1, "url is required"),
});

// Admin-only: probe a newapi site URL, returning name/base_url/aff_code so the
// admin form can be pre-filled. Does not persist anything.
export const POST = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const { url } = await parseJson(req, bodySchema);
  const result = await importNewapiSite(url);
  return NextResponse.json(result);
});

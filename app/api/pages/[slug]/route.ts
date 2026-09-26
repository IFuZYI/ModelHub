import { NextResponse } from "next/server";
import { withErrorHandling, publicService } from "@/lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

// Public personal page data by slug (read-only, no keys).
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  return NextResponse.json(await publicService.personalPage(slug));
});

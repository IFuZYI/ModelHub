import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireUser,
  blogService,
  tagNamesSchema,
} from "@/lib";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ tags: tagNamesSchema });

// Public: tags of one provider.
export const GET = withErrorHandling(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ tags: await blogService.providerTags(id) });
});

// Owner-only: replace the provider's tags.
export const PUT = withErrorHandling(async (req: Request, ctx: Ctx) => {
  const session = await requireUser();
  const { id } = await ctx.params;
  const { tags } = await parseJson(req, bodySchema);
  return NextResponse.json({
    tags: await blogService.setProviderTags(session.userId, id, tags),
  });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  statsService,
  userProviderService,
} from "@/lib";

export const dynamic = "force-dynamic";

// Admin: full-service provider stats (usage counts, admin-added flags).
export const GET = withErrorHandling(async () => {
  await requireAdmin();
  return NextResponse.json({ stats: await statsService.list() });
});

const addSchema = z.object({
  normalized_base_url: z.string().trim().min(1),
});

// Admin one-click add: mount a stat's base_url under the admin from the
// derived template (name/type/free_tier/icon). Key still supplied separately.
export const POST = withErrorHandling(async (req: Request) => {
  const session = await requireAdmin();
  const { normalized_base_url } = await parseJson(req, addSchema);
  const tmpl = await statsService.addTemplate(normalized_base_url);
  const view = await userProviderService.create(session.userId, session.role, {
    name: tmpl.name,
    base_url: tmpl.base_url,
    type: tmpl.type,
    free_tier: tmpl.free_tier,
    icon: tmpl.icon,
  });
  return NextResponse.json(view, { status: 201 });
});

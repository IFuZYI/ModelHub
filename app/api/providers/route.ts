import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  createProviderSchema,
  assertMasterKey,
  requireAdmin,
  providerService,
} from "@/lib";

export const dynamic = "force-dynamic";

// Public lists are summaries so the homepage does not download every model id.
// The full model arrays are only returned to an authenticated admin editing data.
export const GET = withErrorHandling(async (req: Request) => {
  const includeModels =
    new URL(req.url).searchParams.get("includeModels") === "1";
  if (includeModels) {
    await requireAdmin();
    const { providers, settings } = await providerService.listWithSettings();
    return NextResponse.json({ settings, providers });
  }
  return NextResponse.json(await providerService.listSummariesWithSettings());
});

// Admin-only: create a provider.
export const POST = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const input = await parseJson(req, createProviderSchema);
  // Only need the master key when a key will actually be encrypted.
  if (input.key) assertMasterKey();
  const view = await providerService.create(input);
  return NextResponse.json(view, { status: 201 });
});

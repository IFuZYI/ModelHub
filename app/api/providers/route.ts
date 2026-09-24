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

// Public: anyone can browse providers and their models (no key material returned).
export const GET = withErrorHandling(async () => {
  const { providers, settings } = await providerService.listWithSettings();
  return NextResponse.json({ settings, providers });
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

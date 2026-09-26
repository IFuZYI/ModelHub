import { NextResponse } from "next/server";
import {
  withErrorHandling,
  parseJson,
  requireAdmin,
  settingsUpdateSchema,
  settingsService,
} from "@/lib";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  await requireAdmin();
  return NextResponse.json(await settingsService.getPublic());
});

export const PUT = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const input = await parseJson(req, settingsUpdateSchema);
  return NextResponse.json(await settingsService.update(input));
});

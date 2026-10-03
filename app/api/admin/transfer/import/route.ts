import { NextResponse } from "next/server";
import { withErrorHandling, requireAdmin, transferService, AppError } from "@/lib";

export const dynamic = "force-dynamic";

// A dump can be large; allow a generous body but not an unbounded one.
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Restore a bundle produced by /api/admin/transfer/export.
 * `?mode=merge` (default) upserts by primary key; `?mode=replace` wipes the
 * imported tables first. Both run in a single transaction.
 */
export const POST = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const modeParam = new URL(req.url).searchParams.get("mode");
  const mode = modeParam === "replace" ? "replace" : "merge";

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    throw AppError.validation("导入文件过大（上限 64 MB）");
  }
  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw AppError.validation("导入文件不是合法的 JSON");
  }

  return NextResponse.json(await transferService.import(bundle, { mode }));
});

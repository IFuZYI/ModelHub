import { NextResponse } from "next/server";
import {
  withErrorHandling,
  requireAdmin,
  transferService,
  statsService,
  logger,
  AppError,
} from "@/lib";

export const dynamic = "force-dynamic";

// A dump can be large; allow a generous body but not an unbounded one.
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Restore a bundle produced by /api/admin/transfer/export.
 * `?mode=merge` (default) upserts by primary key; `?mode=replace` wipes the
 * imported tables first. Both run in a single transaction.
 *
 * The import carries provider_stats as-is (its admin_* columns are authored
 * data that cannot be re-derived), so the aggregate table can disagree with
 * the imported providers — a sweep afterwards re-derives every live row from
 * the providers (preserving admin overrides) and drops orphaned ones.
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

  const result = await transferService.import(bundle, { mode });
  // Best-effort post-import heal: the import already committed, so a sweep
  // failure must not turn a successful import into a 500 for the client —
  // log it instead (the periodic stats hygiene re-heals within one refresh
  // interval).
  try {
    await statsService.recomputeAll();
  } catch (e) {
    logger.error(
      { err: String(e), mode },
      "post-import stats sweep failed (import itself committed)"
    );
  }
  return NextResponse.json(result);
});

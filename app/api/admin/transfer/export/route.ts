import { NextResponse } from "next/server";
import { withErrorHandling, requireAdmin, transferService } from "@/lib";

export const dynamic = "force-dynamic";

/**
 * Download the whole database as a JSON bundle for server migration.
 * `?secrets=1` additionally carries API keys / SMTP password decrypted, so the
 * target server can re-encrypt them with its own master key. The file is then
 * sensitive — see docs/adr/0014.
 */
export const GET = withErrorHandling(async (req: Request) => {
  await requireAdmin();
  const includeSecrets = new URL(req.url).searchParams.get("secrets") === "1";
  const bundle = await transferService.export({ includeSecrets });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Never let a proxy or the browser cache a database dump.
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="modelhub-export-${stamp}.json"`,
    },
  });
});

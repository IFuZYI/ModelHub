import { NextResponse } from "next/server";
import { sql } from "kysely";
import { withErrorHandling, config, getDatabase, logger } from "@/lib";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness probe. Besides reporting config state, it round-trips a
 * trivial query so a dead/unwritable database surfaces as 503 (and the Docker
 * HEALTHCHECK flips the container unhealthy) instead of a false "ok".
 */
export const GET = withErrorHandling(async () => {
  const base = {
    masterKeyConfigured: config.masterKey !== null,
    adminConfigured: config.adminPassword !== null,
    time: new Date().toISOString(),
  };

  try {
    await sql`select 1`.execute(getDatabase());
    return NextResponse.json({ status: "ok", database: "ok", ...base });
  } catch (err) {
    logger.error({ err: String(err) }, "health check: database probe failed");
    return NextResponse.json(
      { status: "error", database: "error", ...base },
      { status: 503 }
    );
  }
});

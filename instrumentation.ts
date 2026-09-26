export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler, logger } = await import("./lib");
    const { getDatabase } = await import("./lib/infra/db");
    const { migrateDatabase } = await import("./lib/infra/migrate");
    const { seedFromJsonIfNeeded } = await import("./lib/infra/seedFromJson");
    const db = getDatabase();
    await migrateDatabase(db).catch((e) => {
      logger.error({ err: String(e) }, "database migration failed");
      throw e;
    });
    await seedFromJsonIfNeeded(db).catch((e) =>
      logger.error({ err: String(e) }, "legacy JSON import failed")
    );
    await startScheduler().catch((e) =>
      logger.error({ err: String(e) }, "scheduler failed to start")
    );
  }
}

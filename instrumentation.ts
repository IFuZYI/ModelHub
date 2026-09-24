export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler, logger } = await import("./lib");
    await startScheduler().catch((e) =>
      logger.error({ err: String(e) }, "scheduler failed to start")
    );
  }
}

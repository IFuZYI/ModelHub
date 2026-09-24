import { refreshAll } from "./fetcher";
import { config } from "../config/env";
import { logger } from "../infra/logger";
import { fileRepository } from "../infra/repository";

/**
 * In-process periodic refresh scheduler. Module-level (globalThis) guard keeps
 * a single instance alive across Next.js dev HMR reloads.
 */
const g = globalThis as unknown as {
  __modelhubScheduler?: NodeJS.Timeout;
  __modelhubRunning?: boolean;
};

async function runRefresh(reason: string): Promise<void> {
  if (g.__modelhubRunning) {
    logger.debug({ reason }, "refresh already running; skipping overlap");
    return;
  }
  g.__modelhubRunning = true;
  try {
    await refreshAll(fileRepository);
  } catch (e) {
    logger.error({ err: String(e), reason }, "scheduled refresh error");
  } finally {
    g.__modelhubRunning = false;
  }
}

export async function startScheduler(): Promise<void> {
  if (g.__modelhubScheduler) return;

  const { settings } = await fileRepository.read();
  const hours =
    settings.refresh_interval_hours || config.defaultRefreshIntervalHours;
  const intervalMs = hours * 60 * 60 * 1000;

  g.__modelhubScheduler = setInterval(() => {
    void runRefresh("interval");
  }, intervalMs);
  g.__modelhubScheduler.unref?.();

  // Kick one refresh shortly after boot without blocking startup.
  setTimeout(() => void runRefresh("boot"), 5000).unref?.();

  logger.info({ intervalHours: hours }, "scheduler started");
}

export function stopScheduler(): void {
  if (g.__modelhubScheduler) {
    clearInterval(g.__modelhubScheduler);
    g.__modelhubScheduler = undefined;
    logger.info("scheduler stopped");
  }
}

import { config } from "../config/env";
import { logger } from "../infra/logger";
import { getDatabase } from "../infra/db";
import { SettingsRepository } from "../infra/repositories/settingsRepo";
import { TagRepository } from "../infra/repositories/tagRepo";
import { userProviderService } from "./userProviderService";
import { statsService } from "./statsService";

/**
 * In-process periodic refresh scheduler. Module-level (globalThis) guard keeps
 * a single instance alive across Next.js dev HMR reloads.
 */
const g = globalThis as unknown as {
  __modelhubScheduler?: NodeJS.Timeout;
  __modelhubTagSweep?: NodeJS.Timeout;
  __modelhubStatsSweep?: NodeJS.Timeout;
  __modelhubRunning?: boolean;
};

async function runRefresh(reason: string): Promise<void> {
  if (g.__modelhubRunning) {
    logger.debug({ reason }, "refresh already running; skipping overlap");
    return;
  }
  g.__modelhubRunning = true;
  try {
    const count = await userProviderService.refreshAll(
      config.refreshConcurrency
    );
    logger.info({ reason, count }, "refreshAll complete");
  } catch (e) {
    logger.error({ err: String(e), reason }, "scheduled refresh error");
  } finally {
    g.__modelhubRunning = false;
  }
}

/**
 * Periodic hygiene: remove tag rows no provider references. Normal tag
 * writes prune inline, but a crash mid-flow can leave an orphan behind —
 * this sweep guarantees the vocabulary stays clean. Runs under the tag
 * write lock so it cannot interleave with a concurrent tag write.
 */
async function runTagHygiene(reason: string): Promise<void> {
  try {
    const pruned = await new TagRepository(getDatabase()).pruneWithLock();
    if (pruned > 0) {
      logger.info({ reason, pruned }, "tag hygiene pruned orphans");
    }
  } catch (e) {
    logger.error({ err: String(e), reason }, "tag hygiene error");
  }
}

/**
 * Periodic hygiene for provider_stats: drop rows whose providers are all
 * gone, and re-derive the live ones (healing drift from import paths that
 * carry provider_stats as-is). A URL that lost its last provider (delete
 * cascade, manual edit) would otherwise stay listed on the 全服统计 page
 * forever.
 */
async function runStatsHygiene(reason: string): Promise<void> {
  try {
    // Drops orphaned rows AND re-derives live ones (heals drift from
    // import paths that carry provider_stats as-is).
    const removed = await statsService.recomputeAll();
    if (removed > 0) {
      logger.info({ reason, removed }, "stats hygiene dropped stale rows");
    }
  } catch (e) {
    logger.error({ err: String(e), reason }, "stats hygiene error");
  }
}

export async function startScheduler(): Promise<void> {
  if (g.__modelhubScheduler) return;

  const settings = new SettingsRepository(getDatabase());
  const hours =
    (await settings.get<number>("refresh_interval_hours", 0)) ||
    config.defaultRefreshIntervalHours;
  const intervalMs = hours * 60 * 60 * 1000;

  g.__modelhubScheduler = setInterval(() => {
    void runRefresh("interval");
  }, intervalMs);
  g.__modelhubScheduler.unref?.();

  // Tag hygiene rides the same interval (cheap NOT EXISTS sweep).
  g.__modelhubTagSweep = setInterval(() => {
    void runTagHygiene("interval");
  }, intervalMs);
  g.__modelhubTagSweep.unref?.();

  g.__modelhubStatsSweep = setInterval(() => {
    void runStatsHygiene("interval");
  }, intervalMs);
  g.__modelhubStatsSweep.unref?.();

  // Kick one refresh shortly after boot without blocking startup.
  setTimeout(() => void runRefresh("boot"), 5000).unref?.();
  setTimeout(() => void runTagHygiene("boot"), 7000).unref?.();
  setTimeout(() => void runStatsHygiene("boot"), 9000).unref?.();

  logger.info({ intervalHours: hours }, "scheduler started");
}

export function stopScheduler(): void {
  if (g.__modelhubScheduler) {
    clearInterval(g.__modelhubScheduler);
    g.__modelhubScheduler = undefined;
    logger.info("scheduler stopped");
  }
  if (g.__modelhubTagSweep) {
    clearInterval(g.__modelhubTagSweep);
    g.__modelhubTagSweep = undefined;
  }
  if (g.__modelhubStatsSweep) {
    clearInterval(g.__modelhubStatsSweep);
    g.__modelhubStatsSweep = undefined;
  }
}

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AppDatabase } from "./db";
import { config } from "../config/env";
import { logger } from "./logger";
import { hashPassword } from "./password";
import {
  legacyDataFileSchema,
  configFileSchema,
  modelCacheSchema,
  normalizeBaseUrl,
  type ProviderConfig,
  type ModelCache,
} from "../domain/provider";
import { deriveStat, type StatContribution } from "../domain/stats";
import { UserRepository } from "./repositories/userRepo";
import { UserProviderRepository, type OwnedProvider } from "./repositories/userProviderRepo";
import { StatsRepository } from "./repositories/statsRepo";
import { KeyPoolRepository } from "./repositories/keyPoolRepo";
import { decrypt } from "./crypto";

/**
 * One-time import of v0.2 JSON storage into the v0.3 relational schema
 * (ADR-0009/0010). Idempotent: if any users already exist, it does nothing.
 * Steps:
 *   1. Ensure an initial admin user (password from MODELHUB_ADMIN_PASSWORD).
 *   2. Mount every legacy provider under that admin as a user_provider.
 *   3. Rebuild provider_stats from the admin's providers.
 *   4. Contribute the admin's keys to the key pool.
 *   5. Rename the legacy JSON files aside.
 */

const ADMIN_USERNAME = "admin";

function resolveDataDir(): string {
  const dataPath = process.env.MODELHUB_DATA_PATH ?? config.dataPath;
  if (!dataPath) return path.join(process.cwd(), "data");
  const p = path.resolve(dataPath);
  return p.toLowerCase().endsWith(".json") ? path.dirname(p) : p;
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

/** Read legacy providers from either the split config files or old data.json. */
async function readLegacyProviders(dataDir: string): Promise<{
  configs: ProviderConfig[];
  caches: Map<string, ModelCache>;
  sources: string[];
}> {
  const sources: string[] = [];
  const configs: ProviderConfig[] = [];
  const caches = new Map<string, ModelCache>();

  // Split layout (v0.2): providers.official.json + providers.other.json + models/*.json
  for (const category of ["official", "other"]) {
    const file = path.join(dataDir, `providers.${category}.json`);
    const raw = await readJson(file);
    if (!raw) continue;
    const parsed = configFileSchema.safeParse(raw);
    if (parsed.success) {
      configs.push(...parsed.data.providers);
      sources.push(file);
    }
  }
  if (configs.length > 0) {
    const modelsDir = path.join(dataDir, "models");
    for (const cfg of configs) {
      const raw = await readJson(path.join(modelsDir, `${cfg.id}.json`));
      if (!raw) continue;
      const parsed = modelCacheSchema.safeParse(raw);
      if (parsed.success) caches.set(cfg.id, parsed.data);
    }
    return { configs, caches, sources };
  }

  // Classic single-file layout (v0.1): data.json
  const legacyFile = path.join(dataDir, "data.json");
  const raw = await readJson(legacyFile);
  if (raw) {
    const parsed = legacyDataFileSchema.safeParse(raw);
    if (parsed.success) {
      sources.push(legacyFile);
      for (const lp of parsed.data.providers) {
        const p = lp as unknown as ProviderConfig & {
          models: string[];
          last_fetched: string | null;
          last_status: ModelCache["last_status"];
          last_error: string | null;
        };
        const { models, last_fetched, last_status, last_error, ...cfg } = p;
        configs.push(cfg as ProviderConfig);
        caches.set(p.id, {
          provider_id: p.id,
          models,
          count: models.length,
          last_fetched,
          last_status,
          last_error,
          updated_at: last_fetched,
        });
      }
    }
  }
  return { configs, caches, sources };
}

export async function seedFromJsonIfNeeded(db: AppDatabase): Promise<{
  ran: boolean;
  users: number;
  providers: number;
}> {
  const userRepo = new UserRepository(db);
  if ((await userRepo.count()) > 0) {
    return { ran: false, users: 0, providers: 0 };
  }

  // 1. Initial admin.
  const adminId = randomUUID();
  const password = config.adminPassword ?? randomUUID();
  await userRepo.insert({
    id: adminId,
    username: ADMIN_USERNAME,
    email: null,
    password_hash: hashPassword(password),
    role: "admin",
  });
  if (!config.adminPassword) {
    logger.warn(
      "MODELHUB_ADMIN_PASSWORD unset; created admin with a random password — set one and reset."
    );
  }

  // 2. Mount legacy providers under admin.
  const dataDir = resolveDataDir();
  const { configs, caches, sources } = await readLegacyProviders(dataDir);
  const providerRepo = new UserProviderRepository(db);
  const contributionsByUrl = new Map<
    string,
    { base_url: string; items: StatContribution[] }
  >();
  const keyPool = new KeyPoolRepository(db);

  for (const cfg of configs) {
    const cache = caches.get(cfg.id);
    const owned: OwnedProvider = {
      ...cfg,
      user_id: adminId,
      models: cache?.models ?? [],
      last_fetched: cache?.last_fetched ?? null,
      last_status: cache?.last_status ?? "pending",
      last_error: cache?.last_error ?? null,
      updated_at: cache?.updated_at ?? null,
    };
    await providerRepo.upsert(owned);

    const normalized = normalizeBaseUrl(cfg.base_url);
    const bucket = contributionsByUrl.get(normalized) ?? {
      base_url: cfg.base_url,
      items: [],
    };
    bucket.items.push({
      name: cfg.name,
      icon: cfg.icon,
      type: cfg.type,
      free_tier: cfg.free_tier,
    });
    contributionsByUrl.set(normalized, bucket);

    // 4. Contribute the admin's key to the pool.
    if (cfg.key_enc) {
      try {
        await keyPool.put(normalized, adminId, decrypt(cfg.key_enc));
      } catch {
        // A key we can't decrypt (wrong master key) is skipped, not fatal.
      }
    }
  }

  // 3. Rebuild stats.
  const statsRepo = new StatsRepository(db);
  for (const [normalized, { base_url, items }] of contributionsByUrl) {
    const derived = deriveStat(items);
    await statsRepo.upsertDerived({
      normalized_base_url: normalized,
      base_url,
      ...derived,
    });
  }

  // 5. Rename legacy files aside so a re-run doesn't re-import.
  for (const file of sources) {
    await fs.rename(file, `${file}.migrated`).catch(() => undefined);
  }

  logger.info(
    { providers: configs.length, sources: sources.length },
    "migrated legacy JSON into relational storage"
  );
  return { ran: true, users: 1, providers: configs.length };
}

import { promises as fs } from "fs";
import path from "path";
import { config } from "../config/env";
import { logger } from "./logger";
import {
  DataFile,
  StoredProvider,
  ProviderConfig,
  ModelCache,
  ProviderCategory,
  Settings,
  categoryOf,
  configFileSchema,
  modelCacheSchema,
  settingsSchema,
  legacyDataFileSchema,
  composeProvider,
  splitProvider,
} from "../domain/provider";

/**
 * Split JSON persistence with an async mutex + atomic writes.
 *
 * Layout (all under DATA_DIR):
 *   settings.json                — global settings
 *   providers.official.json      — 官方 provider CONFIGS (native + proxy)
 *   providers.other.json         — 其他 provider CONFIGS (newapi + custom)
 *   models/<provider-id>.json    — one MODEL CACHE per provider
 *
 * Config files are keyed by CATEGORY (官方/其他); the leaf `type` (native /
 * proxy / newapi / custom) lives inside each config. CONFIG holds identity +
 * connection + encrypted key; MODEL CACHE holds the fetched model list plus
 * status/timestamps, so refreshing models never rewrites the config files.
 *
 * The Repository interface is the seam: swapping to SQLite later means
 * implementing this interface, not touching services or routes.
 */

export interface ProviderRepository {
  read(): Promise<DataFile>;
  get(id: string): Promise<StoredProvider | undefined>;
  upsert(provider: StoredProvider): Promise<void>;
  remove(id: string): Promise<boolean>;
  mutate<T>(
    fn: (
      data: DataFile
    ) => { data: DataFile; result: T } | Promise<{ data: DataFile; result: T }>
  ): Promise<T>;
}

// All persistence lives under a single data DIRECTORY.
// MODELHUB_DATA_PATH may point at either the directory itself, or (for
// back-compat) the old data.json file — in which case we use its parent dir.
function resolveDataDir(): string {
  if (!config.dataPath) return path.join(process.cwd(), "data");
  const p = path.resolve(config.dataPath);
  // If it looks like the legacy JSON file, use its containing directory.
  return p.toLowerCase().endsWith(".json") ? path.dirname(p) : p;
}

const DATA_DIR = resolveDataDir();
// Legacy single-file location we migrate FROM (old default: <cwd>/data.json).
const LEGACY_DATA_PATH =
  config.dataPath && config.dataPath.toLowerCase().endsWith(".json")
    ? path.resolve(config.dataPath)
    : path.join(process.cwd(), "data.json");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const MODELS_DIR = path.join(DATA_DIR, "models");

/** Config files are keyed by CATEGORY (官方 / 其他). */
const CONFIG_PATHS: Record<ProviderCategory, string> = {
  official: path.join(DATA_DIR, "providers.official.json"),
  other: path.join(DATA_DIR, "providers.other.json"),
};

/** All categories, for iterating config files. */
const CATEGORIES: ProviderCategory[] = ["official", "other"];

const DEFAULT_SETTINGS: Settings = {
  refresh_interval_hours: config.defaultRefreshIntervalHours,
};

/** Async mutex: serializes all read-modify-write cycles. */
let lockChain: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockChain.then(fn, fn);
  lockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function readJson(file: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt/partial JSON on disk: never crash the whole read. Back the bad
    // file up for inspection and treat it as absent so callers fall back to
    // defaults (schema validation downstream also guards shape).
    logger.error({ file }, "JSON parse failed; quarantining corrupt file");
    await fs
      .rename(file, `${file}.corrupt.${Date.now()}`)
      .catch(() => undefined);
    return null;
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file); // atomic replace
}

function cachePath(id: string): string {
  return path.join(MODELS_DIR, `${id}.json`);
}

// ---- settings ----
async function readSettings(): Promise<Settings> {
  const raw = await readJson(SETTINGS_PATH);
  if (!raw) return { ...DEFAULT_SETTINGS };
  const parsed = settingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

// ---- config files (one per category) ----
async function readConfigs(
  category: ProviderCategory
): Promise<ProviderConfig[]> {
  const raw = await readJson(CONFIG_PATHS[category]);
  if (!raw) return [];
  const parsed = configFileSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error(
      { category, errors: parsed.error.flatten() },
      "provider config file failed validation; treating as empty"
    );
    return [];
  }
  return parsed.data.providers;
}

async function writeConfigs(
  category: ProviderCategory,
  configs: ProviderConfig[]
): Promise<void> {
  await writeJsonAtomic(CONFIG_PATHS[category], { providers: configs });
}

async function readAllConfigs(): Promise<ProviderConfig[]> {
  const lists = await Promise.all(CATEGORIES.map((c) => readConfigs(c)));
  return lists.flat();
}

// ---- model caches (one per provider) ----
async function readCache(id: string): Promise<ModelCache | null> {
  const raw = await readJson(cachePath(id));
  if (!raw) return null;
  const parsed = modelCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(cache: ModelCache): Promise<void> {
  await writeJsonAtomic(cachePath(cache.provider_id), cache);
}

async function removeCache(id: string): Promise<void> {
  await fs.rm(cachePath(id), { force: true });
}

/**
 * One-time migration: if the legacy data.json exists and the split config
 * files do not, fan it out into settings + per-type configs + per-provider
 * caches, then rename the old file aside.
 */
let migrated = false;
async function migrateLegacyIfNeeded(): Promise<void> {
  if (migrated) return;
  migrated = true;
  // Only the classic single file named exactly data.json is auto-migrated.
  if (path.basename(LEGACY_DATA_PATH) !== "data.json") return;
  const raw = await readJson(LEGACY_DATA_PATH);
  if (!raw) return;
  // If a split config already exists, don't clobber it.
  const existing = await readJson(CONFIG_PATHS.official);
  if (existing) return;

  const parsed = legacyDataFileSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error(
      { errors: parsed.error.flatten() },
      "legacy data.json failed validation; skipping migration"
    );
    return;
  }
  const legacy = parsed.data;
  const byCategory: Record<ProviderCategory, ProviderConfig[]> = {
    official: [],
    other: [],
  };
  const now = new Date().toISOString();
  for (const lp of legacy.providers) {
    const stored = { ...lp, updated_at: now } as StoredProvider;
    const { config: cfg, cache } = splitProvider(stored);
    byCategory[categoryOf(cfg.type)].push(cfg);
    await writeCache(cache);
  }
  for (const c of CATEGORIES) await writeConfigs(c, byCategory[c]);
  await writeJsonAtomic(SETTINGS_PATH, legacy.settings);
  await fs
    .rename(LEGACY_DATA_PATH, `${LEGACY_DATA_PATH}.migrated`)
    .catch(() => {});
  logger.info(
    { providers: legacy.providers.length },
    "migrated legacy data.json to split storage"
  );
}

async function readAll(): Promise<DataFile> {
  await migrateLegacyIfNeeded();
  const [settings, configs] = await Promise.all([
    readSettings(),
    readAllConfigs(),
  ]);
  const providers = await Promise.all(
    configs.map(async (cfg) => composeProvider(cfg, await readCache(cfg.id)))
  );
  return { settings, providers };
}

/** The default file-backed repository. */
export const fileRepository: ProviderRepository = {
  read() {
    return withLock(readAll);
  },

  async get(id) {
    return withLock(async () => {
      await migrateLegacyIfNeeded();
      const configs = await readAllConfigs();
      const cfg = configs.find((c) => c.id === id);
      if (!cfg) return undefined;
      return composeProvider(cfg, await readCache(id));
    });
  },

  async upsert(provider) {
    await withLock(async () => {
      await migrateLegacyIfNeeded();
      const { config: cfg, cache } = splitProvider(provider);
      const category = categoryOf(cfg.type);
      // Config goes into its category file; remove any stale copy from the
      // other category (in case the provider's type/category changed).
      const lists = await Promise.all(CATEGORIES.map((c) => readConfigs(c)));
      const byCategory = Object.fromEntries(
        CATEGORIES.map((c, i) => [c, lists[i]])
      ) as Record<ProviderCategory, ProviderConfig[]>;

      for (const c of CATEGORIES) {
        if (c === category) continue;
        if (byCategory[c].some((x) => x.id === cfg.id)) {
          await writeConfigs(
            c,
            byCategory[c].filter((x) => x.id !== cfg.id)
          );
        }
      }
      const same = byCategory[category];
      const idx = same.findIndex((x) => x.id === cfg.id);
      if (idx >= 0) same[idx] = cfg;
      else same.push(cfg);
      await writeConfigs(category, same);
      await writeCache(cache);
    });
  },

  async remove(id) {
    return withLock(async () => {
      await migrateLegacyIfNeeded();
      let removed = false;
      for (const category of CATEGORIES) {
        const list = await readConfigs(category);
        const next = list.filter((c) => c.id !== id);
        if (next.length !== list.length) {
          await writeConfigs(category, next);
          removed = true;
        }
      }
      if (removed) await removeCache(id);
      return removed;
    });
  },

  mutate(fn) {
    return withLock(async () => {
      await migrateLegacyIfNeeded();
      const current = await readAll();
      const { data, result } = await fn(current);
      // Persist settings and every provider (config + cache).
      await writeJsonAtomic(SETTINGS_PATH, data.settings);
      const byCategory: Record<ProviderCategory, ProviderConfig[]> = {
        official: [],
        other: [],
      };
      for (const p of data.providers) {
        const { config: cfg, cache } = splitProvider(p);
        byCategory[categoryOf(cfg.type)].push(cfg);
        await writeCache(cache);
      }
      for (const c of CATEGORIES) await writeConfigs(c, byCategory[c]);
      return result;
    });
  },
};

export function getDataDir(): string {
  return DATA_DIR;
}

/** @deprecated use getDataDir(); kept for callers referencing the old file. */
export function getDataPath(): string {
  return LEGACY_DATA_PATH;
}

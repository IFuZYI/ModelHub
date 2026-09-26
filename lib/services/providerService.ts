import { randomUUID } from "crypto";
import { encrypt } from "../infra/crypto";
import { AppError } from "../domain/errors";
import {
  ProviderView,
  PublicProviderView,
  ProviderSummary,
  StoredProvider,
  DataFile,
  toView,
  toPublicView,
  DEFAULT_ADAPTER,
} from "../domain/provider";
import { fileRepository, ProviderRepository } from "../infra/repository";
import { refreshProvider } from "./fetcher";
import { CreateProviderInput, UpdateProviderInput } from "../domain/validation";

/** Model id without its `vendor/` prefix, lowercased — for cross-provider dedup. */
function modelDedupeKey(model: string): string {
  const trimmed = model.trim();
  const lastSlash = trimmed.lastIndexOf("/");
  return (lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed).toLowerCase();
}

/** Normalize a string field: a value keeps it, empty/absent clears to null. */
function orNull(v: string | null | undefined): string | null {
  return v ? v : null;
}

/**
 * Provider use-cases. Depends on a ProviderRepository (default: file-backed)
 * so it is unit-testable with an in-memory fake and storage-agnostic.
 */
export class ProviderService {
  constructor(private readonly repo: ProviderRepository = fileRepository) {}

  async list(): Promise<ProviderView[]> {
    const data = await this.repo.read();
    return data.providers.map(toView);
  }

  /** List + settings in a single repo read (avoids a double file read). */
  async listWithSettings(): Promise<{
    providers: ProviderView[];
    settings: DataFile["settings"];
  }> {
    const data = await this.repo.read();
    return { providers: data.providers.map(toView), settings: data.settings };
  }

  /** List metadata only, avoiding thousands of model ids on the homepage/admin. */
  async listSummariesWithSettings(): Promise<{
    providers: ProviderSummary[];
    settings: DataFile["settings"];
    total_model_count: number;
  }> {
    const data = await this.repo.read();
    // A summary is the public view minus its model id array.
    const providers = data.providers.map((provider): ProviderSummary => {
      const view = toPublicView(provider);
      const { models, ...summary } = view;
      void models;
      return summary;
    });
    return {
      providers,
      settings: data.settings,
      total_model_count: new Set(
        data.providers.flatMap((provider) =>
          provider.models.map(modelDedupeKey).filter(Boolean)
        )
      ).size,
    };
  }

  async getPublicView(id: string): Promise<PublicProviderView> {
    return toPublicView(await this.requireProvider(id));
  }

  async getView(id: string): Promise<ProviderView> {
    return toView(await this.requireProvider(id));
  }

  async create(input: CreateProviderInput): Promise<ProviderView> {
    const seedModels = input.models ? [...input.models].sort() : [];
    const manual = input.manual_models ?? false;
    const now = new Date().toISOString();
    const provider: StoredProvider = {
      id: randomUUID(),
      name: input.name,
      description: orNull(input.description),
      type: input.type,
      base_url: input.base_url,
      aff_code: orNull(input.aff_code),
      adapter: input.adapter ?? DEFAULT_ADAPTER,
      free: input.free ?? false,
      catalog_slugs: input.catalog_slugs ?? {},
      key_enc: input.key ? encrypt(input.key) : null,
      manual_models: manual,
      icon: orNull(input.icon),
      register_methods: input.register_methods ?? [],
      models: seedModels,
      last_fetched: null,
      last_status: "pending",
      last_error: null,
      updated_at: seedModels.length > 0 ? now : null,
    };
    return this.persist(provider);
  }

  async update(id: string, input: UpdateProviderInput): Promise<ProviderView> {
    const existing = await this.requireProvider(id);
    const updated: StoredProvider = { ...existing };

    // Plain overwrites (undefined leaves the field unchanged).
    if (input.name !== undefined) updated.name = input.name;
    if (input.description !== undefined) {
      updated.description = orNull(input.description);
    }
    if (input.type !== undefined) updated.type = input.type;
    if (input.base_url !== undefined) updated.base_url = input.base_url;
    if (input.adapter !== undefined) updated.adapter = input.adapter;
    if (input.free !== undefined) updated.free = input.free;
    if (input.catalog_slugs !== undefined) {
      updated.catalog_slugs = input.catalog_slugs;
    }
    if (input.register_methods !== undefined) {
      updated.register_methods = input.register_methods;
    }
    // String fields where "" clears to null, a value sets, undefined preserves.
    if (input.aff_code !== undefined) updated.aff_code = orNull(input.aff_code);
    if (input.icon !== undefined) updated.icon = orNull(input.icon);
    // A supplied empty key clears the credential; omission preserves it.
    if (input.key !== undefined) {
      updated.key_enc = input.key ? encrypt(input.key) : null;
    }
    // Manual model list edits (custom / newapi).
    if (input.models !== undefined) {
      updated.models = [...input.models].sort();
    }
    if (input.manual_models !== undefined) {
      updated.manual_models = input.manual_models;
    }

    return this.persist(updated);
  }

  async remove(id: string): Promise<void> {
    const ok = await this.repo.remove(id);
    if (!ok) throw AppError.notFound("Provider not found");
  }

  async refresh(id: string): Promise<ProviderView> {
    const refreshed = await refreshProvider(await this.requireProvider(id), this.repo);
    return toView(refreshed);
  }

  async settings() {
    const data = await this.repo.read();
    return data.settings;
  }

  /** Load a provider or throw NOT_FOUND. */
  private async requireProvider(id: string): Promise<StoredProvider> {
    const p = await this.repo.get(id);
    if (!p) throw AppError.notFound("Provider not found");
    return p;
  }

  /**
   * Persist a provider then materialize its view. Manual-model providers
   * (built-in lists, non-standard auth) keep their seed instead of a doomed
   * upstream fetch; everyone else fetches live models via the adapter chain.
   */
  private async persist(provider: StoredProvider): Promise<ProviderView> {
    if (provider.manual_models) {
      const now = new Date().toISOString();
      const seeded: StoredProvider = {
        ...provider,
        last_fetched: now,
        last_status: provider.models.length > 0 ? "ok" : "pending",
        last_error: null,
        updated_at: now,
      };
      await this.repo.upsert(seeded);
      return toView(seeded);
    }
    await this.repo.upsert(provider);
    return toView(await refreshProvider(provider, this.repo));
  }
}

/** Default singleton used by route handlers. */
export const providerService = new ProviderService();

import { randomUUID } from "crypto";
import { encrypt } from "../infra/crypto";
import { AppError } from "../domain/errors";
import {
  ProviderView,
  StoredProvider,
  DataFile,
  toView,
  DEFAULT_ADAPTER,
} from "../domain/provider";
import { fileRepository, ProviderRepository } from "../infra/repository";
import { refreshProvider } from "./fetcher";
import { CreateProviderInput, UpdateProviderInput } from "../domain/validation";

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

  async getView(id: string): Promise<ProviderView> {
    const p = await this.repo.get(id);
    if (!p) throw AppError.notFound("Provider not found");
    return toView(p);
  }

  async create(input: CreateProviderInput): Promise<ProviderView> {
    const seedModels = input.models ? [...input.models].sort() : [];
    const manual = input.manual_models ?? false;
    const now = new Date().toISOString();
    const provider: StoredProvider = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      base_url: input.base_url,
      aff_code: input.aff_code ? input.aff_code : null,
      adapter: input.adapter ?? DEFAULT_ADAPTER,
      key_enc: input.key ? encrypt(input.key) : null,
      manual_models: manual,
      icon: input.icon ? input.icon : null,
      register_methods: input.register_methods ?? [],
      models: seedModels,
      last_fetched: null,
      last_status: "pending",
      last_error: null,
      updated_at: seedModels.length > 0 ? now : null,
    };
    await this.repo.upsert(provider);
    // Manual-model providers (e.g. Gemini/Anthropic) have no usable listing
    // endpoint — keep the built-in seed instead of a doomed upstream fetch.
    if (manual) {
      const seeded: StoredProvider = {
        ...provider,
        last_fetched: now,
        last_status: seedModels.length > 0 ? "ok" : "pending",
        last_error: null,
        updated_at: now,
      };
      await this.repo.upsert(seeded);
      return toView(seeded);
    }
    const refreshed = await refreshProvider(provider, this.repo);
    return toView(refreshed);
  }

  async update(id: string, input: UpdateProviderInput): Promise<ProviderView> {
    const existing = await this.repo.get(id);
    if (!existing) throw AppError.notFound("Provider not found");

    const updated: StoredProvider = { ...existing };
    if (input.name !== undefined) updated.name = input.name;
    if (input.type !== undefined) updated.type = input.type;
    if (input.base_url !== undefined) updated.base_url = input.base_url;
    if (input.adapter !== undefined) updated.adapter = input.adapter;
    // aff_code: empty string clears, a value sets, undefined leaves unchanged
    if (input.aff_code !== undefined) {
      updated.aff_code = input.aff_code ? input.aff_code : null;
    }
    // Only re-encrypt when a new non-empty key is supplied.
    if (input.key && input.key.length > 0) {
      updated.key_enc = encrypt(input.key);
    }
    // icon: empty string clears, a value sets, undefined leaves unchanged
    if (input.icon !== undefined) {
      updated.icon = input.icon ? input.icon : null;
    }
    // register_methods: replace the list when provided
    if (input.register_methods !== undefined) {
      updated.register_methods = input.register_methods;
    }
    // Manual model list edits (custom / newapi): set the list and flag, then
    // persist without a doomed upstream fetch when marked manual.
    if (input.models !== undefined) {
      updated.models = [...input.models].sort();
    }
    if (input.manual_models !== undefined) {
      updated.manual_models = input.manual_models;
    }

    await this.repo.upsert(updated);
    // When models are manual, keep them as-is instead of refreshing.
    if (updated.manual_models) {
      const now = new Date().toISOString();
      const seeded: StoredProvider = {
        ...updated,
        last_fetched: now,
        last_status: updated.models.length > 0 ? "ok" : "pending",
        last_error: null,
        updated_at: now,
      };
      await this.repo.upsert(seeded);
      return toView(seeded);
    }
    const refreshed = await refreshProvider(updated, this.repo);
    return toView(refreshed);
  }

  async remove(id: string): Promise<void> {
    const ok = await this.repo.remove(id);
    if (!ok) throw AppError.notFound("Provider not found");
  }

  async refresh(id: string): Promise<ProviderView> {
    const p = await this.repo.get(id);
    if (!p) throw AppError.notFound("Provider not found");
    const refreshed = await refreshProvider(p, this.repo);
    return toView(refreshed);
  }

  async settings() {
    const data = await this.repo.read();
    return data.settings;
  }
}

/** Default singleton used by route handlers. */
export const providerService = new ProviderService();

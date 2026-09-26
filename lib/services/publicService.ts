import { getDatabase } from "../infra/db";
import { UserProviderRepository } from "../infra/repositories/userProviderRepo";
import { UserRepository } from "../infra/repositories/userRepo";
import { AppError } from "../domain/errors";
import { buildInviteUrl, type ProviderType, type FreeTier } from "../domain/provider";

/** Public, read-only projection of a provider for guests (no key material). */
export interface PublicProvider {
  id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  base_url: string;
  free_tier: FreeTier;
  icon: string | null;
  aff_code: string | null;
  invite_url: string | null;
  model_count: number;
  register_methods: string[];
}

export interface PublicProviderDetail extends PublicProvider {
  models: string[];
}

/** Public page payload: owner label + that owner's providers. */
export interface PublicPage {
  owner: { username: string; slug: string | null };
  providers: PublicProvider[];
  total_model_count: number;
}

function modelDedupeKey(model: string): string {
  const trimmed = model.trim();
  const i = trimmed.lastIndexOf("/");
  return (i >= 0 ? trimmed.slice(i + 1) : trimmed).toLowerCase();
}

/**
 * Read-only public views (ADR-0010/0012): the homepage shows the (first) admin's
 * providers; a personal page shows one user's providers by slug. Guests only
 * ever see these — never keys, diagnostics, or other users' data.
 */
export class PublicService {
  private readonly providers: UserProviderRepository;
  private readonly users: UserRepository;
  constructor(
    providers = new UserProviderRepository(getDatabase()),
    users = new UserRepository(getDatabase())
  ) {
    this.providers = providers;
    this.users = users;
  }

  private toPublic(p: {
    id: string;
    name: string;
    description: string | null;
    type: ProviderType;
    base_url: string;
    free_tier: FreeTier;
    icon: string | null;
    aff_code: string | null;
    register_methods: string[];
    models: string[];
  }): PublicProvider {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      base_url: p.base_url,
      free_tier: p.free_tier,
      icon: p.icon,
      aff_code: p.aff_code,
      invite_url: buildInviteUrl(p.base_url, p.aff_code),
      model_count: p.models.length,
      register_methods: p.register_methods,
    };
  }

  private summarize(providers: PublicProvider[], models: string[][]) {
    return {
      providers,
      total_model_count: new Set(
        models.flatMap((m) => m.map(modelDedupeKey).filter(Boolean))
      ).size,
    };
  }

  /** The first admin account, or undefined on a fresh install. */
  private async firstAdmin() {
    const users = await this.users.list();
    return users.find((u) => u.role === "admin");
  }

  /** Homepage: the primary admin's providers (summaries). */
  async homepage(): Promise<{
    providers: PublicProvider[];
    total_model_count: number;
  }> {
    const admin = await this.firstAdmin();
    if (!admin) return { providers: [], total_model_count: 0 };
    const owned = await this.providers.listByUser(admin.id);
    return this.summarize(
      owned.map((p) => this.toPublic(p)),
      owned.map((p) => p.models)
    );
  }

  /** Personal page by slug. Throws NOT_FOUND when the slug is unknown. */
  async personalPage(slug: string): Promise<PublicPage> {
    const user = await this.users.getBySlug(slug);
    if (!user || user.status !== "active") {
      throw AppError.notFound("Page not found");
    }
    const owned = await this.providers.listByUser(user.id);
    const { providers, total_model_count } = this.summarize(
      owned.map((p) => this.toPublic(p)),
      owned.map((p) => p.models)
    );
    return {
      owner: { username: user.username, slug: user.slug },
      providers,
      total_model_count,
    };
  }

  /** Public provider detail (models included, no key). */
  async detail(id: string): Promise<PublicProviderDetail> {
    const p = await this.providers.getById(id);
    if (!p) throw AppError.notFound("Provider not found");
    return { ...this.toPublic(p), models: p.models };
  }
}

export const publicService = new PublicService();

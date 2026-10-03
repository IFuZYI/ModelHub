import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db";
import type { User, Role, UserStatus } from "../../domain/user";

type UserRow = DatabaseSchema["users"];

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    password_hash: row.password_hash,
    role: row.role,
    status: row.status,
    token_version: row.token_version,
    slug: row.slug,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface NewUser {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: Role;
  status?: UserStatus;
  slug?: string | null;
}

export interface UserPatch {
  email?: string | null;
  password_hash?: string;
  role?: Role;
  status?: UserStatus;
  slug?: string | null;
  bump_token_version?: boolean;
}

/** Client-safe identity subset for bulk view assembly (no credentials). */
export interface UserIdentity {
  id: string;
  username: string;
  slug: string | null;
  status: UserStatus;
}

/** CRUD for user accounts. Storage-agnostic via the Kysely handle. */
export class UserRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async list(): Promise<User[]> {
    const rows = await this.db
      .selectFrom("users")
      .selectAll()
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toUser);
  }

  async getById(id: string): Promise<User | undefined> {
    const row = await this.db
      .selectFrom("users")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toUser(row) : undefined;
  }

  async getByUsername(username: string): Promise<User | undefined> {
    const row = await this.db
      .selectFrom("users")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();
    return row ? toUser(row) : undefined;
  }

  async getBySlug(slug: string): Promise<User | undefined> {
    const row = await this.db
      .selectFrom("users")
      .selectAll()
      .where("slug", "=", slug)
      .executeTakeFirst();
    return row ? toUser(row) : undefined;
  }

  /**
   * Bulk fetch client-safe identities by id (view assembly without loading
   * every user row, and without credential material — callers get only
   * id/username/slug/status, so a future caller can never leak
   * password_hash by accident).
   */
  async getIdentities(ids: string[]): Promise<UserIdentity[]> {
    if (ids.length === 0) return [];
    return this.db
      .selectFrom("users")
      .select(["id", "username", "slug", "status"])
      .where("id", "in", [...new Set(ids)])
      .execute();
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insert(user: NewUser): Promise<User> {
    const now = new Date().toISOString();
    const row: UserRow = {
      id: user.id,
      username: user.username,
      email: user.email,
      password_hash: user.password_hash,
      role: user.role,
      status: user.status ?? "active",
      token_version: 0,
      slug: user.slug ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto("users").values(row).execute();
    return toUser(row);
  }

  async update(id: string, patch: UserPatch): Promise<User | undefined> {
    const set: Partial<UserRow> = { updated_at: new Date().toISOString() };
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.password_hash !== undefined) set.password_hash = patch.password_hash;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.slug !== undefined) set.slug = patch.slug;
    if (patch.bump_token_version) {
      const cur = await this.getById(id);
      if (!cur) return undefined;
      set.token_version = cur.token_version + 1;
    }
    await this.db.updateTable("users").set(set).where("id", "=", id).execute();
    return this.getById(id);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom("users")
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0) > 0;
  }
}

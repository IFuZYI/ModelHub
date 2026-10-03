import { randomUUID } from "crypto";
import { AppError } from "../domain/errors";
import {
  toUserView,
  generateSlug,
  isValidSlug,
  throwUserUniqueAsValidation,
  type UserView,
  type Role,
  type UserStatus,
} from "../domain/user";
import { getDatabase, isUniqueViolation } from "../infra/db";
import { UserRepository, type UserRepository as URepo } from "../infra/repositories/userRepo";
import { hashPassword } from "../infra/password";
import { settingsService } from "./settingsService";

export interface CreateUserArgs {
  username: string;
  password: string;
  email?: string | null;
  role?: Role;
}

export interface UpdateUserArgs {
  password?: string;
  email?: string | null;
  role?: Role;
  status?: UserStatus;
}

/** User account use-cases (ADR-0009/0012). */
export class UserService {
  private readonly repo: URepo;
  constructor(repo: URepo = new UserRepository(getDatabase())) {
    this.repo = repo;
  }

  /**
   * Translate a raw UNIQUE violation from the users table into a clean
   * VALIDATION error (shared with authService via the user domain).
   */
  private static rethrowUnique(err: unknown): never {
    return throwUserUniqueAsValidation(err);
  }

  async list(): Promise<UserView[]> {
    return (await this.repo.list()).map(toUserView);
  }

  async getView(id: string): Promise<UserView> {
    const user = await this.repo.getById(id);
    if (!user) throw AppError.notFound("User not found");
    return toUserView(user);
  }

  async create(args: CreateUserArgs): Promise<UserView> {
    if (await this.repo.getByUsername(args.username)) {
      throw AppError.validation("用户名已被占用");
    }
    try {
      const user = await this.repo.insert({
        id: randomUUID(),
        username: args.username,
        email: args.email ?? null,
        password_hash: hashPassword(args.password),
        role: args.role ?? "user",
      });
      return toUserView(user);
    } catch (err) {
      // Concurrent create, or an email already taken by another account.
      if (isUniqueViolation(err)) UserService.rethrowUnique(err);
      throw err;
    }
  }

  async update(id: string, args: UpdateUserArgs): Promise<UserView> {
    const existing = await this.repo.getById(id);
    if (!existing) throw AppError.notFound("User not found");
    // Guard against locking the console out: the last remaining admin may not
    // be demoted to user or disabled. (Self vs other is enforced at the route.)
    const losingAdmin =
      existing.role === "admin" &&
      ((args.role !== undefined && args.role !== "admin") ||
        args.status === "disabled");
    if (losingAdmin && (await this.adminCount()) <= 1) {
      throw AppError.validation("不能降级或停用唯一的管理员");
    }
    const updated = await this.repo
      .update(id, {
        email: args.email,
        password_hash:
          args.password !== undefined ? hashPassword(args.password) : undefined,
        role: args.role,
        status: args.status,
        // Any credential/role/status change invalidates existing sessions.
        bump_token_version:
          args.password !== undefined ||
          args.role !== undefined ||
          args.status !== undefined,
      })
      .catch((err: unknown) => {
        // e.g. the new email is already used by another account.
        if (isUniqueViolation(err)) UserService.rethrowUnique(err);
        throw err;
      });
    if (!updated) throw AppError.notFound("User not found");
    return toUserView(updated);
  }

  async remove(id: string): Promise<void> {
    // Refuse to delete the last admin, so the console can't lock itself out.
    const user = await this.repo.getById(id);
    if (!user) throw AppError.notFound("User not found");
    if (user.role === "admin" && (await this.adminCount()) <= 1) {
      throw AppError.validation("不能删除唯一的管理员");
    }
    await this.repo.remove(id);
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await this.repo.getById(id);
    if (!user) throw AppError.notFound("User not found");
    const { verifyPassword } = await import("../infra/password");
    if (!verifyPassword(currentPassword, user.password_hash)) {
      throw AppError.unauthorized("当前密码不正确");
    }
    await this.repo.update(id, {
      password_hash: hashPassword(newPassword),
      bump_token_version: true,
    });
  }

  /**
   * Assign (or rotate) the user's personal-page slug.
   *
   * The pre-check avoids the common collision, but two concurrent assigns can
   * still pick the same slug (TOCTOU); the users.slug UNIQUE constraint is the
   * backstop — catch the conflict and retry with a fresh slug instead of
   * bubbling a 500.
   */
  async assignSlug(id: string): Promise<string> {
    // ADR-0012: the operator switch also gates NEW slugs, not just display.
    if (!(await settingsService.getPersonalPagesEnabled())) {
      throw AppError.validation("个人页功能未开放");
    }
    const user = await this.repo.getById(id);
    if (!user) throw AppError.notFound("User not found");
    for (let attempt = 0; attempt < 8; attempt++) {
      const slug = generateSlug();
      if (!isValidSlug(slug)) continue;
      if (await this.repo.getBySlug(slug)) continue;
      try {
        await this.repo.update(id, { slug });
        return slug;
      } catch (err) {
        // Unique-constraint loss against a concurrent assign — retry.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw AppError.internal("Failed to allocate a unique slug");
  }

  async clearSlug(id: string): Promise<void> {
    await this.repo.update(id, { slug: null });
  }

  private async adminCount(): Promise<number> {
    return (await this.repo.list()).filter((u) => u.role === "admin").length;
  }
}

export const userService = new UserService();

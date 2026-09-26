import { randomUUID } from "crypto";
import { AppError } from "../domain/errors";
import { getDatabase } from "../infra/db";
import { UserRepository } from "../infra/repositories/userRepo";
import { hashPassword } from "../infra/password";
import { toUserView, type UserView } from "../domain/user";
import { verifyPassword, createToken, type Session } from "./auth";
import { settingsService } from "./settingsService";
import type { LoginInput, RegisterInput } from "../domain/validation";

/** Result of a successful auth: the session token + the user view. */
export interface AuthResult {
  token: Session extends never ? never : string;
  user: UserView;
}

/** Login + self-registration use-cases (ADR-0009/0012). */
export class AuthService {
  private readonly users: UserRepository;
  constructor(users = new UserRepository(getDatabase())) {
    this.users = users;
  }

  async login(
    input: LoginInput
  ): Promise<{ token: string; user: UserView }> {
    const user = await this.users.getByUsername(input.username);
    if (!user || user.status !== "active") {
      throw AppError.unauthorized("用户名或密码错误");
    }
    if (!verifyPassword(input.password, user.password_hash)) {
      throw AppError.unauthorized("用户名或密码错误");
    }
    const token = createToken({
      userId: user.id,
      role: user.role,
      tokenVersion: user.token_version,
    });
    return { token, user: toUserView(user) };
  }

  /** Self-registration, gated by settings. New accounts are always role=user. */
  async register(
    input: RegisterInput
  ): Promise<{ token: string; user: UserView }> {
    const settings = await settingsService.getPublic();
    if (!settings.registration_enabled) {
      throw AppError.validation("当前未开放注册");
    }
    if (settings.email_verification_required && !input.email) {
      throw AppError.validation("注册需要邮箱");
    }
    if (
      input.email &&
      settings.email_domain_whitelist.length > 0 &&
      !settings.email_domain_whitelist.some((d) =>
        input.email!.toLowerCase().endsWith(`@${d.toLowerCase()}`)
      )
    ) {
      throw AppError.validation("邮箱域名不在允许列表内");
    }
    if (await this.users.getByUsername(input.username)) {
      throw AppError.validation("用户名已被占用");
    }
    const user = await this.users.insert({
      id: randomUUID(),
      username: input.username,
      email: input.email ?? null,
      password_hash: hashPassword(input.password),
      role: "user",
    });
    const token = createToken({
      userId: user.id,
      role: user.role,
      tokenVersion: user.token_version,
    });
    return { token, user: toUserView(user) };
  }
}

export const authService = new AuthService();

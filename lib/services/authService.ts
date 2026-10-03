import { randomUUID } from "crypto";
import { AppError } from "../domain/errors";
import { getDatabase, isUniqueViolation } from "../infra/db";
import { UserRepository } from "../infra/repositories/userRepo";
import { EmailVerificationRepository } from "../infra/repositories/emailVerificationRepo";
import { hashPassword } from "../infra/password";
import {
  toUserView,
  throwUserUniqueAsValidation,
  type UserView,
} from "../domain/user";
import { verifyPassword, createToken } from "./auth";
import { settingsService } from "./settingsService";
import { sendMail } from "./mailer";
import { logger } from "../infra/logger";
import type { LoginInput, RegisterInput } from "../domain/validation";

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A well-formed scrypt hash that no password matches, verified against when a
 * login names an unknown account so the response time does not reveal whether
 * the user exists. Generated once at module load (the cost is ~10ms).
 */
const DUMMY_PASSWORD_HASH = hashPassword(
  randomUUID() + randomUUID()
);

/** A completed auth: session token + user. */
export interface AuthTokenResult {
  status: "ok";
  token: string;
  user: UserView;
}

/** Registration requires an emailed code before the account is created. */
export interface AuthPendingResult {
  status: "verification_required";
  email: string;
}

export type RegisterResult = AuthTokenResult | AuthPendingResult;

function sixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Login + self-registration + email verification (ADR-0009/0012). */
export class AuthService {
  private readonly users: UserRepository;
  private readonly verifications: EmailVerificationRepository;
  constructor(
    users = new UserRepository(getDatabase()),
    verifications = new EmailVerificationRepository(getDatabase())
  ) {
    this.users = users;
    this.verifications = verifications;
  }

  async login(input: LoginInput): Promise<AuthTokenResult> {
    const user = await this.users.getByUsername(input.username);
    // Constant-work login: an early return for an unknown username skips
    // scrypt entirely, and the response time then reveals whether the account
    // exists (a username-enumeration oracle). Verify against a dummy hash when
    // there is no user so both paths pay the same cost.
    const hash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
    const passwordOk = verifyPassword(input.password, hash);
    if (!user || user.status !== "active" || !passwordOk) {
      throw AppError.unauthorized("用户名或密码错误");
    }
    return {
      status: "ok",
      token: createToken({
        userId: user.id,
        role: user.role,
        tokenVersion: user.token_version,
      }),
      user: toUserView(user),
    };
  }

  /**
   * Self-registration, gated by settings. When email verification is required,
   * this issues + emails a code and returns a pending result; the account is
   * created only by verifyEmail. Otherwise the account is created immediately.
   * New accounts are always role=user.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
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

    if (settings.email_verification_required && input.email) {
      const code = sixDigitCode();
      await this.verifications.issue(
        input.email,
        code,
        JSON.stringify({
          username: input.username,
          password_hash: hashPassword(input.password),
        }),
        CODE_TTL_MS
      );
      try {
        await sendMail({
          to: input.email,
          subject: "ModelHub 注册验证码",
          text: `你的验证码是 ${code}，15 分钟内有效。`,
        });
      } catch (e) {
        // Surface a clear error but keep the code so a resend/retry can work.
        logger.error({ err: String(e) }, "verification email failed to send");
        throw AppError.config("验证码邮件发送失败，请联系管理员检查 SMTP 配置");
      }
      return { status: "verification_required", email: input.email };
    }

    const user = await this.users
      .insert({
        id: randomUUID(),
        username: input.username,
        email: input.email ?? null,
        password_hash: hashPassword(input.password),
        role: "user",
      })
      .catch((err: unknown) => {
        // e.g. the email is already used by another account (race past the
        // username check, or a user registering a second account).
        if (isUniqueViolation(err)) throwUserUniqueAsValidation(err);
        throw err;
      });
    return {
      status: "ok",
      token: createToken({
        userId: user.id,
        role: user.role,
        tokenVersion: user.token_version,
      }),
      user: toUserView(user),
    };
  }

  /** Confirm an emailed code, creating the pending account and logging in. */
  async verifyEmail(email: string, code: string): Promise<AuthTokenResult> {
    // Registration may have been closed after the code was issued; the
    // operator's switch must win, or a pre-issued code becomes a bypass.
    const settings = await settingsService.getPublic();
    if (!settings.registration_enabled) {
      throw AppError.validation("当前未开放注册");
    }
    const record = await this.verifications.findValid(email, code);
    if (!record) throw AppError.validation("验证码无效或已过期");
    const payload = JSON.parse(record.payload) as {
      username: string;
      password_hash: string;
    };
    if (await this.users.getByUsername(payload.username)) {
      await this.verifications.consume(record.id);
      throw AppError.validation("用户名已被占用");
    }
    const user = await this.users
      .insert({
        id: randomUUID(),
        username: payload.username,
        email,
        password_hash: payload.password_hash,
        role: "user",
      })
      .catch((err: unknown) => {
        // The email may have been taken between issue and verify.
        if (isUniqueViolation(err)) throwUserUniqueAsValidation(err);
        throw err;
      });
    await this.verifications.consume(record.id);
    return {
      status: "ok",
      token: createToken({
        userId: user.id,
        role: user.role,
        tokenVersion: user.token_version,
      }),
      user: toUserView(user),
    };
  }
}

export const authService = new AuthService();

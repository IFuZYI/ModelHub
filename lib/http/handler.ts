import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";
import { AppError, isAppError } from "../domain/errors";
import { logger } from "../infra/logger";

/** Human labels for API fields, so validation errors read naturally. */
const FIELD_LABELS: Record<string, string> = {
  username: "用户名",
  password: "密码",
  new_password: "新密码",
  current_password: "当前密码",
  email: "邮箱",
  code: "验证码",
  role: "角色",
  status: "状态",
  display_name: "显示名称",
  bio: "简介",
  avatar: "头像",
  body: "评论内容",
  score: "评分",
  tags: "标签",
  name: "名称",
  base_url: "地址",
  url: "链接",
  type: "类型",
  free_tier: "免费额度",
};

/**
 * Turn field errors into a single readable message, e.g.
 *   { password: ["密码至少 8 位"] } → "密码：密码至少 8 位"
 *   { username: [...], password: [...] } → "用户名：…；密码：…"
 * Falls back to a generic sentence when there is nothing to show.
 */
function summarizeValidation(
  fieldErrors: Record<string, string[] | undefined>
): string {
  const parts: string[] = [];
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!messages || messages.length === 0) continue;
    const label = FIELD_LABELS[field] ?? field;
    parts.push(`${label}：${messages.join("；")}`);
  }
  return parts.length > 0 ? parts.join("  ") : "请求参数不合法";
}

/** Consistent JSON error envelope: { error: { code, message, details? } }. */
export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status }
    );
  }
  if (err instanceof ZodError) {
    const fieldErrors = err.flatten().fieldErrors;
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          // Surface the actual field messages so clients can show the user
          // WHY input was rejected (e.g. "密码至少 8 位") instead of a
          // generic "Invalid request body".
          message: summarizeValidation(fieldErrors),
          details: fieldErrors,
        },
      },
      { status: 400 }
    );
  }
  logger.error({ err: String(err) }, "unhandled route error");
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Internal error" } },
    { status: 500 }
  );
}

/** Wrap an async handler so thrown errors become the standard envelope. */
export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Parse and validate a JSON body, throwing a Zod/AppError on failure. */
export async function parseJson<T>(
  req: Request,
  schema: ZodSchema<T>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw AppError.validation("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

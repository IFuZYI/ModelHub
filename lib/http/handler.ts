import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";
import { AppError, isAppError } from "../domain/errors";
import { logger } from "../infra/logger";

/** Consistent JSON error envelope: { error: { code, message, details? } }. */
export function errorResponse(err: unknown): NextResponse {
  if (isAppError(err)) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status }
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "Invalid request body",
          details: err.flatten().fieldErrors,
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

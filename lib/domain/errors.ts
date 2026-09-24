/**
 * Typed application errors with stable codes and HTTP status mapping.
 * Route handlers translate these into a consistent JSON error envelope.
 */

export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "CONFIG"
  | "UPSTREAM"
  | "CRYPTO"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static validation(message: string, details?: unknown) {
    return new AppError("VALIDATION", message, 400, details);
  }
  static notFound(message = "Resource not found") {
    return new AppError("NOT_FOUND", message, 404);
  }
  static unauthorized(message = "Authentication required") {
    return new AppError("UNAUTHORIZED", message, 401);
  }
  static config(message: string) {
    return new AppError("CONFIG", message, 500);
  }
  static upstream(message: string, details?: unknown) {
    return new AppError("UPSTREAM", message, 502, details);
  }
  static crypto(message: string) {
    return new AppError("CRYPTO", message, 500);
  }
  static internal(message = "Internal error") {
    return new AppError("INTERNAL", message, 500);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

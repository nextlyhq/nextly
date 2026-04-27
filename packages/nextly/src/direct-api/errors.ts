/**
 * Direct API Error Classes — migration shim.
 *
 * During the unified-error-system migration:
 *   - The exported `NextlyError` here extends the core `NextlyError` from
 *     `../errors/nextly-error` so structural type guards
 *     (`NextlyError.is(err)`) and the new `withErrorHandler` wrapper recognize
 *     direct-api errors.
 *   - The legacy positional constructor `new NextlyError(message, code,
 *     statusCode, data, cause)` is preserved.
 *   - Subclasses (`NotFoundError`, `ValidationError`, ...) keep their
 *     existing constructors and behavior.
 *
 * This file is deleted entirely in PR 12; namespaces switch to throwing
 * `NextlyError` factory calls from `../errors`.
 *
 * @packageDocumentation
 */

import { NextlyError as CoreNextlyError } from "../errors/nextly-error";

/**
 * Legacy direct-api error code enum. Differs from the new
 * `NEXTLY_ERROR_STATUS` keyset (`AUTH_REQUIRED`, `AUTH_INVALID_CREDENTIALS`,
 * `DUPLICATE`, `RATE_LIMITED`) — preserved here so existing callers'
 * `error.code === NextlyErrorCode.UNAUTHORIZED` checks continue to work.
 */
export enum NextlyErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  DUPLICATE = "DUPLICATE",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
}

const ERROR_CODE_TO_STATUS: Record<NextlyErrorCode, number> = {
  [NextlyErrorCode.VALIDATION_ERROR]: 400,
  [NextlyErrorCode.INVALID_INPUT]: 400,
  [NextlyErrorCode.UNAUTHORIZED]: 401,
  [NextlyErrorCode.INVALID_CREDENTIALS]: 401,
  [NextlyErrorCode.TOKEN_EXPIRED]: 401,
  [NextlyErrorCode.FORBIDDEN]: 403,
  [NextlyErrorCode.NOT_FOUND]: 404,
  [NextlyErrorCode.CONFLICT]: 409,
  [NextlyErrorCode.DUPLICATE]: 409,
  [NextlyErrorCode.INTERNAL_ERROR]: 500,
  [NextlyErrorCode.DATABASE_ERROR]: 500,
};

/**
 * Legacy direct-api NextlyError. Extends the core NextlyError so it
 * satisfies the new wrappers' structural checks and serializes correctly,
 * while keeping the legacy positional constructor signature.
 */
export class NextlyError extends CoreNextlyError {
  constructor(
    message: string,
    code: NextlyErrorCode | string = NextlyErrorCode.INTERNAL_ERROR,
    statusCode: number = 500,
    data?: unknown,
    cause?: Error
  ) {
    super({
      code,
      publicMessage: message,
      // Honor the explicit statusCode when given, otherwise resolve from the
      // local enum mapping (for legacy code names not in NEXTLY_ERROR_STATUS).
      statusCode:
        statusCode !== 500 || !(code in ERROR_CODE_TO_STATUS)
          ? statusCode
          : ERROR_CODE_TO_STATUS[code as NextlyErrorCode],
      // Direct-api callers pass `data` for both validation field maps and
      // generic context. Funnel into publicData so the new toResponseJSON
      // path emits it correctly.
      publicData: data as never,
      cause,
    });
    this.name = "NextlyError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends NextlyError {
  constructor(message: string = "Resource not found", data?: unknown) {
    super(message, NextlyErrorCode.NOT_FOUND, 404, data);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends NextlyError {
  /** Field-specific validation errors (legacy shape). */
  public readonly errors: Record<string, string[]>;

  constructor(
    message: string = "Validation failed",
    errors: Record<string, string[]> = {},
    data?: unknown
  ) {
    super(message, NextlyErrorCode.VALIDATION_ERROR, 400, {
      errors,
      ...(data && typeof data === "object" ? data : {}),
    });
    this.name = "ValidationError";
    this.errors = errors;
  }

  getAllMessages(): string[] {
    return Object.values(this.errors).flat();
  }

  hasFieldError(field: string): boolean {
    return field in this.errors && this.errors[field].length > 0;
  }

  getFieldErrors(field: string): string[] {
    return this.errors[field] || [];
  }
}

export class UnauthorizedError extends NextlyError {
  constructor(message: string = "Unauthorized", data?: unknown) {
    super(message, NextlyErrorCode.UNAUTHORIZED, 401, data);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends NextlyError {
  constructor(message: string = "Forbidden", data?: unknown) {
    super(message, NextlyErrorCode.FORBIDDEN, 403, data);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends NextlyError {
  constructor(message: string = "Conflict", data?: unknown) {
    super(message, NextlyErrorCode.CONFLICT, 409, data);
    this.name = "ConflictError";
  }
}

export class DuplicateError extends NextlyError {
  constructor(message: string = "Duplicate resource", data?: unknown) {
    super(message, NextlyErrorCode.DUPLICATE, 409, data);
    this.name = "DuplicateError";
  }
}

export class DatabaseError extends NextlyError {
  constructor(message: string = "Database error", cause?: Error) {
    super(message, NextlyErrorCode.DATABASE_ERROR, 500, undefined, cause);
    this.name = "DatabaseError";
  }
}

export function isNextlyError(error: unknown): error is NextlyError {
  return error instanceof NextlyError;
}

export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isUnauthorizedError(
  error: unknown
): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

export function isConflictError(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}

export function isDuplicateError(error: unknown): error is DuplicateError {
  return error instanceof DuplicateError;
}

export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

/**
 * Convert a ServiceError to a NextlyError. Used by direct-api namespaces
 * to bridge from the service layer; deleted in PR 10 once services throw
 * `NextlyError` directly.
 */
export function fromServiceError(error: {
  code: string;
  message: string;
  httpStatus?: number;
  details?: unknown;
  cause?: Error;
}): NextlyError {
  const { code, message, httpStatus = 500, details, cause } = error;

  switch (code) {
    case "NOT_FOUND":
      return new NotFoundError(message, details);

    case "VALIDATION_ERROR":
    case "INVALID_INPUT":
      if (
        details &&
        typeof details === "object" &&
        "errors" in details &&
        typeof details.errors === "object"
      ) {
        return new ValidationError(
          message,
          details.errors as Record<string, string[]>,
          details
        );
      }
      return new ValidationError(message, {}, details);

    case "UNAUTHORIZED":
    case "INVALID_CREDENTIALS":
    case "TOKEN_EXPIRED":
      return new UnauthorizedError(message, details);

    case "FORBIDDEN":
    case "INSUFFICIENT_PERMISSIONS":
      return new ForbiddenError(message, details);

    case "CONFLICT":
    case "CONCURRENT_MODIFICATION":
      return new ConflictError(message, details);

    case "DUPLICATE_KEY":
      return new DuplicateError(message, details);

    case "DATABASE_ERROR":
      return new DatabaseError(message, cause);

    default:
      return new NextlyError(message, code, httpStatus, details, cause);
  }
}

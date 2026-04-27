/**
 * Migration shim: ServiceError is a standalone class (not a subclass of
 * NextlyError) but stamps the cross-realm brand on its prototype so that
 * `NextlyError.is(serviceErr)` returns true and the new withErrorHandler
 * wrapper recognises it. ServiceError also implements `toResponseJSON` and
 * `toLogJSON` with the canonical wire shape.
 *
 * Why composition rather than `extends NextlyError`: ServiceError's legacy
 * static factories (`notFound(message, details)`) have positional signatures
 * that TypeScript variance rules reject as overrides of NextlyError's
 * options-based factories (`notFound(opts?: { logContext })`). 119+ callers
 * use the legacy signatures; renaming or breaking them is unacceptable for
 * the shim period.
 *
 * Deleted in PR 12 once every throw site has migrated to NextlyError factories.
 */

import { isDbError, type DbErrorKind } from "../database/errors";

import type { PublicData } from "./public-data";

const NEXTLY_ERROR_BRAND: unique symbol = Symbol.for(
  "@revnixhq/nextly/NextlyError"
);

export enum ServiceErrorCode {
  // Validation errors (400)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_INPUT = "INVALID_INPUT",

  // Authentication errors (401)
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",

  // Authorization errors (403)
  FORBIDDEN = "FORBIDDEN",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",

  // Not found errors (404)
  NOT_FOUND = "NOT_FOUND",

  // Conflict errors (409)
  CONFLICT = "CONFLICT",
  DUPLICATE_KEY = "DUPLICATE_KEY",
  CONCURRENT_MODIFICATION = "CONCURRENT_MODIFICATION",

  // Business logic errors (422)
  BUSINESS_RULE_VIOLATION = "BUSINESS_RULE_VIOLATION",
  WORKFLOW_VIOLATION = "WORKFLOW_VIOLATION",

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // Internal errors (500)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
}

const ERROR_CODE_TO_STATUS: Record<ServiceErrorCode, number> = {
  [ServiceErrorCode.VALIDATION_ERROR]: 400,
  [ServiceErrorCode.INVALID_INPUT]: 400,
  [ServiceErrorCode.UNAUTHORIZED]: 401,
  [ServiceErrorCode.INVALID_CREDENTIALS]: 401,
  [ServiceErrorCode.TOKEN_EXPIRED]: 401,
  [ServiceErrorCode.FORBIDDEN]: 403,
  [ServiceErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ServiceErrorCode.NOT_FOUND]: 404,
  [ServiceErrorCode.CONFLICT]: 409,
  [ServiceErrorCode.DUPLICATE_KEY]: 409,
  [ServiceErrorCode.CONCURRENT_MODIFICATION]: 409,
  [ServiceErrorCode.BUSINESS_RULE_VIOLATION]: 422,
  [ServiceErrorCode.WORKFLOW_VIOLATION]: 422,
  [ServiceErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ServiceErrorCode.INTERNAL_ERROR]: 500,
  [ServiceErrorCode.DATABASE_ERROR]: 500,
  [ServiceErrorCode.EXTERNAL_SERVICE_ERROR]: 500,
};

function mapDbErrorKindToServiceCode(kind: DbErrorKind): ServiceErrorCode {
  switch (kind) {
    case "unique-violation":
      return ServiceErrorCode.DUPLICATE_KEY;
    case "fk-violation":
    case "not-null-violation":
    case "constraint":
      return ServiceErrorCode.VALIDATION_ERROR;
    case "syntax":
      return ServiceErrorCode.INTERNAL_ERROR;
    case "deadlock":
    case "serialization-failure":
      return ServiceErrorCode.CONFLICT;
    case "timeout":
    case "connection-lost":
      return ServiceErrorCode.DATABASE_ERROR;
    case "internal":
    default:
      return ServiceErrorCode.DATABASE_ERROR;
  }
}

export class ServiceError extends Error {
  public readonly code: ServiceErrorCode;
  public readonly httpStatus: number;
  /** Alias for httpStatus, matches the new NextlyError API surface. */
  public readonly statusCode: number;
  /** Alias for `message`, matches the new NextlyError API surface. */
  public readonly publicMessage: string;
  /** Alias for `details` exposed structurally as PublicData for wrapper compatibility. */
  public readonly publicData?: PublicData;
  public readonly logContext?: Record<string, unknown>;
  public readonly details?: unknown;
  public override readonly cause?: Error;
  public readonly timestamp: Date;

  constructor(
    code: ServiceErrorCode,
    message: string,
    details?: unknown,
    cause?: Error
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.httpStatus = ERROR_CODE_TO_STATUS[code] ?? 500;
    this.statusCode = this.httpStatus;
    this.publicMessage = message;
    this.details = details;
    // useDefineForClassFields (ES2022 default) resets values set by super(),
    // so cast to bypass readonly and assign after super().
    (this as { cause?: Error }).cause = cause;
    this.timestamp = new Date();
    // logContext for the new wrapper's structured logger.
    this.logContext =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : details !== undefined
          ? { details }
          : undefined;
    Error.captureStackTrace?.(this, ServiceError);
  }

  static {
    // Stamp the cross-realm brand so NextlyError.is(serviceErr) returns true.
    (ServiceError.prototype as unknown as Record<symbol, unknown>)[
      NEXTLY_ERROR_BRAND
    ] = true;
  }

  /** New wire format. Used by withErrorHandler / withAction. */
  toResponseJSON(requestId: string): {
    code: string;
    message: string;
    data?: PublicData;
    requestId: string;
  } {
    return {
      code: this.code,
      message: this.publicMessage,
      ...(this.publicData !== undefined && { data: this.publicData }),
      requestId,
    };
  }

  /** New log format. Used by withErrorHandler / withAction. */
  toLogJSON(requestId: string): Record<string, unknown> {
    return {
      code: this.code,
      statusCode: this.statusCode,
      publicMessage: this.publicMessage,
      logContext: this.logContext,
      cause: this.cause
        ? {
            name: this.cause.name,
            message: this.cause.message,
            stack: this.cause.stack,
          }
        : undefined,
      timestamp: this.timestamp.toISOString(),
      requestId,
    };
  }

  /** Legacy JSON shape preserved for backward compatibility. */
  toJSON(): {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
  } {
    return {
      code: this.code,
      message: this.publicMessage,
      ...(this.details !== undefined && { details: this.details }),
      timestamp: this.timestamp.toISOString(),
    };
  }

  isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }

  isServerError(): boolean {
    return this.httpStatus >= 500;
  }

  // ────────────────────────────────────────────────────────────────────
  // Legacy static factories. Preserved at their original signatures so
  // 119+ existing call sites continue to work unchanged.
  // ────────────────────────────────────────────────────────────────────

  static notFound(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.NOT_FOUND, message, details);
  }

  static validation(message: string, details?: unknown): ServiceError {
    return new ServiceError(
      ServiceErrorCode.VALIDATION_ERROR,
      message,
      details
    );
  }

  static forbidden(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.FORBIDDEN, message, details);
  }

  static unauthorized(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.UNAUTHORIZED, message, details);
  }

  static duplicate(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.DUPLICATE_KEY, message, details);
  }

  static internal(message: string, cause?: Error): ServiceError {
    return new ServiceError(
      ServiceErrorCode.INTERNAL_ERROR,
      message,
      undefined,
      cause
    );
  }

  static conflict(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.CONFLICT, message, details);
  }

  static businessRule(message: string, details?: unknown): ServiceError {
    return new ServiceError(
      ServiceErrorCode.BUSINESS_RULE_VIOLATION,
      message,
      details
    );
  }

  static fromDatabaseError(error: unknown): ServiceError {
    if (isDbError(error)) {
      const code = mapDbErrorKindToServiceCode(error.kind);
      const message = error.message || "Database operation failed";

      let userMessage = message;
      if (error.kind === "unique-violation") {
        userMessage = "A record with this value already exists";
      } else if (error.kind === "fk-violation") {
        userMessage = "Referenced record does not exist";
      } else if (error.kind === "not-null-violation") {
        userMessage = "Required field is missing";
      } else if (error.kind === "timeout") {
        userMessage = "Database operation timed out";
      } else if (error.kind === "connection-lost") {
        userMessage = "Database connection lost";
      }

      return new ServiceError(
        code,
        userMessage,
        { dbErrorKind: error.kind, originalMessage: message },
        error
      );
    }

    const err = error as Error & { code?: string };
    const message = err?.message || "Database operation failed";

    if (err?.code === "23505") {
      return new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        "A record with this value already exists",
        { dbCode: err.code },
        err
      );
    }

    if (err?.code === "23503") {
      return new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        "Referenced record does not exist",
        { dbCode: err.code },
        err
      );
    }

    if (err?.code === "23502") {
      return new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        "Required field is missing",
        { dbCode: err.code },
        err
      );
    }

    return new ServiceError(
      ServiceErrorCode.DATABASE_ERROR,
      message,
      undefined,
      err
    );
  }
}

/** Type guard for ServiceError. */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

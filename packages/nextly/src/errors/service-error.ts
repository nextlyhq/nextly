/**
 * Service Error Codes
 *
 * These codes map to HTTP status codes and provide structured error handling.
 * Use generic codes with details for entity-specific information.
 */
/**
 * Import DbError types for integration
 */
import { isDbError, type DbErrorKind } from "../database/errors";

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

/**
 * HTTP status code mapping for error codes
 */
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

/**
 * Map DbErrorKind to ServiceErrorCode
 */
function mapDbErrorKindToServiceCode(kind: DbErrorKind): ServiceErrorCode {
  switch (kind) {
    case "unique-violation":
      return ServiceErrorCode.DUPLICATE_KEY;
    case "fk-violation":
      return ServiceErrorCode.VALIDATION_ERROR;
    case "not-null-violation":
      return ServiceErrorCode.VALIDATION_ERROR;
    case "syntax":
      return ServiceErrorCode.INTERNAL_ERROR;
    case "constraint":
      return ServiceErrorCode.VALIDATION_ERROR;
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

/**
 * ServiceError - Exception class for service layer errors
 *
 * Usage:
 * ```typescript
 * // In service
 * throw new ServiceError(ServiceErrorCode.NOT_FOUND, 'Document not found', { entity: 'user', id });
 *
 * // In API route
 * try {
 *   const doc = await service.findById(id);
 *   return NextResponse.json({ data: doc });
 * } catch (error) {
 *   if (error instanceof ServiceError) {
 *     return NextResponse.json({ error: error.toJSON() }, { status: error.httpStatus });
 *   }
 *   throw error;
 * }
 * ```
 */
export class ServiceError extends Error {
  public readonly code: ServiceErrorCode;
  public readonly httpStatus: number;
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
    this.details = details;
    this.cause = cause;
    this.timestamp = new Date();

    // Maintain proper stack trace (V8 environments only)
    Error.captureStackTrace?.(this, ServiceError);
  }

  /**
   * Convert to JSON-serializable object for API responses
   */
  toJSON(): {
    code: string;
    message: string;
    details?: unknown;
    timestamp: string;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
      timestamp: this.timestamp.toISOString(),
    };
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.httpStatus >= 500;
  }

  /**
   * Create a NOT_FOUND error
   * @param message - Error message
   * @param details - Optional details (e.g., { entity: 'user', id: '123' })
   */
  static notFound(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.NOT_FOUND, message, details);
  }

  /**
   * Create a VALIDATION_ERROR
   * @param message - Error message
   * @param details - Optional validation details (e.g., { field: 'email', issue: 'format' })
   */
  static validation(message: string, details?: unknown): ServiceError {
    return new ServiceError(
      ServiceErrorCode.VALIDATION_ERROR,
      message,
      details
    );
  }

  /**
   * Create a FORBIDDEN error
   * @param message - Error message
   * @param details - Optional details about required permissions
   */
  static forbidden(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.FORBIDDEN, message, details);
  }

  /**
   * Create an UNAUTHORIZED error
   * @param message - Error message
   * @param details - Optional details
   */
  static unauthorized(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.UNAUTHORIZED, message, details);
  }

  /**
   * Create a DUPLICATE_KEY error
   * @param message - Error message
   * @param details - Optional details (e.g., { field: 'email', value: 'test@test.com' })
   */
  static duplicate(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.DUPLICATE_KEY, message, details);
  }

  /**
   * Create an INTERNAL_ERROR (wrapping another error)
   * @param message - Error message
   * @param cause - Original error that caused this
   */
  static internal(message: string, cause?: Error): ServiceError {
    return new ServiceError(
      ServiceErrorCode.INTERNAL_ERROR,
      message,
      undefined,
      cause
    );
  }

  /**
   * Create a CONFLICT error
   * @param message - Error message
   * @param details - Optional details about the conflict
   */
  static conflict(message: string, details?: unknown): ServiceError {
    return new ServiceError(ServiceErrorCode.CONFLICT, message, details);
  }

  /**
   * Create a BUSINESS_RULE_VIOLATION error
   * @param message - Error message describing the violated rule
   * @param details - Optional details about the rule
   */
  static businessRule(message: string, details?: unknown): ServiceError {
    return new ServiceError(
      ServiceErrorCode.BUSINESS_RULE_VIOLATION,
      message,
      details
    );
  }

  /**
   * Wrap a database error into a ServiceError
   *
   * Accepts either a DbError instance or a raw database error.
   * When given a DbError, maps DbErrorKind to appropriate ServiceErrorCode.
   * When given a raw error, attempts to detect common database error patterns.
   *
   * @param error - Database error (DbError instance or raw error)
   */
  static fromDatabaseError(error: unknown): ServiceError {
    // Handle DbError instances with proper kind mapping
    if (isDbError(error)) {
      const code = mapDbErrorKindToServiceCode(error.kind);
      const message = error.message || "Database operation failed";

      // Provide user-friendly messages for common cases
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

    // Handle raw errors - attempt to detect common patterns
    const err = error as Error & { code?: string };
    const message = err?.message || "Database operation failed";

    // PostgreSQL unique violation
    if (err?.code === "23505") {
      return new ServiceError(
        ServiceErrorCode.DUPLICATE_KEY,
        "A record with this value already exists",
        { dbCode: err.code },
        err
      );
    }

    // PostgreSQL foreign key violation
    if (err?.code === "23503") {
      return new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        "Referenced record does not exist",
        { dbCode: err.code },
        err
      );
    }

    // PostgreSQL not-null violation
    if (err?.code === "23502") {
      return new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        "Required field is missing",
        { dbCode: err.code },
        err
      );
    }

    // Generic database error
    return new ServiceError(
      ServiceErrorCode.DATABASE_ERROR,
      message,
      undefined,
      err
    );
  }
}

/**
 * Type guard to check if an error is a ServiceError
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

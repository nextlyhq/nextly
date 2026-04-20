/**
 * Direct API Error Classes
 *
 * This module provides error classes for the Nextly Direct API.
 * These errors provide a clean, consistent interface for error handling
 * while internally leveraging the ServiceError infrastructure.
 *
 * @example
 * ```typescript
 * import { NotFoundError, ValidationError } from 'nextly';
 *
 * try {
 *   const post = await nextly.findByID({ collection: 'posts', id: 'missing' });
 * } catch (error) {
 *   if (error instanceof NotFoundError) {
 *     console.log('Post not found');
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

/**
 * Error codes for Direct API errors.
 *
 * These codes provide machine-readable error identification
 * and map to appropriate HTTP status codes.
 */
export enum NextlyErrorCode {
  /** Validation failed (400) */
  VALIDATION_ERROR = "VALIDATION_ERROR",
  /** Invalid input provided (400) */
  INVALID_INPUT = "INVALID_INPUT",
  /** Authentication required (401) */
  UNAUTHORIZED = "UNAUTHORIZED",
  /** Invalid credentials (401) */
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  /** Token expired (401) */
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  /** Permission denied (403) */
  FORBIDDEN = "FORBIDDEN",
  /** Resource not found (404) */
  NOT_FOUND = "NOT_FOUND",
  /** Resource conflict (409) */
  CONFLICT = "CONFLICT",
  /** Duplicate resource (409) */
  DUPLICATE = "DUPLICATE",
  /** Internal server error (500) */
  INTERNAL_ERROR = "INTERNAL_ERROR",
  /** Database error (500) */
  DATABASE_ERROR = "DATABASE_ERROR",
}

/**
 * HTTP status code mapping for error codes.
 */
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
 * Base error class for all Nextly Direct API errors.
 *
 * Provides a consistent error interface with error codes,
 * HTTP status codes, and optional additional data.
 *
 * @example
 * ```typescript
 * throw new NextlyError(
 *   'Post not found',
 *   NextlyErrorCode.NOT_FOUND,
 *   404,
 *   { collection: 'posts', id: 'post-123' }
 * );
 * ```
 */
export class NextlyError extends Error {
  /** Error code for machine-readable identification */
  public readonly code: NextlyErrorCode | string;

  /** HTTP status code */
  public readonly statusCode: number;

  /** Additional error data */
  public readonly data?: unknown;

  /** Original error that caused this error */
  public readonly cause?: Error;

  /** Timestamp when the error occurred */
  public readonly timestamp: Date;

  constructor(
    message: string,
    code: NextlyErrorCode | string = NextlyErrorCode.INTERNAL_ERROR,
    statusCode: number = 500,
    data?: unknown,
    cause?: Error
  ) {
    super(message);
    this.name = "NextlyError";
    this.code = code;
    this.statusCode =
      typeof code === "string" && code in NextlyErrorCode
        ? ERROR_CODE_TO_STATUS[code as NextlyErrorCode]
        : statusCode;
    this.data = data;
    this.cause = cause;
    this.timestamp = new Date();

    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert error to JSON-serializable object.
   *
   * Useful for API responses and logging.
   */
  toJSON(): {
    name: string;
    code: string;
    message: string;
    statusCode: number;
    data?: unknown;
    timestamp: string;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.data !== undefined && { data: this.data }),
      timestamp: this.timestamp.toISOString(),
    };
  }

  /**
   * Check if this is a client error (4xx).
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if this is a server error (5xx).
   */
  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

/**
 * Error thrown when a requested resource is not found.
 *
 * HTTP Status: 404
 *
 * @example
 * ```typescript
 * throw new NotFoundError('Post not found', {
 *   collection: 'posts',
 *   id: 'post-123',
 * });
 * ```
 */
export class NotFoundError extends NextlyError {
  constructor(message: string = "Resource not found", data?: unknown) {
    super(message, NextlyErrorCode.NOT_FOUND, 404, data);
    this.name = "NotFoundError";
  }
}

/**
 * Error thrown when validation fails.
 *
 * HTTP Status: 400
 *
 * @example
 * ```typescript
 * throw new ValidationError('Invalid input', {
 *   errors: {
 *     email: ['Invalid email format'],
 *     name: ['Name is required'],
 *   },
 * });
 * ```
 */
export class ValidationError extends NextlyError {
  /** Field-specific validation errors */
  public readonly errors: Record<string, string[]>;

  constructor(
    message: string = "Validation failed",
    errors: Record<string, string[]> = {},
    data?: unknown
  ) {
    super(message, NextlyErrorCode.VALIDATION_ERROR, 400, {
      errors,
      ...((data as object) || {}),
    });
    this.name = "ValidationError";
    this.errors = errors;
  }

  /**
   * Get all error messages as a flat array.
   */
  getAllMessages(): string[] {
    return Object.values(this.errors).flat();
  }

  /**
   * Check if a specific field has errors.
   */
  hasFieldError(field: string): boolean {
    return field in this.errors && this.errors[field].length > 0;
  }

  /**
   * Get error messages for a specific field.
   */
  getFieldErrors(field: string): string[] {
    return this.errors[field] || [];
  }
}

/**
 * Error thrown when authentication is required but not provided.
 *
 * HTTP Status: 401
 *
 * @example
 * ```typescript
 * throw new UnauthorizedError('Authentication required');
 * ```
 */
export class UnauthorizedError extends NextlyError {
  constructor(message: string = "Unauthorized", data?: unknown) {
    super(message, NextlyErrorCode.UNAUTHORIZED, 401, data);
    this.name = "UnauthorizedError";
  }
}

/**
 * Error thrown when user lacks permission for an operation.
 *
 * HTTP Status: 403
 *
 * @example
 * ```typescript
 * throw new ForbiddenError('You do not have permission to edit this post', {
 *   requiredRole: 'editor',
 *   userRole: 'viewer',
 * });
 * ```
 */
export class ForbiddenError extends NextlyError {
  constructor(message: string = "Forbidden", data?: unknown) {
    super(message, NextlyErrorCode.FORBIDDEN, 403, data);
    this.name = "ForbiddenError";
  }
}

/**
 * Error thrown when there's a resource conflict.
 *
 * HTTP Status: 409
 *
 * @example
 * ```typescript
 * throw new ConflictError('Document has been modified by another user', {
 *   expectedVersion: 1,
 *   actualVersion: 2,
 * });
 * ```
 */
export class ConflictError extends NextlyError {
  constructor(message: string = "Conflict", data?: unknown) {
    super(message, NextlyErrorCode.CONFLICT, 409, data);
    this.name = "ConflictError";
  }
}

/**
 * Error thrown when attempting to create a duplicate resource.
 *
 * HTTP Status: 409
 *
 * @example
 * ```typescript
 * throw new DuplicateError('A user with this email already exists', {
 *   field: 'email',
 *   value: 'user@example.com',
 * });
 * ```
 */
export class DuplicateError extends NextlyError {
  constructor(message: string = "Duplicate resource", data?: unknown) {
    super(message, NextlyErrorCode.DUPLICATE, 409, data);
    this.name = "DuplicateError";
  }
}

/**
 * Error thrown for database-related failures.
 *
 * HTTP Status: 500
 *
 * @example
 * ```typescript
 * throw new DatabaseError('Failed to connect to database', originalError);
 * ```
 */
export class DatabaseError extends NextlyError {
  constructor(message: string = "Database error", cause?: Error) {
    super(message, NextlyErrorCode.DATABASE_ERROR, 500, undefined, cause);
    this.name = "DatabaseError";
  }
}

/**
 * Type guard to check if an error is a NextlyError.
 *
 * @example
 * ```typescript
 * try {
 *   await nextly.findByID({ collection: 'posts', id: 'missing' });
 * } catch (error) {
 *   if (isNextlyError(error)) {
 *     console.log(`Error code: ${error.code}`);
 *   }
 * }
 * ```
 */
export function isNextlyError(error: unknown): error is NextlyError {
  return error instanceof NextlyError;
}

/**
 * Type guard to check if an error is a NotFoundError.
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}

/**
 * Type guard to check if an error is a ValidationError.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Type guard to check if an error is an UnauthorizedError.
 */
export function isUnauthorizedError(
  error: unknown
): error is UnauthorizedError {
  return error instanceof UnauthorizedError;
}

/**
 * Type guard to check if an error is a ForbiddenError.
 */
export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof ForbiddenError;
}

/**
 * Type guard to check if an error is a ConflictError.
 */
export function isConflictError(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}

/**
 * Type guard to check if an error is a DuplicateError.
 */
export function isDuplicateError(error: unknown): error is DuplicateError {
  return error instanceof DuplicateError;
}

/**
 * Type guard to check if an error is a DatabaseError.
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof DatabaseError;
}

/**
 * Convert a ServiceError to a NextlyError.
 *
 * This utility allows seamless integration between the service layer
 * and the Direct API error handling.
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

/**
 * Database error type definitions.
 *
 * @packageDocumentation
 */

/**
 * Database error classification.
 *
 * @remarks
 * Categorizes database errors for consistent error handling across adapters.
 * Each adapter translates database-specific error codes to these kinds.
 *
 * @public
 */
export type DatabaseErrorKind =
  | "connection" // Connection/network errors
  | "query" // Syntax or execution errors
  | "constraint" // Generic constraint violation
  | "unique_violation" // Unique constraint violation
  | "foreign_key_violation" // Foreign key constraint violation
  | "check_violation" // Check constraint violation
  | "not_null_violation" // NOT NULL constraint violation
  | "deadlock" // Transaction deadlock
  | "timeout" // Query or connection timeout
  | "serialization_failure" // Serializable transaction conflict
  | "unsupported_version" // F17: DB version below minimum or unparseable at connect
  | "unknown"; // Unclassified error

/**
 * Enhanced database error interface.
 *
 * @remarks
 * Extends the standard Error interface with database-specific context.
 * Adapters should throw errors implementing this interface for consistent
 * error handling.
 *
 * @example
 * ```typescript
 * try {
 *   await adapter.insert('users', { email: 'duplicate@example.com' });
 * } catch (error) {
 *   if (isDatabaseError(error) && error.kind === 'unique_violation') {
 *     console.log(`Duplicate ${error.column} in ${error.table}`);
 *   }
 * }
 * ```
 *
 * @public
 */
export interface DatabaseError extends Error {
  /** Error classification */
  kind: DatabaseErrorKind;

  /** Database-specific error code (e.g., "23505" for PostgreSQL unique violation) */
  code?: string;

  /** Constraint name that was violated (if applicable) */
  constraint?: string;

  /** Table name involved in the error */
  table?: string;

  /** Column name involved in the error */
  column?: string;

  /** Detailed error description from the database */
  detail?: string;

  /** Hint for resolving the error */
  hint?: string;

  /** Original error from the database driver */
  cause?: Error;
}

/**
 * Type guard for DatabaseError.
 *
 * @remarks
 * Checks if an error is a DatabaseError with proper typing.
 *
 * @param error - Error to check
 * @returns True if error is a DatabaseError
 *
 * @public
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof (error as DatabaseError).kind === "string"
  );
}

/**
 * Database error constructor options.
 *
 * @public
 */
export interface DatabaseErrorOptions {
  /** Error classification */
  kind: DatabaseErrorKind;

  /** Error message */
  message: string;

  /** Database-specific error code */
  code?: string;

  /** Constraint name */
  constraint?: string;

  /** Table name */
  table?: string;

  /** Column name */
  column?: string;

  /** Detailed description */
  detail?: string;

  /** Resolution hint */
  hint?: string;

  /** Original error */
  cause?: Error;
}

/**
 * Create a DatabaseError instance.
 *
 * @remarks
 * Helper function to create properly structured DatabaseError objects.
 *
 * @param options - Error options
 * @returns DatabaseError instance
 *
 * @public
 */
export function createDatabaseError(
  options: DatabaseErrorOptions
): DatabaseError {
  const error = new Error(options.message) as DatabaseError;
  error.name = "DatabaseError";
  error.kind = options.kind;

  if (options.code !== undefined) error.code = options.code;
  if (options.constraint !== undefined) error.constraint = options.constraint;
  if (options.table !== undefined) error.table = options.table;
  if (options.column !== undefined) error.column = options.column;
  if (options.detail !== undefined) error.detail = options.detail;
  if (options.hint !== undefined) error.hint = options.hint;
  if (options.cause !== undefined) error.cause = options.cause;

  return error;
}

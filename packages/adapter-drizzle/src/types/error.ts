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
 * The brand every Nextly application error carries.
 *
 * Read through the global symbol registry rather than imported, because the
 * adapters must not depend on the package that defines the error: `Symbol.for`
 * resolves to the same symbol in every module instance, which is why the brand
 * exists in that form to begin with.
 *
 * @internal
 */
const APPLICATION_ERROR_BRAND: unique symbol = Symbol.for("nextly/NextlyError");

/**
 * Whether an error is the application's verdict rather than the database's
 * failure.
 *
 * Work running inside a transaction may throw to roll the write back — a
 * refused value, a permission denial — and such an error is not something the
 * driver produced. Classifying it as a database error replaces its code and its
 * payload with a generic one, so a caller that asked for a refusal is handed an
 * unexplained failure instead, and per-field validation detail is lost on the
 * way out.
 *
 * @param error - Error to check
 * @returns True if the error was raised by application code
 *
 * @public
 */
export function isApplicationError(error: unknown): boolean {
  if (
    error === null ||
    (typeof error !== "object" && typeof error !== "function")
  ) {
    return false;
  }
  return (error as Record<symbol, unknown>)[APPLICATION_ERROR_BRAND] === true;
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

/**
 * The code an adapter gives the error it raises when a request has waited
 * longer than `pool.connectionTimeoutMs` for a database connection.
 *
 * A code of the adapters' own rather than the driver's wording, because the
 * drivers disagree: pg-pool raises a plain `Error` with no code, mysql2 has no
 * such wait to time out, and better-sqlite3 has no pool. Core reads this one
 * code to answer with its retryable "database busy" error.
 *
 * @public
 */
export const POOL_WAIT_TIMEOUT_CODE = "NEXTLY_POOL_WAIT_TIMEOUT";

/**
 * The error for a request that waited `boundMs` for a database connection and
 * was given none.
 *
 * @param boundMs - The bound it waited, `pool.connectionTimeoutMs`
 * @param cause - The driver's own error, when the driver raised one
 *
 * @public
 */
export function poolWaitTimeoutError(
  boundMs: number,
  cause?: Error
): DatabaseError {
  return createDatabaseError({
    kind: "timeout",
    code: POOL_WAIT_TIMEOUT_CODE,
    message: `Waited ${boundMs} ms for a database connection, and none was free`,
    cause,
  });
}

/**
 * The code an adapter gives the error it raises when a CRUD call names a
 * table its table resolver does not hold.
 *
 * Such a table is one this running instance never registered: on a running
 * site, an entity a migration added after the instance started. The code is
 * the adapters' own, like {@link POOL_WAIT_TIMEOUT_CODE}, so core can answer
 * it as an entity the instance has not registered rather than as a database
 * failure, without reading the message.
 *
 * @public
 */
export const TABLE_NOT_REGISTERED_CODE = "NEXTLY_TABLE_NOT_REGISTERED";

/**
 * The error for a CRUD call on `table` when the table resolver does not hold
 * it. The message names the table and what is missing, and nothing about how
 * the adapter was wired, which an operator cannot act on. It keeps the words
 * "not found in schema registry" the adapters have always used, for code that
 * still recognises the refusal by its message rather than by its code.
 *
 * @param table - The table the call named
 *
 * @public
 */
export function tableNotRegisteredError(table: string): DatabaseError {
  return createDatabaseError({
    kind: "query",
    code: TABLE_NOT_REGISTERED_CODE,
    table,
    message: `Table "${table}" not found in schema registry: this running instance has not registered it, so no statement can be built for it.`,
  });
}

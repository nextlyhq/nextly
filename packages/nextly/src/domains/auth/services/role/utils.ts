import { env } from "@nextly/lib/env";

/**
 * SQLite boolean constants
 * SQLite doesn't have a native boolean type, so we use integers
 */
const SQLITE_TRUE = 1;
const SQLITE_FALSE = 0;

/**
 * Validate that a string is a valid UUID format.
 * @param value - String to validate
 * @returns True if valid UUID format, false otherwise
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validate input parameter for role ID.
 * @param roleId - Role ID to validate
 * @throws Error if validation fails
 */
export function validateRoleId(
  roleId: string | null | undefined
): asserts roleId is string {
  if (!roleId || typeof roleId !== "string" || roleId.trim() === "") {
    throw new Error("Role ID is required and must be a non-empty string");
  }
  if (!isValidUUID(roleId)) {
    throw new Error("Role ID must be a valid UUID format");
  }
}

/**
 * Helper to convert boolean to database-specific format.
 * SQLite doesn't have a native boolean type, so we use integers (0/1).
 * PostgreSQL and MySQL handle booleans/ints natively.
 *
 * @param value - Boolean value to convert
 * @returns Database-appropriate boolean representation
 */
export function toDialectBool(value: boolean): boolean | number {
  // For sqlite we store integer(0/1); for pg/mysql booleans/ints are fine
  if (env.DB_DIALECT === "sqlite") {
    return value ? SQLITE_TRUE : SQLITE_FALSE;
  }
  return value;
}

/**
 * Case Conversion Utilities
 *
 * Helper functions for converting between snake_case (database) and camelCase (API).
 * These utilities handle both simple string conversion and recursive object transformation.
 *
 * @module lib/case-conversion
 */

/**
 * Convert a snake_case string to camelCase.
 * Example: "created_at" -> "createdAt"
 *
 * @param str - The snake_case string to convert
 * @returns The camelCase version of the string
 *
 * @example
 * ```typescript
 * toCamelCase("user_name") // => "userName"
 * toCamelCase("created_at") // => "createdAt"
 * ```
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert a camelCase string to snake_case.
 * Example: "createdAt" -> "created_at"
 *
 * @param str - The camelCase string to convert
 * @returns The snake_case version of the string
 *
 * @example
 * ```typescript
 * toSnakeCase("userName") // => "user_name"
 * toSnakeCase("createdAt") // => "created_at"
 * ```
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Recursively convert all object keys from snake_case to camelCase.
 * Handles nested objects and arrays, making it suitable for transforming
 * database responses (snake_case) into API responses (camelCase).
 *
 * @param obj - The object, array, or primitive value to convert
 * @returns A new object/array with all keys converted to camelCase, or the original value if primitive
 *
 * @example
 * ```typescript
 * keysToCamelCase({ user_name: "John", created_at: "2026-01-01" })
 * // => { userName: "John", createdAt: "2026-01-01" }
 *
 * keysToCamelCase({
 *   user_info: {
 *     first_name: "John",
 *     last_name: "Doe"
 *   }
 * })
 * // => { userInfo: { firstName: "John", lastName: "Doe" } }
 *
 * keysToCamelCase([{ user_name: "John" }, { user_name: "Jane" }])
 * // => [{ userName: "John" }, { userName: "Jane" }]
 * ```
 */
export function keysToCamelCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(keysToCamelCase);
  } else if (
    obj !== null &&
    typeof obj === "object" &&
    obj.constructor === Object
  ) {
    return Object.entries(obj as Record<string, unknown>).reduce(
      (acc, [key, value]) => {
        acc[toCamelCase(key)] = keysToCamelCase(value);
        return acc;
      },
      {} as Record<string, unknown>
    );
  }
  return obj;
}

/**
 * Recursively convert all object keys from camelCase to snake_case.
 * Handles nested objects and arrays, making it suitable for transforming
 * API requests (camelCase) into database queries (snake_case).
 *
 * @param obj - The object, array, or primitive value to convert
 * @returns A new object/array with all keys converted to snake_case, or the original value if primitive
 *
 * @example
 * ```typescript
 * keysToSnakeCase({ userName: "John", createdAt: "2026-01-01" })
 * // => { user_name: "John", created_at: "2026-01-01" }
 *
 * keysToSnakeCase({
 *   userInfo: {
 *     firstName: "John",
 *     lastName: "Doe"
 *   }
 * })
 * // => { user_info: { first_name: "John", last_name: "Doe" } }
 * ```
 */
export function keysToSnakeCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(keysToSnakeCase);
  } else if (
    obj !== null &&
    typeof obj === "object" &&
    obj.constructor === Object
  ) {
    return Object.entries(obj as Record<string, unknown>).reduce(
      (acc, [key, value]) => {
        acc[toSnakeCase(key)] = keysToSnakeCase(value);
        return acc;
      },
      {} as Record<string, unknown>
    );
  }
  return obj;
}

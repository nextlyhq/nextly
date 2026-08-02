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

/**
 * The system timestamp columns, and the camelCase name each is published under.
 *
 * Listed once because a row can reach the API through several paths, and a column converted on
 * some of them and not others gives the same entry different shapes depending on the operation
 * that returned it. That is what happened to `first_published_at`: create responses carried
 * `firstPublishedAt` while list and detail reads returned the raw column name.
 */
export const TIMESTAMP_COLUMN_NAMES: ReadonlyArray<readonly [string, string]> =
  [
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
    ["first_published_at", "firstPublishedAt"],
  ];

/**
 * Every spelling of every system timestamp, both the physical column and the API name.
 *
 * Exported for the response shapers that decide which system keys to carry through a projection.
 * They listed the two they knew about, which is why a third was pruned from selected reads and
 * working-draft views while ordinary reads returned it.
 */
export const SYSTEM_TIMESTAMP_KEYS: readonly string[] =
  TIMESTAMP_COLUMN_NAMES.flat();

/**
 * Convert the DB timestamp columns on a row object into their camelCase API form and remove the
 * snake_case keys. Pre-existing camelCase values are preserved.
 *
 * @param entry - The row object to mutate in place.
 * @param options.normalize - Optional value transform applied to the
 *   timestamp before it is written under the camelCase key.
 * @returns The same `entry` reference.
 */
export function convertTimestampsToCamelCase<T extends Record<string, unknown>>(
  entry: T,
  options?: { normalize?: (value: unknown) => unknown }
): T {
  const record = entry as Record<string, unknown>;
  const normalize = options?.normalize;
  for (const [column, apiName] of TIMESTAMP_COLUMN_NAMES) {
    if (record[column] === undefined) continue;
    if (record[apiName] === undefined) {
      // A null marker is a meaningful value — "not known to have been published" — so it is
      // converted like any other, rather than being dropped as if the column were absent.
      record[apiName] = normalize ? normalize(record[column]) : record[column];
    }
    delete record[column];
  }
  return entry;
}

/**
 * Turn any system timestamp still held as an ISO string back into a `Date`, in place.
 *
 * A row loaded from the database arrives Drizzle-decoded, but a row reassembled from a stored
 * snapshot arrives as JSON, where a timestamp is a string. A caller that overlays a snapshot onto a
 * read has to restore the decoded shape or the same hook that works for every other entry fails on
 * a drafted one the moment it calls a date method.
 *
 * Both spellings are covered, because an overlay can run either side of the camelCase conversion.
 * A value that does not parse is left as it is rather than replaced with an `Invalid Date`.
 */
export function rehydrateSystemTimestamps<T extends Record<string, unknown>>(
  entry: T
): T {
  const record = entry as Record<string, unknown>;
  for (const key of SYSTEM_TIMESTAMP_KEYS) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) record[key] = parsed;
  }
  return entry;
}

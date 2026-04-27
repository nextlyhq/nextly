/**
 * Permission Utilities
 *
 * Shared utilities for handling permission data from various API response formats.
 */

/**
 * Type guard to check if a value is a string array
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

/**
 * Normalize permissions from various API response formats to string[]
 *
 * The API may return permissions in different formats:
 * - string[] - Array of permission IDs
 * - Array<{id: string}> - Array of permission objects
 * - Mixed array - Combination of both
 *
 * This function normalizes all formats to a consistent string[] of permission IDs.
 *
 * @param permissions - Unknown permission data from API
 * @returns Normalized array of permission ID strings
 *
 * @example
 * normalizePermissions(['perm1', 'perm2']) // => ['perm1', 'perm2']
 * normalizePermissions([{id: 'perm1'}, {id: 'perm2'}]) // => ['perm1', 'perm2']
 * normalizePermissions(null) // => []
 */
export function normalizePermissions(permissions: unknown): string[] {
  // Fast path: already a string array
  if (isStringArray(permissions)) {
    return permissions;
  }

  // Handle array with objects or mixed content
  if (Array.isArray(permissions)) {
    return permissions
      .map(p => {
        // Already a string
        if (typeof p === "string") return p;

        // Object with id property
        if (typeof p === "object" && p !== null && "id" in p) {
          const id = (p as { id: unknown }).id;

          // Validate id is not null/undefined before converting
          if (id !== undefined && id !== null) {
            return String(id);
          }
        }

        // Fallback: convert to string (handles numbers, etc.)
        return String(p);
      })
      .filter(id => id !== "undefined" && id !== "null"); // Filter out stringified null/undefined
  }

  // Invalid input: return empty array
  return [];
}

/**
 * Type Guard Utility Functions
 *
 * Reusable type guards for runtime type checking.
 */

/**
 * Filters an array to only include string values.
 *
 * @param arr - The array to filter (can be undefined)
 * @returns A new array containing only the string values
 *
 * @example
 * ```ts
 * const mixed = ['a', 1, 'b', null, 'c'];
 * const strings = filterStringArray(mixed); // ['a', 'b', 'c']
 *
 * const roles = filterStringArray(values.roles); // Type-safe string[]
 * ```
 */
export function filterStringArray(arr?: unknown[]): string[] {
  if (!arr) return [];
  return arr.filter((item): item is string => typeof item === "string");
}

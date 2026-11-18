/**
 * Core's one slug rule, as a leaf of its own: the auto-slug hook makes slugs
 * by it, the root entry publishes it, and `nextly/slugify` gives it to a
 * browser bundle, so a dialog that shows an address before it is made shows
 * the one the server will make. It imports nothing, so a client reaching it
 * takes nothing more.
 *
 * @module slugify
 */

/**
 * Default slugify function for auto-slug hook.
 *
 * Transforms a string into a URL-friendly slug:
 * - Converts to lowercase
 * - Normalizes unicode characters (removes diacritics)
 * - Replaces spaces and special characters with hyphens
 * - Removes leading/trailing hyphens
 * - Collapses multiple consecutive hyphens
 *
 * @param value - The string to slugify
 * @returns URL-friendly slug
 *
 * @example
 * ```typescript
 * slugify('Hello World!'); // 'hello-world'
 * slugify('Café & Restaurant'); // 'cafe-restaurant'
 * slugify('  Multiple   Spaces  '); // 'multiple-spaces'
 * ```
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD") // Decompose unicode characters
    .replace(/[̀-ͯ]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .replace(/-{2,}/g, "-"); // Collapse multiple hyphens
}

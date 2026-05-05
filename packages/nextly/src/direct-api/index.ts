/**
 * Nextly Direct API
 *
 * The Direct API provides direct server-side access to database operations
 * without HTTP overhead. Use it in Server Components, API routes, and hooks.
 *
 * @example
 * ```typescript
 * import { getNextly } from 'nextly';
 *
 * const nextly = getNextly();
 *
 * // Find documents
 * const posts = await nextly.find({
 *   collection: 'posts',
 *   where: { status: { equals: 'published' } },
 * });
 *
 * // Create document
 * const newPost = await nextly.create({
 *   collection: 'posts',
 *   data: { title: 'Hello', content: 'World' },
 * });
 *
 * // Get single/global
 * const settings = await nextly.findSingle({
 *   slug: 'site-settings',
 * });
 * ```
 *
 * @packageDocumentation
 */

// Export Nextly class, factory, and convenience object
export { Nextly, getNextly, resetNextlyInstance, nextly } from "./nextly";
export * from "./types";
// Canonical NextlyError replaces the legacy direct-api error subclass
// hierarchy (NotFoundError, ValidationError, etc.) — those were deleted in
// Task 21 PR 12. SDK consumers narrow via `NextlyError.isNotFound(err)` etc.
export { NextlyError } from "../errors/nextly-error";

/**
 * Singles - Public Exports
 *
 * Re-exports all Single-related types, configurations, and utilities.
 * Singles are single-document entities
 * for storing site-wide configuration such as site settings, navigation menus,
 * footers, and homepage configurations.
 *
 * Key differences from Collections:
 * - Only one document per Single (no list view)
 * - No create/delete operations (auto-created on first access)
 * - Simplified hooks (4 vs 8 for Collections)
 * - Simplified access control (read/update only)
 *
 * @module singles
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineSingle, text, upload } from '@revnixhq/nextly';
 *
 * export default defineSingle({
 *   slug: 'site-settings',
 *   fields: [
 *     text({ name: 'siteName', required: true }),
 *     upload({ name: 'logo', relationTo: 'media' }),
 *   ],
 * });
 * ```
 */

// Single configuration
export * from "./config";

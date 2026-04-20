/**
 * Single Services
 *
 * This module provides services for Single (Global) operations:
 *
 * - SingleRegistryService: Unified registry for code-first and UI Singles
 *
 * Singles are single-document entities for storing site-wide configuration
 * such as site settings, navigation menus, footers, and homepage configurations.
 *
 * Key differences from Collections:
 * - Only one document per Single (no list view)
 * - No create/delete operations (auto-created on first access)
 * - Simplified access rules (read/update only)
 * - Table prefix: `single_` instead of `dc_`
 *
 * All services use the database adapter pattern for multi-database support
 * (PostgreSQL, MySQL, SQLite).
 *
 * @module services/singles
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { SingleRegistryService } from '@nextly/services/singles';
 *
 * const registry = new SingleRegistryService(adapter, logger);
 *
 * // Register a code-first Single
 * await registry.registerSingle({
 *   slug: 'site-settings',
 *   label: 'Site Settings',
 *   tableName: 'single_site_settings',
 *   fields: [...],
 *   source: 'code',
 *   schemaHash: 'abc123...',
 * });
 *
 * // Sync code-first Singles (detects schema changes)
 * const result = await registry.syncCodeFirstSingles([
 *   { slug: 'site-settings', fields: [...], label: 'Site Settings' },
 *   { slug: 'header', fields: [...], label: 'Header' },
 * ]);
 *
 * console.log(result.created);   // ['header']
 * console.log(result.updated);   // ['site-settings']
 * console.log(result.unchanged); // []
 * ```
 */

export { SingleRegistryService } from "./single-registry-service";
export type {
  UpdateSingleOptions,
  DeleteSingleOptions,
  CodeFirstSingleConfig,
  SyncSingleResult,
  ListSinglesOptions,
  ListSinglesResult,
} from "./single-registry-service";

export { SingleEntryService } from "./single-entry-service";
export type {
  GetSingleOptions,
  UpdateSingleOptions as UpdateSingleEntryOptions,
  UserContext,
  SingleResult,
  SingleDocument,
} from "./single-entry-service";

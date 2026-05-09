/**
 * Dynamic Collections Schema Module
 *
 * Provides dialect-agnostic types and dialect-specific schemas for the
 * `dynamic_collections` metadata table and migration tracking.
 *
 * @module schemas/dynamic-collections
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import {
 *   type DynamicCollectionRecord,
 *   type DynamicCollectionInsert,
 *   type CollectionSource,
 *   type MigrationStatus,
 * } from '@nextly/schemas/dynamic-collections';
 * ```
 */

export type {
  CollectionSource,
  MigrationStatus,
  CollectionLabels,
  CollectionAdminConfig,
  StoredHookType,
  StoredHookConfig,
  DynamicCollectionInsert,
  DynamicCollectionRecord,
  MigrationRecordStatus,
  MigrationRecordInsert,
  MigrationRecord,
} from "./types";

export {
  dynamicCollectionsPg,
  type DynamicCollectionPg,
  type DynamicCollectionInsertPg,
} from "./postgres";

export {
  dynamicCollectionsMysql,
  type DynamicCollectionMysql,
  type DynamicCollectionInsertMysql,
} from "./mysql";

export {
  dynamicCollectionsSqlite,
  type DynamicCollectionSqlite,
  type DynamicCollectionInsertSqlite,
} from "./sqlite";

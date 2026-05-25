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

// Plan A Task 12 — UI-builder field-definition types previously lived at the
// top-level schemas/dynamic-collections.ts file. That top-level file also
// declared a stale duplicate `dynamicCollections` Drizzle table whose columns
// diverged from the runtime canonical (database/schema/<dialect>.ts). The
// duplicate table was unused by any importer and was dropped; the types now
// live alongside the rest of the dynamic-collections module.
export type {
  CollectionSchemaDefinition,
  DynamicFieldType,
  FieldDefinition,
  DynamicCollection,
  NewDynamicCollection,
} from "./legacy-types";

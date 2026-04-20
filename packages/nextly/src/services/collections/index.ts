/**
 * Collection Services
 *
 * This module provides services for collection operations:
 *
 * - CollectionService: Unified service with adapter pattern (ServiceError, RequestContext, transactions)
 * - CollectionRegistryService: Unified registry for code-first and UI collections (Plan 04)
 * - CollectionSyncService: Sync code-first collections from config to database (Plan 04)
 * - CollectionMetadataService: Collection CRUD (create, list, get, update, delete)
 * - CollectionEntryService: Entry CRUD with hooks and permissions
 * - CollectionRelationshipService: Relationship expansion and junction table management
 * - CollectionExportService: Export UI collections to code-first format (Plan 04)
 *
 * All services use the database adapter pattern for multi-database support (PostgreSQL, MySQL, SQLite).
 *
 * @example
 * ```typescript
 * // New API with adapter pattern (recommended)
 * import { CollectionService, CollectionRegistryService } from '@nextly/services/collections';
 *
 * const service = new CollectionService(adapter, logger, metadataService, entryService);
 * const post = await service.createEntry('posts', { title: 'Hello' }, context);
 *
 * // Collection Registry for code-first sync
 * const registry = new CollectionRegistryService(adapter, logger);
 * const result = await registry.syncCodeFirstCollections([
 *   { slug: 'posts', fields: [...], labels: { singular: 'Post', plural: 'Posts' } },
 * ]);
 *
 * // With transactions
 * await service.withTransaction(async (tx) => {
 *   const entry = await service.createEntryInTransaction(tx, 'posts', data, context);
 *   await service.updateEntryInTransaction(tx, 'posts', entry.id, moreData, context);
 * });
 * ```
 */

export { CollectionService } from "./collection-service";
export type {
  Collection,
  CreateCollectionInput,
  UpdateCollectionInput,
  ListCollectionsOptions,
  CollectionEntry,
} from "./collection-service";

export { CollectionRegistryService } from "./collection-registry-service";
export type {
  UpdateCollectionOptions,
  CodeFirstCollectionConfig,
  SyncResult,
  ListCollectionsOptions as RegistryListOptions,
  ListCollectionsResult,
} from "./collection-registry-service";

export { CollectionExportService } from "./collection-export-service";
export type { ExportOptions } from "./collection-export-service";

export { CollectionSyncService } from "./collection-sync-service";
export type {
  SyncOptions,
  CollectionSyncResult,
  CollectionSyncResultWithValidation,
  RelationshipValidationResult,
  RelationshipValidationError,
  RelationshipValidationWarning,
} from "./collection-sync-service";

export { CollectionMetadataService } from "./collection-metadata-service";
export {
  CollectionEntryService,
  type CollectionServiceResult,
  type UserContext,
  type BulkOperationResult,
  type BatchOperationResult,
  type BulkOperationOptions,
  type BulkCreateOptions, // @deprecated - use BulkOperationOptions instead
  type BulkUpdateEntry,
} from "./collection-entry-service";
export {
  CollectionRelationshipService,
  DEFAULT_RELATIONSHIP_DEPTH,
  MAX_RELATIONSHIP_DEPTH,
  type RelationshipExpansionOptions,
} from "./collection-relationship-service";

export {
  buildWhereClause,
  isValidOperator,
  getSupportedOperators,
  extractGeoFilters,
  GEO_OPERATORS,
  type QueryOperator,
  type GeoQueryOperator,
  type AllQueryOperators,
  type FieldCondition,
  type WhereFilter,
  type ExtractGeoFiltersResult,
} from "./query-operators";
export {
  parseWhereQuery,
  parseWhere,
  stringifyWhereQuery,
} from "./query-parser";

export {
  calculateDistance,
  parseNearQuery,
  parseWithinQuery,
  applyGeoFilters,
  sortByDistance,
  pointFromValue,
  matchesNearQuery,
  matchesWithinQuery,
  looksLikeGeoQuery,
  type Point,
  type PointFieldValue,
  type NearQuery,
  type WithinQuery,
  type GeoFilter,
  type GeoFilterResult,
} from "./geo-utils";

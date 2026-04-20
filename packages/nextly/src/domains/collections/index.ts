/**
 * Collections Domain
 *
 * Domain co-located module for all collection-related services, types, and utilities.
 * This is the main entry point for the collections domain.
 */

export { CollectionAccessService } from "./services/collection-access-service";
export { CollectionHookService } from "./services/collection-hook-service";
export { CollectionQueryService } from "./services/collection-query-service";
export { CollectionMutationService } from "./services/collection-mutation-service";
export { CollectionBulkService } from "./services/collection-bulk-service";

export { CollectionRegistryService } from "./services/collection-registry-service";
export { CollectionRelationshipService } from "./services/collection-relationship-service";
export { CollectionMetadataService } from "./services/collection-metadata-service";
export { CollectionSyncService } from "./services/collection-sync-service";
export { CollectionExportService } from "./services/collection-export-service";
export { CollectionService } from "./services/collection-service";

export {
  toCamelCase,
  withTimestampAliases,
  isJsonFieldType,
  isRelationshipField,
  normalizeRelationshipValue,
  normalizeRelationshipItem,
  normalizeNestedRelationships,
  getTableName,
  generateSlug,
  normalizeUploadFields,
  getSearchableFields,
  getMinSearchLength,
  ALWAYS_JSON_TYPES,
  SEARCHABLE_FIELD_TYPES,
} from "./services/collection-utils";

export type {
  CollectionServiceResult,
  UserContext,
  BulkOperationResult,
  BatchOperationResult,
  BulkOperationOptions,
  BulkCreateOptions,
  BulkUpdateEntry,
} from "./services/collection-types";

export type { QueryDatabaseParams } from "./services/collection-hook-service";

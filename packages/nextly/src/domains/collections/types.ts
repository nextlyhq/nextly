/**
 * Collections domain — Public type exports.
 *
 * Consolidates all collection-domain-specific types for convenient importing.
 * Re-exports from the service-level types file where the definitions live.
 */

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

export type {
  QueryOperator,
  GeoQueryOperator,
  AllQueryOperators,
  FieldCondition,
  WhereFilter,
  ExtractGeoFiltersResult,
} from "./query/query-operators";

export type {
  Point,
  PointFieldValue,
  NearQuery,
  WithinQuery,
  GeoFilter,
  GeoFilterResult,
} from "./query/geo-utils";

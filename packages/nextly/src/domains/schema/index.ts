/**
 * Schema Domain — Public Exports
 *
 * Consolidates schema generation, hashing, migration, and push helpers
 * used by the code-first and builder-first flows.
 *
 * @module domains/schema
 * @since 1.0.0
 */

// Schema hash utility for change detection
export {
  SYSTEM_SCHEMA_VERSION,
  calculateSchemaHash,
  schemaHashesMatch,
  hasSchemaChanged,
} from "./services/schema-hash";

// Field diff helper for builder preview
export {
  computeFieldDiff,
  type FieldChange,
  type FieldDiffResult,
} from "./services/field-diff";

// Runtime schema generator for dynamic/UI-created collections
export {
  generateRuntimeSchema,
  type RuntimeSchemaResult,
} from "./services/runtime-schema-generator";

// Drizzle push service (dev-mode auto-sync)
export {
  DrizzlePushService,
  type PushPreviewResult,
  type PushApplyOptions,
} from "./services/drizzle-push-service";

// Schema generator for creating Drizzle ORM schemas (Collections and Singles)
export {
  SchemaGenerator,
  type SupportedDialect,
  type GeneratedSchema,
  type GeneratedSingleSchema,
  type GeneratedIndexFile,
  type SchemaGeneratorOptions,
} from "./services/schema-generator";

// Migration generator for SQL migration files
export {
  MigrationGenerator,
  type MigrationOperationType,
  type SchemaChange,
  type SchemaDiff,
  type GeneratedMigration,
  type MigrationGeneratorOptions,
} from "./services/migration-generator";

// Zod schema generator for runtime validation
export {
  ZodGenerator,
  type GeneratedZodSchema,
  type GeneratedZodIndexFile,
  type ZodGeneratorOptions,
} from "./services/zod-generator";

// TypeScript type generator for payload-types.ts (Collections and Singles)
export {
  TypeGenerator,
  type GeneratedTypeInterface,
  type GeneratedSingleTypeInterface,
  type GeneratedTypesFile,
  type TypeGeneratorOptions,
} from "./services/type-generator";

// Schema push service for development-mode auto-sync
export {
  SchemaPushService,
  type SchemaPushOptions,
  type SchemaPushResult,
  type CollectionSyncInfo,
  type EnvironmentInfo,
} from "./services/schema-push-service";

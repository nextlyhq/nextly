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

// F8 PR 4: DrizzlePushService re-export removed. Replaced by:
//   - pipeline/fresh-push.ts (direct pushSchema for migrate:fresh +
//     ensureCoreTables)
//   - pipeline/preview.ts (read-only Phase A + B for admin preview)
//   - applyDesiredSchema (full pipeline for HMR + UI applies)

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

// F8 PR 4: SchemaPushService re-export removed. The boot-time auto-sync
// (was register.ts:syncCodeFirstCollections) now uses
// applyDesiredSchema directly. Per-table addMissingColumnsForFields
// extracted to domains/schema/utils/missing-columns.ts (F8 PR 1).

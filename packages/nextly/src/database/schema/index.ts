// Shared schema barrel. Re-export per-dialect schemas under namespaces to avoid
// name collisions (same table names across dialects). These namespaces can be
// expanded or unified in future tasks when a single active dialect is chosen.
export * as postgres from "./postgres";
export * as mysql from "./mysql";
export * as sqlite from "./sqlite";

// Unified schema definitions (database-agnostic)
export { nextlyTables } from "./unified";

// Schema generator utilities
export {
  // Type mapping
  mapColumnType,
  isTypeNativelySupported,
  getTypeMappings,
  getSupportedDialects,
  // DDL generation
  generateCreateTableSql,
  generateIndexSql,
  generateDropTableSql,
  // Batch generation
  generateSchemaForDialect,
  generateDropSchemaForDialect,
  // Types
  type SchemaGenerationResult,
} from "./generator";

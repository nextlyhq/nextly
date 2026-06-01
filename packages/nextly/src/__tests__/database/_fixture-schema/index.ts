/**
 * Test-only fixture schema — DDL-from-spec generator + table descriptors.
 *
 * Why this lives under `__tests__/database/_fixture-schema/`:
 *
 * - These modules used to sit at `packages/nextly/src/database/schema/` and
 *   were re-exported from the framework's public path. They were never
 *   wired into the runtime — the only consumer is `setup.ts` in the same
 *   directory, which builds `CREATE TABLE` statements from an abstract
 *   `TableDefinition[]` (`nextlyTables`) to bootstrap unit-test databases
 *   without going through drizzle-kit migrations.
 *
 * - Plan A (Task 17) deletes `database/schema/` entirely; the runtime
 *   schema source of truth is now `getCoreSchema(dialect)` from
 *   `@nextly/schemas`, which returns a Drizzle-native snapshot the
 *   pipeline introspect-and-diff path consumes.
 *
 * - Moving these two files into the test tree keeps the test fixture
 *   working without exposing a parallel, drifting "all core tables"
 *   declaration through the public package surface. The DDL generator is
 *   independent of the rest of Plan A — different abstraction (abstract
 *   `TableDefinition` vs Drizzle table objects) — and merging the two is
 *   out of scope here.
 *
 * Consumers outside `packages/nextly/src/__tests__/` should NOT import
 * from this directory. Use `getCoreSchema(dialect)` instead.
 *
 * @module __tests__/database/_fixture-schema
 * @since v0.0.3-alpha (Plan A Task 17 — moved from src/database/schema/)
 */

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

export { nextlyTables } from "./unified";

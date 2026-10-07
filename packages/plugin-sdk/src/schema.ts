/**
 * Declaring database tables from a plugin, and the typed handle that reads
 * and writes them.
 *
 * Re-exported from core rather than re-declared, for the same reason `db.ts`
 * re-exports the query operators: the DSL's output is compiled by core, and a
 * second copy of the types would describe a shape core does not build.
 *
 * Named one by one rather than re-exported with `*`, so a name added to
 * core's `schema-extension` entry does not become public SDK surface without
 * a change here, a surface snapshot change and a stability row.
 *
 * @experimental The whole subpath, until a first-party plugin declares its
 *   tables through it (see STABILITY.md).
 * @module schema
 */
export {
  col,
  defineTable,
  isUniqueViolation,
  migrationChecksum,
} from "nextly/schema-extension";
export type {
  ColumnBuilder,
  ContributedElements,
  DialectStatements,
  DraftTableView,
  DrizzleSchemaHook,
  ExtensionColumn,
  ExtensionIndex,
  ExtensionTable,
  InferInsert,
  InferRow,
  PluginDatabase,
  PluginMigration,
  PluginMigrationSnapshot,
  PluginTransaction,
  PortableSelect,
  PortableWhere,
  SchemaDraft,
  SchemaHook,
  SchemaOwner,
  TableDefinition,
} from "nextly/schema-extension";

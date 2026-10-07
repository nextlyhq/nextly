/**
 * @experimental Declaring database tables from a plugin.
 *
 * Re-exported from core rather than re-declared, for the same reason `db.ts`
 * re-exports the query operators: the DSL's output is compiled by core, and a
 * second copy of the types would describe a shape core does not build.
 *
 * Named one by one rather than re-exported with `*`, so a name added to
 * `nextly/schema-extension` does not become public SDK surface without a
 * change here, a surface snapshot change and a stability row.
 *
 * @module schema
 */
export {
  col,
  defineTable,
  isUniqueViolation,
  migrationChecksum,
  type ColumnBuilder,
  type ContributedElements,
  type DialectStatements,
  type DraftTableView,
  type DrizzleSchemaHook,
  type ExtensionColumn,
  type ExtensionIndex,
  type ExtensionTable,
  type InferInsert,
  type InferRow,
  type PluginDatabase,
  type PluginMigration,
  type PluginMigrationSnapshot,
  type PluginTransaction,
  type PortableSelect,
  type PortableWhere,
  type SchemaDraft,
  type SchemaHook,
  type SchemaOwner,
  type TableDefinition,
} from "nextly/schema-extension";

/**
 * The schema-extension surface plugins and apps author against.
 *
 * A subpath of its own rather than part of the root entry: a plugin that
 * declares tables imports the DSL at module scope, and pulling the whole core
 * entry in to reach it would drag the runtime into a file that only describes
 * shapes.
 *
 * @module schema-extension
 * @since 1.0.0
 */
export {
  col,
  defineTable,
  type ColumnBuilder,
  type InferInsert,
  type InferRow,
  type TableDefinition,
} from "./domains/schema/extension/dsl";
export type {
  DraftTableView,
  SchemaDraft,
  SchemaHook,
} from "./domains/schema/extension/draft";
export type {
  ExtensionColumn,
  ExtensionIndex,
  ExtensionTable,
  SchemaOwner,
} from "./domains/schema/extension/types";
export type { DrizzleSchemaHook } from "./domains/schema/extension/after-drizzle";
export type {
  PluginDatabase,
  PluginTransaction,
  PortableSelect,
  PortableWhere,
} from "./plugins/database/plugin-database";
export type {
  DialectStatements,
  PluginMigration,
  PluginMigrationSnapshot,
} from "./domains/schema/migrate/plugin/plugin-migration";
// A value, not a type: a hand-written module computes its checksum rather
// than pasting one, so it cannot drift into the state the checksum detects.
export { migrationChecksum } from "./domains/schema/migrate/plugin/plugin-migration";
export { isUniqueViolation } from "./database/errors";

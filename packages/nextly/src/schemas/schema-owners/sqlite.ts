/**
 * `nextly_schema_owners` — who owns each table, SQLite.
 *
 * See the PostgreSQL module for why this table exists. SQLite stores
 * timestamps as epoch integers, which is the only difference of substance.
 *
 * @module schemas/schema-owners/sqlite
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { SCHEMA_OWNERS_TABLE } from "./table-name";

export const nextlySchemaOwners = sqliteTable(SCHEMA_OWNERS_TABLE, {
  tableName: text("table_name").primaryKey(),
  ownerKind: text("owner_kind").notNull(),
  ownerId: text("owner_id").notNull(),
  migratedBy: text("migrated_by").notNull(),
  ownerVersion: text("owner_version"),
  schemaVersion: integer("schema_version"),
  state: text("state").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

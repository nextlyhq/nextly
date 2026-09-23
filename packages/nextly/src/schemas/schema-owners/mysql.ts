/**
 * `nextly_schema_owners` — who owns each table, MySQL.
 *
 * See the PostgreSQL module for why this table exists. The only differences
 * here are dialect ones: MySQL cannot make an unbounded `text` column a
 * primary key, so the identifiers are bounded `varchar`.
 *
 * @module schemas/schema-owners/mysql
 */

import {
  int,
  mysqlTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

import { SCHEMA_OWNERS_TABLE } from "./table-name";

export const nextlySchemaOwners = mysqlTable(
  SCHEMA_OWNERS_TABLE,
  {
    // 63 is the strictest identifier limit of the three dialects, so a table
    // name that exists anywhere fits here.
    tableName: varchar("table_name", { length: 64 }),
    /** `table` (the pre-element meaning of every row) or an element kind. */
    elementKind: varchar("element_kind", { length: 16 }).notNull().default("table"),
    /** The element's name; `''` for a table-level row. */
    elementName: varchar("element_name", { length: 64 }).notNull().default(""),
    ownerKind: varchar("owner_kind", { length: 32 }).notNull(),
    ownerId: varchar("owner_id", { length: 255 }).notNull(),
    migratedBy: varchar("migrated_by", { length: 255 }).notNull(),
    ownerVersion: varchar("owner_version", { length: 64 }),
    schemaVersion: int("schema_version"),
    state: varchar("state", { length: 32 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  t => [primaryKey({ columns: [t.tableName, t.elementKind, t.elementName] })]
);

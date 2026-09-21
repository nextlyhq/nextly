/**
 * `nextly_schema_owners` — who owns each table, PostgreSQL.
 *
 * One row per table, answering two questions that look like one and are not:
 * WHO DECLARED it (`owner_kind`/`owner_id`) and WHICH MIGRATION STREAM CARRIES
 * it (`migrated_by`). A plugin-contributed collection is declared by the
 * plugin and migrated by the app, so a single "owner" column would have to be
 * wrong about one of them.
 *
 * ## Why a table rather than deriving it from config
 *
 * The config says what SHOULD exist. This says what DOES, and the difference
 * is the whole point: a table whose plugin has been removed from config is
 * exactly the case where dropping it would destroy data, and config can no
 * longer tell you it was ever a plugin's. A row that outlives the declaration
 * is what makes an uninstall a decision rather than an accident.
 *
 * A table with NO row is never dropped by any path. Absence means "nobody has
 * claimed this", which is the safe answer, not an invitation.
 *
 * @module schemas/schema-owners/postgres
 */

import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { SCHEMA_OWNERS_TABLE } from "./table-name";

export const nextlySchemaOwners = pgTable(SCHEMA_OWNERS_TABLE, {
  tableName: text("table_name").primaryKey(),
  /** `core` | `collection` | `single` | `component` | `plugin` | `app`. */
  ownerKind: text("owner_kind").notNull(),
  /** `nextly` | entity slug | plugin name | `app`. */
  ownerId: text("owner_id").notNull(),
  /**
   * Which migration stream carries this table: `core`, `app`, or
   * `plugin:<name>`. Distinct from who declared it.
   */
  migratedBy: text("migrated_by").notNull(),
  ownerVersion: text("owner_version"),
  schemaVersion: integer("schema_version"),
  /** `active` | `orphaned` | `uninstalled`. */
  state: text("state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

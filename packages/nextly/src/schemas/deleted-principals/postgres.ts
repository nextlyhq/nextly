import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

import { DELETED_PRINCIPALS_TABLE } from "./table-name";

/**
 * Plugin-defined people a plugin reported deleted, by a keyed digest of their
 * kind and id, and when.
 *
 * The digest, never the id: a plugin's id may be an address, and this table is
 * kept with no expiry. Read whenever an audit row naming a person is written,
 * so a row written for them at any later time is written already erased.
 */
export const nextlyDeletedPrincipals = pgTable(DELETED_PRINCIPALS_TABLE, {
  // Hex HMAC-SHA256: 64 characters.
  digest: varchar("digest", { length: 64 }).primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: false }).notNull(),
});

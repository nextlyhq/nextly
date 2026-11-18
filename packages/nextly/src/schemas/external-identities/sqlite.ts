/**
 * `nextly_external_identities` on SQLite. See `postgres.ts` for what each
 * column is for, and for why `issuer` is "" rather than NULL where a
 * provider has no issuer.
 *
 * Instants are stored as whole seconds (timestamp mode), as every other core
 * table here stores them.
 *
 * @module schemas/external-identities/sqlite
 */
// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import {
  EXTERNAL_IDENTITIES_INDEXES,
  sqliteIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/sqlite";

import { EXTERNAL_IDENTITIES_TABLE } from "./table-name";

export const nextlyExternalIdentitiesSqlite = sqliteTable(
  EXTERNAL_IDENTITIES_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    providerKey: text("provider_key").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    address: text("address"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(EXTERNAL_IDENTITIES_INDEXES, table)
);

/**
 * `nextly_external_identities` on MySQL. See `postgres.ts` for what each
 * column is for, and for why `issuer` is "" rather than NULL where a
 * provider has no issuer.
 *
 * Every column the unique index reads is a bounded `varchar`: MySQL cannot
 * index `text`, and the lengths keep the index inside its 3072-byte key
 * limit — 191 characters each for the provider key, the issuer and the
 * subject, 2292 bytes at utf8mb4's four bytes a character.
 *
 * @module schemas/external-identities/mysql
 */
// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";

import {
  EXTERNAL_IDENTITIES_INDEXES,
  mysqlIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/mysql";

import { EXTERNAL_IDENTITIES_TABLE } from "./table-name";

export const nextlyExternalIdentitiesMysql = mysqlTable(
  EXTERNAL_IDENTITIES_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // 191 is the bound the codebase gives a provider and an id.
    providerKey: varchar("provider_key", { length: 191 }).notNull(),
    issuer: varchar("issuer", { length: 191 }).notNull(),
    subject: varchar("subject", { length: 191 }).notNull(),
    // As wide as `users.email`, whose value the provider's assertion
    // competes with.
    address: varchar("address", { length: 255 }),
    // As wide as `users.id`, whose key it holds. Deleted with the account.
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(EXTERNAL_IDENTITIES_INDEXES, table)
);

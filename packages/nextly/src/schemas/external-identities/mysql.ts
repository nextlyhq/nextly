/**
 * `nextly_external_identities` on MySQL. See `postgres.ts` for what each
 * column is for, for the digest that enforces uniqueness, and for why
 * `issuer` is "" rather than NULL where a provider has no issuer.
 *
 * The provider key, the issuer and the subject are UNBOUNDED `text` here,
 * as they are on PostgreSQL and SQLite: an issuer is a URL whose length the
 * provider chooses and OIDC permits a subject of up to 255 ASCII
 * characters, so any bound this table picked would refuse a valid identity
 * on MySQL alone. Nothing indexes them, so `text` costs nothing.
 *
 * Uniqueness lives in `key_digest`, 64 hex characters, indexed alone: tiny
 * enough for every InnoDB page size (an index over the key's three columns
 * would pass 1024 bytes on an 8 KiB-page instance and fail there), and
 * exact by construction — MySQL's collations compare TEXT case- and
 * pad-insensitively (`utf8mb4_bin` folds `Alice` and `Alice ` as PAD
 * SPACE), where a digest of the bytes has nothing to fold. See
 * `externalIdentityKeyDigest` in this module's barrel for how it is
 * computed and why it is plain SHA-256, never keyed.
 *
 * @module schemas/external-identities/mysql
 */
// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
import { mysqlTable, varchar, text, datetime } from "drizzle-orm/mysql-core";

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
    providerKey: text("provider_key").notNull(),
    issuer: text("issuer").notNull(),
    subject: text("subject").notNull(),
    // The digest the unique index holds, from `externalIdentityKeyDigest`.
    // `varchar(64)`, the codebase's spelling of a hex digest, because MySQL
    // cannot index `text` — and this is the one column that is indexed.
    keyDigest: varchar("key_digest", { length: 64 }).notNull(),
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

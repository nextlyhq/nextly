/**
 * `nextly_external_identities` on MySQL. See `postgres.ts` for what each
 * column is for, and for why `issuer` is "" rather than NULL where a
 * provider has no issuer.
 *
 * Every column the unique index reads is a bounded `varchar`: MySQL cannot
 * index `text`, and the lengths keep the index inside its 3072-byte key
 * limit — 191 characters for the provider key and 255 each for the issuer
 * and the subject, 2804 bytes at utf8mb4's four bytes a character.
 *
 * The provider key, the issuer and the subject compare EXACTLY, byte for
 * byte: each carries `utf8mb4_bin`, overriding whatever collation the
 * database or the table was given. An install's MySQL defaults to a
 * case-insensitive collation (`utf8mb4_unicode_ci` where this repo's own
 * docker-compose.yml starts it), under which the unique index would treat
 * `Alice` and `alice` as the same subject and refuse a distinct, valid
 * identity — OIDC's `sub` is case-sensitive, and PostgreSQL and SQLite
 * compare text exactly, so MySQL alone would break the promise that the
 * uniqueness is enforced identically on every dialect. There is no
 * precedent for a per-column collation under `schemas/`; this module sets
 * one, `utf8mb4_bin` rather than a merely case-sensitive collation, because
 * byte comparison is the strongest form of exact and cannot grow
 * accent-sensitivity exceptions. The address carries none: it names no key
 * of this table, and addresses compare case-insensitively wherever else
 * they are held.
 *
 * The issuer and the subject are 255 characters: OIDC permits a `sub` of up
 * to 255 ASCII characters, and an issuer is a URL whose length the provider
 * chooses, so a 191 bound would refuse valid identities on MySQL alone —
 * PostgreSQL and SQLite hold them as unbounded text.
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
    providerKey: varchar("provider_key", { length: 191 })
      .notNull()
      // Compares exactly, for the reason this file's header gives.
      .collate("utf8mb4_bin"),
    issuer: varchar("issuer", { length: 255 }).notNull().collate("utf8mb4_bin"),
    subject: varchar("subject", { length: 255 })
      .notNull()
      .collate("utf8mb4_bin"),
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

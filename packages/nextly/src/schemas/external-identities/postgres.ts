/**
 * `nextly_external_identities` on PostgreSQL: the external identities a
 * person signed in with, kept by core rather than by any login plugin.
 *
 * One row is one identity one provider asserted: which provider key it
 * signed in under, the issuer that asserted it where that provider has one,
 * the subject the issuer named the person by, the address the provider last
 * asserted, and the account that owns it. Nothing else — no access, refresh
 * or ID token, and nothing from a client-side flow: a token held here would
 * outlive the session it bought, in a row the person cannot see or end.
 *
 * The provider key is stamped with the plugin's own name by the hand-off
 * that writes the row (the same key every read resolves it by), and the
 * subject is the provider's stable identifier for the person rather than a
 * display name or address, which change.
 *
 * `issuer` is never NULL: a provider with no issuer writes "" instead, so
 * the unique index over (provider key, issuer, subject) holds on every
 * dialect. One subject from two issuers of one key is therefore two
 * identities, and a second row for an issuerless key and subject is
 * refused everywhere — NULLs are distinct in a unique index on PostgreSQL
 * and SQLite alike, and only MySQL treats repeated NULLs as equal, so a
 * scheme that leaned on a missing issuer would enforce the rule on one of
 * the three and not the other two.
 *
 * @module schemas/external-identities/postgres
 */
// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
  EXTERNAL_IDENTITIES_INDEXES,
  pgIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/postgres";

import { EXTERNAL_IDENTITIES_TABLE } from "./table-name";

export const nextlyExternalIdentitiesPg = pgTable(
  EXTERNAL_IDENTITIES_TABLE,
  {
    id: text("id").primaryKey(),
    // The provider key the sign-in was handed over under: a login plugin's
    // own name stamped on the provider's key.
    providerKey: text("provider_key").notNull(),
    // The issuer that asserted the identity, "" where the provider has none.
    // Not nullable, for the reason this file's header gives.
    issuer: text("issuer").notNull(),
    // The subject: the issuer's stable identifier for the person.
    subject: text("subject").notNull(),
    // The address the provider last asserted; null where it asserted none.
    // The local account's address is not rewritten from it.
    address: text("address"),
    // The account the identity signs in. Deleted with the account, so an
    // identity cannot outlive its owner and be handed to a new one.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => pgIndexes(EXTERNAL_IDENTITIES_INDEXES, table)
);

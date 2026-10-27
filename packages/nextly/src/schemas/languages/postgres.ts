/**
 * `nextly_languages` - PostgreSQL. One row per content language a site manages in Settings.
 *
 * A removed language keeps its row, marked inactive, so its content stays and adding it back
 * restores it. `code` is stored in canonical BCP 47 form, so the primary key also makes codes
 * unique whatever their letter case. `revision` rises on every write: with the row count it is
 * the fingerprint every instance reads to notice a change made elsewhere.
 *
 * @module schemas/languages/postgres
 */
// fallow-ignore-file code-duplication

import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { LANGUAGES_TABLE } from "./table-name";
import type { LanguageDirection } from "./types";

export const nextlyLanguagesPg = pgTable(LANGUAGES_TABLE, {
  // The `_locale` columns that hold translations are 20 characters wide.
  code: varchar("code", { length: 20 }).primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  direction: varchar("direction", { length: 3 })
    .$type<LanguageDirection>()
    .notNull()
    .default("ltr"),
  // The codes this language falls back to, in order, as a JSON list.
  fallback: text("fallback").notNull().default("[]"),
  position: integer("position").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * `nextly_languages` - SQLite. Mirrors `./postgres.ts`; see it for what each column holds.
 *
 * @module schemas/languages/sqlite
 */
// fallow-ignore-file code-duplication

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { LANGUAGES_TABLE } from "./table-name";
import type { LanguageDirection } from "./types";

export const nextlyLanguagesSqlite = sqliteTable(LANGUAGES_TABLE, {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  direction: text("direction")
    .$type<LanguageDirection>()
    .notNull()
    .default("ltr"),
  fallback: text("fallback").notNull().default("[]"),
  position: integer("position").notNull(),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

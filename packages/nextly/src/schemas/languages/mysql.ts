/**
 * `nextly_languages` - MySQL. Mirrors `./postgres.ts`; see it for what each column holds.
 *
 * @module schemas/languages/mysql
 */
// fallow-ignore-file code-duplication

import {
  boolean,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

import { LANGUAGES_TABLE } from "./table-name";
import type { LanguageDirection } from "./types";

export const nextlyLanguagesMysql = mysqlTable(LANGUAGES_TABLE, {
  code: varchar("code", { length: 20 }).primaryKey(),
  label: varchar("label", { length: 255 }).notNull(),
  direction: varchar("direction", { length: 3 })
    .$type<LanguageDirection>()
    .notNull()
    .default("ltr"),
  // MySQL gives a TEXT column no default, so every write names the list.
  fallback: text("fallback").notNull(),
  position: int("position").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  revision: int("revision").notNull().default(1),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

/**
 * One `afterDrizzle` hook per construct the hook refuses, each returning an
 * app table that holds that construct and nothing else the model cannot
 * carry.
 *
 * Keyed by every entry of `AFTER_DRIZZLE_REFUSED_CONSTRUCTS`, so a construct
 * added to the list fails type-checking here until it has a case, and shared
 * by the unit tests of the refusals and the parity suite, which both refuse
 * each one.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  AfterDrizzleRefusedConstruct,
  DrizzleSchemaHook,
} from "../after-drizzle";

const parents = pgTable("app_parents", { id: text("id").primaryKey() });
const mood = pgEnum("app_mood", ["calm", "loud"]);

export const REFUSED_CONSTRUCT_HOOKS = {
  "a partial index": () => ({
    app_notes: pgTable(
      "app_notes",
      { id: text("id"), done: boolean("done") },
      t => [
        index("idx_app_notes_done")
          .on(t.done)
          .where(sql`${t.done} = true`),
      ]
    ),
  }),
  "an expression index": () => ({
    app_notes: pgTable("app_notes", { id: text("id") }, t => [
      index("idx_app_notes_lower").on(sql`lower(${t.id})`),
    ]),
  }),
  "a column-level unique constraint": () => ({
    app_notes: pgTable("app_notes", {
      id: varchar("id", { length: 36 }).unique(),
    }),
  }),
  "a generated column": () => ({
    app_notes: pgTable("app_notes", {
      id: text("id"),
      shout: text("shout").generatedAlwaysAs(sql`upper(id)`),
    }),
  }),
  "an identity column": () => ({
    app_notes: pgTable("app_notes", {
      id: integer("id").generatedAlwaysAsIdentity(),
    }),
  }),
  "an enum column": () => ({
    app_notes: pgTable("app_notes", { id: text("id"), mood: mood("mood") }),
  }),
  "a check constraint": () => ({
    app_notes: pgTable(
      "app_notes",
      { id: text("id"), rank: integer("rank") },
      t => [check("ck_app_notes_rank", sql`${t.rank} > 0`)]
    ),
  }),
  "a foreign key": () => ({
    app_notes: pgTable(
      "app_notes",
      { id: text("id"), parentId: text("parent_id") },
      t => [
        foreignKey({
          name: "fk_app_notes_parent",
          columns: [t.parentId],
          foreignColumns: [parents.id],
        }),
      ]
    ),
  }),
  "a table-level unique constraint": () => ({
    app_notes: pgTable(
      "app_notes",
      { id: text("id"), slug: text("slug"), lang: text("lang") },
      t => [unique("uq_app_notes_slug_lang").on(t.slug, t.lang)]
    ),
  }),
  "a composite primary key": () => ({
    app_notes: pgTable(
      "app_notes",
      { slug: text("slug"), lang: text("lang") },
      t => [primaryKey({ columns: [t.slug, t.lang] })]
    ),
  }),
} satisfies Record<AfterDrizzleRefusedConstruct, DrizzleSchemaHook>;

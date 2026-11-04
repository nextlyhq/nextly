/**
 * `nextly_review_states` - SQLite. Mirrors `./postgres.ts`, which documents each column.
 *
 * @module schemas/review-states/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { ReviewAssigneeKind, ReviewScopeKind } from "./types";

export const nextlyReviewStatesSqlite = sqliteTable(
  "nextly_review_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<ReviewScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    part: text("part"),
    partKey: text("part_key").notNull(),

    stage: text("stage").notNull(),
    enteredAt: integer("entered_at", { mode: "timestamp" }).notNull(),
    enteredBy: text("entered_by"),

    assigneeKind: text("assignee_kind").$type<ReviewAssigneeKind>(),
    assigneeId: text("assignee_id"),
    dueAt: integer("due_at", { mode: "timestamp" }),

    approvedVersionNo: integer("approved_version_no"),
    approvedDigest: text("approved_digest"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),

    definitionHash: text("definition_hash").notNull(),
    revision: integer("revision").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_review_states_key_uidx").on(table.partKey),
    index("nextly_review_states_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
    index("nextly_review_states_stage_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.stage
    ),
    index("nextly_review_states_assignee_idx").on(
      table.assigneeKind,
      table.assigneeId
    ),
  ]
);

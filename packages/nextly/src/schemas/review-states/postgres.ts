/**
 * `nextly_review_states` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with their own types. One
 * row per document and part (a language, or the shared part) of a collection or Single a workflow
 * is attached to: the stage the part's pending content is in, who is to act on it and by when, and
 * the approval it holds. Status stays on the content row; nothing here is a column of a content
 * table, and nothing references one, so the rows are removed by the code that removes the content.
 *
 * @module schemas/review-states/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ReviewAssigneeKind, ReviewScopeKind } from "./types";

export const nextlyReviewStatesPg = pgTable(
  "nextly_review_states",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: text("scope_kind").$type<ReviewScopeKind>().notNull(),
    scopeSlug: text("scope_slug").notNull(),
    entryId: text("entry_id").notNull(),
    // The part: a language, or null for the shared part.
    part: text("part"),
    // The digest of (scope, document, part), which the unique index is on (`reviewStateKey`): a
    // null part cannot sit in a unique index on every dialect, and the readable composite would
    // pass MySQL's key limit.
    partKey: text("part_key").notNull(),

    stage: text("stage").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
    // The person accountable for the part being in its stage: whoever moved it there, or a key's
    // or agent's owner. Null for a move nobody made, which keeps the one before it.
    enteredBy: text("entered_by"),

    assigneeKind: text("assignee_kind").$type<ReviewAssigneeKind>(),
    assigneeId: text("assignee_id"),
    dueAt: timestamp("due_at", { withTimezone: true }),

    // The current approval, if any: the number of the recorded version the reviewer saw (its
    // `versionNo`, as content events and pins name a version), a digest of its content without the
    // stage's exempt fields, and who approved it when.
    approvedVersionNo: integer("approved_version_no"),
    approvedDigest: text("approved_digest"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    // The hash of the workflow definition the row was written under.
    definitionHash: text("definition_hash").notNull(),
    // Raised by one on every write, so a step taken on a row someone changed since is refused.
    revision: integer("revision").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_review_states_key_uidx").on(table.partKey),
    // A document's parts, read and removed together.
    index("nextly_review_states_doc_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.entryId
    ),
    // How many parts wait in each stage of a collection or Single.
    index("nextly_review_states_stage_idx").on(
      table.scopeKind,
      table.scopeSlug,
      table.stage
    ),
    // What waits for a person or role.
    index("nextly_review_states_assignee_idx").on(
      table.assigneeKind,
      table.assigneeId
    ),
  ]
);

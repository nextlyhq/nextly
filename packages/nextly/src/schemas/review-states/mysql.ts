/**
 * `nextly_review_states` - MySQL. Mirrors `./postgres.ts`, which documents each column.
 *
 * @module schemas/review-states/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import type { ReviewAssigneeKind, ReviewScopeKind } from "./types";

export const nextlyReviewStatesMysql = mysqlTable(
  "nextly_review_states",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    scopeKind: varchar("scope_kind", { length: 32 })
      .$type<ReviewScopeKind>()
      .notNull(),
    scopeSlug: varchar("scope_slug", { length: 255 }).notNull(),
    entryId: varchar("entry_id", { length: 36 }).notNull(),
    part: varchar("part", { length: 35 }),
    partKey: varchar("part_key", { length: 64 }).notNull(),

    stage: varchar("stage", { length: 64 }).notNull(),
    enteredAt: datetime("entered_at", { fsp: 3 }).notNull(),
    enteredBy: varchar("entered_by", { length: 255 }),

    assigneeKind: varchar("assignee_kind", {
      length: 16,
    }).$type<ReviewAssigneeKind>(),
    assigneeId: varchar("assignee_id", { length: 255 }),
    dueAt: datetime("due_at", { fsp: 3 }),

    approvedVersionNo: int("approved_version_no"),
    approvedDigest: varchar("approved_digest", { length: 64 }),
    approvedBy: varchar("approved_by", { length: 255 }),
    approvedAt: datetime("approved_at", { fsp: 3 }),

    definitionHash: varchar("definition_hash", { length: 64 }).notNull(),
    revision: int("revision").notNull(),

    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
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

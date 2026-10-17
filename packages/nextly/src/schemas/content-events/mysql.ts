/**
 * `nextly_content_events` and `nextly_content_event_parts` - MySQL. Mirror
 * `./postgres.ts`; see it for what each column holds.
 *
 * @module schemas/content-events/mysql
 */
// fallow-ignore-file code-duplication

import {
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import type { ContentEventActorKind, ContentEventSubjectKind } from "./types";

export const nextlyContentEventsMysql = mysqlTable(
  "nextly_content_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),

    subjectKind: varchar("subject_kind", { length: 16 })
      .$type<ContentEventSubjectKind>()
      .notNull(),
    // Bounded so the subject index stays inside MySQL's key size limit.
    subjectSlug: varchar("subject_slug", { length: 255 }),
    subjectId: varchar("subject_id", { length: 255 }).notNull(),

    kind: varchar("kind", { length: 64 }).notNull(),
    endsSubject: boolean("ends_subject").notNull().default(false),

    actorKind: varchar("actor_kind", { length: 16 })
      .$type<ContentEventActorKind>()
      .notNull(),
    actorId: varchar("actor_id", { length: 255 }),
    actorPrincipalKind: varchar("actor_principal_kind", { length: 64 }),
    actorName: varchar("actor_name", { length: 255 }),

    occurredAt: datetime("occurred_at", { fsp: 3 }).notNull(),

    fromState: varchar("from_state", { length: 64 }),
    toState: varchar("to_state", { length: 64 }),
    note: text("note"),
    versionNo: int("version_no"),
    payload: json("payload"),
    definitionHash: varchar("definition_hash", { length: 64 }),
  },
  table => [
    index("nextly_content_events_subject_idx").on(
      table.subjectKind,
      table.subjectSlug,
      table.subjectId,
      table.id
    ),
    index("nextly_content_events_ends_idx").on(
      table.endsSubject,
      table.occurredAt
    ),
  ]
);

export const nextlyContentEventPartsMysql = mysqlTable(
  "nextly_content_event_parts",
  {
    eventId: varchar("event_id", { length: 36 }).notNull(),
    part: varchar("part", { length: 35 }).notNull(),
  },
  table => [primaryKey({ columns: [table.eventId, table.part] })]
);

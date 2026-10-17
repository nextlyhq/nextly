/**
 * `nextly_content_events` and `nextly_content_event_parts` - SQLite. Mirror
 * `./postgres.ts`; see it for what each column holds.
 *
 * @module schemas/content-events/sqlite
 */
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { ContentEventActorKind, ContentEventSubjectKind } from "./types";

export const nextlyContentEventsSqlite = sqliteTable(
  "nextly_content_events",
  {
    id: text("id").primaryKey(),

    subjectKind: text("subject_kind")
      .$type<ContentEventSubjectKind>()
      .notNull(),
    subjectSlug: text("subject_slug"),
    subjectId: text("subject_id").notNull(),

    kind: text("kind").notNull(),
    endsSubject: integer("ends_subject", { mode: "boolean" })
      .notNull()
      .default(false),

    actorKind: text("actor_kind").$type<ContentEventActorKind>().notNull(),
    actorId: text("actor_id"),
    actorPrincipalKind: text("actor_principal_kind"),
    actorName: text("actor_name"),

    // Seconds, as every timestamp here: the adapter writes a Date as epoch
    // seconds. Order within a second comes from the time-ordered id.
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),

    fromState: text("from_state"),
    toState: text("to_state"),
    note: text("note"),
    versionNo: integer("version_no"),
    payload: text("payload", { mode: "json" }),
    definitionHash: text("definition_hash"),
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

export const nextlyContentEventPartsSqlite = sqliteTable(
  "nextly_content_event_parts",
  {
    eventId: text("event_id").notNull(),
    part: text("part").notNull(),
  },
  table => [primaryKey({ columns: [table.eventId, table.part] })]
);

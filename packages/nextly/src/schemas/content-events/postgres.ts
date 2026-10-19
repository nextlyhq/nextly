/**
 * `nextly_content_events` and `nextly_content_event_parts` - PostgreSQL.
 *
 * The canonical column lists; `./mysql.ts` and `./sqlite.ts` mirror them with
 * their own types. One row per thing that happened to content (a document or
 * a release), and one part row per language (or the shared fields) the event
 * involved, so history can be filtered and paged by part in SQL.
 *
 * @module schemas/content-events/postgres
 */
// The same tables in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type { ContentEventActorKind, ContentEventSubjectKind } from "./types";

export const nextlyContentEventsPg = pgTable(
  "nextly_content_events",
  {
    // Time-ordered (see `contentEventId`), so events of one instant still read
    // newest first.
    id: text("id").primaryKey(),

    // The subject. A document is (kind, slug, id); a release is ("release",
    // null, id).
    subjectKind: varchar("subject_kind", { length: 16 })
      .$type<ContentEventSubjectKind>()
      .notNull(),
    subjectSlug: text("subject_slug"),
    subjectId: text("subject_id").notNull(),

    // A registered event kind.
    kind: varchar("kind", { length: 64 }).notNull(),
    // Whether the event records its subject's deletion, stored with it so
    // retention never depends on which kinds are registered now.
    endsSubject: boolean("ends_subject").notNull().default(false),
    // The deletion event that ended the life this event belongs to, stamped
    // in the deletion's transaction (a deletion event names itself). Which
    // life an event belongs to is fixed by what had committed then, never by
    // comparing ids or clocks written by different processes.
    endedBy: text("ended_by"),

    // Who or what did it, and how they were named then: the event still reads
    // correctly after the person or key is gone.
    actorKind: varchar("actor_kind", { length: 16 })
      .$type<ContentEventActorKind>()
      .notNull(),
    actorId: text("actor_id"),
    // A principal's kind, beside its id, for a `principal` actor only.
    actorPrincipalKind: varchar("actor_principal_kind", { length: 64 }),
    actorName: text("actor_name"),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    // Optional: the state before and after (a status or a stage), a note, the
    // version the change produced or points at, a small kind-specific payload,
    // and the hash of a definition a feature acted under.
    fromState: varchar("from_state", { length: 64 }),
    toState: varchar("to_state", { length: 64 }),
    note: text("note"),
    versionNo: integer("version_no"),
    payload: jsonb("payload"),
    definitionHash: varchar("definition_hash", { length: 64 }),
  },
  table => [
    // A subject's history, newest first and paged by id, and the retention
    // sweep of a subject's events by id.
    index("nextly_content_events_subject_idx").on(
      table.subjectKind,
      table.subjectSlug,
      table.subjectId,
      table.id
    ),
    // Retention finds deletion events by age.
    index("nextly_content_events_ends_idx").on(
      table.endsSubject,
      table.occurredAt
    ),
    // Retention removes one ended life's events by the deletion that ended it.
    index("nextly_content_events_ended_by_idx").on(table.endedBy),
  ]
);

export const nextlyContentEventPartsPg = pgTable(
  "nextly_content_event_parts",
  {
    eventId: text("event_id").notNull(),
    // A locale code, or `SHARED_PART` for the shared fields.
    part: varchar("part", { length: 35 }).notNull(),
  },
  // One row per event and part; the key's leading `event_id` also serves the
  // lookup of an event's parts.
  table => [primaryKey({ columns: [table.eventId, table.part] })]
);

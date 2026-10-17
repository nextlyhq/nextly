/**
 * Write one content event, in the caller's transaction.
 *
 * A change never stands without its event, nor an event without its change:
 * the event and its parts are written on the transaction that makes the change,
 * and commit or roll back with it.
 *
 * @module domains/content-events/record
 * @experimental
 */

import { NextlyError } from "../../errors";
import {
  CONTENT_EVENTS_TABLE,
  CONTENT_EVENT_PARTS_TABLE,
  SHARED_PART,
  type ContentEventSubjectKind,
} from "../../schemas/content-events";
import { toJsonColumnValue } from "../../shared/lib/json-column-value";
import { uuidV7 } from "../../utils/uuid-v7";
import type { VersionsDbApi } from "../versions/db-api";

import type { ContentEventActor } from "./actor";
import { contentEventKind, type ContentEventKind } from "./kinds";

/** What an event is about. */
export type ContentEventSubject =
  | {
      kind: Exclude<ContentEventSubjectKind, "release">;
      slug: string;
      id: string;
    }
  | { kind: "release"; id: string };

/**
 * One event to record.
 *
 * @experimental
 */
export interface ContentEventInput {
  subject: ContentEventSubject;
  /**
   * The parts of a document the event involved: its languages, and whether
   * its shared (untranslated) fields were. A release's events involve none.
   */
  parts?: { locales?: readonly string[]; shared?: boolean };
  /** A registered kind. */
  kind: string;
  actor: ContentEventActor;
  /** The state before and after, for a status or a stage. */
  fromState?: string | null;
  toState?: string | null;
  note?: string | null;
  /** The version the change produced or points at. */
  versionNo?: number | null;
  /** Kind-specific fields, checked against the kind's payload schema. */
  payload?: Record<string, unknown> | null;
  /** The hash of the definition a feature acted under, where it has one. */
  definitionHash?: string | null;
}

/** The longest a payload may be, serialised: events are small by design. */
const MAX_PAYLOAD_BYTES = 4096;
const MAX_PART_LENGTH = 35;

function refuse(message: string, logContext: Record<string, unknown>): never {
  throw NextlyError.invalidInput({ message, logContext });
}

/** The registered kind, or a refusal naming the unknown one. */
function registeredKind(name: string): ContentEventKind {
  const kind = contentEventKind(name);
  if (!kind) {
    refuse(`"${name}" is not a registered content event kind.`, { kind: name });
  }
  return kind;
}

/**
 * The longest each bounded field may be: the columns MySQL keeps as
 * `varchar`. Checked on every dialect, so an event one dialect would refuse or
 * cut short is refused everywhere, before anything is written.
 */
const FIELD_LIMITS = {
  subjectSlug: 255,
  subjectId: 255,
  actorId: 255,
  actorName: 255,
  actorPrincipalKind: 64,
  fromState: 64,
  toState: 64,
  definitionHash: 64,
} as const;

type BoundedFields = Record<keyof typeof FIELD_LIMITS, string | null>;

function checkLengths(fields: BoundedFields): void {
  for (const field of Object.keys(FIELD_LIMITS) as (keyof BoundedFields)[]) {
    const value = fields[field];
    const limit = FIELD_LIMITS[field];
    if (value !== null && value.length > limit) {
      refuse(
        `A content event's ${field} must be at most ${limit} characters.`,
        {
          field,
          length: value.length,
        }
      );
    }
  }
}

/** The payload, checked against its kind; refuses one its kind does not take. */
function checkedPayload(
  kind: ContentEventKind,
  input: ContentEventInput
): Record<string, unknown> | null {
  const payload = input.payload ?? null;
  if (!kind.payload) {
    if (payload !== null) {
      refuse(`Content event kind "${kind.name}" carries no payload.`, {
        kind: kind.name,
      });
    }
    return null;
  }
  const parsed = kind.payload.safeParse(payload ?? {});
  if (!parsed.success) {
    refuse(
      `The payload of a "${kind.name}" event does not match its kind: ${parsed.error.issues
        .map(issue => `${issue.path.join(".") || "payload"}: ${issue.message}`)
        .join("; ")}.`,
      { kind: kind.name }
    );
  }
  if (
    Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > MAX_PAYLOAD_BYTES
  ) {
    refuse(
      `A content event's payload must be at most ${MAX_PAYLOAD_BYTES} bytes.`,
      { kind: kind.name }
    );
  }
  return parsed.data;
}

/** The event's part values: each language once, and the shared marker. */
function partValues(input: ContentEventInput): string[] {
  const locales = [...new Set(input.parts?.locales ?? [])];
  for (const locale of locales) {
    if (
      locale.length === 0 ||
      locale.length > MAX_PART_LENGTH ||
      locale.startsWith("~")
    ) {
      refuse(`"${locale}" is not a language a content event can involve.`, {
        locale,
      });
    }
  }
  return input.parts?.shared ? [...locales, SHARED_PART] : locales;
}

/**
 * Record one event and its parts on `tx`, the transaction of the change it
 * records. Returns the event's id, which is time-ordered.
 *
 * @experimental
 */
export async function recordContentEvent(
  tx: VersionsDbApi,
  input: ContentEventInput
): Promise<{ id: string }> {
  const kind = registeredKind(input.kind);
  const payload = checkedPayload(kind, input);
  const parts = partValues(input);
  const { actor, subject } = input;
  const bounded: BoundedFields = {
    subjectSlug: subject.kind === "release" ? null : subject.slug,
    subjectId: subject.id,
    actorId: actor.kind === "system" ? null : actor.id,
    actorName: actor.name ?? null,
    actorPrincipalKind: actor.kind === "principal" ? actor.principalKind : null,
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    definitionHash: input.definitionHash ?? null,
  };
  checkLengths(bounded);
  const id = uuidV7();
  await tx.insert(CONTENT_EVENTS_TABLE, {
    id,
    subjectKind: subject.kind,
    kind: kind.name,
    // Stored with the event, so retention never depends on which kinds are
    // registered when it runs.
    endsSubject: kind.endsSubject === true,
    actorKind: actor.kind,
    occurredAt: new Date(),
    note: input.note ?? null,
    versionNo: input.versionNo ?? null,
    // Encoded for the JSON column as every write path encodes one: a raw
    // object reaches MySQL as text it rejects.
    payload: toJsonColumnValue(payload),
    ...bounded,
  });
  for (const part of parts) {
    await tx.insert(CONTENT_EVENT_PARTS_TABLE, { eventId: id, part });
  }
  return { id };
}

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
import { contentEventKind } from "./kinds";

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

/** The payload, checked against its kind; refuses one its kind does not take. */
function checkedPayload(
  input: ContentEventInput
): Record<string, unknown> | null {
  const kind = contentEventKind(input.kind);
  if (!kind) {
    refuse(`"${input.kind}" is not a registered content event kind.`, {
      kind: input.kind,
    });
  }
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
  const payload = checkedPayload(input);
  const parts = partValues(input);
  const id = uuidV7();
  const { actor, subject } = input;
  await tx.insert(CONTENT_EVENTS_TABLE, {
    id,
    subjectKind: subject.kind,
    subjectSlug: subject.kind === "release" ? null : subject.slug,
    subjectId: subject.id,
    kind: input.kind,
    actorKind: actor.kind,
    actorId: actor.kind === "system" ? null : actor.id,
    actorPrincipalKind: actor.kind === "principal" ? actor.principalKind : null,
    actorName: actor.name ?? null,
    occurredAt: new Date(),
    fromState: input.fromState ?? null,
    toState: input.toState ?? null,
    note: input.note ?? null,
    versionNo: input.versionNo ?? null,
    // Encoded for the JSON column as every write path encodes one: a raw
    // object reaches MySQL as text it rejects.
    payload: toJsonColumnValue(payload),
    definitionHash: input.definitionHash ?? null,
  });
  for (const part of parts) {
    await tx.insert(CONTENT_EVENT_PARTS_TABLE, { eventId: id, part });
  }
  return { id };
}

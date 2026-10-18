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
import { isConfigurableLocaleCode } from "../i18n/config/validate";
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
function registeredKind(name: string): Readonly<ContentEventKind> {
  const kind = contentEventKind(name);
  if (!kind) {
    refuse(`"${name}" is not a registered content event kind.`, { kind: name });
  }
  return kind;
}

/**
 * The longest each bounded field may be: the columns MySQL keeps as
 * `varchar`, and the note, which MySQL keeps as `text` of at most 65,535
 * bytes (4,000 characters fit at four bytes each). Checked on every dialect,
 * so an event one dialect would refuse or cut short is refused everywhere,
 * before anything is written.
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
  note: 4000,
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
  kind: Readonly<ContentEventKind>,
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
  // What the schema produced has to survive the JSON column unchanged: a
  // Date would read back as a string, an undefined field would vanish, and a
  // bigint cannot be written at all.
  if (!isJsonValue(parsed.data)) {
    refuse(
      `The payload of a "${kind.name}" event must be plain JSON: strings, finite numbers, booleans, null, arrays and plain objects.`,
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

/**
 * A release has no parts, so a release event that names any is refused rather
 * than recorded as matching a language.
 */
function refuseReleaseParts(input: ContentEventInput): void {
  if (input.subject.kind !== "release" || !input.parts) return;
  const { locales = [], shared = false } = input.parts;
  if (locales.length > 0 || shared) {
    refuse("A release's events involve no parts of a document.", {
      kind: input.kind,
    });
  }
}

/** The largest version number the column holds on every dialect. */
const MAX_VERSION_NO = 2_147_483_647;

/**
 * The version an event names, refused unless the integer column holds it on
 * every dialect: PostgreSQL and MySQL keep a signed 32-bit integer, and
 * SQLite would store a fraction or a larger number they refuse.
 */
function checkedVersionNo(versionNo: number | null | undefined): number | null {
  if (versionNo === undefined || versionNo === null) return null;
  if (
    !Number.isInteger(versionNo) ||
    versionNo < 1 ||
    versionNo > MAX_VERSION_NO
  ) {
    refuse("A content event's version must be a whole number from 1.", {
      versionNo,
    });
  }
  return versionNo;
}

/** Whether a value is JSON as it will be read back: nothing lost or changed. */
function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isJsonValue);
}

/** The event's part values: each language once, and the shared marker. */
function partValues(input: ContentEventInput): string[] {
  refuseReleaseParts(input);
  const locales = [...new Set(input.parts?.locales ?? [])];
  for (const locale of locales) {
    // A language as configuration would accept one, and short enough for
    // the part column on every dialect.
    if (!isConfigurableLocaleCode(locale) || locale.length > MAX_PART_LENGTH) {
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
    note: input.note ?? null,
  };
  checkLengths(bounded);
  const versionNo = checkedVersionNo(input.versionNo);
  const id = uuidV7();
  const endsSubject = kind.endsSubject === true;
  if (endsSubject) {
    // Every event of the life this deletion ends is stamped with it, on the
    // deletion's own transaction, so retention later removes exactly those.
    // A subject recreated under the same id starts unstamped events of its own.
    await tx.update(
      CONTENT_EVENTS_TABLE,
      { endedBy: id },
      {
        and: [
          { column: "subjectKind", op: "=", value: subject.kind },
          bounded.subjectSlug === null
            ? { column: "subjectSlug", op: "IS NULL" }
            : { column: "subjectSlug", op: "=", value: bounded.subjectSlug },
          { column: "subjectId", op: "=", value: subject.id },
          { column: "endedBy", op: "IS NULL" },
        ],
      }
    );
  }
  await tx.insert(CONTENT_EVENTS_TABLE, {
    id,
    subjectKind: subject.kind,
    kind: kind.name,
    // Stored with the event, so retention never depends on which kinds are
    // registered when it runs.
    endsSubject,
    // A deletion event belongs to the life it ends.
    endedBy: endsSubject ? id : null,
    actorKind: actor.kind,
    occurredAt: new Date(),
    versionNo,
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

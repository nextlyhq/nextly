/**
 * Real records an owner offers for a template's test data: an order, a
 * submission, a user, read to fill the workbench's preview.
 *
 * An owner contributes a loader beside its template (`sampleRecords`), saying
 * what it reads. Nextly checks the caller may read that, with the same access
 * decision every read takes, before the loader runs at all: a loader never
 * has to remember the check, and a caller refused never reaches it. What a
 * loader answers is checked for shape, bounded, and handed back for the
 * preview; it is never stored.
 *
 * @module domains/email/sample-records
 */

import { z } from "zod";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import {
  canReadEntity,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";
import { canReadSystemResource } from "../../auth/resource-readable";
import { NextlyError } from "../../errors";

/**
 * @experimental What a loader reads, which Nextly checks the caller may read
 * before the loader runs: `"users"`, or a collection by its slug.
 */
export type SampleRecordReads = "users" | { collection: string };

/** @experimental One record a loader offers, as the workbench lists it. */
export interface SampleRecordSummary {
  /** The record's id, handed back to `load`. */
  id: string;
  /** What the record is called in the list, such as "Order A-104". */
  label: string;
}

/**
 * @experimental Real records offered for a template's test data. Read only
 * for a person allowed to read what `reads` names, and never stored.
 */
export interface EmailSampleRecords {
  /** What the records are, shown above them, such as "A real order". */
  label: string;
  /** What the loader reads, checked before it runs. */
  reads: SampleRecordReads;
  /** Up to `limit` records to choose from, newest first. */
  list(args: { limit: number }): Promise<SampleRecordSummary[]>;
  /**
   * One record's values for the template's variables, by variable name; null
   * for a record the loader no longer has.
   */
  load(id: string): Promise<Record<string, unknown> | null>;
}

/** The most records a list offers. */
const SAMPLE_RECORDS_LIMIT = 20;

/** The largest record a load hands back, as JSON text. */
const MAX_RECORD_BYTES = 64 * 1024;

const SUMMARY = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});

/** A record's id as a route receives it. */
const RECORD_ID = z.string().min(1).max(200);

/** Who is asking, as the access decision reads them. */
export interface SampleRecordCaller {
  /** For a collection's records. */
  readCaller: ReadAccessCaller;
  /** For users: the signed-in user's id, and an API key's own scope. */
  userId: string | undefined;
  scope?: AuthenticatedScope;
}

/**
 * The loader an owner declared, kept only when it has the shape: an owner is
 * plain JavaScript at runtime, so a malformed one offers nothing rather than
 * failing when the workbench asks.
 */
export function sampleRecordsOf(
  declared: unknown
): EmailSampleRecords | undefined {
  if (typeof declared !== "object" || declared === null) return undefined;
  const source = declared as Partial<EmailSampleRecords>;
  const reads = source.reads;
  const readsKnown =
    reads === "users" ||
    (typeof reads === "object" &&
      reads !== null &&
      typeof reads.collection === "string" &&
      reads.collection !== "");
  return typeof source.label === "string" &&
    source.label.trim() !== "" &&
    readsKnown &&
    typeof source.list === "function" &&
    typeof source.load === "function"
    ? (source as EmailSampleRecords)
    : undefined;
}

/** Whether `caller` may read what `reads` names, by the one access decision. */
async function mayRead(
  reads: SampleRecordReads,
  caller: SampleRecordCaller
): Promise<boolean> {
  if (reads === "users") {
    return canReadSystemResource("users", caller.userId, caller.scope);
  }
  return canReadEntity(reads.collection, caller.readCaller);
}

/**
 * The precondition of every read here: a loader is offered, and the caller
 * may read what it reads. Checked before the loader is called.
 */
async function offered(
  source: EmailSampleRecords | undefined,
  caller: SampleRecordCaller
): Promise<EmailSampleRecords> {
  if (!source) {
    throw NextlyError.notFound({
      logContext: { reason: "no-sample-records" },
    });
  }
  if (!(await mayRead(source.reads, caller))) {
    throw NextlyError.forbidden({
      logContext: { reason: "sample-records-not-readable" },
    });
  }
  return source;
}

/**
 * The records `source` offers this caller, with what they are. Only the
 * well-formed ones, up to {@link SAMPLE_RECORDS_LIMIT}.
 *
 * @throws {NextlyError} `NOT_FOUND` when no loader is offered; `FORBIDDEN`
 *   when the caller may not read what it reads.
 */
export async function listSampleRecords(
  source: EmailSampleRecords | undefined,
  caller: SampleRecordCaller
): Promise<{ label: string; items: SampleRecordSummary[] }> {
  const loader = await offered(source, caller);
  const listed = await loader.list({ limit: SAMPLE_RECORDS_LIMIT });
  const items = (Array.isArray(listed) ? listed : [])
    .flatMap(entry => {
      const read = SUMMARY.safeParse(entry);
      return read.success ? [read.data] : [];
    })
    .slice(0, SAMPLE_RECORDS_LIMIT);
  return { label: loader.label, items };
}

/**
 * One record's values for the preview, as plain JSON data, read and handed
 * back, never stored.
 *
 * @throws {NextlyError} `NOT_FOUND` when no loader is offered or the record is
 *   gone; `FORBIDDEN` when the caller may not read it; `VALIDATION_ERROR` for
 *   an id no record can have.
 */
export async function loadSampleRecord(
  source: EmailSampleRecords | undefined,
  id: string,
  caller: SampleRecordCaller
): Promise<Record<string, unknown>> {
  const loader = await offered(source, caller);
  const recordId = RECORD_ID.safeParse(id);
  if (!recordId.success) {
    throw NextlyError.validation({
      errors: [
        { path: "recordId", code: "INVALID", message: "Not a record id." },
      ],
    });
  }
  const record = await loader.load(recordId.data);
  if (record === null || record === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "sample-record-gone" },
    });
  }
  return plainRecord(record);
}

/**
 * A record as plain JSON data: what JSON keeps of it, as an object, within
 * the size bound. A loader that answers anything else answers nothing usable.
 */
function plainRecord(record: unknown): Record<string, unknown> {
  let text: string;
  try {
    text = JSON.stringify(record);
  } catch (error) {
    throw NextlyError.internal({
      cause: error instanceof Error ? error : undefined,
      logContext: { reason: "sample-record-not-json" },
    });
  }
  const parsed: unknown = text === undefined ? undefined : JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    text.length > MAX_RECORD_BYTES
  ) {
    throw NextlyError.internal({
      logContext: { reason: "sample-record-not-an-object" },
    });
  }
  return parsed as Record<string, unknown>;
}

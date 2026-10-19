/**
 * Read the record of content events by subject, newest first, filtered and
 * paged in the database.
 *
 * A storage read only: who may read a subject's events is the events read's
 * to decide, through the same access check as the document's history.
 *
 * @module domains/content-events/repository
 * @experimental
 */

import { and, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";

import { toDbError } from "../../database/errors";
import { NextlyError } from "../../errors";
import {
  contentEventsTables,
  type ContentEventActorKind,
  type ContentEventSubjectKind,
  type my,
  type pg,
  type sl,
} from "../../schemas/content-events";
import { BaseService } from "../../shared/base-service";

import type { ContentEventSubject } from "./record";

type EventsTable =
  | typeof pg.nextlyContentEventsPg
  | typeof my.nextlyContentEventsMysql
  | typeof sl.nextlyContentEventsSqlite;
type PartsTable =
  | typeof pg.nextlyContentEventPartsPg
  | typeof my.nextlyContentEventPartsMysql
  | typeof sl.nextlyContentEventPartsSqlite;

/** One stored event, with the parts it involved. */
export interface ContentEventRecord {
  id: string;
  subjectKind: ContentEventSubjectKind;
  subjectSlug: string | null;
  subjectId: string;
  kind: string;
  actorKind: ContentEventActorKind;
  actorId: string | null;
  actorPrincipalKind: string | null;
  actorName: string | null;
  occurredAt: Date;
  fromState: string | null;
  toState: string | null;
  note: string | null;
  versionNo: number | null;
  payload: Record<string, unknown> | null;
  definitionHash: string | null;
  /** Locale codes, and `SHARED_PART` for the shared fields. */
  parts: string[];
}

/** What to read of a subject's events. */
export interface ContentEventQuery {
  /**
   * Only events that involved any of these parts (locale codes, or
   * `SHARED_PART`).
   */
  parts?: readonly string[];
  /** Only events of these kinds. */
  kinds?: readonly string[];
  /** At most this many events. */
  limit: number;
  /** Only events older than this event (its id), for the next page. */
  before?: string;
}

const MAX_PAGE = 100;

/**
 * The record of content events, read.
 *
 * @experimental
 */
export class ContentEventsRepository extends BaseService {
  private readonly events: EventsTable;
  private readonly parts: PartsTable;

  constructor(
    adapter: ConstructorParameters<typeof BaseService>[0],
    logger: ConstructorParameters<typeof BaseService>[1]
  ) {
    super(adapter, logger);
    const tables = contentEventsTables(this.adapter.getCapabilities().dialect);
    this.events = tables.nextlyContentEvents;
    this.parts = tables.nextlyContentEventParts;
  }

  /**
   * A page of a subject's events, newest first, and the cursor for the next
   * page (null when there is none).
   *
   * Ordered by the time-ordered id, which is also the cursor, so a page never
   * repeats or skips an event however many share an instant. A parts filter
   * joins the parts table, so it is applied and paged in the database.
   */
  async listForSubject(
    subject: ContentEventSubject,
    query: ContentEventQuery
  ): Promise<{ items: ContentEventRecord[]; nextBefore: string | null }> {
    assertPageSize(query.limit);
    const rows = await this.pageRows(subject, query);
    const page = rows.slice(0, query.limit);
    const partsByEvent = await this.partsOf(page.map(row => row.id));
    return {
      items: page.map(row => ({
        ...row,
        occurredAt: new Date(row.occurredAt),
        payload: parsedPayload(row.payload),
        parts: partsByEvent.get(row.id) ?? [],
      })),
      nextBefore:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** What narrows the read: the subject, then any kinds, cursor and parts. */
  private conditions(subject: ContentEventSubject, query: ContentEventQuery) {
    const conditions: SQL[] = [
      eq(this.events.subjectKind, subject.kind),
      subject.kind === "release"
        ? isNull(this.events.subjectSlug)
        : eq(this.events.subjectSlug, subject.slug),
      eq(this.events.subjectId, subject.id),
    ];
    if (query.kinds?.length) {
      conditions.push(inArray(this.events.kind, [...query.kinds]));
    }
    if (query.before !== undefined) {
      conditions.push(lt(this.events.id, query.before));
    }
    if (query.parts?.length) {
      conditions.push(inArray(this.parts.part, [...query.parts]));
    }
    return and(...conditions);
  }

  /** One row more than the page, which says whether another page exists. */
  private pageRows(
    subject: ContentEventSubject,
    query: ContentEventQuery
  ): Promise<StoredEventRow[]> {
    const where = this.conditions(subject, query);
    return withDbErrors(this.dialect, async () => {
      if (!query.parts?.length) {
        return (await this.db
          .select(this.eventColumns)
          .from(this.events)
          .where(where)
          .orderBy(desc(this.events.id))
          .limit(query.limit + 1)) as StoredEventRow[];
      }
      // An event that involved several of the asked-for parts joins once per
      // part; DISTINCT keeps it once.
      return (await this.db
        .selectDistinct(this.eventColumns)
        .from(this.events)
        .innerJoin(this.parts, eq(this.parts.eventId, this.events.id))
        .where(where)
        .orderBy(desc(this.events.id))
        .limit(query.limit + 1)) as StoredEventRow[];
    });
  }

  /** The event columns, selected by name for the joined read. */
  private get eventColumns() {
    const e = this.events;
    return {
      id: e.id,
      subjectKind: e.subjectKind,
      subjectSlug: e.subjectSlug,
      subjectId: e.subjectId,
      kind: e.kind,
      actorKind: e.actorKind,
      actorId: e.actorId,
      actorPrincipalKind: e.actorPrincipalKind,
      actorName: e.actorName,
      occurredAt: e.occurredAt,
      fromState: e.fromState,
      toState: e.toState,
      note: e.note,
      versionNo: e.versionNo,
      payload: e.payload,
      definitionHash: e.definitionHash,
    };
  }

  /** Each event's parts, in one read. */
  private async partsOf(ids: string[]): Promise<Map<string, string[]>> {
    const byEvent = new Map<string, string[]>();
    if (ids.length === 0) return byEvent;
    const rows = await withDbErrors(
      this.dialect,
      async () =>
        (await this.db
          .select({ eventId: this.parts.eventId, part: this.parts.part })
          .from(this.parts)
          .where(inArray(this.parts.eventId, ids))) as {
          eventId: string;
          part: string;
        }[]
    );
    for (const row of rows) {
      byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row.part]);
    }
    for (const parts of byEvent.values()) parts.sort();
    return byEvent;
  }
}

/** Refuse a page size outside what one read may return. */
function assertPageSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw NextlyError.invalidInput({
      message: `A page of content events holds between 1 and ${MAX_PAGE} events.`,
      logContext: { limit },
    });
  }
}

/** Run a read, so a driver error never escapes as anything but a NextlyError. */
async function withDbErrors<T>(
  dialect: Parameters<typeof toDbError>[0],
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof NextlyError) throw err;
    throw NextlyError.fromDatabaseError(toDbError(dialect, err));
  }
}

type StoredEventRow = Omit<
  ContentEventRecord,
  "parts" | "occurredAt" | "payload"
> & {
  occurredAt: Date | string | number;
  payload: unknown;
};

/** MySQL can return a JSON column as text; every dialect reads back an object. */
function parsedPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

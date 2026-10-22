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

import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

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
  /**
   * The parts the reader may be shown. An event that involved none of them is
   * left out, unless it involved no part at all, and each event's parts are
   * narrowed to them. Absent shows every part.
   */
  visibleParts?: readonly string[];
  /** At most this many events. */
  limit: number;
  /** Only events older than this event (its id), for the next page. */
  before?: string;
  /**
   * Which life of the subject to read. A document id can live more than once
   * (deleted, then made again under the same id), and each life's events are
   * its own: `current` is the life not yet ended, and `{ endedBy }` the life a
   * given deletion ended. Absent reads every life, as a storage read.
   */
  life?: "current" | { endedBy: string };
}

const MAX_PAGE = 100;

/** The kinds of event that capture a version, and so name who wrote it. */
const PRODUCING_KINDS = ["created", "saved", "restored", "published"] as const;

/** Who recorded an event, as the record keeps them. */
export interface ContentEventProducer {
  actorKind: ContentEventActorKind;
  actorId: string | null;
  actorPrincipalKind: string | null;
  actorName: string | null;
}

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
        parts: visibleOf(partsByEvent.get(row.id) ?? [], query.visibleParts),
      })),
      nextBefore:
        rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * The id of the subject's latest deletion, the event that ended its most
   * recent life, or null when it has never been deleted.
   */
  async latestEnd(subject: ContentEventSubject): Promise<string | null> {
    const rows = await withDbErrors(
      this.dialect,
      async () =>
        (await this.db
          .select({ id: this.events.id })
          .from(this.events)
          .where(
            and(
              this.subjectConditions(subject),
              eq(this.events.endsSubject, true)
            )
          )
          .orderBy(desc(this.events.id))
          .limit(1)) as { id: string }[]
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Who produced each of these versions of a subject: the actor of the event
   * that recorded the version, keyed by its number.
   *
   * One read for the whole page of versions. The producing events are a
   * create, a save, a restore and a publish that captured a version; a naming
   * is never one, since whoever names a version did not write it. Where a
   * version has more than one (a create straight to published records both),
   * the first recorded wins. A version number is never reused within a
   * document, so no life of the document needs choosing.
   */
  async producersOf(
    subject: ContentEventSubject,
    versionNos: readonly number[]
  ): Promise<Map<number, ContentEventProducer>> {
    const producers = new Map<number, ContentEventProducer>();
    if (versionNos.length === 0) return producers;
    const e = this.events;
    const rows = await withDbErrors(
      this.dialect,
      async () =>
        (await this.db
          .select({
            versionNo: e.versionNo,
            actorKind: e.actorKind,
            actorId: e.actorId,
            actorPrincipalKind: e.actorPrincipalKind,
            actorName: e.actorName,
          })
          .from(e)
          .where(
            and(
              this.subjectConditions(subject),
              inArray(e.versionNo, [...versionNos]),
              inArray(e.kind, [...PRODUCING_KINDS])
            )
          )
          .orderBy(asc(e.id))) as (ContentEventProducer & {
          versionNo: number | null;
        })[]
    );
    for (const { versionNo, ...producer } of rows) {
      if (versionNo !== null && !producers.has(versionNo)) {
        producers.set(versionNo, producer);
      }
    }
    return producers;
  }

  /** The subject an event is about. */
  private subjectConditions(subject: ContentEventSubject): SQL {
    return and(
      eq(this.events.subjectKind, subject.kind),
      subject.kind === "release"
        ? isNull(this.events.subjectSlug)
        : eq(this.events.subjectSlug, subject.slug),
      eq(this.events.subjectId, subject.id)
    )!;
  }

  /** What narrows the read: the subject, then any kinds, cursor and parts. */
  private conditions(subject: ContentEventSubject, query: ContentEventQuery) {
    const conditions: SQL[] = [this.subjectConditions(subject)];
    if (query.kinds?.length) {
      conditions.push(inArray(this.events.kind, [...query.kinds]));
    }
    if (query.before !== undefined) {
      conditions.push(lt(this.events.id, query.before));
    }
    if (query.parts?.length) {
      conditions.push(inArray(this.parts.part, [...query.parts]));
    }
    if (query.visibleParts !== undefined) {
      conditions.push(this.involvesVisiblePart(query.visibleParts));
    }
    if (query.life !== undefined) {
      conditions.push(
        query.life === "current"
          ? isNull(this.events.endedBy)
          : eq(this.events.endedBy, query.life.endedBy)
      );
    }
    return and(...conditions);
  }

  /**
   * An event that involved one of these parts, or no part at all: one about
   * the whole document rather than any part of it.
   */
  private involvesVisiblePart(visible: readonly string[]): SQL {
    const partsOfEvent = eq(this.parts.eventId, this.events.id);
    const noPart = notExists(
      this.db
        .select({ one: sql`1` })
        .from(this.parts)
        .where(partsOfEvent)
    );
    if (visible.length === 0) return noPart;
    return or(
      noPart,
      exists(
        this.db
          .select({ one: sql`1` })
          .from(this.parts)
          .where(and(partsOfEvent, inArray(this.parts.part, [...visible])))
      )
    )!;
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

/** An event's parts, narrowed to those the reader may be shown. */
function visibleOf(
  parts: string[],
  visible: readonly string[] | undefined
): string[] {
  if (visible === undefined) return parts;
  return parts.filter(part => visible.includes(part));
}

/**
 * Refuse a page size outside what one read may return. Exported so a caller
 * can refuse it before its access check, by the same bounds.
 */
export function assertPageSize(limit: number): void {
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

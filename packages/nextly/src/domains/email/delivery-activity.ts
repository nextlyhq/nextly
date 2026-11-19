/**
 * What the Email hub's Activity reads: the delivery log and queued email,
 * each newest first with its filters, when each template was last sent, and
 * whether queued email is overdue because the jobs trigger is not running.
 *
 * **Nothing personal leaves here.** Each record is built field by field from
 * an allow-list, so a column added to either table later is not returned
 * until someone adds it here. A delivery carries no address and no digest of
 * one, only whether it was erased; a queued email carries no part of its
 * message, only whether one is still held. Neither table holds a subject or
 * a body to return.
 *
 * Delivery records are read through `EmailDeliveryService.list`, the one
 * reader of the delivery log, and projected here.
 *
 * Lists answer `{ items, meta }`, walked by cursor: `meta.nextBefore` is the
 * `before` that reads the next page.
 *
 * A search by address (`searchByAddress`) is the merged Activity narrowed to
 * one exact address, matched by its keyed digests under the current and the
 * previous secrets (`recipientDigests`), never by the address itself. Each
 * search is recorded in the activity log without the address
 * (`address-search-activity`), and the address is neither stored nor logged.
 *
 * Who may read is decided before any of this runs: `read-email-deliveries`,
 * asked by the REST routes and by a checked Direct API call alike
 * (`SYSTEM_READ_POLICY.emailDeliveries`).
 *
 * @module domains/email/delivery-activity
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type { PaginationMeta } from "../../api/response-shapes";
import type { RequestActor } from "../../auth/request-actor";
import { loadedDialect } from "../../database/dialect-tables";
import { toDbError } from "../../database/errors";
import { NextlyError } from "../../errors";
import {
  adapterForReads,
  runReadsInTransaction,
} from "../../shared/lib/read-transaction-scope";

import {
  recordAddressSearch,
  searchRecordable,
} from "./address-search-activity";
import { deliveriesTableFor } from "./deliveries-table";
import {
  recipientDigests,
  type DeliveryFailureKind,
  type DeliveryTemplateVersion,
  type EmailDeliveryRecipientKind,
  type EmailDeliveryStatus,
} from "./delivery-record";
import type { EmailFailure } from "./failure";
import {
  FILTERABLE_ORIGINS,
  originCondition,
  providerExists,
  providerRead,
  providersTablePresent,
  type FilterableOrigin,
  type ProviderRead,
} from "./provider-origin";
import {
  LATE_QUEUED_EMAIL_COUNTED,
  LATE_QUEUED_EMAIL_MS,
  lateQueuedEmails,
} from "./queued-email-warning";
import {
  standingOf,
  storedFailureOf,
  templateCausedOf,
  type QueueDialect,
  type QueuedEmailStanding,
} from "./queued-send-read";
import type {
  EmailDeliveryRecord,
  EmailDeliveryService,
} from "./services/email-delivery-service";
import { isSendableAddress } from "./services/recipients";

/** What happened to one recipient of one send: `DeliveryActivity["outcome"]`. */
type DeliveryOutcome = EmailDeliveryStatus;

/** @experimental One delivery record, as Activity lists it. */
export interface DeliveryActivity {
  id: string;
  createdAt: Date;
  outcome: DeliveryOutcome;
  /** The template it was sent from, or null for a send without one. */
  templateSlug: string | null;
  /**
   * The provider that carried it: the stored one's id while it exists, its
   * registered type, which outlives it, and where it came from.
   */
  provider: ProviderRead;
  recipientKind: EmailDeliveryRecipientKind;
  /** Why it failed, with anything address-shaped removed; null when sent. */
  failureReason: string | null;
  /** Whether the send named a plugin-defined person as this recipient. */
  namedPerson: boolean;
  /** Whether this recipient has been erased since. */
  erased: boolean;
  /** The queued email this was an attempt of, when it was one. */
  queuedId: string | null;
  templateVersion: DeliveryTemplateVersionRead;
  /** The provider's answer to a failure, structured: never its own text. */
  failureKind: DeliveryFailureKind | null;
  failureStatus: number | null;
}

/**
 * @experimental Which version of its template a delivery sent: the
 * template's owner, whether the site had overridden it, and a digest of the
 * version as saved; `none` for a send without a template; `not-recorded`
 * for a delivery from before versions were recorded.
 */
type DeliveryTemplateVersionRead = DeliveryTemplateVersion | "not-recorded";

/** One attempt on a detail sheet's timeline: `DeliveryDetail["timeline"][number]`. */
interface DeliveryAttempt {
  id: string;
  createdAt: Date;
  outcome: DeliveryOutcome;
  recipientKind: EmailDeliveryRecipientKind;
  provider: ProviderRead;
  /** The provider's answer, structured: never its own text. */
  failureKind: DeliveryFailureKind | null;
  failureStatus: number | null;
  /** Core's sentence for the failure, with anything address-shaped removed. */
  failureReason: string | null;
  templateVersion: DeliveryTemplateVersionRead;
  erased: boolean;
}

/** @experimental A delivery's detail sheet. */
export interface DeliveryDetail extends DeliveryActivity {
  /**
   * Oldest first: every delivery its queued email's attempts recorded, to
   * every recipient, this one among them by its id; or itself alone.
   */
  timeline: DeliveryAttempt[];
  /** Whether the timeline stopped at its limit, its oldest left out. */
  timelineTruncated: boolean;
}

/** @experimental A queued email's detail sheet. */
export interface QueuedEmailDetail extends QueuedEmailActivity {
  /** Whether its last failure came from its template, for "Fix template". */
  templateCaused: boolean;
  /** The template version its latest attempt sent; null before any. */
  templateVersion: DeliveryTemplateVersionRead | null;
  /** Every delivery its attempts recorded, oldest first. */
  timeline: DeliveryAttempt[];
  /** Whether the timeline stopped at its limit, its oldest left out. */
  timelineTruncated: boolean;
}

/** @experimental One queued email, as Activity lists it. */
export interface QueuedEmailActivity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  /** When it was sent, failed for good, or was cancelled. */
  settledAt: Date | null;
  state: QueuedEmailStanding;
  /**
   * Attempts made so far, the one in flight included; null once the job
   * that made them has been pruned.
   */
  attempts: number | null;
  /** When the next attempt is due, while one is to follow. */
  nextAttemptAt: Date | null;
  /** The last failed attempt's failure, with no address in it. */
  lastFailure: EmailFailure | null;
  /** Whether its message is still held, so it could still be sent. */
  messageHeld: boolean;
  /**
   * The template it is sent from. Null for a message queued without one,
   * and for one queued before templates were recorded on queued email.
   */
  templateSlug: string | null;
  /** Who queued it: `site`, `core`, or `plugin:<name>`. */
  queuedBy: string;
}

/**
 * @experimental One page of a list, as every list answers: `meta.nextBefore`
 * is the `before` that reads the next page, when there is one.
 */
export interface ActivityPage<T> {
  items: T[];
  meta: PaginationMeta;
}

/** When one template was last sent: `TemplatesLastSent["templates"][number]`. */
interface TemplateLastSent {
  slug: string;
  lastSentAt: Date;
}

/**
 * @experimental When each template was last sent, as far back as the
 * delivery log reaches: a template missing from `templates` has not been
 * sent since `keptSince`, the start of the log's retention window, or ever
 * when that is null.
 */
export interface TemplatesLastSent {
  templates: TemplateLastSent[];
  keptSince: Date | null;
}

/** @experimental Whether queued email is waiting on a jobs trigger that is not running. */
export interface QueuedEmailOverdue {
  /** Queued emails more than `warningAfterMinutes` past due. */
  overdue: number;
  /** Whether `overdue` stopped counting at its ceiling. */
  capped: boolean;
  warningAfterMinutes: number;
}

/** The longest page a list returns. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
/** Records read per page of a queued email's timeline. */
const TIMELINE_PAGE = 500;
/**
 * The most records a queued email's timeline returns: every attempt of the
 * largest send the queue takes, many times over; past it, the answer says
 * the timeline was cut.
 */
const MAX_TIMELINE_ROWS = 10_000;
/** The most templates one last-sent read names. */
const MAX_SLUGS = 200;

/**
 * The times every dialect's columns can hold: MySQL's `datetime` runs from
 * the year 1000 to 9999, the narrowest of the three, so a time outside it is
 * refused here rather than compared differently by each database.
 */
const EARLIEST_MS = Date.UTC(1000, 0, 1);
const LATEST_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const IN_RANGE = "A time between the years 1000 and 9999.";

/** A time a caller gives: a `Date`, or an ISO 8601 instant. */
const instant = z
  .union([
    z.date(),
    z
      .string()
      .datetime({ offset: true })
      .transform(value => new Date(value)),
  ])
  .refine(
    date => date.getTime() >= EARLIEST_MS && date.getTime() <= LATEST_MS,
    IN_RANGE
  );

const common = {
  template: z.string().min(1).max(255).optional(),
  from: instant.optional(),
  to: instant.optional(),
  before: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
};

const DELIVERY_FILTER = z.object({
  outcome: z.enum(["sent", "failed"]).optional(),
  // A stored provider's id is a UUID, and PostgreSQL refuses anything else
  // in that column rather than matching nothing, as the other dialects do.
  providerId: z
    .string()
    .uuid()
    .transform(id => id.toLowerCase())
    .optional(),
  providerType: z.string().min(1).max(50).optional(),
  ...common,
});

const QUEUED_FILTER = z.object({
  state: z
    .enum(["waiting", "retrying", "sending", "sent", "failed", "cancelled"])
    .optional(),
  ...common,
});

const ACTIVITY_FILTER = z.object({
  status: z
    .enum(["waiting", "retrying", "sending", "sent", "failed", "cancelled"])
    .optional(),
  providerType: z.string().min(1).max(50).optional(),
  providerOrigin: z.enum(FILTERABLE_ORIGINS).optional(),
  ...common,
});

// Exactly the addresses the send path takes (`isSendableAddress`), with no
// bound of its own, so any address email can go to can be searched for. Its
// own value is never put in a message: a refusal names the field, not what
// was entered.
const ADDRESS_SEARCH = ACTIVITY_FILTER.extend({
  address: z
    .string()
    .trim()
    .refine(isSendableAddress, "Enter one whole email address."),
});

const SLUGS = z.array(z.string().min(1).max(255)).max(MAX_SLUGS);

/** @experimental How the delivery list is narrowed. */
export interface DeliveryActivityFilter {
  outcome?: DeliveryOutcome;
  template?: string;
  /** A stored provider's id. */
  providerId?: string;
  /** A provider's registered type, whether or not it is still stored. */
  providerType?: string;
  /** Sent at or after; a `Date` or an ISO 8601 instant. */
  from?: Date | string;
  /** Sent at or before; a `Date` or an ISO 8601 instant. */
  to?: Date | string;
  /** The `meta.nextBefore` of the page before. */
  before?: string;
  /** At most 100; 50 when not given. */
  limit?: number | string;
}

/**
 * @experimental One row of the merged Activity: a queued email, or a
 * delivery of a send that was not queued. A queued email's own deliveries
 * are its timeline, not rows of their own.
 */
export interface ActivityEntry {
  kind: "delivery" | "queued";
  id: string;
  createdAt: Date;
  /** A delivery's outcome, or where a queued email stands. */
  status: DeliveryOutcome | QueuedEmailStanding;
  /**
   * The template it was sent from; `none` for a message without one;
   * `not-recorded` when that was not recorded.
   */
  template: { slug: string } | "none" | "not-recorded";
  /** Its provider; null for a queued email not yet tried. */
  provider: ProviderRead | null;
  /**
   * The kinds of recipient it went to: a delivery's own, a queued email's
   * every kind; null when not recorded.
   */
  recipientKinds: EmailDeliveryRecipientKind[] | null;
  /** Why it (last) failed, with nothing address-shaped in it. */
  failureReason: string | null;
  /** A queued email's attempts so far; null for a delivery, or when unknown. */
  attempts: number | null;
  /** When a queued email's next attempt is due, while one is to follow. */
  nextAttemptAt: Date | null;
  /** Whether a delivery's recipient has been erased since. */
  erased: boolean;
}

/** @experimental How the merged Activity is narrowed. */
export interface ActivityFilter {
  status?: DeliveryOutcome | QueuedEmailStanding;
  template?: string;
  /** A provider's registered type. */
  providerType?: string;
  /** Where the provider came from; a row not recorded matches none. */
  providerOrigin?: FilterableOrigin;
  /** Created at or after; a `Date` or an ISO 8601 instant. */
  from?: Date | string;
  /** Created at or before; a `Date` or an ISO 8601 instant. */
  to?: Date | string;
  /** The `meta.nextBefore` of the page before. */
  before?: string;
  /** At most 100; 50 when not given. */
  limit?: number | string;
}

/**
 * @experimental A search of the merged Activity by one exact address, with
 * its filters. Matched by the address's keyed digests, so only a whole
 * address finds anything, however it is cased or written
 * (`Name <address>` included).
 */
export interface AddressSearch extends ActivityFilter {
  address: string;
}

/**
 * What a search by address says beside what it found: records written under
 * a secret no longer configured hold a digest nothing computed now matches.
 */
const ADDRESS_SEARCH_NOTICE =
  "Only records sent under the current secret, or a previous secret still " +
  "configured, can be found by address. Older records can't be found this " +
  "way.";

/**
 * @experimental One page of a search by address, in the list envelope, its
 * `meta.notice` saying which records a search cannot reach
 * (`ADDRESS_SEARCH_NOTICE`).
 */
export interface AddressSearchPage {
  items: ActivityEntry[];
  meta: PaginationMeta & { notice: string };
}

/** @experimental How the queued-email list is narrowed. */
export interface QueuedEmailActivityFilter {
  state?: QueuedEmailStanding;
  template?: string;
  /** Queued at or after; a `Date` or an ISO 8601 instant. */
  from?: Date | string;
  /** Queued at or before; a `Date` or an ISO 8601 instant. */
  to?: Date | string;
  /** The `meta.nextBefore` of the page before. */
  before?: string;
  /** At most 100; 50 when not given. */
  limit?: number | string;
}

/** `input` read by `schema`, or the validation error naming what was wrong. */
function parsed<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw NextlyError.validation({
    errors: result.error.issues.map(issue => ({
      path: issue.path.join(".") || "filter",
      code: "INVALID",
      message: issue.message,
    })),
  });
}

/** Where a page ends: the last record's time and id, newest first. */
interface Cursor {
  at: number;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString(
    "base64url"
  );
}

// Every record's id is a UUID, which PostgreSQL's columns hold as one.
// The time is bounded to what every dialect's columns hold, so a forged
// cursor is refused here rather than reaching a database that cannot store
// it. Queued email keeps epoch milliseconds, which are never negative.
const CURSOR = z.tuple([
  z.number().int().nonnegative().max(LATEST_MS),
  z.string().uuid(),
]);

function decodeCursor(text: string | undefined): Cursor | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    value = undefined;
  }
  const read = CURSOR.safeParse(value);
  if (!read.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "before",
          code: "INVALID",
          message: "Pass back the nextBefore a page answered with.",
        },
      ],
    });
  }
  return { at: read.data[0], id: read.data[1].toLowerCase() };
}

/**
 * One page of `rows`, read one past `limit` to know whether more follow,
 * with the meta every list answers: a cursor walk, so `page` and `total`
 * describe this window, and `nextBefore` reads the next.
 */
function pageOf<R, T>(
  rows: R[],
  limit: number,
  walked: boolean,
  cursorOf: (row: R) => Cursor,
  item: (row: R) => T
): ActivityPage<T> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextBefore =
    rows.length > limit && last !== undefined
      ? encodeCursor(cursorOf(last))
      : undefined;
  return {
    items: page.map(item),
    meta: {
      total: page.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext: nextBefore !== undefined,
      hasPrev: walked,
      ...(nextBefore !== undefined ? { nextBefore } : {}),
    },
  };
}

/** The select chain these reads use, over any dialect's tables. */
interface Chain extends PromiseLike<unknown[]> {
  where(condition: unknown): Chain;
  orderBy(...columns: unknown[]): Chain;
  groupBy(...columns: unknown[]): Chain;
  limit(count: number): Chain;
}
interface ActivityDb {
  select(fields: Record<string, unknown>): { from(table: unknown): Chain };
}

interface QueueRow {
  id: string;
  scope: string;
  state: string;
  jobId: string | null;
  held: unknown;
  failure: string | null;
  templateSlug: string | null;
  messageKind: string | null;
  recipientKinds: string | null;
  providerType: string | null;
  providerId: string | null;
  providerOrigin: string | null;
  providerExists: unknown;
  createdAt: number | string;
  updatedAt: number | string;
  settledAt: number | string | null;
}

interface JobRow {
  id: string;
  attemptCount: number;
  runAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

/** The time a stored epoch-milliseconds value names. */
const epoch = (value: number | string): Date => new Date(Number(value));

/**
 * The Activity reads over one database: the delivery log through its
 * service's reader, queued email and its jobs directly. Built per call, as
 * the routes and the Direct API each have both.
 */
export class EmailDeliveryActivity {
  private readonly dialect: QueueDialect;

  constructor(
    private readonly adapter: DrizzleAdapter,
    private readonly deliveries: EmailDeliveryService
  ) {
    this.dialect = adapter.getCapabilities().dialect;
  }

  // Inside `inSnapshot`, its reads run on the snapshot's transaction.
  private get db(): ActivityDb {
    return adapterForReads(this.adapter).getDrizzle<ActivityDb>();
  }

  /**
   * Run `work`'s reads, this reader's and the delivery reader's, on one
   * snapshot: a transaction that is REPEATABLE READ and read-only on
   * PostgreSQL and MySQL, and on SQLite one that keeps every other
   * transaction out until it ends. The two halves of the merged Activity
   * then describe one moment, never a queued email pruned or sent between
   * them.
   */
  private inSnapshot<T>(work: () => Promise<T>): Promise<T> {
    return this.run(() =>
      this.adapter.transaction(
        tx => runReadsInTransaction(tx, work, "none"),
        this.dialect === "sqlite"
          ? undefined
          : { isolationLevel: "repeatable read", readOnly: true }
      )
    );
  }

  /** Whether the providers table exists (`providersTablePresent`). */
  private providersPresent(): Promise<boolean> {
    return this.run(() =>
      providersTablePresent(this.db as never, this.dialect)
    );
  }

  /** Run a read, turning a driver's failure into the API's error. */
  private async run<T>(read: () => PromiseLike<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof NextlyError) throw error;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
  }

  /**
   * Delivery records, newest first, narrowed by `filter`.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for a filter it cannot read.
   */
  async listDeliveries(
    filter: DeliveryActivityFilter = {}
  ): Promise<ActivityPage<DeliveryActivity>> {
    const options = parsed(DELIVERY_FILTER, filter);
    const after = decodeCursor(options.before);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const records = await this.deliveries.list({
      status: options.outcome,
      templateSlug: options.template,
      providerId: options.providerId,
      providerType: options.providerType,
      from: options.from,
      to: options.to,
      before: after
        ? { createdAt: new Date(after.at), id: after.id }
        : undefined,
      limit: limit + 1,
    });
    return pageOf(
      records,
      limit,
      after !== undefined,
      record => ({ at: record.createdAt.getTime(), id: record.id }),
      deliveryOf
    );
  }

  /**
   * Queued emails, newest first, narrowed by `filter`.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for a filter it cannot read.
   */
  async listQueuedEmails(
    filter: QueuedEmailActivityFilter = {}
  ): Promise<ActivityPage<QueuedEmailActivity>> {
    const options = parsed(QUEUED_FILTER, filter);
    const after = decodeCursor(options.before);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const queue = loadedDialect(this.dialect).tables.emailQueue;
    const conditions = queueWindow(queue, options.state, options, after);

    const rows = await this.queueRows(conditions, limit + 1);
    const jobs = await this.jobsOf(
      rows.slice(0, limit).flatMap(row => (row.jobId ? [row.jobId] : []))
    );
    return pageOf(
      rows,
      limit,
      after !== undefined,
      row => ({ at: Number(row.createdAt), id: row.id }),
      row => queuedOf(row, row.jobId ? jobs.get(row.jobId) : undefined)
    );
  }

  /** Queued email rows matching every one of `conditions`, newest first. */
  private async queueRows(
    conditions: SQL[],
    limit: number
  ): Promise<QueueRow[]> {
    const queue = loadedDialect(this.dialect).tables.emailQueue;
    const present = await this.providersPresent();
    return (await this.run(() =>
      this.db
        .select({
          id: queue.id,
          scope: queue.scope,
          state: queue.state,
          jobId: queue.jobId,
          // Whether a message is held, never the message.
          held: isNotNull(queue.message),
          failure: queue.failure,
          templateSlug: queue.templateSlug,
          messageKind: queue.messageKind,
          recipientKinds: queue.recipientKinds,
          providerType: queue.providerType,
          providerId: queue.providerId,
          providerOrigin: queue.providerOrigin,
          // Read with the row, as the origin filter tests it.
          providerExists: providerExists(queue, this.dialect, present),
          createdAt: queue.createdAt,
          updatedAt: queue.updatedAt,
          settledAt: queue.settledAt,
        })
        .from(queue)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(queue.createdAt), desc(queue.id))
        .limit(limit)
    )) as QueueRow[];
  }

  /**
   * One delivery record, with the timeline of attempts it belongs to: for
   * an attempt of a queued email, that email's attempts to the same
   * recipient, oldest first; else the record alone. Null for an id that
   * names none, whatever its shape.
   */
  async findDelivery(given: string): Promise<DeliveryDetail | null> {
    if (!isUuid(given)) return null;
    const id = given.toLowerCase();
    const [record] = await this.deliveries.list({ id, limit: 1 });
    if (!record) return null;
    // Its queued email's every attempt, each with its recipient's kind, and
    // this record among them by its id. Not narrowed to one recipient: a
    // recipient's digest changes when the secret rotates and is gone once it
    // is erased, so nothing on the records says which were the same person.
    const { records, truncated } = record.queuedId
      ? await this.timelineOf(record.queuedId)
      : { records: [record], truncated: false };
    return {
      ...deliveryOf(record),
      timeline: [...records].reverse().map(attemptOf),
      timelineTruncated: truncated,
    };
  }

  /**
   * One queued email, with every delivery its attempts recorded, oldest
   * first, whether its last failure came from its template, and the
   * template version its latest attempt sent. Null for an id that names
   * none, whatever its shape.
   */
  async findQueuedEmail(given: string): Promise<QueuedEmailDetail | null> {
    if (!isUuid(given)) return null;
    const id = given.toLowerCase();
    const queue = loadedDialect(this.dialect).tables.emailQueue;
    const [row] = await this.queueRows([eq(queue.id, id)], 1);
    if (!row) return null;
    const jobs = await this.jobsOf(row.jobId ? [row.jobId] : []);
    const { records, truncated } = await this.timelineOf(row.id);
    const attempts = [...records].reverse();
    const latest = attempts.at(-1);
    return {
      ...queuedOf(row, row.jobId ? jobs.get(row.jobId) : undefined),
      templateCaused: templateCausedOf(row.failure),
      templateVersion: latest ? latest.templateVersion : null,
      timeline: attempts.map(attemptOf),
      timelineTruncated: truncated,
    };
  }

  /**
   * Every delivery record of a queued email, newest first, read a page at a
   * time up to `MAX_TIMELINE_ROWS`; past it, the newest are kept and the
   * answer says it stopped.
   */
  private async timelineOf(
    queuedId: string
  ): Promise<{ records: EmailDeliveryRecord[]; truncated: boolean }> {
    const records: EmailDeliveryRecord[] = [];
    let before: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const page = await this.deliveries.list({
        queuedId,
        before,
        limit: TIMELINE_PAGE + 1,
      });
      records.push(...page.slice(0, TIMELINE_PAGE));
      if (page.length <= TIMELINE_PAGE) {
        return { records, truncated: false };
      }
      if (records.length >= MAX_TIMELINE_ROWS) {
        return {
          records: records.slice(0, MAX_TIMELINE_ROWS),
          truncated: true,
        };
      }
      const last = records[records.length - 1];
      before = { createdAt: last.createdAt, id: last.id };
    }
  }

  /** The attempt counts and due times of the jobs `ids`, by id. */
  private async jobsOf(ids: string[]): Promise<Map<string, JobRow>> {
    if (ids.length === 0) return new Map();
    const jobs = loadedDialect(this.dialect).tables.nextlyJobs;
    const rows = (await this.run(() =>
      this.db
        .select({
          id: jobs.id,
          attemptCount: jobs.attemptCount,
          runAt: jobs.runAt,
          nextAttemptAt: jobs.nextAttemptAt,
          createdAt: jobs.createdAt,
        })
        .from(jobs)
        .where(inArray(jobs.id, ids))
    )) as JobRow[];
    return new Map(rows.map(row => [row.id, row]));
  }

  /**
   * When each template was last sent: the newest delivery recorded `sent`
   * for it. Every template that has been sent, or only those among `slugs`.
   * The log is pruned by age, so a template is left out when it has not
   * been sent since `keptSince`, which the answer says.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for more than 200 slugs.
   */
  async lastSentByTemplate(
    slugs?: readonly string[]
  ): Promise<TemplatesLastSent> {
    const names =
      slugs === undefined ? undefined : parsed(SLUGS, [...new Set(slugs)]);
    const keptSince = this.deliveries.keptSince();
    if (names?.length === 0) return { templates: [], keptSince };
    const table = deliveriesTableFor(this.dialect);
    const rows = (await this.run(() =>
      this.db
        .select({
          slug: table.templateSlug,
          lastSentAt: max(table.createdAt),
        })
        .from(table)
        .where(
          and(
            eq(table.status, "sent"),
            names
              ? inArray(table.templateSlug, names)
              : isNotNull(table.templateSlug)
          )
        )
        .groupBy(table.templateSlug)
    )) as Array<{ slug: string; lastSentAt: Date | string | number }>;
    const templates = rows
      .map(row => ({
        slug: row.slug,
        lastSentAt:
          row.lastSentAt instanceof Date
            ? row.lastSentAt
            : new Date(row.lastSentAt),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return { templates, keptSince };
  }

  /**
   * The merged Activity, newest first: every queued email, and every
   * delivery of a send that was not queued, under one cursor and one set of
   * filters. Each side is filtered, ordered and limited in the database, one
   * page past the limit, and the two pages are merged by time and id, which
   * is the order the cursor walks.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for a filter it cannot read.
   */
  async listActivity(
    filter: ActivityFilter = {}
  ): Promise<ActivityPage<ActivityEntry>> {
    return this.activityPage(parsed(ACTIVITY_FILTER, filter));
  }

  /**
   * The merged Activity narrowed to one exact address: the deliveries of
   * sends not queued that went to it, and the queued emails it is a
   * recipient of, or that a delivery to it belongs to, under the merged
   * Activity's cursor and filters. Found by the address's digests under
   * the current and previous secrets; older records are not found, which
   * the answer's `meta.notice` says.
   *
   * The search is recorded in the activity log as `actor`'s, with how many
   * it found and never the address. When that record cannot be written the
   * search is not answered.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for an address or filter it
   * cannot read; `INTERNAL_ERROR` when the search could not be recorded.
   */
  async searchByAddress(
    // Or a body as a route received it, which the search's schema reads.
    search: AddressSearch | Readonly<Record<string, unknown>>,
    actor?: RequestActor | null
  ): Promise<AddressSearchPage> {
    const { address, ...filter } = parsed(ADDRESS_SEARCH, search);
    // A precondition: a search no entry could name is refused before it
    // reads anything.
    if (!searchRecordable(actor)) {
      throw NextlyError.validation({
        errors: [
          {
            path: "user",
            code: "INVALID",
            message:
              "A search by address is recorded by who made it: name the user making it.",
          },
        ],
      });
    }
    let page: ActivityPage<ActivityEntry>;
    try {
      page = await this.activityPage(filter, address);
    } catch (error) {
      throw searchFailure(error);
    }
    try {
      await recordAddressSearch({ actor, found: page.items.length });
    } catch (error) {
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: { reason: "address-search-not-recorded" },
      });
    }
    return {
      items: page.items,
      meta: { ...page.meta, notice: ADDRESS_SEARCH_NOTICE },
    };
  }

  /**
   * One page of the merged Activity under `options`, narrowed to
   * `address`'s records when one is given, read on one snapshot.
   */
  private activityPage(
    options: z.infer<typeof ACTIVITY_FILTER>,
    address?: string
  ): Promise<ActivityPage<ActivityEntry>> {
    const after = decodeCursor(options.before);
    return this.inSnapshot(() => this.readPage(options, after, address));
  }

  /** {@link activityPage}'s reads. */
  private async readPage(
    options: z.infer<typeof ACTIVITY_FILTER>,
    after: Cursor | undefined,
    address: string | undefined
  ): Promise<ActivityPage<ActivityEntry>> {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const outcome =
      options.status === "sent" || options.status === "failed"
        ? options.status
        : undefined;
    // Both read on one snapshot (`inSnapshot`): an email settled and pruned
    // meanwhile is either the queued row or its deliveries, never both or
    // neither.
    const queued = await this.queuedEntries(options, after, limit + 1, address);
    // A state only a queued email can be in matches no delivery.
    const deliveries =
      options.status !== undefined && outcome === undefined
        ? []
        : await this.deliveries.list({
            standalone: true,
            // Hashed by the delivery reader, as every lookup by address is.
            recipient: address,
            status: outcome,
            templateSlug: options.template,
            providerType: options.providerType,
            providerOrigin: options.providerOrigin,
            from: options.from,
            to: options.to,
            before: after
              ? { createdAt: new Date(after.at), id: after.id }
              : undefined,
            limit: limit + 1,
          });
    const entries = [...deliveries.map(deliveryEntry), ...queued]
      .sort(newestFirst)
      .slice(0, limit + 1);
    return pageOf(
      entries,
      limit,
      after !== undefined,
      entry => ({ at: entry.createdAt.getTime(), id: entry.id }),
      entry => entry
    );
  }

  /** The queued emails of one merged page, as its rows. */
  private async queuedEntries(
    options: z.infer<typeof ACTIVITY_FILTER>,
    after: Cursor | undefined,
    limit: number,
    address: string | undefined
  ): Promise<ActivityEntry[]> {
    const queue = loadedDialect(this.dialect).tables.emailQueue;
    const present = await this.providersPresent();
    const conditions = [
      ...queueWindow(queue, options.status, options, after),
      ...this.providerConditions(queue, options, present),
      ...(address !== undefined ? [this.sentTo(queue, address)] : []),
    ];
    const rows = await this.queueRows(conditions, limit);
    const jobs = await this.jobsOf(
      rows.flatMap(row => (row.jobId ? [row.jobId] : []))
    );
    return rows.map(row =>
      queuedEntry(row, row.jobId ? jobs.get(row.jobId) : undefined)
    );
  }

  /** The merged Activity's provider filters, on the queue's columns. */
  private providerConditions(
    queue: QueueTable,
    options: z.infer<typeof ACTIVITY_FILTER>,
    present: boolean
  ): SQL[] {
    const conditions: SQL[] = [];
    if (options.providerType) {
      conditions.push(eq(queue.providerType, options.providerType));
      // By its exact bytes on MySQL, as the delivery reader compares it.
      if (this.dialect === "mysql") {
        conditions.push(
          sql`CAST(${queue.providerType} AS BINARY) = CAST(${options.providerType} AS BINARY)`
        );
      }
    }
    if (options.providerOrigin) {
      conditions.push(
        originCondition(queue, options.providerOrigin, this.dialect, present)
      );
    }
    return conditions;
  }

  /**
   * The queued emails `address` is a recipient of, or that a delivery to it
   * belongs to: a recipient a send filter added has a delivery and no
   * recipient row. Matched by every digest the address could have been
   * stored under; an erased or pruned email's recipients are gone, so it is
   * not found.
   */
  private sentTo(queue: QueueTable, address: string): SQL {
    const digests = recipientDigests(address);
    const recipients = loadedDialect(this.dialect).tables.emailQueueRecipients;
    const deliveries = deliveriesTableFor(this.dialect);
    return sql`(${queue.id} in (select ${recipients.queuedId} from ${recipients} where ${inArray(recipients.recipientHash, digests)}) or ${queue.id} in (select ${deliveries.queuedId} from ${deliveries} where ${inArray(deliveries.recipientHash, digests)}))`;
  }

  /**
   * How many queued emails are more than 15 minutes past due, which means
   * the jobs trigger is not running (`queued-email-warning`).
   */
  async overdue(now: Date = new Date()): Promise<QueuedEmailOverdue> {
    const count = await this.run(() => lateQueuedEmails(this.adapter, now));
    return {
      // Counted one past the ceiling, so an exact ceiling is not capped.
      overdue: Math.min(count, LATE_QUEUED_EMAIL_COUNTED),
      capped: count > LATE_QUEUED_EMAIL_COUNTED,
      warningAfterMinutes: LATE_QUEUED_EMAIL_MS / 60_000,
    };
  }
}

/**
 * A delivery record as Activity lists it: each field named, and nothing
 * personal. Its digest is read only to say whether it was erased.
 */
function deliveryOf(record: EmailDeliveryRecord): DeliveryActivity {
  return {
    id: record.id,
    createdAt: record.createdAt,
    outcome: record.status,
    templateSlug: record.templateSlug,
    provider: record.provider,
    recipientKind: record.recipientKind,
    failureReason: record.status === "sent" ? null : record.error,
    namedPerson: record.namedPerson,
    // The reader gives an erased recipient's digest as null.
    erased: record.recipientHash === null,
    queuedId: record.queuedId,
    templateVersion: record.templateVersion,
    failureKind: record.failure?.kind ?? null,
    failureStatus: record.failure?.status ?? null,
  };
}

/** A delivery record as one attempt on a timeline. */
function attemptOf(record: EmailDeliveryRecord): DeliveryAttempt {
  const delivery = deliveryOf(record);
  return {
    id: delivery.id,
    createdAt: delivery.createdAt,
    outcome: delivery.outcome,
    recipientKind: delivery.recipientKind,
    provider: delivery.provider,
    failureKind: delivery.failureKind,
    failureStatus: delivery.failureStatus,
    failureReason: delivery.failureReason,
    templateVersion: delivery.templateVersion,
    erased: delivery.erased,
  };
}

const UUID = z.string().uuid();

/** Whether `id` can name a record: every one is a UUID. */
function isUuid(id: string): boolean {
  return UUID.safeParse(id).success;
}

/** A queued email's row and its job as Activity lists them. */
function queuedOf(row: QueueRow, job: JobRow | undefined): QueuedEmailActivity {
  const state = standingOf(row);
  return {
    id: row.id,
    createdAt: epoch(row.createdAt),
    updatedAt: epoch(row.updatedAt),
    settledAt: row.settledAt === null ? null : epoch(row.settledAt),
    state,
    attempts: attemptsOf(row, job),
    nextAttemptAt: nextAttemptOf(state, job),
    lastFailure: storedFailureOf(row.failure) ?? null,
    messageHeld: isHeld(row.held),
    templateSlug: row.templateSlug,
    queuedBy: row.scope,
  };
}

/**
 * When a queued email's next attempt is due, while one is to follow: its
 * job's retry time, else its schedule, else its creation, as the job queue
 * reads them.
 */
function nextAttemptOf(
  state: QueuedEmailStanding,
  job: JobRow | undefined
): Date | null {
  if (!job || (state !== "waiting" && state !== "retrying")) return null;
  return job.nextAttemptAt ?? job.runAt ?? job.createdAt;
}

/**
 * How many attempts a queued email's job has made: none for one stored with
 * no job, and unknown (null) once its job has been pruned, which a jobs run
 * with a shorter retention than the queue's can do.
 */
function attemptsOf(row: QueueRow, job: JobRow | undefined): number | null {
  if (job) return Number(job.attemptCount);
  return row.jobId === null ? 0 : null;
}

/** Whether a message is held: a boolean on PostgreSQL, 0 or 1 elsewhere. */
function isHeld(held: unknown): boolean {
  return held === true || Number(held) === 1;
}

/** Newest first, then by id, as every list here and its cursor order rows. */
function newestFirst(a: ActivityEntry, b: ActivityEntry): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** A delivery of a send that was not queued, as a merged row. */
function deliveryEntry(record: EmailDeliveryRecord): ActivityEntry {
  return {
    kind: "delivery",
    id: record.id,
    createdAt: record.createdAt,
    status: record.status,
    // A record from before versions knows its slug, never that it had none.
    template: record.templateSlug
      ? { slug: record.templateSlug }
      : record.templateVersion === "none"
        ? "none"
        : "not-recorded",
    provider: record.provider,
    recipientKinds: [record.recipientKind],
    failureReason: record.status === "sent" ? null : record.error,
    attempts: null,
    nextAttemptAt: null,
    erased: record.recipientHash === null,
  };
}

const RECIPIENT_KINDS = new Set(["to", "cc", "bcc"]);

/** A queued email as a merged row. */
function queuedEntry(row: QueueRow, job: JobRow | undefined): ActivityEntry {
  const activity = queuedOf(row, job);
  return {
    kind: "queued",
    id: row.id,
    createdAt: activity.createdAt,
    status: activity.state,
    template:
      row.messageKind === "message"
        ? "none"
        : row.templateSlug
          ? { slug: row.templateSlug }
          : "not-recorded",
    provider:
      row.providerType === null
        ? null
        : providerRead(
            row.providerType,
            row.providerId,
            row.providerOrigin,
            row.providerExists
          ),
    recipientKinds:
      row.recipientKinds === null
        ? null
        : (row.recipientKinds
            .split(",")
            .filter(kind =>
              RECIPIENT_KINDS.has(kind)
            ) as EmailDeliveryRecipientKind[]),
    failureReason: activity.lastFailure?.reason ?? null,
    attempts: activity.attempts,
    nextAttemptAt: activity.nextAttemptAt,
    erased: false,
  };
}

type QueueTable = ReturnType<typeof loadedDialect>["tables"]["emailQueue"];

/**
 * A failed search's error with nothing of its query: a driver's error
 * quotes its statement's parameters, and a search's are the address's
 * digests. A refusal of what was asked is the caller's to read, and passes.
 */
function searchFailure(error: unknown): NextlyError {
  if (error instanceof NextlyError && error.code === "VALIDATION_ERROR") {
    return error;
  }
  return NextlyError.internal({
    logContext: {
      reason: "address-search-failed",
      ...(error instanceof NextlyError ? { code: error.code } : {}),
    },
  });
}

/**
 * What both queue lists narrow by alike: the state, the template, the time
 * window and the cursor, each when given.
 */
function queueWindow(
  queue: QueueTable,
  state: QueuedEmailStanding | undefined,
  options: { template?: string; from?: Date; to?: Date },
  after: Cursor | undefined
): SQL[] {
  return [
    stateCondition(queue, state),
    options.template ? eq(queue.templateSlug, options.template) : undefined,
    options.from ? gte(queue.createdAt, options.from.getTime()) : undefined,
    options.to ? lte(queue.createdAt, options.to.getTime()) : undefined,
    after
      ? or(
          lt(queue.createdAt, after.at),
          and(eq(queue.createdAt, after.at), lt(queue.id, after.id))
        )
      : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);
}

/** The condition for a queued email's state as its reader names it. */
function stateCondition(
  queue: QueueTable,
  state: QueuedEmailStanding | undefined
): SQL | undefined {
  if (state === undefined) return undefined;
  // Retrying is waiting with a failure recorded (`queued-send-read`).
  if (state === "waiting") {
    return and(eq(queue.state, "waiting"), isNull(queue.failure));
  }
  if (state === "retrying") {
    return and(eq(queue.state, "waiting"), isNotNull(queue.failure));
  }
  return eq(queue.state, state);
}

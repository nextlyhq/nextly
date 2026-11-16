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
  type SQL,
} from "drizzle-orm";
import { z } from "zod";

import type { PaginationMeta } from "../../api/response-shapes";
import { loadedDialect } from "../../database/dialect-tables";
import { toDbError } from "../../database/errors";
import { NextlyError } from "../../errors";

import { deliveriesTableFor } from "./deliveries-table";
import type {
  DeliveryFailureKind,
  DeliveryTemplateVersion,
  EmailDeliveryRecipientKind,
  EmailDeliveryStatus,
} from "./delivery-record";
import type { EmailFailure } from "./failure";
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
   * The stored provider that carried it, when one still exists, and its
   * registered type, which outlives it.
   */
  provider: { id: string | null; type: string };
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
  provider: { id: string | null; type: string };
  /** The provider's answer, structured: never its own text. */
  failureKind: DeliveryFailureKind | null;
  failureStatus: number | null;
  /** Core's sentence for the failure, with anything address-shaped removed. */
  failureReason: string | null;
  /** The provider's own id for the message, when it gave one. */
  providerMessageId: string | null;
  templateVersion: DeliveryTemplateVersionRead;
  erased: boolean;
}

/** @experimental A delivery's detail sheet. */
export interface DeliveryDetail extends DeliveryActivity {
  providerMessageId: string | null;
  /** Its attempts, oldest first: the queued email's, or itself alone. */
  timeline: DeliveryAttempt[];
}

/** @experimental A queued email's detail sheet. */
export interface QueuedEmailDetail extends QueuedEmailActivity {
  /** Whether its last failure came from its template, for "Fix template". */
  templateCaused: boolean;
  /** The template version its latest attempt sent; null before any. */
  templateVersion: DeliveryTemplateVersionRead | null;
  /** Every delivery its attempts recorded, oldest first. */
  timeline: DeliveryAttempt[];
}

/** @experimental One queued email, as Activity lists it. */
export interface QueuedEmailActivity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  /** When it was sent, failed for good, or was cancelled. */
  settledAt: Date | null;
  state: QueuedEmailStanding;
  /** Attempts made so far, the one in flight included. */
  attempts: number;
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
/** The most delivery records one timeline reads. */
const MAX_ATTEMPT_ROWS = 500;
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

  private get db(): ActivityDb {
    return this.adapter.getDrizzle<ActivityDb>();
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
    const conditions = [
      stateCondition(queue, options.state),
      options.template ? eq(queue.templateSlug, options.template) : undefined,
      options.from ? gte(queue.createdAt, options.from.getTime()) : undefined,
      options.to ? lte(queue.createdAt, options.to.getTime()) : undefined,
      after
        ? or(
            lt(queue.createdAt, after.at),
            and(eq(queue.createdAt, after.at), lt(queue.id, after.id))
          )
        : undefined,
    ].filter(condition => condition !== undefined);

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
    const timeline = record.queuedId
      ? (
          await this.deliveries.list({
            queuedId: record.queuedId,
            limit: MAX_ATTEMPT_ROWS,
          })
        ).filter(
          other =>
            other.recipientKind === record.recipientKind &&
            other.recipientHash === record.recipientHash
        )
      : [record];
    return {
      ...deliveryOf(record),
      providerMessageId: record.messageId,
      timeline: [...timeline].reverse().map(attemptOf),
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
    const attempts = [
      ...(await this.deliveries.list({
        queuedId: row.id,
        limit: MAX_ATTEMPT_ROWS,
      })),
    ].reverse();
    const latest = attempts.at(-1);
    return {
      ...queuedOf(row, row.jobId ? jobs.get(row.jobId) : undefined),
      templateCaused: templateCausedOf(row.failure),
      templateVersion: latest ? latest.templateVersion : null,
      timeline: attempts.map(attemptOf),
    };
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
    provider: { id: record.providerId, type: record.providerType },
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
    providerMessageId: record.messageId,
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
    attempts: job ? Number(job.attemptCount) : 0,
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

/** Whether a message is held: a boolean on PostgreSQL, 0 or 1 elsewhere. */
function isHeld(held: unknown): boolean {
  return held === true || Number(held) === 1;
}

type QueueTable = ReturnType<typeof loadedDialect>["tables"]["emailQueue"];

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

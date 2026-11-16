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

import { loadedDialect } from "../../database/dialect-tables";
import { toDbError } from "../../database/errors";
import { NextlyError } from "../../errors";

import { deliveriesTableFor } from "./deliveries-table";
import {
  isErasedRecipientHash,
  type EmailDeliveryRecipientKind,
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
  type QueueDialect,
  type QueuedEmailStanding,
} from "./queued-send-read";

/** @experimental What happened to one recipient of one send. */
export type DeliveryOutcome = "sent" | "failed";

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

/** @experimental One page of a list, and where the next one starts. */
export interface ActivityPage<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/** @experimental When one template was last sent. */
export interface TemplateLastSent {
  slug: string;
  lastSentAt: Date;
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
/** The most templates one last-sent read names. */
const MAX_SLUGS = 200;

/** A time a caller gives: a `Date`, or an ISO 8601 instant. */
const instant = z.union([
  z.date(),
  z
    .string()
    .datetime({ offset: true })
    .transform(value => new Date(value)),
]);

const common = {
  template: z.string().min(1).max(255).optional(),
  from: instant.optional(),
  to: instant.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
};

const DELIVERY_FILTER = z.object({
  outcome: z.enum(["sent", "failed"]).optional(),
  providerId: z.string().min(1).max(36).optional(),
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
  cursor?: string;
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
  cursor?: string;
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

const CURSOR = z.tuple([z.number().int().nonnegative(), z.string().min(1)]);

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
          path: "cursor",
          code: "INVALID",
          message: "Pass back the cursor a page answered with.",
        },
      ],
    });
  }
  return { at: read.data[0], id: read.data[1] };
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

interface DeliveryRow {
  id: string;
  createdAt: Date;
  status: string;
  templateSlug: string | null;
  providerId: string | null;
  providerType: string;
  recipientKind: string;
  error: string | null;
  principalKind: string | null;
  recipientHash: string;
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
 * The Activity reads over one database. Built per call from the adapter, as
 * the routes and the Direct API each have one.
 */
export class EmailDeliveryActivity {
  private readonly dialect: QueueDialect;

  constructor(private readonly adapter: DrizzleAdapter) {
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
    const after = decodeCursor(options.cursor);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const table = deliveriesTableFor(this.dialect);
    const conditions = [
      options.outcome ? eq(table.status, options.outcome) : undefined,
      options.template ? eq(table.templateSlug, options.template) : undefined,
      options.providerId ? eq(table.providerId, options.providerId) : undefined,
      options.providerType
        ? eq(table.providerType, options.providerType)
        : undefined,
      options.from ? gte(table.createdAt, options.from) : undefined,
      options.to ? lte(table.createdAt, options.to) : undefined,
      after
        ? or(
            lt(table.createdAt, new Date(after.at)),
            and(eq(table.createdAt, new Date(after.at)), lt(table.id, after.id))
          )
        : undefined,
    ].filter(condition => condition !== undefined);

    const rows = (await this.run(() =>
      this.db
        .select({
          id: table.id,
          createdAt: table.createdAt,
          status: table.status,
          templateSlug: table.templateSlug,
          providerId: table.providerId,
          providerType: table.providerType,
          recipientKind: table.recipientKind,
          error: table.error,
          principalKind: table.principalKind,
          // Read to say whether it was erased, and never returned.
          recipientHash: table.recipientHash,
        })
        .from(table)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(table.createdAt), desc(table.id))
        .limit(limit + 1)
    )) as DeliveryRow[];

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(deliveryOf),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: last.createdAt.getTime(), id: last.id })
          : null,
    };
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
    const after = decodeCursor(options.cursor);
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

    const rows = (await this.run(() =>
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
        .limit(limit + 1)
    )) as QueueRow[];

    const page = rows.slice(0, limit);
    const jobs = await this.jobsOf(
      page.flatMap(row => (row.jobId ? [row.jobId] : []))
    );
    const last = page.at(-1);
    return {
      items: page.map(row =>
        queuedOf(row, row.jobId ? jobs.get(row.jobId) : undefined)
      ),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ at: Number(last.createdAt), id: last.id })
          : null,
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
   * A template never sent is left out.
   *
   * @throws {NextlyError} `VALIDATION_ERROR` for more than 200 slugs.
   */
  async lastSentByTemplate(
    slugs?: readonly string[]
  ): Promise<TemplateLastSent[]> {
    const names =
      slugs === undefined ? undefined : parsed(SLUGS, [...new Set(slugs)]);
    if (names?.length === 0) return [];
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
    return rows
      .map(row => ({
        slug: row.slug,
        lastSentAt:
          row.lastSentAt instanceof Date
            ? row.lastSentAt
            : new Date(row.lastSentAt),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * How many queued emails are more than 15 minutes past due, which means
   * the jobs trigger is not running (`queued-email-warning`).
   */
  async overdue(now: Date = new Date()): Promise<QueuedEmailOverdue> {
    const count = await this.run(() => lateQueuedEmails(this.adapter, now));
    return {
      overdue: count,
      capped: count >= LATE_QUEUED_EMAIL_COUNTED,
      warningAfterMinutes: LATE_QUEUED_EMAIL_MS / 60_000,
    };
  }
}

/** A delivery row as Activity lists it: each field named, nothing personal. */
function deliveryOf(row: DeliveryRow): DeliveryActivity {
  return {
    id: row.id,
    createdAt: row.createdAt,
    outcome: row.status === "sent" ? "sent" : "failed",
    templateSlug: row.templateSlug,
    provider: { id: row.providerId, type: row.providerType },
    recipientKind: row.recipientKind as EmailDeliveryRecipientKind,
    failureReason: row.status === "sent" ? null : row.error,
    namedPerson: row.principalKind !== null,
    erased: isErasedRecipientHash(row.recipientHash),
  };
}

/** A queued email's row and its job as Activity lists them. */
function queuedOf(row: QueueRow, job: JobRow | undefined): QueuedEmailActivity {
  const state = standingOf(row);
  const awaiting = state === "waiting" || state === "retrying";
  return {
    id: row.id,
    createdAt: epoch(row.createdAt),
    updatedAt: epoch(row.updatedAt),
    settledAt: row.settledAt === null ? null : epoch(row.settledAt),
    state,
    attempts: job ? Number(job.attemptCount) : 0,
    nextAttemptAt:
      awaiting && job
        ? (job.nextAttemptAt ?? job.runAt ?? job.createdAt)
        : null,
    lastFailure: storedFailureOf(row.failure) ?? null,
    messageHeld: row.held === true || Number(row.held) === 1,
    templateSlug: row.templateSlug,
    queuedBy: row.scope,
  };
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

/**
 * Webhook domain — delivery read service.
 *
 * Backs the admin delivery log: lists an endpoint's delivery attempts and reads
 * one delivery's attempt history. Read-only; the drain owns every write to
 * `nextly_webhook_deliveries`. Each delivery row carries only its `event_id`, so
 * the event type and resource come from a join to `nextly_events`.
 *
 * Nothing here is credential-bearing: a delivery row records retry state, the
 * last response status/latency/error, a truncated response snippet, and a
 * per-attempt log of `{ at, outcome, statusCode, latencyMs, error }`. The
 * request headers actually sent (which may include a receiver credential) are
 * never persisted, so this read surface cannot leak one.
 *
 * @module domains/webhooks/services/webhook-delivery-query-service
 */

import { and, count, desc, eq } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import {
  nextlyEvents as eventsMysql,
  nextlyWebhookDeliveries as deliveriesMysql,
} from "../../../schemas/webhooks/mysql";
import {
  nextlyEvents as eventsPg,
  nextlyWebhookDeliveries as deliveriesPg,
} from "../../../schemas/webhooks/postgres";
import {
  nextlyEvents as eventsSqlite,
  nextlyWebhookDeliveries as deliveriesSqlite,
} from "../../../schemas/webhooks/sqlite";
import { BaseService } from "../../../shared/base-service";
import { dbTimestampToInstant } from "../../../shared/lib/date-formatting";

type DeliveriesTable =
  | typeof deliveriesPg
  | typeof deliveriesMysql
  | typeof deliveriesSqlite;
type EventsTable = typeof eventsPg | typeof eventsMysql | typeof eventsSqlite;

/** Lifecycle state of a delivery, mirroring the drain's status vocabulary. */
export type WebhookDeliveryStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "retrying"
  | "failed";

/** The resource an event was about, surfaced from the joined event row. */
export interface WebhookDeliveryResource {
  kind: string;
  collection: string | null;
  id: string | null;
}

/** One recorded attempt, as stored on the delivery row's `attempts` log. */
export interface WebhookDeliveryAttempt {
  at: string;
  outcome: string;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

/** A delivery as the log list shows it (joined to its event). */
export interface WebhookDeliverySummary {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  resource: WebhookDeliveryResource;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** When the next retry is due, or null when the delivery is terminal. */
  nextAttemptAt: Date | null;
  /** When the underlying event was recorded (event row's created_at). */
  eventCreatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** A single delivery with its full attempt history and response snippet. */
export interface WebhookDeliveryDetail extends WebhookDeliverySummary {
  attempts: WebhookDeliveryAttempt[];
  /** Truncated response body from the last attempt, or null. */
  lastResponseSnippet: string | null;
}

/** Filters and paging for a delivery list. `page`/`limit` are 1-based/bounded. */
export interface ListDeliveriesOptions {
  page: number;
  limit: number;
  status?: WebhookDeliveryStatus;
  eventType?: string;
}

/** The joined row shape the fluent builder returns for a delivery + its event. */
interface DeliveryJoinRow {
  id: string;
  webhookId: string;
  eventId: string;
  status: string;
  attemptCount: number;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastResponseSnippet: string | null;
  attempts: unknown;
  nextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  eventType: string;
  resourceKind: string;
  resourceCollection: string | null;
  resourceId: string | null;
  eventCreatedAt: Date;
}

export class WebhookDeliveryQueryService extends BaseService {
  private readonly deliveries: DeliveriesTable;
  private readonly events: EventsTable;

  constructor(
    adapter: ConstructorParameters<typeof BaseService>[0],
    logger: ConstructorParameters<typeof BaseService>[1]
  ) {
    super(adapter, logger);
    switch (this.adapter.getCapabilities().dialect) {
      case "postgresql":
        this.deliveries = deliveriesPg;
        this.events = eventsPg;
        break;
      case "mysql":
        this.deliveries = deliveriesMysql;
        this.events = eventsMysql;
        break;
      default:
        this.deliveries = deliveriesSqlite;
        this.events = eventsSqlite;
        break;
    }
  }

  /**
   * Turn a driver error into the canonical envelope so a raw driver exception
   * never escapes `packages/nextly`.
   */
  private async query<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof NextlyError) throw err;
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
  }

  /** The columns pulled from the delivery+event join, shared by list and get. */
  private get selection() {
    return {
      id: this.deliveries.id,
      webhookId: this.deliveries.webhookId,
      eventId: this.deliveries.eventId,
      status: this.deliveries.status,
      attemptCount: this.deliveries.attemptCount,
      lastStatusCode: this.deliveries.lastStatusCode,
      lastLatencyMs: this.deliveries.lastLatencyMs,
      lastError: this.deliveries.lastError,
      lastResponseSnippet: this.deliveries.lastResponseSnippet,
      attempts: this.deliveries.attempts,
      nextAttemptAt: this.deliveries.nextAttemptAt,
      createdAt: this.deliveries.createdAt,
      updatedAt: this.deliveries.updatedAt,
      eventType: this.events.type,
      resourceKind: this.events.resourceKind,
      resourceCollection: this.events.resourceCollection,
      resourceId: this.events.resourceId,
      eventCreatedAt: this.events.createdAt,
    };
  }

  /** WHERE fragments shared by the list page query and its count. */
  private listConditions(webhookId: string, opts: ListDeliveriesOptions) {
    const conditions = [eq(this.deliveries.webhookId, webhookId)];
    if (opts.status) {
      conditions.push(eq(this.deliveries.status, opts.status));
    }
    if (opts.eventType) {
      conditions.push(eq(this.events.type, opts.eventType));
    }
    return and(...conditions);
  }

  /**
   * A page of an endpoint's deliveries, newest first, plus the total for paging.
   *
   * Scoped by `webhookId` alone: deliveries outlive their endpoint (a retired
   * endpoint keeps its history), so this deliberately does not require the
   * endpoint to still be live.
   */
  async listDeliveries(
    webhookId: string,
    opts: ListDeliveriesOptions
  ): Promise<{ items: WebhookDeliverySummary[]; total: number }> {
    const where = this.listConditions(webhookId, opts);
    const offset = (opts.page - 1) * opts.limit;

    const { rows, total } = await this.query(async () => {
      const countRows = (await this.db
        .select({ value: count() })
        .from(this.deliveries)
        .innerJoin(this.events, eq(this.deliveries.eventId, this.events.id))
        .where(where)) as Array<{ value: number | string | bigint }>;

      const pageRows = (await this.db
        .select(this.selection)
        .from(this.deliveries)
        .innerJoin(this.events, eq(this.deliveries.eventId, this.events.id))
        .where(where)
        // The id tiebreaker keeps offset paging stable when several deliveries
        // share a created_at: without it, adjacent pages could duplicate or
        // skip rows the database returns in an arbitrary order within a tie.
        .orderBy(desc(this.deliveries.createdAt), desc(this.deliveries.id))
        .limit(opts.limit)
        .offset(offset)) as DeliveryJoinRow[];

      // count() returns string/bigint on some drivers; coerce to a number.
      return { rows: pageRows, total: Number(countRows[0]?.value ?? 0) };
    });

    return { items: rows.map(row => this.toSummary(row)), total };
  }

  /**
   * One delivery with its attempt history, or null when no delivery with this
   * id belongs to this endpoint.
   */
  async getDelivery(
    webhookId: string,
    deliveryId: string
  ): Promise<WebhookDeliveryDetail | null> {
    const rows = await this.query(
      async () =>
        (await this.db
          .select(this.selection)
          .from(this.deliveries)
          .innerJoin(this.events, eq(this.deliveries.eventId, this.events.id))
          .where(
            and(
              eq(this.deliveries.id, deliveryId),
              eq(this.deliveries.webhookId, webhookId)
            )
          )
          .limit(1)) as DeliveryJoinRow[]
    );
    return rows[0] ? this.toDetail(rows[0]) : null;
  }

  /** Map a joined row to the list summary, normalizing timestamps to ISO-UTC. */
  private toSummary(row: DeliveryJoinRow): WebhookDeliverySummary {
    return {
      id: row.id,
      webhookId: row.webhookId,
      eventId: row.eventId,
      eventType: row.eventType,
      resource: {
        kind: row.resourceKind,
        collection: row.resourceCollection,
        id: row.resourceId,
      },
      status: row.status as WebhookDeliveryStatus,
      attemptCount: row.attemptCount,
      lastStatusCode: row.lastStatusCode,
      lastLatencyMs: row.lastLatencyMs,
      lastError: row.lastError,
      // Dialect-aware instant recovery: a SQLite epoch Date is already correct,
      // while a naive Postgres/MySQL Date is reinterpreted as UTC. Returning the
      // corrected Date lets the response layer serialize the right ISO-8601
      // instant on every dialect, on a UTC or non-UTC server alike.
      nextAttemptAt: dbTimestampToInstant(row.nextAttemptAt, this.dialect),
      eventCreatedAt: dbTimestampToInstant(row.eventCreatedAt, this.dialect),
      createdAt: dbTimestampToInstant(row.createdAt, this.dialect),
      updatedAt: dbTimestampToInstant(row.updatedAt, this.dialect),
    };
  }

  /** Map a joined row to the detail shape, including the attempt log. */
  private toDetail(row: DeliveryJoinRow): WebhookDeliveryDetail {
    return {
      ...this.toSummary(row),
      attempts: this.normalizeAttempts(row.attempts),
      lastResponseSnippet: row.lastResponseSnippet,
    };
  }

  /**
   * Coerce the stored attempt log to the public shape. A malformed or missing
   * value (a legacy or manual write) reads as an empty history rather than
   * throwing, so one bad row cannot break the whole log view.
   */
  private normalizeAttempts(value: unknown): WebhookDeliveryAttempt[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
      if (!entry || typeof entry !== "object") return [];
      const e = entry as Record<string, unknown>;
      if (typeof e.at !== "string" || typeof e.outcome !== "string") return [];
      const attempt: WebhookDeliveryAttempt = { at: e.at, outcome: e.outcome };
      if (typeof e.statusCode === "number") attempt.statusCode = e.statusCode;
      if (typeof e.latencyMs === "number") attempt.latencyMs = e.latencyMs;
      if (typeof e.error === "string") attempt.error = e.error;
      return [attempt];
    });
  }
}

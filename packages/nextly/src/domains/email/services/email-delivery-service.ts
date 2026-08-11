/**
 * The email delivery log's writer and reader.
 *
 * Records that a message was attempted and what happened to it. Before this, a
 * failed password-reset left no durable trace: the adapter threw, the service
 * returned `{ success: false }`, one line went to the process log, and the
 * operator learned from the user.
 *
 * **This is a log, not a queue, and nothing prunes it yet.** Nothing drains it,
 * nothing retries, no retention pass reads its `retention_class`, and the
 * reserved columns stay inert — see `schemas/email-deliveries/postgres.ts` for
 * why that distinction is written into the schema rather than only decided
 * here. An install sending at volume will grow this table until a pass exists.
 *
 * @module domains/email/services/email-delivery-service
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, desc, eq } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import { emailDeliveriesMysql } from "../../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  hashRecipient,
  storableError,
  type EmailDeliveryInput,
  type EmailDeliveryRecipientKind,
  type EmailDeliveryStatus,
} from "../delivery-record";

type EmailDeliveriesTable =
  | typeof emailDeliveriesPg
  | typeof emailDeliveriesMysql
  | typeof emailDeliveriesSqlite;

/**
 * A row as the three dialect tables produce it.
 *
 * Declared rather than inferred: the three table definitions are a union, and
 * Drizzle's select over a union resolves to something the compiler cannot name,
 * so the callback parameter would be implicitly `any`. Writing the shape once
 * keeps the mapping below checked against something real.
 */
interface EmailDeliveryRow {
  id: string;
  providerId: string | null;
  providerType: string;
  templateSlug: string | null;
  recipientHash: string;
  recipientKind: string;
  status: string;
  attemptCount: number;
  error: string | null;
  messageId: string | null;
  createdAt: Date;
}

/** One recorded delivery, as a reader sees it. */
export interface EmailDeliveryRecord {
  id: string;
  providerId: string | null;
  providerType: string;
  templateSlug: string | null;
  recipientHash: string;
  recipientKind: EmailDeliveryRecipientKind;
  status: EmailDeliveryStatus;
  attemptCount: number;
  error: string | null;
  messageId: string | null;
  createdAt: Date;
}

/** How a caller narrows a listing. */
export interface ListDeliveriesOptions {
  /** Hash of the address to look for; callers pass an address, not a hash. */
  recipient?: string;
  status?: EmailDeliveryStatus;
  providerId?: string;
  limit?: number;
}

export class EmailDeliveryService extends BaseService {
  private deliveries: EmailDeliveriesTable;

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

    switch (this.dialect) {
      case "postgresql":
        this.deliveries = emailDeliveriesPg;
        break;
      case "mysql":
        this.deliveries = emailDeliveriesMysql;
        break;
      case "sqlite":
        this.deliveries = emailDeliveriesSqlite;
        break;
      default:
        throw NextlyError.internal({
          logContext: {
            reason: "unsupported dialect for the email delivery log",
            dialect: String(this.dialect),
          },
        });
    }
  }

  /**
   * Record one delivery attempt.
   *
   * Never throws. A send that succeeded must not be reported as failed because
   * the log could not be written, and a send that failed must not have its
   * failure replaced by a different one. The recording failure goes to the
   * process log, so a trail that stops being written is visible.
   *
   * `next_attempt_at` is not set. Nothing drains this table, and a timestamp
   * there would tell an operator to expect a retry that no code will perform.
   */
  async record(input: EmailDeliveryInput): Promise<void> {
    await this.recordAll([input]);
  }

  /**
   * Record every recipient of one message, in a single statement.
   *
   * A message with copied recipients produces one row per address, because the
   * question the table answers is asked about a PERSON and a person copied on
   * a message received it. One insert rather than one per address, so a
   * copied-in message costs the same round trip as any other.
   *
   * Never throws, for the reason `record` gives.
   */
  async recordAll(inputs: EmailDeliveryInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date();
    try {
      await this.insertRows(inputs, now, true);
    } catch (error) {
      // The one recoverable failure: PostgreSQL and SQLite carry a foreign key
      // to `email_providers`, and an administrator deleting a provider while
      // its send is in flight leaves `providerId` pointing at a row that is
      // gone by the time this runs. `ON DELETE SET NULL` only protects rows
      // that already existed.
      //
      // The message WAS sent, so losing its row to the provider's absence
      // would make the log's completeness depend on nobody editing settings
      // during a send. Retried once without the reference: `provider_type`
      // beside it keeps every row meaningful without the join, which is the
      // same reason MySQL carries no key here at all.
      try {
        await this.insertRows(inputs, now, false);
        this.logger.warn(
          "Recorded an email delivery without its provider reference",
          {
            providerType: inputs[0]?.providerType,
            providerId: inputs[0]?.providerId,
          }
        );
        return;
      } catch {
        // Fall through to the original failure, which is the one worth
        // reporting: the retry failing too means the cause was never the key.
      }
      this.logger.error("Failed to record an email delivery", {
        providerType: inputs[0]?.providerType,
        status: inputs[0]?.status,
        recipientCount: inputs.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The insert itself, with or without the provider reference.
   *
   * Split out so the retry above writes exactly the same rows rather than a
   * second, subtly different statement — which is how a fallback path comes to
   * store something the primary one never would.
   */
  private async insertRows(
    inputs: EmailDeliveryInput[],
    now: Date,
    withProvider: boolean
  ): Promise<void> {
    await this.db.insert(this.deliveries).values(
      inputs.map(input => ({
        id: randomUUID(),
        providerId: withProvider ? (input.providerId ?? null) : null,
        providerType: input.providerType,
        templateSlug: input.templateSlug ?? null,
        // The address is hashed here and nowhere retained. Callers hand over
        // the real one because they are sending to it; this is the boundary
        // where it stops travelling.
        recipientHash: hashRecipient(input.to),
        recipientKind: input.recipientKind ?? "to",
        status: input.status,
        attemptCount: 1,
        error: input.error ? storableError(input.error) : null,
        messageId: input.messageId ?? null,
        // One timestamp for the whole message: the rows describe a single
        // send, and staggering them by microseconds would suggest otherwise.
        createdAt: now,
      }))
    );
  }

  /**
   * List recorded deliveries, newest first.
   *
   * `recipient` takes an ADDRESS and hashes it here, because a caller holding a
   * hash is a caller who has been handed one — and the only supported way to
   * ask about a person is to already know which person you mean.
   */
  async list(
    options: ListDeliveriesOptions = {}
  ): Promise<EmailDeliveryRecord[]> {
    const filters = [
      options.recipient !== undefined
        ? eq(this.deliveries.recipientHash, hashRecipient(options.recipient))
        : undefined,
      options.status !== undefined
        ? eq(this.deliveries.status, options.status)
        : undefined,
      options.providerId !== undefined
        ? eq(this.deliveries.providerId, options.providerId)
        : undefined,
    ].filter(filter => filter !== undefined);

    // A lost connection or any other driver failure has to arrive at the
    // caller as a `NextlyError` like every other read in the service layer:
    // the raw driver error carries no canonical code and no public message, so
    // an unguarded await would put a driver's own text in an API response and
    // lose the database log context the rest of the layer records.
    let rows: unknown[];
    try {
      rows = await this.db
        .select()
        .from(this.deliveries)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(this.deliveries.createdAt))
        // Bounded by default. An unbounded read of a log table is the query
        // that works in development and takes the database down in production.
        .limit(options.limit ?? 50);
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return (rows as EmailDeliveryRow[]).map(row => ({
      id: row.id,
      providerId: row.providerId,
      providerType: row.providerType,
      templateSlug: row.templateSlug,
      recipientHash: row.recipientHash,
      recipientKind: row.recipientKind as EmailDeliveryRecipientKind,
      status: row.status as EmailDeliveryStatus,
      attemptCount: row.attemptCount,
      error: row.error,
      messageId: row.messageId,
      createdAt: row.createdAt,
    }));
  }
}

/**
 * The email delivery log's writer and reader.
 *
 * Records that a message was attempted and what happened to it. Before this, a
 * failed password-reset left no durable trace: the adapter threw, the service
 * returned `{ success: false }`, one line went to the process log, and the
 * operator learned from the user.
 *
 * **This is a log, not a queue.** Nothing drains it, nothing retries, and the
 * reserved columns stay inert — see `schemas/email-deliveries/postgres.ts` for
 * why that distinction is written into the schema rather than only decided
 * here.
 *
 * @module domains/email/services/email-delivery-service
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, desc, eq } from "drizzle-orm";

import { emailDeliveriesMysql } from "../../../schemas/email-deliveries/mysql";
import { emailDeliveriesPg } from "../../../schemas/email-deliveries/postgres";
import { emailDeliveriesSqlite } from "../../../schemas/email-deliveries/sqlite";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  hashRecipient,
  storableError,
  type EmailDeliveryInput,
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
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
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
    try {
      await this.db.insert(this.deliveries).values({
        id: randomUUID(),
        providerId: input.providerId ?? null,
        providerType: input.providerType,
        templateSlug: input.templateSlug ?? null,
        // The address is hashed here and nowhere retained. Callers hand over
        // the real one because they are sending to it; this is the boundary
        // where it stops travelling.
        recipientHash: hashRecipient(input.to),
        status: input.status,
        attemptCount: 1,
        error: input.error ? storableError(input.error) : null,
        messageId: input.messageId ?? null,
        createdAt: new Date(),
      });
    } catch (error) {
      this.logger.error("Failed to record an email delivery", {
        providerType: input.providerType,
        status: input.status,
        message: error instanceof Error ? error.message : String(error),
      });
    }
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

    const rows = await this.db
      .select()
      .from(this.deliveries)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(this.deliveries.createdAt))
      // Bounded by default. An unbounded read of a log table is the query that
      // works in development and takes the database down in production.
      .limit(options.limit ?? 50);

    return (rows as EmailDeliveryRow[]).map(row => ({
      id: row.id,
      providerId: row.providerId,
      providerType: row.providerType,
      templateSlug: row.templateSlug,
      recipientHash: row.recipientHash,
      status: row.status as EmailDeliveryStatus,
      attemptCount: row.attemptCount,
      error: row.error,
      messageId: row.messageId,
      createdAt: row.createdAt,
    }));
  }
}

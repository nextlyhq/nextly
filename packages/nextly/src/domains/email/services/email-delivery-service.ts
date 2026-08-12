/**
 * The email delivery log's writer and reader.
 *
 * Records that a message was attempted and what happened to it: which provider
 * carried it, which template produced it, whether it was accepted, and a hash
 * of each recipient. One row per RECIPIENT, so the question "did this person
 * receive it" has an answer for someone who was copied.
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
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  deliveriesTableFor,
  type EmailDeliveriesTable,
} from "../deliveries-table";
import {
  EMAIL_RETENTION_CLASS,
  isErasedRecipientHash,
  recipientDigest,
  storableError,
  type EmailDeliveryInput,
  type EmailDeliveryRecipientKind,
  type EmailDeliveryStatus,
} from "../delivery-record";
import { eraseRecipientDeliveries } from "../erase-recipient";

/**
 * Rows per insert statement.
 *
 * Chosen against the tightest dialect rather than the roomiest: SQLite's
 * default bind-parameter ceiling is the low limit, and each row binds a dozen
 * columns. Small enough to stay well inside it, large enough that an ordinary
 * send is still one statement.
 */
const INSERT_CHUNK_SIZE = 50;

/**
 * A thrown value as one log-safe line.
 *
 * `String(value)` on a plain object yields `[object Object]`, which reads like
 * a message and says nothing — so a non-Error rejection is serialised instead.
 */
function describeUnknownError(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

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
  /**
   * The stored digest, or null once this recipient has been erased.
   *
   * Null rather than the raw sentinel so a reader never has to know what the
   * erased state is spelled as. The column is NOT NULL, so there is no "no
   * value recorded" case for null to be confused with: it means erased and
   * nothing else.
   */
  recipientHash: string | null;
  recipientKind: EmailDeliveryRecipientKind;
  status: EmailDeliveryStatus;
  attemptCount: number;
  error: string | null;
  messageId: string | null;
  createdAt: Date;
}

/**
 * A stored row as a reader sees it.
 *
 * Every read path returns rows through here rather than building the record
 * inline, so the erased state is translated once. A future single-row getter
 * that mapped its own columns would hand back the raw sentinel, and it would
 * look correct beside a listing that does not — so the translation lives where
 * a new caller gets it by construction instead of by noticing.
 */
function toDeliveryRecord(row: EmailDeliveryRow): EmailDeliveryRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    providerType: row.providerType,
    templateSlug: row.templateSlug,
    // The sentinel is a storage detail: it exists because the column is NOT
    // NULL, and a reader has no use for the spelling.
    recipientHash: isErasedRecipientHash(row.recipientHash)
      ? null
      : row.recipientHash,
    recipientKind: row.recipientKind as EmailDeliveryRecipientKind,
    status: row.status as EmailDeliveryStatus,
    attemptCount: row.attemptCount,
    error: row.error,
    messageId: row.messageId,
    createdAt: row.createdAt,
  };
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
    this.deliveries = deliveriesTableFor(this.dialect);
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
   * Record every recipient of one message.
   *
   * A message with copied recipients produces one row per address, because the
   * question the table answers is asked about a PERSON and a person copied on
   * a message received it.
   *
   * Written in bounded chunks: an ordinary send is one statement, and a large
   * recipient list becomes several rather than one that would exceed a
   * dialect's bind-parameter limit. Each chunk succeeds or fails on its own,
   * so a batch can end up partially recorded -- which is the deliberate trade
   * against losing all of it.
   *
   * Never throws, for the reason `record` gives.
   */
  async recordAll(inputs: EmailDeliveryInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date();
    // Generated ONCE, outside the retry below. The provider-reference retry
    // rewrites the rows it was given, and reusing the ids is what makes it a
    // REPLACEMENT of the refused rows rather than a second set of them.
    const ids = inputs.map(() => randomUUID());

    // Written in bounded chunks. One `values()` over an unbounded recipient
    // list exceeds a dialect's bind-parameter or statement-size limit, and
    // this method swallows its own failures by design -- so a message with a
    // large BCC list would be dispatched and then lose EVERY row. Each chunk
    // fails, retries and reports on its own, so one oversized or unlucky slice
    // cannot take the rest of the batch with it.
    for (let start = 0; start < inputs.length; start += INSERT_CHUNK_SIZE) {
      const end = start + INSERT_CHUNK_SIZE;
      await this.insertChunk(
        inputs.slice(start, end),
        ids.slice(start, end),
        now
      );
    }
  }

  /**
   * One bounded slice of a batch: insert it, and recover the one way that can
   * be recovered.
   *
   * Per chunk rather than per batch, because the provider retry rewrites the
   * rows it was given. Retrying a whole batch after a later chunk failed would
   * re-insert the ids an earlier chunk had already committed, and collide on
   * the primary key.
   */
  private async insertChunk(
    inputs: EmailDeliveryInput[],
    ids: string[],
    now: Date
  ): Promise<void> {
    try {
      await this.insertRows(inputs, ids, now, true);
    } catch (error) {
      // The one recoverable failure: PostgreSQL and SQLite carry a foreign key
      // to `email_providers`, and an administrator deleting a provider while
      // its send is in flight leaves `providerId` pointing at a row that is
      // gone by the time this runs. `ON DELETE SET NULL` only protects rows
      // that already existed. The message WAS sent, so losing its row to the
      // provider's absence would make the log's completeness depend on nobody
      // editing settings during a send.
      //
      // ONLY a foreign-key violation. Any other failure -- a deadlock, a
      // timeout, a lost connection -- has nothing to do with the provider
      // reference, and retrying without it would clear a reference whose
      // provider still exists, quietly weakening every row written during a
      // database hiccup.
      if (toDbError(this.dialect, error).kind !== "fk-violation") {
        this.reportInsertFailure(inputs, error);
        return;
      }

      try {
        // `provider_type` beside it keeps every row meaningful without the
        // join, which is the same reason MySQL carries no key here at all.
        await this.insertRows(inputs, ids, now, false);
        this.reportProviderReferenceDropped(inputs);
        return;
      } catch (retryError) {
        // BOTH errors. The original says the row was refused for its provider
        // reference; the retry's says what stopped the recovery -- a lost
        // connection or a timeout is a different problem with a different fix,
        // and reporting only the foreign-key violation would send an operator
        // looking for a provider-deletion race that is not what went wrong.
        this.reportInsertFailure(inputs, error, retryError);
        return;
      }
      this.reportInsertFailure(inputs, error);
    }
  }

  /**
   * Say that a row was kept without its provider reference, and never let
   * saying so change what happened.
   *
   * The row is already inserted by the time this runs. An installed logger
   * that throws would otherwise be caught by the recovery's own handler and
   * reported as a retry that failed -- an error naming a row that exists, on a
   * path whose whole purpose was to keep it. Isolated for the same reason
   * `reportInsertFailure` is, and the two sit together so neither is the one
   * that gets forgotten.
   */
  private reportProviderReferenceDropped(inputs: EmailDeliveryInput[]): void {
    try {
      this.logger.warn(
        "Recorded an email delivery without its provider reference",
        {
          providerType: inputs[0]?.providerType,
          providerId: inputs[0]?.providerId,
        }
      );
    } catch {
      // Nowhere left to report to: the reporting mechanism is what failed.
    }
  }

  /**
   * One shape for a lost chunk, so the two report sites cannot diverge.
   *
   * The log call is isolated. `recordAll` promises never to throw, and it is
   * called from a send that has already been dispatched -- so a logger an
   * install supplied, throwing from `error()`, would otherwise escape a
   * recorder whose whole contract is that it cannot affect the send, and be
   * caught as a provider failure by the path above it. A trail that cannot be
   * written is a trail that cannot be written; it is not a failed message.
   */
  private reportInsertFailure(
    inputs: EmailDeliveryInput[],
    error: unknown,
    retryError?: unknown
  ): void {
    try {
      this.logInsertFailure(inputs, error, retryError);
    } catch {
      // Nowhere left to report to: the reporting mechanism is what failed.
    }
  }

  private logInsertFailure(
    inputs: EmailDeliveryInput[],
    error: unknown,
    retryError?: unknown
  ): void {
    this.logger.error("Failed to record an email delivery", {
      providerType: inputs[0]?.providerType,
      status: inputs[0]?.status,
      recipientCount: inputs.length,
      message: describeUnknownError(error),
      ...(retryError !== undefined
        ? { retryMessage: describeUnknownError(retryError) }
        : {}),
    });
  }

  /**
   * The insert itself, with or without the provider reference.
   *
   * Split out so the retry above writes exactly the same rows rather than a
   * second, subtly different statement — which is how a fallback path comes to
   * store something the primary one never would. The ids are passed in for the
   * same reason: the retry must replace the failed rows, not add new ones.
   */
  private async insertRows(
    inputs: EmailDeliveryInput[],
    ids: string[],
    now: Date,
    withProvider: boolean
  ): Promise<void> {
    await this.db.insert(this.deliveries).values(
      inputs.map((input, index) => ({
        id: ids[index],
        providerId: withProvider ? (input.providerId ?? null) : null,
        providerType: input.providerType,
        templateSlug: input.templateSlug ?? null,
        // The address is hashed here and nowhere retained. Callers hand over
        // the real one because they are sending to it; this is the boundary
        // where it stops travelling.
        //
        // Through `recipientDigest`, the same function the reader and the
        // erasure use. A send addressed `Jane <jane@example.com>` must store
        // what a lookup for `jane@example.com` will compute, or the row is
        // written in a form nothing can ever find again.
        recipientHash: recipientDigest(input.to),
        recipientKind: input.recipientKind ?? "to",
        status: input.status,
        attemptCount: 1,
        retentionClass: EMAIL_RETENTION_CLASS,
        error: input.error ? storableError(input.error) : null,
        messageId: input.messageId ?? null,
        // One timestamp for the whole message: the rows describe a single
        // send, and staggering them by microseconds would suggest otherwise.
        createdAt: now,
      }))
    );
  }

  /**
   * Erase every delivery recorded for an address.
   *
   * The reachable entry point for the population `deleteUser` cannot serve:
   * most recipients never had an account — a password reset to an address that
   * never registered, a CC, a BCC added by a `beforeSend` filter — and no
   * account deletion will ever fire for them. Without a caller of its own, the
   * erasure would cover an arbitrary subset of the people it claims to.
   *
   * Runs outside a transaction because it stands alone here; `deleteUser`
   * calls the underlying function directly with its own so the erasure commits
   * and rolls back with the account removal.
   */
  async eraseRecipient(address: string): Promise<void> {
    try {
      await eraseRecipientDeliveries(
        this.db as Parameters<typeof eraseRecipientDeliveries>[0],
        this.deliveries,
        address
      );
    } catch (err) {
      // Converted like every other read and write on this service. A caller
      // handling an erasure request needs to tell "the table is missing on this
      // install" from "the connection dropped", and a raw driver exception
      // carries neither in a form the API layer can map — it becomes a 500
      // whatever it was. Rethrown rather than swallowed: unlike `record`, a
      // failed erasure must not be reported as a completed one.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
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
        ? eq(
            this.deliveries.recipientHash,
            // The MAILBOX, as the writer stored it. A caller asking about
            // `Jane <jane@example.com>` is asking about `jane@example.com`,
            // and hashing what they typed answers "no record" for a message
            // that was sent. The same function the erasure uses, so a lookup
            // and a removal can never disagree about which rows are a person's.
            recipientDigest(options.recipient)
          )
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
        // `id` breaks the tie, and what that buys is DETERMINISM, not
        // chronology. Rows written by one send share a timestamp by design, so
        // without a second key a limited read returns a different subset of
        // them each time it runs. Two INDEPENDENT sends landing in the same
        // millisecond are ordered arbitrarily between themselves; recovering
        // that would need an insertion sequence the table does not keep, and
        // `created_at` already carries every bit of chronology it is given.
        .orderBy(desc(this.deliveries.createdAt), desc(this.deliveries.id))
        // Bounded by default. An unbounded read of a log table is the query
        // that works in development and takes the database down in production.
        .limit(options.limit ?? 50);
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return (rows as EmailDeliveryRow[]).map(toDeliveryRecord);
  }
}

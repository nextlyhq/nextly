/**
 * A queued email: stored with the caller's change, attempted once that
 * change commits, and retried through the job queue until it is sent or
 * fails for good.
 *
 * - **Stored, not sent.** `storeQueuedEmail` writes the email's row and the
 *   job that attempts it in the caller's transaction, so both exist only if
 *   the caller's change commits. The job's input is the row's id alone: the
 *   message lives in `email_queue`, sealed under the install's secret, and
 *   the jobs table holds nothing of it.
 * - **Attempted by its job.** The first attempt is the job's first run,
 *   started once the change commits (`runJobNow`), so a jobs trigger running
 *   at the same moment cannot attempt it twice. A process that stops before
 *   then leaves the job pending, and the next trigger runs it.
 * - **Sent under one key.** Every attempt sends with the caller's
 *   idempotency key, or one derived from the queued email's id, so a retry
 *   after a lost response is not delivered twice where the provider takes a
 *   key.
 * - **Retried only when it may succeed.** A retryable failure is thrown back
 *   to the job queue, which tries again with backoff up to
 *   `QUEUED_EMAIL_MAX_ATTEMPTS`; a failure that is not retryable, or the last
 *   attempt's, fails the email without another attempt.
 * - **A template is rendered at each attempt**, from the template as saved
 *   then, so an attempt after the template is fixed sends the fixed version.
 *
 * @module domains/email/queued-send
 */

import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray } from "drizzle-orm";

import { NextlyError } from "../../errors";
import { emailQueueMysql } from "../../schemas/email-queue/mysql";
import { emailQueuePg } from "../../schemas/email-queue/postgres";
import { emailQueueSqlite } from "../../schemas/email-queue/sqlite";
import { EMAIL_QUEUE_TABLE } from "../../schemas/email-queue/table-name";
import {
  defineJob,
  type JobContext,
  type JobDefinition,
} from "../jobs/job-registry";
import { enqueueInTransaction } from "../jobs/jobs-repository";
import { openSetting, sealSetting } from "../plugins/settings-crypto";

import { storableError } from "./delivery-record";
import { type EmailFailure, httpFailure } from "./failure";
import {
  QUEUED_EMAIL_JOB,
  QUEUED_EMAIL_MAX_ATTEMPTS,
} from "./queued-email-job";
import type { EmailService } from "./services/email-service";
import { markHtml, TrustedHtml } from "./services/liquid-engine";
import { notAcceptedFailure } from "./services/send-failures";

/**
 * Where a queued email stands.
 *
 * - `waiting`: stored, and its next attempt not yet made. Retrying is
 *   `waiting` with a failure recorded.
 * - `sending`: an attempt is with the provider.
 * - `sent`, `failed`, `cancelled`: settled, with no attempt to follow.
 */
export type QueuedEmailState =
  | "waiting"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

/** @experimental A queued email, as `queue` and `queueWithTemplate` return it. */
export interface QueuedEmail {
  /** The queued email's id. */
  id: string;
  /**
   * Where it stands when the call returns: `waiting` when queued inside a
   * transaction, whose commit starts the first attempt; else where that
   * first attempt left it.
   */
  state: QueuedEmailState;
}

type SendOptions = Parameters<EmailService["send"]>[0];
type TemplateOptions = NonNullable<
  Parameters<EmailService["sendWithTemplate"]>[3]
>;

/** What a queued email sends: a message, or a template with its variables. */
export type QueuedMessage =
  | { kind: "message"; send: Omit<SendOptions, "templateSlug"> }
  | {
      kind: "template";
      slug: string;
      to: string | string[];
      variables: Record<string, unknown>;
      options: TemplateOptions;
    };

/** The queue's table for a dialect. */
export type EmailQueueTable =
  | typeof emailQueuePg
  | typeof emailQueueMysql
  | typeof emailQueueSqlite;

export function emailQueueTableFor(dialect: string): EmailQueueTable {
  switch (dialect) {
    case "postgresql":
      return emailQueuePg;
    case "mysql":
      return emailQueueMysql;
    case "sqlite":
      return emailQueueSqlite;
    default:
      throw NextlyError.internal({
        logContext: {
          reason: "unsupported dialect for the email queue",
          dialect: String(dialect),
        },
      });
  }
}

/** The Drizzle surface the queue needs. */
interface QueueDb {
  select(fields?: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(rows: number): PromiseLike<unknown[]>;
      };
    };
  };
  insert(table: unknown): { values(row: unknown): PromiseLike<unknown> };
  update(table: unknown): {
    set(values: unknown): { where(condition: unknown): PromiseLike<unknown> };
  };
}

// ============================================================
// The sealed message
// ============================================================

/** The owner the seal authenticates, as core's other sealed values name it. */
const SEAL_OWNER = "nextly core";
/** Marks a message sealed under the install's secret. */
const SEALED = "sealed:";
/**
 * Marks a message stored without a seal, which happens only where the
 * install has no secret to seal under: never in production, which requires
 * one. As the principal digest key is stored in the same case.
 */
const UNSEALED = "unsealed:";

/**
 * The seal's associated data: the table and the row, so a message copied
 * into another row fails to open rather than being sent as that row's.
 */
function sealPath(id: string): string[] {
  return [EMAIL_QUEUE_TABLE, id];
}

/**
 * A variable's value as stored, tagged by what it was so it reads back as
 * the same kind of value. Every object is wrapped, so data a caller passed
 * can never be read back as markup `markHtml` trusted.
 */
type StoredValue =
  | null
  | boolean
  | number
  | string
  | { h: string }
  | { d: string }
  | { a: StoredValue[] }
  | { o: Record<string, StoredValue> };

/**
 * A variable's value as stored. What JSON would drop (`undefined`, a
 * function, a symbol) is dropped, `toJSON` is honoured as JSON honours it,
 * and a `markHtml` mark and a date keep what they are.
 */
function storedValue(
  value: unknown,
  seen: Set<object>
): StoredValue | undefined {
  if (value === null || typeof value !== "object") return storedScalar(value);
  if (TrustedHtml.is(value)) return { h: value.html };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : { d: value.toISOString() };
  }
  return storedObject(value, seen);
}

/** A value that is not an object, as JSON would store it. */
function storedScalar(value: unknown): StoredValue | undefined {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    default:
      // `null` here; `undefined`, a function and a symbol are dropped.
      return value === null ? null : undefined;
  }
}

/** A list or an object, each entry stored as `storedValue` stores it. */
function storedObject(
  value: object,
  seen: Set<object>
): StoredValue | undefined {
  if (seen.has(value)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "variables",
          code: "INVALID",
          message: "An email's variables must not refer to themselves.",
        },
      ],
    });
  }
  seen.add(value);
  try {
    const json = (value as { toJSON?: unknown }).toJSON;
    if (typeof json === "function") {
      return storedValue((json as () => unknown).call(value), seen);
    }
    if (Array.isArray(value)) {
      return { a: value.map(item => storedValue(item, seen) ?? null) };
    }
    const entries: Record<string, StoredValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const stored = storedValue(item, seen);
      if (stored !== undefined) entries[key] = stored;
    }
    return { o: entries };
  } finally {
    seen.delete(value);
  }
}

/** A stored value read back as the value it was stored from. */
function readValue(stored: StoredValue): unknown {
  if (stored === null || typeof stored !== "object") return stored;
  if ("h" in stored) return markHtml(stored.h);
  if ("d" in stored) return new Date(stored.d);
  if ("a" in stored) return stored.a.map(readValue);
  return Object.fromEntries(
    Object.entries(stored.o).map(([key, item]) => [key, readValue(item)])
  );
}

/** The message as the text that is sealed. */
function messageText(message: QueuedMessage): string {
  if (message.kind === "message") return JSON.stringify(message);
  return JSON.stringify({
    ...message,
    variables: storedValue(message.variables, new Set()) ?? { o: {} },
  });
}

/** The text that was sealed, as the message it was made from. */
function messageFromText(text: string): QueuedMessage | undefined {
  const parsed = JSON.parse(text) as QueuedMessage | undefined;
  if (parsed?.kind === "message") return parsed;
  if (parsed?.kind !== "template") return undefined;
  const variables = readValue(parsed.variables as unknown as StoredValue);
  return {
    ...parsed,
    variables:
      typeof variables === "object" && variables !== null
        ? (variables as Record<string, unknown>)
        : {},
  };
}

/**
 * The message as stored: sealed under the current secret, the first of
 * `secrets`, when the install has one.
 */
export function sealQueuedMessage(
  message: QueuedMessage,
  id: string,
  secrets: readonly string[]
): string {
  const text = messageText(message);
  const [current] = secrets;
  return current === undefined
    ? `${UNSEALED}${text}`
    : `${SEALED}${sealSetting(text, current, SEAL_OWNER, sealPath(id))}`;
}

/**
 * A stored message, opened with whichever of `secrets` sealed it. Undefined
 * when it cannot be read: sealed under a secret the install no longer has,
 * moved from another row, or damaged.
 */
export function openQueuedMessage(
  stored: string,
  id: string,
  secrets: readonly string[]
): QueuedMessage | undefined {
  try {
    if (stored.startsWith(UNSEALED)) {
      return messageFromText(stored.slice(UNSEALED.length));
    }
    if (!stored.startsWith(SEALED)) return undefined;
    const opened = openSetting(
      stored.slice(SEALED.length),
      secrets,
      SEAL_OWNER,
      sealPath(id)
    );
    return opened.readable ? messageFromText(opened.plaintext) : undefined;
  } catch {
    // Text that opened but does not parse is damaged, as a bad seal is.
    return undefined;
  }
}

// ============================================================
// Storing
// ============================================================

/** What `storeQueuedEmail` stores. */
export interface QueuedEmailInput {
  /** Who queued it, the scope its key is claimed in. */
  scope: string;
  message: QueuedMessage;
  /** The install's secrets, current first. */
  secrets: readonly string[];
  dialect: string;
  now: Date;
}

/**
 * Store a queued email and the job that attempts it, in `tx`. Nothing is
 * attempted here; the caller starts the job once `tx` has committed.
 */
export async function storeQueuedEmail(
  tx: TransactionContext,
  input: QueuedEmailInput
): Promise<{ id: string; jobId: string }> {
  const id = randomUUID();
  // Sealed before anything is written, so a message that cannot be stored
  // (variables that refer to themselves) refuses the queue with nothing left.
  const message = sealQueuedMessage(input.message, id, input.secrets);
  const { id: jobId } = await enqueueInTransaction(tx, input.dialect, {
    slug: QUEUED_EMAIL_JOB,
    input: { queuedId: id },
    runAt: null,
    runAsUserId: null,
    now: input.now,
  });
  const now = input.now.getTime();
  await tx
    .getDrizzle<QueueDb>()
    .insert(emailQueueTableFor(input.dialect))
    .values({
      id,
      scope: input.scope,
      state: "waiting",
      jobId,
      message,
      failure: null,
      createdAt: now,
      updatedAt: now,
      settledAt: null,
    });
  return { id, jobId };
}

/** A queued email's state, or undefined when there is no such email. */
export async function queuedEmailState(
  adapter: DrizzleAdapter,
  id: string
): Promise<QueuedEmailState | undefined> {
  const table = emailQueueTableFor(adapter.getCapabilities().dialect);
  const [row] = (await adapter
    .getDrizzle<QueueDb>()
    .select({ state: table.state })
    .from(table)
    .where(eq(table.id, id))
    .limit(1)) as Array<{ state: QueuedEmailState }>;
  return row?.state;
}

// ============================================================
// Attempting
// ============================================================

/** The states an attempt may start from. `sending` is an attempt that died. */
const ATTEMPTABLE: QueuedEmailState[] = ["waiting", "sending"];

/** The send service an attempt sends through. */
export type QueuedEmailSender = Pick<EmailService, "send" | "sendWithTemplate">;

/** What an attempt needs. */
export interface QueuedAttemptDeps {
  adapter: DrizzleAdapter;
  /** The send service as `scope` sends through it. */
  sender: (scope: string) => QueuedEmailSender;
  /** The install's secrets, current first. */
  secrets: readonly string[];
}

/** The job's input: the queued email's id, and nothing of its message. */
export type QueuedEmailJobInput = { queuedId: string };

/**
 * The key a queued email is sent with when its caller gave none: the same on
 * every attempt, and unlike any other queued email's.
 */
export function queuedEmailKey(id: string): string {
  return `queued-email:${id}`;
}

/**
 * The failure an attempt that threw is recorded with.
 *
 * Thrown before any provider answered: the send refused its own input, the
 * template could not be rendered, or something it needed was not there. One
 * the error itself marks not retryable is not; otherwise its status decides,
 * as a provider's HTTP status does (`httpFailure`): a refusal (4xx) fails the
 * email, and a fault (5xx) is retried. Anything that is not a `NextlyError`
 * is retried. The reason is the error's public message, with any address
 * removed.
 */
export function thrownAttemptFailure(error: unknown): EmailFailure {
  if (!(error instanceof NextlyError)) {
    return {
      retryable: true,
      reason: "The attempt failed before a provider was asked.",
    };
  }
  const retryable =
    error.logContext?.retryable === false
      ? false
      : httpFailure(error.statusCode).retryable;
  return {
    retryable,
    status: error.statusCode,
    reason: storableError(error.publicMessage),
  };
}

/** Send the message once. Undefined when it was sent, else why it was not. */
async function sendOnce(
  sender: QueuedEmailSender,
  message: QueuedMessage,
  id: string
): Promise<EmailFailure | undefined> {
  try {
    const outcome =
      message.kind === "template"
        ? await sender.sendWithTemplate(
            message.slug,
            message.to,
            message.variables,
            {
              ...message.options,
              idempotencyKey:
                message.options.idempotencyKey ?? queuedEmailKey(id),
            }
          )
        : await sender.send({
            ...message.send,
            idempotencyKey: message.send.idempotencyKey ?? queuedEmailKey(id),
          });
    return outcome.success
      ? undefined
      : (outcome.failure ?? notAcceptedFailure());
  } catch (error) {
    return thrownAttemptFailure(error);
  }
}

/** A failure as the queue's row records it, with no address. */
function storedFailure(failure: EmailFailure): string {
  return JSON.stringify({
    retryable: failure.retryable,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    reason: storableError(failure.reason),
  });
}

/**
 * Make one attempt at a queued email: the `email:send` job's handler.
 *
 * Does nothing for an email that is settled or gone, so a job run twice
 * attempts once. Throws only to have the job queue retry a retryable
 * failure; every other outcome is recorded on the email's row.
 */
export async function attemptQueuedEmail(
  deps: QueuedAttemptDeps,
  input: QueuedEmailJobInput,
  context: Pick<JobContext, "attempt" | "now">
): Promise<void> {
  const db = deps.adapter.getDrizzle<QueueDb>();
  const table = emailQueueTableFor(deps.adapter.getCapabilities().dialect);
  const [row] = (await db
    .select({
      id: table.id,
      scope: table.scope,
      state: table.state,
      message: table.message,
    })
    .from(table)
    .where(eq(table.id, input.queuedId))
    .limit(1)) as Array<{
    id: string;
    scope: string;
    state: QueuedEmailState;
    message: string | null;
  }>;
  if (!row || !ATTEMPTABLE.includes(row.state)) return;

  const now = context.now.getTime();
  const record = (values: Record<string, unknown>) =>
    db
      .update(table)
      .set({ ...values, updatedAt: now })
      .where(and(eq(table.id, row.id), inArray(table.state, ATTEMPTABLE)));
  // A sent email's message is cleared as it settles: nothing sends it again,
  // and it is not held a moment longer than that. A failed one keeps its
  // message until the row is pruned (`pruneQueuedEmails`).
  const settle = (state: QueuedEmailState, failure?: EmailFailure) =>
    record({
      state,
      ...(failure ? { failure: storedFailure(failure) } : {}),
      ...(state === "sent" ? { message: null } : {}),
      settledAt: now,
    });

  await record({ state: "sending" });
  const message =
    row.message === null
      ? undefined
      : openQueuedMessage(row.message, row.id, deps.secrets);
  if (!message) {
    await settle("failed", {
      retryable: false,
      reason: "The queued message could not be read.",
    });
    return;
  }

  const failure = await sendOnce(deps.sender(row.scope), message, row.id);
  if (!failure) {
    await settle("sent");
    return;
  }
  if (!failure.retryable || context.attempt >= QUEUED_EMAIL_MAX_ATTEMPTS) {
    await settle("failed", failure);
    return;
  }
  await record({ state: "waiting", failure: storedFailure(failure) });
  // To the job queue, which records this as the attempt's error and backs off.
  throw new NextlyError({
    code: "EXTERNAL_SERVICE_ERROR",
    publicMessage: `The queued email was not sent and will be tried again: ${storableError(failure.reason)}`,
    logContext: { queuedId: row.id, attempt: context.attempt },
  });
}

/**
 * The `email:send` job: one attempt at a queued email per run, retried by
 * the job queue up to `QUEUED_EMAIL_MAX_ATTEMPTS`. Its dependencies are
 * resolved per run, so the job can be registered before the send service
 * exists.
 */
export function createQueuedEmailJob(
  deps: () => QueuedAttemptDeps
): JobDefinition<QueuedEmailJobInput> {
  return defineJob<QueuedEmailJobInput>({
    slug: QUEUED_EMAIL_JOB,
    retry: { maxAttempts: QUEUED_EMAIL_MAX_ATTEMPTS },
    handler: async (input, context) => {
      // A row's input is whatever was stored; one without an id names no
      // email, and there is nothing to attempt.
      if (typeof input?.queuedId !== "string") return;
      await attemptQueuedEmail(deps(), input, context);
    },
  });
}

/**
 * The webhooks a plugin receives, lent to it as `ctx.security.webhooks`:
 * verifying a delivery, and claiming it once.
 *
 * A claim is one row in `nextly_received_webhooks`, keyed by a SHA-256 of the
 * plugin, the provider and the delivery, so a delivery is processed once
 * however often its provider sends it. A provider's retry of a processed
 * delivery is answered as a duplicate, and a replay of one too, while its row
 * is kept: 30 days, which is what makes a scheme that signs no time safe from
 * replay for that long.
 *
 * Claimed in the plugin's transaction (`{ tx }`), the row is written as
 * processed and commits or rolls back with the plugin's writes, so a handler
 * that fails leaves the delivery for the retry. Claimed without one, it is a
 * lease: a pending row the handler ends with `complete` or `release`. A
 * handler that dies holding it costs the provider one retry: a retry during
 * the lease is told the delivery is in progress, and the first after it takes
 * the claim over. No transaction is held while the handler works.
 *
 * Only an answer `verify` returned can be claimed, and its key comes from
 * what was verified, never from the answer's fields.
 *
 * @module plugins/security/received-webhooks
 * @experimental
 */
import { createHash, randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { eq, sql } from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import {
  RECEIVED_WEBHOOKS_TABLE,
  receivedWebhooksTables,
} from "../../schemas/received-webhooks";

import {
  verifiedFacts,
  verifyWebhookRequest,
  type ClaimDeliveryOptions,
  type DeliveryClaim,
  type DeliveryClaimResult,
  type PluginReceivedWebhooks,
  type VerifiedFacts,
} from "./inbound-webhooks";
import { pluginWriter } from "./plugin-write";
import { isStorableText } from "./well-formed";

/** What claiming needs from the database adapter. */
export type ReceivedWebhooksAdapter = Pick<
  DrizzleAdapter,
  "transaction" | "transactionOpenInFlow" | "dialect"
>;

/** What `ctx.security.webhooks` is built from. */
export interface PluginReceivedWebhooksOptions {
  /** The plugin's name: every delivery it claims is kept within it. */
  owner: string;
  /** The adapter, resolved per call: the context can be built before it connects. */
  adapter: () => ReceivedWebhooksAdapter;
  /** The clock; injectable for tests. */
  now?: () => Date;
}

const DEFAULT_LEASE_SECONDS = 300;
const MAX_LEASE_SECONDS = 3600;
/** The bound on a provider and an id, the width every dialect keeps them in. */
const MAX_NAME_LENGTH = 191;
/**
 * Claim attempts before giving up: another attempt is needed only when the
 * row seen as standing is gone by the time it is read, released or pruned in
 * between, which cannot keep happening to one delivery.
 */
const ATTEMPTS = 3;

/** A claim's row, as the claim reads it back. */
interface ClaimRow {
  status: string;
  claimToken: string;
  leaseUntil: Date | null;
}

/** An insert that yields to a row already there, on PostgreSQL and SQLite. */
interface ConflictInsertDb {
  insert(table: unknown): {
    values(row: unknown): {
      onConflictDoNothing(): {
        returning(fields: Record<string, unknown>): PromiseLike<unknown[]>;
      };
    };
  };
}

/** An insert that leaves a row already there as it is, on MySQL. */
interface DuplicateKeyInsertDb {
  insert(table: unknown): {
    values(row: unknown): {
      onDuplicateKeyUpdate(args: {
        set: Record<string, unknown>;
      }): PromiseLike<unknown>;
    };
  };
}

/** A read of one claim, which can lock the row it reads. */
interface ClaimReadDb {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): PromiseLike<ClaimRow[]> & {
        for(strength: "update"): PromiseLike<ClaimRow[]>;
      };
    };
  };
}

function tableOf(dialect: SupportedDialect) {
  return receivedWebhooksTables(dialect).nextlyReceivedWebhooks;
}

/** Insert `row` unless its delivery is claimed already; whether this wrote it. */
async function insertIfAbsent(
  tx: TransactionContext,
  dialect: SupportedDialect,
  row: { deliveryKey: string; claimToken: string } & Record<string, unknown>
): Promise<boolean> {
  const table = tableOf(dialect);
  // Yielding rather than failing on the key: in the plugin's transaction a
  // failed insert would end it, on PostgreSQL, for every write it holds.
  if (dialect === "mysql") {
    // Not `INSERT IGNORE`: on a key already there that takes a SHARED lock,
    // and two claims each holding one then deadlock asking for the exclusive
    // lock the read below takes. A no-op `ON DUPLICATE KEY UPDATE` takes the
    // exclusive lock at once, so the second claim waits for the first. Which
    // claim wrote the row is told by its token, as the count of an update that
    // changes nothing is not.
    await tx
      .getDrizzle<DuplicateKeyInsertDb>()
      .insert(table)
      .values(row)
      .onDuplicateKeyUpdate({
        set: { deliveryKey: sql`${table.deliveryKey}` },
      });
    const standing = await standingClaim(tx, dialect, row.deliveryKey);
    return standing?.claimToken === row.claimToken;
  }
  const written = await tx
    .getDrizzle<ConflictInsertDb>()
    .insert(table)
    .values(row)
    .onConflictDoNothing()
    .returning({ deliveryKey: table.deliveryKey });
  return written.length > 0;
}

/**
 * The claim standing on `deliveryKey`, its row locked until the transaction
 * ends. Locked rather than plainly read: a plain read in a transaction that
 * began earlier sees the database as it was then on MySQL, and could miss the
 * row the insert just yielded to. SQLite runs one writer at a time, so its
 * writer reads the latest without a lock.
 */
async function standingClaim(
  tx: TransactionContext,
  dialect: SupportedDialect,
  deliveryKey: string
): Promise<ClaimRow | undefined> {
  const table = tableOf(dialect);
  const read = tx
    .getDrizzle<ClaimReadDb>()
    .select({
      status: table.status,
      claimToken: table.claimToken,
      leaseUntil: table.leaseUntil,
    })
    .from(table)
    .where(eq(table.deliveryKey, deliveryKey));
  const [row] = dialect === "sqlite" ? await read : await read.for("update");
  return row;
}

/** One claim attempt: what it writes, and where. */
interface ClaimAttempt {
  tx: TransactionContext;
  dialect: SupportedDialect;
  at: Date;
  /** The lease's length, or null for a claim processed at once (in `tx`). */
  leaseMs: number | null;
  /** The claim's fixed columns: its key, plugin, provider, id and freshness. */
  row: { deliveryKey: string } & Record<string, unknown>;
}

/**
 * Try once to claim a delivery: the token that won it, the answer for a
 * claim that stands, or `undefined` when the row seen went away before it was
 * read, and the attempt should be made again.
 */
async function attemptClaim(
  attempt: ClaimAttempt
): Promise<
  | { won: string }
  | { status: "duplicate" }
  | { status: "in-progress" }
  | undefined
> {
  const { tx, dialect, at, row } = attempt;
  const token = randomUUID();
  // Rounded up to a whole second, so a lease is never shorter than asked on
  // a dialect that keeps times in seconds, and the same length on every one.
  const leaseUntil =
    attempt.leaseMs === null
      ? null
      : new Date(Math.ceil((at.getTime() + attempt.leaseMs) / 1000) * 1000);
  const held = {
    status: leaseUntil === null ? "completed" : "pending",
    claimToken: token,
    leaseUntil,
    completedAt: leaseUntil === null ? at : null,
    pruneAt: leaseUntil ?? at,
  };
  if (await insertIfAbsent(tx, dialect, { ...row, receivedAt: at, ...held })) {
    return { won: token };
  }
  const standing = await standingClaim(tx, dialect, row.deliveryKey);
  // Gone between the insert and the read: released or pruned.
  if (standing === undefined) return undefined;
  if (standing.status === "completed") return { status: "duplicate" };
  if (standing.leaseUntil !== null && standing.leaseUntil > at) {
    return { status: "in-progress" };
  }
  // A lease run out: its handler is taken to have failed, and this retry
  // takes the claim over. The row is locked, and the token always changes, so
  // the update matches on every dialect.
  const taken = await tx.updateCount(RECEIVED_WEBHOOKS_TABLE, held, {
    and: [
      { column: "deliveryKey", op: "=", value: row.deliveryKey },
      { column: "claimToken", op: "=", value: standing.claimToken },
      { column: "status", op: "=", value: "pending" },
    ],
  });
  return taken > 0 ? { won: token } : undefined;
}

/** `value` as a provider or an id: a non-empty, well-formed short string. */
function checkName(name: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NAME_LENGTH ||
    !isStorableText(value)
  ) {
    throw NextlyError.invalidInput({
      message: `${name} must be a well-formed string of 1 to ${MAX_NAME_LENGTH} characters.`,
      logContext: { field: name },
    });
  }
  return value;
}

function checkLease(value: unknown): number {
  if (value === undefined) return DEFAULT_LEASE_SECONDS;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > MAX_LEASE_SECONDS
  ) {
    throw NextlyError.invalidInput({
      message: `leaseSeconds must be a finite number from 1 to ${MAX_LEASE_SECONDS}.`,
      logContext: { leaseSeconds: value },
    });
  }
  return value;
}

/** The facts `verified` was recorded with, or a refusal naming the mistake. */
function factsOf(verified: unknown): VerifiedFacts {
  const facts = verifiedFacts(verified);
  if (facts) return facts;
  throw NextlyError.invalidInput({
    message:
      "claimDelivery takes the verified answer verify returned, as it was returned: not an unverified one, a copy or an object built by hand.",
  });
}

/** Build the helper a plugin receives as `ctx.security.webhooks`. */
export function createPluginReceivedWebhooks(
  options: PluginReceivedWebhooksOptions
): PluginReceivedWebhooks {
  const { owner } = options;
  const now = options.now ?? (() => new Date());

  // Every write on the plugin's transaction or one of its own, as
  // `runPluginWrite` decides.
  const write = pluginWriter(options.adapter);

  /** The claim `token` holds on `deliveryKey`, for its handler to end. */
  const claimOf = (deliveryKey: string, token: string): DeliveryClaim => {
    const held = [
      { column: "deliveryKey", op: "=" as const, value: deliveryKey },
      { column: "claimToken", op: "=" as const, value: token },
    ];
    return {
      async complete(txOption) {
        return write("webhooks.claim.complete", txOption?.tx, async tx => {
          const at = now();
          // Only a pending claim this token still holds: one taken over after
          // its lease is not this handler's to complete. The status always
          // moves, so MySQL, which counts changed rows, counts the match.
          const moved = await tx.updateCount(
            RECEIVED_WEBHOOKS_TABLE,
            {
              status: "completed",
              leaseUntil: null,
              completedAt: at,
              pruneAt: at,
            },
            {
              and: [...held, { column: "status", op: "=", value: "pending" }],
            }
          );
          if (moved > 0) return { completed: true };
          // Completed already by this token: a claim made in a transaction,
          // or a second call. Either way the delivery stands processed.
          const [row] = await tx.select<{ status: string }>(
            RECEIVED_WEBHOOKS_TABLE,
            { columns: ["status"], where: { and: held }, limit: 1 }
          );
          return { completed: row?.status === "completed" };
        });
      },
      async release(txOption) {
        return write("webhooks.claim.release", txOption?.tx, async tx => {
          // Only a pending claim: a processed delivery's record is what
          // answers its retries as duplicates, so no handler can undo it,
          // whatever error it saw after completing.
          const removed = await tx.delete(RECEIVED_WEBHOOKS_TABLE, {
            and: [...held, { column: "status", op: "=", value: "pending" }],
          });
          return { released: removed > 0 };
        });
      },
    };
  };

  return {
    verify(request, verifyOptions) {
      return verifyWebhookRequest(request, verifyOptions, now);
    },

    async claimDelivery(verified, claimOptions: ClaimDeliveryOptions) {
      // Every check before any write: a refused claim leaves nothing behind.
      const facts = factsOf(verified);
      const provider = checkName("provider", claimOptions.provider);
      const id =
        claimOptions.id === undefined
          ? undefined
          : checkName("id", claimOptions.id);
      const leaseMs = checkLease(claimOptions.leaseSeconds) * 1000;
      const deliveryId = id ?? facts.deliveryId;
      // Kinds kept apart, so an id that happens to read as a body's digest
      // never meets that body's claim.
      const deliveryKey = createHash("sha256")
        .update(
          JSON.stringify([
            owner,
            provider,
            deliveryId === undefined ? "body" : "id",
            deliveryId ?? facts.bodyDigest,
          ])
        )
        .digest("hex");
      // Kept for diagnosis only, and only when every dialect can store it:
      // within the column's width and free of what PostgreSQL refuses. The
      // scheme's id is the provider's, never checked as the caller's `id` is,
      // so it is judged here; the key above holds the whole id either way.
      const storedId =
        deliveryId !== undefined &&
        deliveryId.length <= MAX_NAME_LENGTH &&
        isStorableText(deliveryId)
          ? deliveryId
          : null;
      const dialect = options.adapter().dialect;

      return write(
        "webhooks.claimDelivery",
        claimOptions.tx,
        async (adapterTx): Promise<DeliveryClaimResult> => {
          for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const outcome = await attemptClaim({
              tx: adapterTx,
              dialect,
              at: now(),
              // In the plugin's transaction the claim is the processing
              // record at once, as it commits only with the plugin's writes.
              leaseMs: claimOptions.tx === undefined ? leaseMs : null,
              row: {
                deliveryKey,
                owner,
                provider,
                deliveryId: storedId,
                freshness: facts.freshness,
              },
            });
            if (outcome === undefined) continue;
            return "won" in outcome
              ? { status: "first", claim: claimOf(deliveryKey, outcome.won) }
              : outcome;
          }
          throw new NextlyError({
            code: "INTERNAL_ERROR",
            publicMessage: "An unexpected error occurred.",
            logMessage:
              "A received webhook's claim kept changing while it was being claimed.",
            logContext: { owner, provider },
          });
        }
      );
    },
  };
}

/**
 * One editor's claim on one document: taking it, keeping it, and giving it up.
 *
 * Two authors opening the same entry is what this exists for. Without it the
 * second save silently overwrites the first, and neither author is told.
 *
 * ## The claim is decided by the database, never by this process
 *
 * Every liveness comparison is a SQL expression the database evaluates itself.
 * Contenders sit on different machines — under serverless, a different instance
 * per request — whose clocks disagree, so a claim written from one clock and
 * judged against another is decided by that skew rather than by who holds the
 * lock. Asking the database for both sides puts every comparison in one frame
 * of reference.
 *
 * ## Why a takeover is allowed here and refused by the migration lock
 *
 * They share a clock and a TTL derivation, and nothing else. That lock guards
 * DDL, where stealing a live claim means two concurrent migrations corrupting a
 * schema, so it never steals. This one mediates two people, where refusing
 * forever would mean a closed laptop locking a document until its lease runs
 * out with no way to ask for it back. Different questions, different answers,
 * deliberately not shared.
 *
 * ## No flush on takeover
 *
 * Taking a claim over does not move the ousted author's unsaved work anywhere.
 * The editor already writes an autosave into a per-document-per-author row on
 * its own interval, so that work survives on a path that runs whether or not a
 * takeover ever happens — including in the cases a lease actually exists for,
 * where the ousted client is asleep, offline or gone and could not have flushed
 * anything.
 *
 * @module domains/document-lock/document-lock-repository
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import {
  futureExpression,
  nowExpression,
  remainingSecondsExpression,
} from "../../database/lease-clock";
import { NextlyError } from "../../errors/nextly-error";
import { DOCUMENT_LOCK_TABLE } from "../../schemas/document-lock";
import { isUniqueViolation } from "../../shared/lib/unique-violation";

import { documentLockKey } from "./lock-key";
import {
  DOCUMENT_LOCK_RENEW_MARGIN_SECONDS,
  DOCUMENT_LOCK_TTL_SECONDS,
} from "./timings";
import type {
  AcquireDocumentLockOutcome,
  DocumentLockHolder,
  DocumentRef,
  RenewDocumentLockOutcome,
} from "./types";

/** Who is asking, and what the interface should call them. */
export interface DocumentLockClaimant {
  readonly ownerId: string;
  readonly ownerLabel?: string | null;
}

/**
 * The row as the database reports it, with every time question already decided
 * there.
 *
 * `live` is "would this claim still exclude a contender right now", which is
 * what an observer reports. `usable` is the stricter "will it outlast the window
 * before its holder asks again", which is what a claimant needs before it starts
 * editing: a claim shorter than that is live now and gone before anything
 * re-checks it.
 *
 * Both are computed in the same statement as the read, so no caller can hold a
 * holder and a liveness verdict that disagree.
 */
interface LockRow {
  readonly ownerId: string;
  readonly ownerLabel: string | null;
  readonly expiresInSeconds: number;
  readonly live: boolean;
  readonly usable: boolean;
}

interface RawLockRow {
  readonly owner_id: string | null;
  readonly owner_label: string | null;
  readonly expires_in: unknown;
  readonly live: unknown;
  readonly usable: unknown;
}

/**
 * The single statement that reads a lock row and decides both liveness
 * questions.
 *
 * Issued as a raw statement rather than through the typed query builder because
 * the comparisons have to be the database's own clock expressions, which the
 * builder has no way to express.
 *
 * The two verdicts are `CASE` expressions returning 1 or 0 rather than booleans
 * because the dialects return booleans differently — `true`, `1` and `"1"` all
 * occur — and a caller comparing against one of those three is a per-dialect
 * defect no unit double can see. An integer normalises through `Number()` on
 * every driver.
 */
function lockRowQuery(dialect: SupportedDialect, key: string): SQL {
  return sql`SELECT ${sql.identifier("owner_id")},
      ${sql.identifier("owner_label")},
      ${remainingSecondsExpression(dialect, "expires_at")} AS ${sql.identifier("expires_in")},
      CASE WHEN ${sql.identifier("expires_at")} > ${nowExpression(dialect)}
           THEN 1 ELSE 0 END AS ${sql.identifier("live")},
      CASE WHEN ${sql.identifier("expires_at")} > ${futureExpression(dialect, DOCUMENT_LOCK_RENEW_MARGIN_SECONDS)}
           THEN 1 ELSE 0 END AS ${sql.identifier("usable")}
      FROM ${sql.identifier(DOCUMENT_LOCK_TABLE)}
      WHERE ${sql.identifier("lock_key")} = ${key}`;
}

/** The row, or `undefined` when no claim on this document exists at all. */
function toLockRow(row: RawLockRow | undefined): LockRow | undefined {
  if (row === undefined || row.owner_id === null) return undefined;
  return {
    ownerId: row.owner_id,
    ownerLabel: row.owner_label,
    // Every driver reports this differently — a number on SQLite, a string from
    // PostgreSQL's `EXTRACT` on some drivers, a number from MySQL — so it is
    // coerced once here rather than at each of the three call sites.
    expiresInSeconds: Math.trunc(Number(row.expires_in)),
    live: Number(row.live) === 1,
    usable: Number(row.usable) === 1,
  };
}

function toHolder(row: LockRow): DocumentLockHolder {
  return {
    ownerId: row.ownerId,
    ownerLabel: row.ownerLabel,
    expiresInSeconds: row.expiresInSeconds,
  };
}

/**
 * The row this claim was just written to is gone.
 *
 * Only a release landing in the same instant produces this. Reported as a
 * conflict the caller may retry rather than as "somebody else is editing",
 * which would be false — nobody holds the document, including us.
 */
function lockRowVanished(key: string, at: string): never {
  throw NextlyError.conflict({
    reason: "state",
    message: "Could not start editing just now. Please try again.",
    logContext: { reason: "lock row vanished", at, key },
  });
}

/** The key for this document, or a refusal naming why there is not one. */
function keyFor(ref: DocumentRef): string {
  const key = documentLockKey(ref.collection, ref.entryId);
  if (key !== undefined) return key;
  // `invalidInput` rather than `internal`: a collection slug or entry id can
  // reach here from a request, so this is a caller mistake rather than a
  // programming one, and it must not read as a server fault in the log.
  throw NextlyError.invalidInput({
    message: "This document cannot be locked for editing.",
    logContext: {
      reason: "document reference does not form a portable lock key",
      collection: ref.collection,
      entryId: ref.entryId,
    },
  });
}

async function readRow(
  ctx: Pick<TransactionContext, "queryStatement">,
  dialect: SupportedDialect,
  key: string
): Promise<LockRow | undefined> {
  const rows = await ctx.queryStatement<RawLockRow>(lockRowQuery(dialect, key));
  return toLockRow(rows[0]);
}

/**
 * Who holds this document right now, if anybody.
 *
 * Read on the adapter's own connection rather than in a transaction: opening one
 * to read a single row asks for more than the read needs, and this is the call
 * an editor makes on every poll.
 */
export async function readDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef
): Promise<DocumentLockHolder | undefined> {
  const dialect = adapter.getCapabilities().dialect;
  const row = await readRow(adapter, dialect, keyFor(ref));
  return row !== undefined && row.live ? toHolder(row) : undefined;
}

/**
 * Claim this document for editing.
 *
 * Returns `held` rather than throwing when somebody else has it, because that is
 * an ordinary answer with a name and a countdown in it that the interface has to
 * render.
 *
 * `takeover` is the deliberate steal a person asks for after being told who
 * holds it. It is a separate argument rather than a retry of the same call so
 * that no caller can take a document over by accident: an editor opening a
 * document and a person pressing "take over anyway" are different intents and
 * the server can tell them apart.
 */
export async function acquireDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef,
  claimant: DocumentLockClaimant,
  options?: { readonly takeover?: boolean }
): Promise<AcquireDocumentLockOutcome> {
  const dialect = adapter.getCapabilities().dialect;
  const key = keyFor(ref);
  const label = claimant.ownerLabel ?? null;

  return adapter.transaction(async ctx => {
    // Serializes contenders that find an existing row. A row that does NOT yet
    // exist cannot be locked, which is why the insert below is written to
    // survive losing that race rather than to assume it won.
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);

    const existing = await readRow(ctx, dialect, key);

    if (existing === undefined) {
      const inserted = await insertClaim(ctx, dialect, key, ref, claimant);
      if (inserted !== undefined) return inserted;
      // Another contender inserted between our read and our write. Re-reading
      // rather than reporting failure: they may hold it, or their claim may
      // already have lapsed, and only the row can say which.
      const after = await readRow(ctx, dialect, key);
      if (after === undefined) lockRowVanished(key, "contended-insert");
      return acquisitionOf(after, claimant);
    }

    const mine = existing.ownerId === claimant.ownerId;
    const takeable = !existing.live || mine || options?.takeover === true;
    if (!takeable) return { status: "held", holder: toHolder(existing) };

    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("owner_id")} = ${claimant.ownerId},
              ${sql.identifier("owner_label")} = ${label},
              ${sql.identifier("acquired_at")} = ${nowExpression(dialect)},
              ${sql.identifier("expires_at")} = ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)}
          WHERE ${sql.identifier("lock_key")} = ${key}`
    );

    // Read back rather than trusting the update's affected-row count, which the
    // dialects report inconsistently — and which counts a row matched but
    // unchanged differently again.
    const after = await readRow(ctx, dialect, key);
    if (after === undefined) lockRowVanished(key, "acquisition");
    return acquisitionOf(after, claimant);
  });
}

/**
 * Is this row a claim the caller may rely on?
 *
 * 🔴 OWNERSHIP AND USABILITY, never ownership alone. A row can name this
 * claimant and still be spent: a transaction suspended or merely slow between
 * writing the expiry and reading it back can burn more than the TTL inside
 * itself. Reporting success on that hands back a claim a contender may take the
 * instant it commits, while the editor carries on believing it is protected.
 *
 * Returns a boolean rather than an outcome because the two callers name the same
 * verdict differently — acquiring calls it `acquired`/`held`, confirming calls it
 * `renewed`/`lost` — and one function returning both unions could only do it
 * through a cast that erases the difference it exists to preserve.
 */
function holdsIt(row: LockRow, claimant: DocumentLockClaimant): boolean {
  return row.ownerId === claimant.ownerId && row.usable;
}

/** The same verdict, named the way an acquisition names it. */
function acquisitionOf(
  row: LockRow,
  claimant: DocumentLockClaimant
): AcquireDocumentLockOutcome {
  return holdsIt(row, claimant)
    ? { status: "acquired", holder: toHolder(row) }
    : { status: "held", holder: toHolder(row) };
}

/** Insert a first claim, or `undefined` when another contender won the race. */
async function insertClaim(
  ctx: TransactionContext,
  dialect: SupportedDialect,
  key: string,
  ref: DocumentRef,
  claimant: DocumentLockClaimant
): Promise<AcquireDocumentLockOutcome | undefined> {
  try {
    await ctx.runStatement(
      sql`INSERT INTO ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          (${sql.identifier("lock_key")}, ${sql.identifier("collection")},
           ${sql.identifier("entry_id")}, ${sql.identifier("owner_id")},
           ${sql.identifier("owner_label")}, ${sql.identifier("acquired_at")},
           ${sql.identifier("expires_at")})
          VALUES (${key}, ${ref.collection}, ${ref.entryId},
                  ${claimant.ownerId}, ${claimant.ownerLabel ?? null},
                  ${nowExpression(dialect)},
                  ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)})`
    );
  } catch (error) {
    // A duplicate key reaches here in several shapes, nested a couple of
    // wrappers deep; this is the one place that knows all of them.
    if (!isUniqueViolation(error)) throw error;
    return undefined;
  }
  const after = await readRow(ctx, dialect, key);
  if (after === undefined) lockRowVanished(key, "insert");
  return acquisitionOf(after, claimant);
}

/**
 * Confirm a claim this editor believes it still holds.
 *
 * Fenced on ownership in the statement itself, so a heartbeat that arrives after
 * somebody took the document over extends THEIR claim by nothing.
 */
export async function renewDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef,
  claimant: DocumentLockClaimant
): Promise<RenewDocumentLockOutcome> {
  const dialect = adapter.getCapabilities().dialect;
  const key = keyFor(ref);

  return adapter.transaction(async ctx => {
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)}
          WHERE ${sql.identifier("lock_key")} = ${key}
            AND ${sql.identifier("owner_id")} = ${claimant.ownerId}`
    );
    const after = await readRow(ctx, dialect, key);
    // No row at all means the claim lapsed and was cleared, or its holder
    // released it. Reported as lost WITHOUT a holder, which is a different
    // answer from "somebody else has it" and leads the interface to offer
    // resuming rather than requesting access.
    if (after === undefined) return { status: "lost" };
    return holdsIt(after, claimant)
      ? { status: "renewed", holder: toHolder(after) }
      : { status: "lost", holder: toHolder(after) };
  });
}

/**
 * Give up a claim.
 *
 * Fenced on ownership so a late release from a previous holder cannot free the
 * document out from under whoever took it over. Silent when there is nothing to
 * release: an editor closing a tab whose claim already lapsed has nothing to
 * apologise for, and reporting an error there would be noise on a path nobody
 * is watching.
 */
export async function releaseDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef,
  claimant: DocumentLockClaimant
): Promise<void> {
  const key = keyFor(ref);
  await adapter.transaction(async ctx => {
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);
    await ctx.runStatement(
      sql`DELETE FROM ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          WHERE ${sql.identifier("lock_key")} = ${key}
            AND ${sql.identifier("owner_id")} = ${claimant.ownerId}`
    );
  });
}

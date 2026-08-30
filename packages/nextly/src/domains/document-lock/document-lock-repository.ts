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
 * ## A claim is an ACQUISITION, not a person
 *
 * Every claim carries a token minted when it was taken, and every heartbeat and
 * release must present it. Ownership alone is not enough: one author with the
 * document open in two tabs holds two claims under one user id, and a release
 * from the tab they closed would otherwise delete the claim the other tab is
 * still editing under — leaving that tab believing it is protected while
 * somebody else takes the document.
 *
 * ## Why a takeover is allowed here and refused by the migration lock
 *
 * They share a clock and a TTL derivation, and nothing else. That lock guards
 * DDL, where stealing a live claim means two concurrent migrations corrupting a
 * schema, so it never steals. This one mediates two people, where refusing
 * forever would mean a closed laptop locking a document until its lease runs
 * out with no way to ask for it back.
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

import { randomUUID } from "node:crypto";

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
 */
interface LockRow {
  readonly ownerId: string;
  readonly ownerLabel: string | null;
  readonly claimToken: string;
  readonly expiresInSeconds: number;
  readonly live: boolean;
  readonly usable: boolean;
}

interface RawLockRow {
  readonly owner_id: string | null;
  readonly owner_label: string | null;
  readonly claim_token: string | null;
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
      ${sql.identifier("claim_token")},
      ${remainingSecondsExpression(dialect, "expires_at")} AS ${sql.identifier("expires_in")},
      CASE WHEN ${sql.identifier("expires_at")} > ${nowExpression(dialect)}
           THEN 1 ELSE 0 END AS ${sql.identifier("live")},
      CASE WHEN ${sql.identifier("expires_at")} > ${futureExpression(dialect, DOCUMENT_LOCK_RENEW_MARGIN_SECONDS)}
           THEN 1 ELSE 0 END AS ${sql.identifier("usable")}
      FROM ${sql.identifier(DOCUMENT_LOCK_TABLE)}
      WHERE ${sql.identifier("id")} = ${key}`;
}

/** The row, or `undefined` when no claim on this document exists at all. */
function toLockRow(row: RawLockRow | undefined): LockRow | undefined {
  if (row === undefined || row.owner_id === null) return undefined;
  return {
    ownerId: row.owner_id,
    ownerLabel: row.owner_label,
    claimToken: row.claim_token ?? "",
    // Every driver reports this differently — a number on SQLite, a string from
    // PostgreSQL's `EXTRACT` on some drivers, a number from MySQL — so it is
    // coerced once here rather than at each call site.
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

/** The key for this document, or a refusal naming why there is not one. */
function keyFor(ref: DocumentRef): string {
  const key = documentLockKey(ref.scopeKind, ref.slug, ref.entryId);
  if (key !== undefined) return key;
  // `invalidInput` rather than `internal`: a slug or entry id can reach here
  // from a request, so this is a caller mistake rather than a programming one,
  // and it must not read as a server fault in the log.
  throw NextlyError.invalidInput({
    message: "This document cannot be locked for editing.",
    logContext: {
      reason: "document reference does not form a portable lock key",
      scopeKind: ref.scopeKind,
      slug: ref.slug,
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
 * An insert that yields to a concurrent winner instead of raising.
 *
 * 🔴 Deliberately NOT a caught unique violation. On PostgreSQL a constraint
 * error aborts the whole transaction, so catching `23505` leaves a context in
 * which every later statement fails with `25P02` — the read that was supposed
 * to report the winner cannot run. Letting the database ignore the conflict
 * keeps the transaction usable, and the read-back that follows is then the one
 * thing that decides the outcome.
 *
 * MySQL cannot express `ON CONFLICT`, and PostgreSQL and SQLite cannot express
 * `INSERT IGNORE`; the spelling differs per dialect but the semantics are the
 * same on all three.
 */
function insertIfAbsent(
  dialect: SupportedDialect,
  key: string,
  ref: DocumentRef,
  claimant: DocumentLockClaimant,
  claimToken: string
): SQL {
  const columns = sql`(${sql.identifier("id")}, ${sql.identifier("scope_kind")},
      ${sql.identifier("slug")}, ${sql.identifier("entry_id")},
      ${sql.identifier("owner_id")}, ${sql.identifier("claim_token")},
      ${sql.identifier("owner_label")}, ${sql.identifier("acquired_at")},
      ${sql.identifier("expires_at")})`;
  const values = sql`VALUES (${key}, ${ref.scopeKind}, ${ref.slug}, ${ref.entryId},
      ${claimant.ownerId}, ${claimToken}, ${claimant.ownerLabel ?? null},
      ${nowExpression(dialect)},
      ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)})`;

  if (dialect === "mysql") {
    return sql`INSERT IGNORE INTO ${sql.identifier(DOCUMENT_LOCK_TABLE)} ${columns} ${values}`;
  }
  return sql`INSERT INTO ${sql.identifier(DOCUMENT_LOCK_TABLE)} ${columns} ${values}
      ON CONFLICT (${sql.identifier("id")}) DO NOTHING`;
}

/**
 * The row this claim was just written to is gone.
 *
 * Only a release or a sweep landing in the same instant produces this. Reported
 * as a conflict the caller may retry rather than as "somebody else is editing",
 * which would be false — nobody holds the document, including us.
 */
function lockRowVanished(key: string): never {
  throw NextlyError.conflict({
    reason: "state",
    message: "Could not start editing just now. Please try again.",
    logContext: { reason: "lock row vanished during acquisition", key },
  });
}

/** Whether this existing claim may be replaced by the caller's. */
function isTakeable(
  existing: LockRow,
  claimant: DocumentLockClaimant,
  takeover: boolean
): boolean {
  // Lapsed, ours to renew, or deliberately taken over by a person who was told
  // who held it.
  return (
    !existing.live || existing.ownerId === claimant.ownerId || takeover === true
  );
}

/** Replace whatever claim the row carries with this one. */
function writeClaim(
  dialect: SupportedDialect,
  key: string,
  claimant: DocumentLockClaimant,
  claimToken: string
): SQL {
  return sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
      SET ${sql.identifier("owner_id")} = ${claimant.ownerId},
          ${sql.identifier("claim_token")} = ${claimToken},
          ${sql.identifier("owner_label")} = ${claimant.ownerLabel ?? null},
          ${sql.identifier("acquired_at")} = ${nowExpression(dialect)},
          ${sql.identifier("expires_at")} = ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)}
      WHERE ${sql.identifier("id")} = ${key}`;
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
  const claimToken = randomUUID();

  return adapter.transaction(async ctx => {
    // 🔴 INSERT FIRST, then lock. `lockRow` issues `SELECT ... FOR UPDATE`, and
    // on a row that does not exist yet InnoDB answers that with a GAP lock —
    // two contenders opening the same fresh document then deadlock, which is a
    // failed acquisition on a path with no conflict in it. Creating the row
    // first is atomic on every dialect and needs no prior lock, so by the time
    // anything is locked the row is a real row and the lock is an ordinary one.
    await ctx.runStatement(
      insertIfAbsent(dialect, key, ref, claimant, claimToken)
    );
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);

    const existing = await readRow(ctx, dialect, key);

    // Ours already: the insert above found no row and wrote this claim. Nothing
    // to update, and no other outcome is possible for this token.
    if (existing !== undefined && existing.claimToken === claimToken) {
      return { status: "acquired", holder: toHolder(existing), claimToken };
    }

    if (existing === undefined) lockRowVanished(key);
    if (!isTakeable(existing, claimant, options?.takeover === true)) {
      return { status: "held", holder: toHolder(existing) };
    }

    await ctx.runStatement(writeClaim(dialect, key, claimant, claimToken));

    // Read back rather than trusting an affected-row count, which the dialects
    // report inconsistently — and which counts a row matched but unchanged
    // differently again.
    const after = await readRow(ctx, dialect, key);
    if (after === undefined) lockRowVanished(key);

    // 🔴 The TOKEN decides, not the owner. A concurrent acquisition by the same
    // author writes a different token, so comparing owners would report both
    // callers as holders of one claim and let either release the other's.
    if (after.claimToken !== claimToken || !after.usable) {
      return { status: "held", holder: toHolder(after) };
    }
    return { status: "acquired", holder: toHolder(after), claimToken };
  });
}

/**
 * Confirm a claim this editor believes it still holds.
 *
 * Fenced in the statement itself on the acquisition token AND on the claim still
 * being live, so a heartbeat that arrives after somebody took the document over,
 * from a tab whose claim was replaced, or after the lease already lapsed,
 * extends nothing.
 */
export async function renewDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef,
  claimToken: string
): Promise<RenewDocumentLockOutcome> {
  const dialect = adapter.getCapabilities().dialect;
  const key = keyFor(ref);

  return adapter.transaction(async ctx => {
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);
    await ctx.runStatement(
      sql`UPDATE ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          SET ${sql.identifier("expires_at")} = ${futureExpression(dialect, DOCUMENT_LOCK_TTL_SECONDS)}
          WHERE ${sql.identifier("id")} = ${key}
            AND ${sql.identifier("claim_token")} = ${claimToken}
            AND ${sql.identifier("expires_at")} > ${nowExpression(dialect)}`
    );
    const after = await readRow(ctx, dialect, key);
    // No row at all means the claim lapsed and was swept, or its holder
    // released it. Reported as lost WITHOUT a holder, which is a different
    // answer from "somebody else has it" and leads the interface to offer
    // resuming rather than requesting access.
    if (after === undefined) return { status: "lost" };
    // 🔴 Liveness is a PRECONDITION of renewal, not a consequence of it. Without
    // the clause above, a heartbeat arriving after expiry — but before anyone
    // else acquired — would revive a claim that was already free for the taking,
    // and the author who was about to acquire would be refused by a lease that
    // should not have existed.
    if (after.claimToken !== claimToken || !after.usable) {
      return { status: "lost", holder: toHolder(after) };
    }
    return { status: "renewed", holder: toHolder(after) };
  });
}

/**
 * Give up a claim.
 *
 * Fenced on the acquisition token so neither a late release from a previous
 * holder nor one from the author's own closed second tab can free the document
 * out from under whoever is editing now. Silent when there is nothing to
 * release: an editor closing a tab whose claim already lapsed has nothing to
 * apologise for, and an error there would be noise on a path nobody watches.
 */
export async function releaseDocumentLock(
  adapter: DrizzleAdapter,
  ref: DocumentRef,
  claimToken: string
): Promise<void> {
  const key = keyFor(ref);
  await adapter.transaction(async ctx => {
    await ctx.lockRow(DOCUMENT_LOCK_TABLE, key);
    await ctx.runStatement(
      sql`DELETE FROM ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          WHERE ${sql.identifier("id")} = ${key}
            AND ${sql.identifier("claim_token")} = ${claimToken}`
    );
  });
}

/**
 * Delete every claim that has lapsed.
 *
 * A released claim deletes its own row, so this only ever collects the ones
 * nobody came back from — a crashed tab, a closed laptop, a lost connection.
 * Without it the table would keep one row per document ever OPENED rather than
 * per document open now, and the docblock's bound would be a claim nothing
 * enforced.
 *
 * Bounded by the database's clock like every other comparison here, so a sweep
 * running on an instance whose clock is behind cannot delete a live claim.
 *
 * @returns nothing — a sweep that deletes nothing is the ordinary case, and a
 * count nobody reads would only invite treating it as a health signal.
 */
export async function sweepExpiredDocumentLocks(
  adapter: DrizzleAdapter
): Promise<void> {
  const dialect = adapter.getCapabilities().dialect;
  await adapter.transaction(async ctx => {
    await ctx.runStatement(
      sql`DELETE FROM ${sql.identifier(DOCUMENT_LOCK_TABLE)}
          WHERE ${sql.identifier("expires_at")} <= ${nowExpression(dialect)}`
    );
  });
}

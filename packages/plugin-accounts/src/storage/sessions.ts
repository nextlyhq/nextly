import { and, asc, eq, lt, lte, or } from "@nextlyhq/plugin-sdk/db";
import type { InferRow } from "@nextlyhq/plugin-sdk/schema";

import { sessions } from "../schema/tables";

import type { AccountsDb } from "./accounts";
import { accountRowsExcept } from "./filters";

/** A session as its row holds it: never the token, only its hash. */
export type SessionRow = InferRow<typeof sessions>;

/** How long a session lasts, from the site's settings. */
export interface SessionLimits {
  /** Ended this long after its last use. */
  idleMs: number;
  /** Ended this long after it started, however often it is used. */
  absoluteMs: number;
  /** The most sessions one account keeps; starting another ends the oldest. */
  perAccount: number;
}

/**
 * Starts a session for an account, keeping only the hash of its token, and
 * ends the account's oldest sessions past `perAccount`. A flow starts it in
 * the transaction that checked the account's security version, so a change
 * that ends sessions and commits first is seen.
 */
export async function startSession(
  db: AccountsDb,
  input: { accountId: string; tokenHash: string; now: Date },
  limits: SessionLimits
): Promise<SessionRow> {
  const { accountId, tokenHash, now } = input;
  const absoluteExpiresAt = new Date(now.getTime() + limits.absoluteMs);
  const session = await db.insertReturning(sessions, {
    accountId,
    tokenHash,
    lastUsedAt: now,
    idleExpiresAt: earlier(
      new Date(now.getTime() + limits.idleMs),
      absoluteExpiresAt
    ),
    absoluteExpiresAt,
  });

  const columns = db.table(sessions);
  const held = await db
    .select(sessions)
    .where(eq(columns.accountId, accountId))
    .orderBy(asc(columns.createdAt), asc(columns.id))
    .all();
  for (const oldest of held.slice(
    0,
    Math.max(0, held.length - limits.perAccount)
  )) {
    await db.delete(sessions).where(eq(columns.id, oldest.id));
  }

  return session;
}

/** The live session a token's hash names, or null when there is none or it has ended. */
export async function liveSession(
  db: AccountsDb,
  tokenHash: string,
  now: Date
): Promise<SessionRow | null> {
  const columns = db.table(sessions);
  const session = await db
    .select(sessions)
    .where(eq(columns.tokenHash, tokenHash))
    .first();
  if (session === null) return null;

  return isLive(session, now) ? session : null;
}

/**
 * Records a session's use, moving its idle expiry on. Written at most once a
 * tenth of the idle period, which is how close to its last use the idle
 * expiry is counted, so a busy session is not a write on every request, and
 * only over an older use: of two requests at once, the slower never moves
 * the expiry back. Answers whether it wrote.
 */
export async function touchSession(
  db: AccountsDb,
  session: SessionRow,
  now: Date,
  limits: Pick<SessionLimits, "idleMs">
): Promise<boolean> {
  if (now.getTime() - session.lastUsedAt.getTime() < limits.idleMs / 10)
    return false;
  const columns = db.table(sessions);
  const older = and(eq(columns.id, session.id), lt(columns.lastUsedAt, now));
  if (older === undefined) throw new TypeError("The touch lost its condition.");
  const written = await db
    .update(sessions, {
      lastUsedAt: now,
      idleExpiresAt: earlier(
        new Date(now.getTime() + limits.idleMs),
        session.absoluteExpiresAt
      ),
    })
    .where(older);

  return written === 1;
}

/** Ends the session a token's hash names (signing out). */
export async function endSession(
  db: AccountsDb,
  tokenHash: string
): Promise<void> {
  const columns = db.table(sessions);
  await db.delete(sessions).where(eq(columns.tokenHash, tokenHash));
}

/**
 * Ends every session of an account, or every one but the session that made
 * the change (`except`, its token's hash). Answers how many ended.
 */
export async function endAccountSessions(
  db: AccountsDb,
  accountId: string,
  options: { except?: string } = {}
): Promise<number> {
  const columns = db.table(sessions);
  const condition = accountRowsExcept(columns, accountId, options.except);

  return db.delete(sessions).where(condition);
}

/** Removes every session past either expiry. Answers how many it removed. */
export async function sweepSessions(
  db: AccountsDb,
  now: Date
): Promise<number> {
  const columns = db.table(sessions);
  const ended = or(
    lte(columns.idleExpiresAt, now),
    lte(columns.absoluteExpiresAt, now)
  );
  if (ended === undefined)
    throw new TypeError("The sweep lost its expiry filter.");

  return db.delete(sessions).where(ended);
}

function isLive(session: SessionRow, now: Date): boolean {
  return session.idleExpiresAt > now && session.absoluteExpiresAt > now;
}

function earlier(a: Date, b: Date): Date {
  return a < b ? a : b;
}

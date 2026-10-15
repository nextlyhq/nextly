import { and, asc, eq, inArray, lte } from "@nextlyhq/plugin-sdk/db";
import type { InferRow } from "@nextlyhq/plugin-sdk/schema";

import { knownBrowsers } from "../schema/tables";

import type { AccountsDb } from "./accounts";
import { accountRowsExcept } from "./filters";

/** A browser known to an account, as its row holds it: never the token, only its hash. */
export type KnownBrowserRow = InferRow<typeof knownBrowsers>;

/** Sign-in attempts in a row a known browser's token may fail before it skips nothing. */
export const KNOWN_BROWSER_CAP = 10;

/** A token's count started again, as a proven password through it leaves it. */
const COUNT_STARTED_AGAIN = {
  failuresInARow: 0,
  cappedAt: null,
  lastFailedCheckAt: null,
} as const;

/** How many times a charge re-reads a count another attempt moved first, before refusing. */
const CHARGE_RETRIES = 50;

/** The moment a browser last known at or before is no longer known: `days` before `now`. */
function knownCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** The known browsers these token hashes name, each still within `days` of when it was last known. */
export async function liveKnownBrowsers(
  db: AccountsDb,
  tokenHashes: readonly string[],
  now: Date,
  days: number
): Promise<KnownBrowserRow[]> {
  if (tokenHashes.length === 0) return [];
  const columns = db.table(knownBrowsers);
  const rows = await db
    .select(knownBrowsers)
    .where(inArray(columns.tokenHash, [...tokenHashes]))
    .all();
  const cutoff = knownCutoff(now, days);

  return rows.filter(row => row.knownAt > cutoff);
}

/**
 * Charges a sign-in attempt to a known browser's token before the attempt
 * starts: one more failure in a row, which a sign-in to its account later
 * starts again. Answers whether the attempt took one of the cap's slots: of
 * any number of attempts at once, on any number of instances, exactly
 * `KNOWN_BROWSER_CAP` do. The count moves by compare-and-set, so two
 * attempts never take one slot; one that keeps losing the race is answered
 * as past the cap, the safe side. Reaching the cap records when.
 */
export async function chargeKnownBrowser(
  db: AccountsDb,
  id: string,
  now: Date
): Promise<boolean> {
  const columns = db.table(knownBrowsers);
  for (let attempt = 0; attempt < CHARGE_RETRIES; attempt += 1) {
    const current = await db
      .select(knownBrowsers)
      .where(eq(columns.id, id))
      .first();
    if (current === null || current.failuresInARow >= KNOWN_BROWSER_CAP)
      return false;
    const next = current.failuresInARow + 1;
    const unchanged = and(
      eq(columns.id, id),
      eq(columns.failuresInARow, current.failuresInARow)
    );
    if (unchanged === undefined)
      throw new TypeError("The charge lost its compare.");
    const written = await db
      .update(
        knownBrowsers,
        next >= KNOWN_BROWSER_CAP
          ? { failuresInARow: next, cappedAt: now }
          : { failuresInARow: next }
      )
      .where(unchanged);
    if (written === 1) return true;
  }

  return false;
}

/** A known browser by its row's id, or null when it is gone. */
export async function knownBrowserById(
  db: AccountsDb,
  id: string
): Promise<KnownBrowserRow | null> {
  const columns = db.table(knownBrowsers);

  return db.select(knownBrowsers).where(eq(columns.id, id)).first();
}

/**
 * Starts a token's count again, as a password proven through it does: the
 * attempts it was charged with were its own holder's.
 */
export async function startCountAgain(
  db: AccountsDb,
  id: string
): Promise<void> {
  const columns = db.table(knownBrowsers);
  await db.update(knownBrowsers, COUNT_STARTED_AGAIN).where(eq(columns.id, id));
}

/** Records a failed password check through a token, which a capped token's own wait runs from. */
export async function recordFailedCheck(
  db: AccountsDb,
  id: string,
  now: Date
): Promise<void> {
  const columns = db.table(knownBrowsers);
  await db
    .update(knownBrowsers, { lastFailedCheckAt: now })
    .where(eq(columns.id, id));
}

/**
 * When a capped token's own account's address may be tried through it
 * again: 60 seconds after the later of the moment it reached its cap and
 * its last failed password check. Null for a token under its cap.
 */
export function cappedUntil(
  row: Pick<
    KnownBrowserRow,
    "failuresInARow" | "cappedAt" | "lastFailedCheckAt"
  >
): Date | null {
  if (row.failuresInARow < KNOWN_BROWSER_CAP || row.cappedAt === null)
    return null;
  const from = Math.max(
    row.cappedAt.getTime(),
    row.lastFailedCheckAt?.getTime() ?? 0
  );

  return new Date(from + 60_000);
}

/**
 * Makes the browser known to the account, or known again: a new token's
 * row, or its existing row with its count started again and its expiry
 * running from now. Past `perAccount`, the account's longest-unknown
 * browsers are forgotten.
 */
export async function rememberBrowser(
  db: AccountsDb,
  input: { accountId: string; tokenHash: string; now: Date },
  perAccount: number
): Promise<void> {
  const columns = db.table(knownBrowsers);
  const known = { knownAt: input.now, ...COUNT_STARTED_AGAIN };
  const existing = await db
    .select(knownBrowsers)
    .where(eq(columns.tokenHash, input.tokenHash))
    .first();
  if (existing !== null && existing.accountId === input.accountId) {
    await db.update(knownBrowsers, known).where(eq(columns.id, existing.id));
  } else if (existing === null) {
    await db.insert(knownBrowsers, {
      accountId: input.accountId,
      tokenHash: input.tokenHash,
      ...known,
    });
  } else {
    throw new TypeError("A known-browser token belongs to another account.");
  }

  const held = await db
    .select(knownBrowsers)
    .where(eq(columns.accountId, input.accountId))
    .orderBy(asc(columns.knownAt), asc(columns.id))
    .all();
  const forgotten = held
    .slice(0, Math.max(0, held.length - perAccount))
    .map(row => row.id);
  if (forgotten.length > 0)
    await db.delete(knownBrowsers).where(inArray(columns.id, forgotten));
}

/** Forgets every browser known to the account, or every one but `except` (its token's hash). */
export async function forgetBrowsers(
  db: AccountsDb,
  accountId: string,
  options: { except?: string } = {}
): Promise<number> {
  const columns = db.table(knownBrowsers);
  const condition = accountRowsExcept(columns, accountId, options.except);

  return db.delete(knownBrowsers).where(condition);
}

/** Removes every browser last known `days` or more before `now`. */
export async function sweepKnownBrowsers(
  db: AccountsDb,
  now: Date,
  days: number
): Promise<number> {
  const columns = db.table(knownBrowsers);

  return db
    .delete(knownBrowsers)
    .where(lte(columns.knownAt, knownCutoff(now, days)));
}

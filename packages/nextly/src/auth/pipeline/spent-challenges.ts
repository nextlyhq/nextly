/**
 * Two-factor challenges already answered correctly, kept in the database.
 *
 * A pending token is a JWT that stays valid until it expires, so without a
 * record of its flow being answered, the same token and answer could be
 * presented again to mint a second session. The record is one row per flow,
 * keyed by the flow's mark: the first correct answer inserts it, and the
 * primary key makes every other insert fail, on every instance sharing the
 * database. So single use holds whichever limit store the site selected,
 * shared or not.
 *
 * The insert commits in a transaction of its own and never joins one. On
 * SQLite every request shares one connection, so a lone insert made while
 * another request's transaction is open would run inside it and be undone
 * by its rollback, leaving the flow answerable again; in its own transaction
 * it queues behind the open one instead.
 *
 * @module auth/pipeline/spent-challenges
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, lte } from "drizzle-orm";

import { getStaticRelations } from "../../database/static-relations";
import { getNextlyLogger } from "../../observability/logger";
import { spentChallengesTables } from "../../schemas/spent-challenges";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";
import { isUniqueViolation } from "../../shared/lib/unique-violation";

/** The most expired marks one sweep removes. */
const SWEEP_BATCH = 500;

/**
 * How long past its pending token's end a mark must be kept: what a caller
 * adds to that end to make the mark's `expiresAt`.
 *
 * An answer is let through on the token's lifetime when it arrives, and may
 * reach the mark after that lifetime has ended, its resolver having taken
 * the time. Were the mark gone at the end, a second answer let through at
 * the same moment could write its own after the first had been removed, and
 * both would go on to a session. Kept this long after, every answer let
 * through before the end meets it, whichever store keeps the marks.
 */
export const SPENT_MARK_GRACE_MS = 60 * 60_000;

/** Which flows were answered already, and marking one so. */
export interface SpentChallenges {
  /** Whether the flow whose mark is `mark` was answered already. */
  isSpent(mark: string): Promise<boolean>;
  /**
   * Mark the flow answered, keeping the mark until `expiresAt` (ms since the
   * epoch): its pending token's end plus {@link SPENT_MARK_GRACE_MS}. True
   * for the one caller whose mark was written, false for every other, for
   * as long as the mark is kept. Commits on its own before it returns, and
   * throws when the calling flow has a transaction open.
   */
  spend(mark: string, expiresAt: number): Promise<boolean>;
}

/** The statements the marks take, on a handle or in a transaction. */
interface MarkDb {
  select<R>(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): { limit(rows: number): PromiseLike<R[]> };
    };
  };
  insert(table: unknown): { values(row: unknown): PromiseLike<unknown> };
  delete(table: unknown): { where(condition: unknown): PromiseLike<unknown> };
}

/** Run `work` in a transaction of the adapter's own. */
function inOwnTransaction<T>(
  adapter: DrizzleAdapter,
  work: (db: MarkDb) => Promise<T>
): Promise<T> {
  const relations = getStaticRelations(adapter.getCapabilities().dialect);
  return runAdapterTransaction<T, TransactionContext>(
    run => adapter.transaction(ctx => run(ctx)),
    ctx => work(ctx.drizzleWithRelations<MarkDb>(relations))
  );
}

/**
 * Remove marks kept until `now` (ms since the epoch) or before, at most
 * `batch` of them, and say how many went.
 *
 * By then a mark guards nothing: its `expiresAt` is a grace past its token's
 * end, so every answer let through before that end has long reached it. Each
 * mark written sweeps after itself, so the table holds about as many rows as
 * flows answered within a token lifetime and the grace.
 */
export async function sweepSpentChallenges(
  adapter: DrizzleAdapter,
  now: number,
  batch = SWEEP_BATCH
): Promise<number> {
  const table = spentChallengesTables(
    adapter.getCapabilities().dialect
  ).nextlySpentChallenges;
  const expired = await adapter
    .getDrizzle<MarkDb>()
    .select<{ id: string }>({ id: table.id })
    .from(table)
    .where(lte(table.expiresAt, now))
    .limit(batch);
  if (expired.length === 0) return 0;
  // A write like the mark itself: in a transaction of its own, so another
  // request's rollback on SQLite cannot bring the rows back.
  await inOwnTransaction(adapter, db =>
    Promise.resolve(
      db.delete(table).where(
        and(
          inArray(
            table.id,
            expired.map(row => row.id)
          ),
          lte(table.expiresAt, now)
        )
      )
    )
  );
  return expired.length;
}

/** The marks kept in `adapter`'s database. */
export function databaseSpentChallenges(
  adapter: DrizzleAdapter,
  options: { now?: () => number } = {}
): SpentChallenges {
  const now = options.now ?? Date.now;
  const table = spentChallengesTables(
    adapter.getCapabilities().dialect
  ).nextlySpentChallenges;

  return {
    async isSpent(mark) {
      const found = await adapter
        .getDrizzle<MarkDb>()
        .select<{ id: string }>({ id: table.id })
        .from(table)
        .where(eq(table.id, mark))
        .limit(1);
      return found.length > 0;
    },

    async spend(mark, expiresAt) {
      assertNoOpenTransaction(
        adapter,
        "Marking a two-factor challenge answered"
      );
      try {
        await inOwnTransaction(adapter, db =>
          Promise.resolve(db.insert(table).values({ id: mark, expiresAt }))
        );
      } catch (error) {
        // Another answer's mark is already there: this one lost.
        if (isUniqueViolation(error)) return false;
        throw error;
      }
      // After the commit, and never failing the answer that won: the mark
      // stands whether or not the sweep runs.
      await sweepSpentChallenges(adapter, now()).catch((error: unknown) => {
        getNextlyLogger().warn({
          kind: "spent-challenges-sweep-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return true;
    },
  };
}

import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
} from "@nextlyhq/plugin-sdk/schema";

import { commerceError } from "../errors";
import { ownTransaction } from "../own-transaction";
import { jobHealth } from "../schema/tables";

/**
 * Record that a commerce job ran at `now`. One row per job: the first run
 * inserts it, every later run moves it forward. Two first runs racing each
 * other both reach the same row, since the loser of the insert updates it.
 */
export async function recordJobRun(
  db: PluginDatabase,
  dialect: Parameters<typeof isUniqueViolation>[0],
  job: string,
  now: Date
): Promise<void> {
  const moveForward = () =>
    ownTransaction(db, tx =>
      tx
        .update(jobHealth, { lastRunAt: now, updatedAt: now })
        .where(eq(tx.table(jobHealth).job, job))
    );
  if ((await moveForward()) > 0) return;
  try {
    await ownTransaction(db, tx =>
      tx.insert(jobHealth, {
        job,
        lastRunAt: now,
        createdAt: now,
        updatedAt: now,
      })
    );
  } catch (error) {
    if (!isUniqueViolation(dialect, error)) throw error;
    await moveForward();
  }
}

/** When `job` last ran, or `null` if it never has. */
export async function lastJobRun(
  db: PluginDatabase,
  job: string
): Promise<Date | null> {
  const h = db.table(jobHealth);
  const row = await db.select(jobHealth).where(eq(h.job, job)).first();
  return row?.lastRunAt ?? null;
}

/**
 * Refuse to start a checkout while `job` has not run within `staleAfterMs`,
 * or has never run. Settlement, expiry and every step that must follow a
 * checkout depend on the jobs running, so money taken while they are not
 * would leave orders that never finish.
 *
 * @throws `COMMERCE_JOBS_NOT_RUNNING`
 */
export async function assertJobsRunning(options: {
  readonly db: PluginDatabase;
  readonly job: string;
  readonly now: Date;
  readonly staleAfterMs: number;
  /** Told whenever checkout is refused, so staff hear of it. */
  readonly alert: (lastRunAt: Date | null) => void;
}): Promise<void> {
  const lastRunAt = await lastJobRun(options.db, options.job);
  const fresh =
    lastRunAt !== null &&
    options.now.getTime() - lastRunAt.getTime() <= options.staleAfterMs;
  if (fresh) return;
  options.alert(lastRunAt);
  throw commerceError("COMMERCE_JOBS_NOT_RUNNING", {
    job: options.job,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    staleAfterMs: options.staleAfterMs,
  });
}

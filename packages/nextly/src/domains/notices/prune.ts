/**
 * Retention for notices: they are kept as long as the activity log keeps its
 * records, and removed after, oldest first, in bounded batches.
 *
 * A notice is a record of something that happened to a person's work, so it
 * shares the activity log's window rather than having a second setting a site
 * would have to keep in step with the first.
 *
 * @module domains/notices/prune
 */
import { NOTICES_TABLE } from "../../schemas/notices/table-name";
import type { Logger } from "../../shared/types";
import { warnQuietly } from "../retention/safe-log";

import { deleteNoticesOlderThan, type NoticesPruneDb } from "./notices-service";

/** Rows removed per statement: small enough to keep each delete short. */
const NOTICE_PRUNE_BATCH = 500;

/**
 * Remove notices older than `maxAgeMs`, at most `maxBatches` batches.
 *
 * Never throws: a retention pass is offered by ordinary writes, and a failure
 * here must not reach the write that offered it.
 *
 * @returns how many notices were removed, and whether a batch was started:
 *   a pass that started none (its time already spent) did no work, and its
 *   caller should give its turn back.
 */
export async function pruneNoticesSafely(
  deps: {
    db: NoticesPruneDb;
    now?: () => Date;
    logger?: Logger;
    /** Stop between batches once this passes: the drain's wall-clock promise. */
    deadline?: Date;
  },
  maxAgeMs: number,
  maxBatches: number
): Promise<{ removed: number; started: boolean }> {
  const now = deps.now ?? (() => new Date());
  const before = new Date(now().getTime() - maxAgeMs);
  let removed = 0;
  let started = false;
  try {
    // A database from before notices has nothing to prune; passed over
    // without a warning on every pass.
    if (deps.db.tableExists && !(await deps.db.tableExists(NOTICES_TABLE))) {
      return { removed: 0, started: true };
    }
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (deps.deadline !== undefined && now() >= deps.deadline) break;
      started = true;
      const count = await deleteNoticesOlderThan(
        deps.db,
        before,
        NOTICE_PRUNE_BATCH
      );
      removed += count;
      if (count < NOTICE_PRUNE_BATCH) break;
    }
  } catch (error) {
    // A failure is a pass that ran: retrying at once would fail the same way.
    started = true;
    warnQuietly(deps.logger, "Notices retention pass failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
  return { removed, started };
}

/**
 * A barrier for concurrency tests: wait until the database shows another
 * session blocked on a lock.
 *
 * @module domains/versions/__tests__/helpers/lock-wait
 */
import type { TestDialect, TestNextly } from "../../../../plugins/test-nextly";

/**
 * Resolve once another session in this test database is waiting on a lock:
 * the point at which the work a test races is known to be blocked, rather than
 * assumed to be after a delay. A delay passes vacuously when the blocked side
 * is merely slow to start; this fails instead, by timing out, when nothing
 * ever waits, which is what a missing lock looks like.
 *
 * Callers release the transaction they hold in a `finally`: a barrier that
 * fails would otherwise leave it open, and the teardown waiting on it would
 * hang and hide the failure.
 */
export async function untilSomeoneWaitsOnALock(
  adapter: Pick<TestNextly["adapter"], "executeQuery">,
  dialect: TestDialect
): Promise<void> {
  const sql =
    dialect === "postgresql"
      ? "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
      : // `innodb_trx` does not list every waiting session; the lock-wait view
        // does, with the waiter's database.
        "SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.thread_id = w.REQUESTING_THREAD_ID WHERE t.processlist_db = DATABASE()";
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await adapter.executeQuery<{ n: number | string }>(sql);
    if (Number(rows[0]?.n ?? 0) > 0) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("no session started waiting on a lock within 10s");
}

/**
 * The RBAC epoch: how many times authorization data has changed, install-wide.
 *
 * Every cache of an authorization answer is filed under the epoch it was
 * computed at, and an answer filed under an older one is not served. The
 * counter it replaces was a module variable, so it moved only in the process
 * that handled the change: a second instance neither saw the move nor had one
 * of its own, and served what it had cached until the entry aged out.
 *
 * ## Read from memory, refreshed on a timer
 *
 * `currentEpoch()` is synchronous because the checks that ask it are — they sit
 * between a read and a cache write, on a path taken on every request. So the
 * value is held in memory and refreshed by `refreshEpoch()`, which the async
 * entry points call before they capture the epoch they will file under.
 *
 * The refresh is rate-limited to one read per {@link EPOCH_TTL_MS}. That
 * interval is the bound on how long an instance can be unaware of another
 * instance's change, and it buys back the per-request query the naive version
 * would cost: one indexed read per second per instance rather than one per
 * authorization check.
 *
 * An instance's OWN change is not subject to that delay. `bumpEpoch` advances
 * the in-memory value as soon as the write lands, so the process that made the
 * change never serves a stale answer of its own making.
 *
 * ## Degrading when the table is not there
 *
 * An installation upgraded from a version without this table has no row to read
 * until `nextly db:sync` reconciles the core tables. Every read and write here
 * therefore degrades to the previous behaviour — a counter local to this
 * process — rather than failing the authorization check that asked. The
 * degraded state is strictly what the install had before, so it cannot be worse
 * than not having upgraded; it is reported once so an operator can see why
 * cross-instance invalidation is not yet in effect.
 *
 * @module services/lib/rbac-epoch
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, sql } from "drizzle-orm";

import { container } from "../../di/container";
import { getAuthLogger } from "../../lib/logger";
import { RBAC_EPOCH_ROW_ID, rbacEpochTables } from "../../schemas/rbac-epoch";

/**
 * How long a read of the shared counter is reused.
 *
 * This is the bound on cross-instance staleness, so it is deliberately short.
 * A second is long enough to collapse a burst of authorization checks onto one
 * query and short enough that a revocation is everywhere before an operator has
 * finished watching for it.
 */
export const EPOCH_TTL_MS = 1000;

/**
 * The epoch this process is currently answering with, and when it was read.
 *
 * `readAt` is zero until the first successful read, which is what makes the
 * first `refreshEpoch()` of a process actually go to the database rather than
 * trusting an initial value nothing established.
 */
let epoch = 0;
let readAt = 0;

/**
 * Whether the shared counter has been found unreadable.
 *
 * Held so the warning is emitted once rather than on every check: an install
 * that has not reconciled its core tables would otherwise log per request, and
 * a log nobody can read is the same as no log.
 */
let degraded = false;

/**
 * The narrow view of the query builder this module uses.
 *
 * `getDrizzle()` is typed `unknown` because the concrete builder differs per
 * driver, and the repository narrows it structurally at each call site rather
 * than casting — the same shape `services/lib/permissions.ts` declares for its
 * reads. Spelling out only the three statements used here keeps the module
 * typed without an escape hatch, and makes a driver that stops offering one of
 * them a compile error rather than a runtime one.
 */
interface EpochRow {
  revision: number;
}
interface EpochSelect extends Promise<EpochRow[]> {
  from(table: unknown): EpochSelect;
  where(condition: unknown): EpochSelect;
  limit(count: number): EpochSelect;
}
interface EpochInsert extends Promise<unknown> {
  values(row: Record<string, unknown>): EpochInsert;
  onConflictDoNothing?: () => Promise<unknown>;
}
interface EpochUpdate extends Promise<unknown> {
  set(patch: Record<string, unknown>): EpochUpdate;
  where(condition: unknown): EpochUpdate;
}
interface EpochExecutor {
  select(projection: Record<string, unknown>): EpochSelect;
  insert(table: unknown): EpochInsert;
  update(table: unknown): EpochUpdate;
}

function adapter(): DrizzleAdapter {
  return container.get<DrizzleAdapter>("adapter");
}

function executor(): EpochExecutor {
  return adapter().getDrizzle();
}

function epochTable() {
  const { dialect } = adapter().getCapabilities();
  return rbacEpochTables(dialect).nextlyRbacEpoch;
}

function reportDegraded(error: unknown): void {
  if (degraded) return;
  degraded = true;
  getAuthLogger()?.log?.("warn", {
    category: "auth",
    op: "cache",
    message:
      "RBAC epoch table unreadable; cache invalidation is local to this " +
      "process until `nextly db:sync` reconciles the core tables",
    error: String(error),
  });
}

/**
 * The epoch to file a cached answer under, without going to the database.
 *
 * Callers that are about to READ and then cache should call
 * {@link refreshEpoch} first, so the value they file under reflects any change
 * another instance made.
 */
export function currentEpoch(): number {
  return epoch;
}

/**
 * Bring this process's copy of the epoch up to date, at most once per TTL.
 *
 * Answers the epoch it settled on, so a caller can capture it in the same
 * expression rather than reading it again afterwards and racing its own
 * refresh.
 */
export async function refreshEpoch(): Promise<number> {
  if (Date.now() - readAt < EPOCH_TTL_MS) return epoch;
  try {
    const table = epochTable();
    const rows = await executor()
      .select({ revision: table.revision })
      .from(table)
      .where(eq(table.id, RBAC_EPOCH_ROW_ID))
      .limit(1);
    // A missing row is not a failure: the table exists and nothing has
    // invalidated yet, which is epoch zero and exactly what this process
    // already holds.
    const shared = rows.length > 0 ? Number(rows[0].revision) : 0;
    // Never backwards. This process may have bumped locally while the read was
    // in flight, and taking the older value would re-serve what that bump
    // retired. The shared counter only rises, so the larger is the current one.
    epoch = Math.max(epoch, shared);
    readAt = Date.now();
    degraded = false;
  } catch (error) {
    reportDegraded(error);
  }
  return epoch;
}

/**
 * Record that authorization data changed, install-wide.
 *
 * The increment is one statement the database evaluates itself, so two
 * instances invalidating at the same moment produce two increments rather than
 * one lost update — which a read-modify-write from here would not.
 *
 * The in-memory value moves first and unconditionally. A shared write that
 * fails leaves this process correct and the others no worse than they were,
 * where waiting for the write would mean an instance not honouring its own
 * revocation.
 */
export async function bumpEpoch(): Promise<number> {
  epoch += 1;
  // Read again on the next check rather than after the TTL: this process just
  // changed the value, so its cached copy is deliberately ahead of the last
  // read and the window in which another instance's bump could be missed
  // should not be extended by it.
  readAt = 0;

  try {
    const table = epochTable();
    const db = executor();
    const updated = await db
      .update(table)
      .set({
        revision: sql`${table.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(table.id, RBAC_EPOCH_ROW_ID));
    // The first invalidation on a fresh install has no row to increment. Insert
    // it, and treat a collision as another instance having got there first —
    // its insert counts as this bump, since either way the counter moved.
    if (rowsTouched(updated) === 0) {
      const insert = db
        .insert(table)
        .values({ id: RBAC_EPOCH_ROW_ID, revision: 1, updatedAt: new Date() });
      // Not every dialect builder offers it; where it does not, a collision
      // surfaces as the duplicate-key error the catch below reports, which is
      // the correct outcome — another instance created the row.
      if (typeof insert.onConflictDoNothing === "function") {
        await insert.onConflictDoNothing();
      } else {
        await insert;
      }
    }
    degraded = false;
  } catch (error) {
    reportDegraded(error);
  }
  return epoch;
}

/**
 * How many rows a write reported, across drivers that disagree about saying so.
 *
 * Postgres answers `{ rowCount }`, MySQL `{ affectedRows }` inside an array,
 * and better-sqlite3 `{ changes }`. A driver this does not recognise answers
 * `-1`, which the caller reads as "cannot tell" and does NOT treat as zero: a
 * spurious insert on a row that already exists is a conflict rather than a
 * silent second counter, but a spurious SKIP would leave a fresh install with
 * no row at all and no bump ever recorded.
 */
function rowsTouched(result: unknown): number {
  if (typeof result !== "object" || result === null) return -1;
  const first = Array.isArray(result) ? result[0] : result;
  if (typeof first !== "object" || first === null) return -1;
  const shape = first as {
    rowCount?: unknown;
    affectedRows?: unknown;
    changes?: unknown;
  };
  for (const value of [shape.rowCount, shape.affectedRows, shape.changes]) {
    if (typeof value === "number") return value;
  }
  return -1;
}

/**
 * Forget everything this process knows, for a test that needs a clean one.
 *
 * The module holds the epoch, the time it was read and whether the table has
 * been found unreadable, and a suite asserting any of those has to be able to
 * start from nothing. Exported rather than reached through a mock because the
 * state is this module's own.
 */
export function resetEpochForTests(): void {
  epoch = 0;
  readAt = 0;
  degraded = false;
}

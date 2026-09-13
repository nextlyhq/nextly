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
import { randomUUID } from "node:crypto";

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
let revision = 0;
let generation = "";
let readAt = 0;

/**
 * A refresh already on its way, shared by every ORDINARY caller while it runs.
 *
 * Without this the interval bounds how often a read STARTS being allowed, not
 * how many run: every check arriving after expiry sees the same stale `readAt`
 * and issues its own query before any of them finishes, so a burst turns one
 * read per second into one per request — the cost this design exists to avoid.
 *
 * A forced caller does not join it; see {@link refreshEpoch}.
 */
let inFlight: Promise<string> | null = null;

/**
 * Local invalidations the shared row has not accepted yet.
 *
 * Only ever above zero while the shared store is unreachable. It is a COUNT
 * rather than a second epoch on purpose: two counters that both advance
 * diverge, and the local one then wins every comparison, so an instance that
 * invalidated while degraded would stay permanently ahead and stop noticing
 * anybody else's changes. Nothing here invents an epoch; the only values
 * `epoch` ever takes are ones the shared row gave it.
 */
let pendingBumps = 0;

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
  generation: string;
}
interface EpochSelect extends Promise<EpochRow[]> {
  from(table: unknown): EpochSelect;
  where(condition: unknown): EpochSelect;
  limit(count: number): EpochSelect;
}
interface EpochInsert extends Promise<unknown> {
  values(row: Record<string, unknown>): EpochInsert;
  // Postgres and SQLite spell the upsert one way, MySQL the other. Both are
  // optional so a builder offering neither is a branch rather than a crash.
  onConflictDoUpdate?: (config: {
    target: unknown;
    set: Record<string, unknown>;
  }) => Promise<unknown>;
  onDuplicateKeyUpdate?: (config: {
    set: Record<string, unknown>;
  }) => Promise<unknown>;
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
export function currentEpoch(): string {
  return `${generation}:${String(revision)}`;
}

/**
 * May a cached answer be trusted at all right now?
 *
 * False while this process holds invalidations the shared row has not
 * accepted. Its epoch is then a value other instances have never seen, so
 * comparing anything against it says nothing about whether that answer is
 * current — and the honest response to "I cannot tell" on an authorization
 * decision is to recompute rather than to serve.
 *
 * The cost lands only on an installation whose core tables are not reconciled
 * AND which has since changed a role: it stops serving from cache until
 * `nextly db:sync` runs. That is a visible, self-correcting slowdown rather
 * than an invisible stale grant, and it is the direction to fail in.
 */
export function epochIsTrustworthy(): boolean {
  return pendingBumps === 0;
}

/**
 * May an answer filed under `stamp` still be used?
 *
 * The one place that question is answered, because it has three askers and they
 * were not asking the same thing. Comparing the stamp is only half of it: a
 * match means nothing while this process holds invalidations the shared row has
 * not accepted, since the value being matched against is then one no other
 * instance has ever seen. A tier that compares stamps and omits the trust check
 * looks correct beside one that does not, and serves a revoked answer for its
 * whole life on an install whose epoch table is not yet reconciled.
 *
 * Every cache derives its own predicate from this rather than restating it:
 * the in-memory tiers add their expiry, the shared tier adds its retirement,
 * and the API key's copied grants add their own freshness window.
 */
export function stampIsCurrent(stamp: string): boolean {
  if (!epochIsTrustworthy()) return false;
  return stamp === currentEpoch();
}

/**
 * Bring this process's copy of the epoch up to date, at most once per TTL.
 *
 * Answers the epoch it settled on, so a caller can capture it in the same
 * expression rather than reading it again afterwards and racing its own
 * refresh.
 */
export async function refreshEpoch(options?: {
  force?: boolean;
}): Promise<string> {
  const force = options?.force === true;
  if (!force && Date.now() - readAt < EPOCH_TTL_MS) return currentEpoch();

  // Joining a read already running is honest for an ordinary caller: it asked
  // for a value no older than the interval, and that read will supply one.
  //
  // It is not honest for a FORCED caller. The only reason to force is to
  // observe something that has just happened, and a read already in flight may
  // have queried before it — handing that back answers with an observation
  // older than the write it exists to confirm, which is the whole of the
  // post-write verification. So a forced caller waits out the reads ahead of it
  // and then makes one of its own.
  if (!force) {
    if (inFlight) return inFlight;
  } else {
    // Sequential by design: each read ahead of this one has to finish before a
    // new observation may start, or the observation is not a new one.
    let ahead = inFlight;
    while (ahead) {
      await ahead;
      ahead = inFlight;
    }
  }

  const reading = readShared().finally(() => {
    if (inFlight === reading) inFlight = null;
  });
  inFlight = reading;
  return reading;
}

async function readShared(): Promise<string> {
  try {
    // Owed invalidations go in BEFORE the value comes out, and that order is
    // the point: a read taken first answers with a number that does not
    // include them, and this process would then adopt it as authoritative and
    // trust its caches again while the change it made is still nowhere.
    await persistPendingBumps();

    const table = epochTable();
    const rows = await executor()
      .select({ revision: table.revision, generation: table.generation })
      .from(table)
      .where(eq(table.id, RBAC_EPOCH_ROW_ID))
      .limit(1);
    // A missing row is not a failure: the table exists and nothing has
    // invalidated yet, which is epoch zero.
    // Adopted whole, and never maxed against a local value. The row is the only
    // authority: taking the larger of the two is what let a process that had
    // invalidated while degraded stay permanently ahead of everyone else, and
    // taking only the number is what let a REPLACED store read as the same one.
    revision = rows.length > 0 ? Number(rows[0].revision) : 0;
    generation = rows.length > 0 ? String(rows[0].generation) : "";
    readAt = Date.now();
    degraded = false;
  } catch (error) {
    reportDegraded(error);
    // Rate-limit the FAILING path too. Left unset, a missing table means one
    // failing query per authorization check rather than one per interval,
    // which is the upgrade window turned into a load problem.
    readAt = Date.now();
  }
  return currentEpoch();
}

/**
 * Push the invalidations this process owes into the shared row.
 *
 * ## Exactly one drain runs at a time, and this depends on it
 *
 * The count is read, sent, and subtracted around an await. Two drains
 * overlapping would each subtract a backlog the other had already sent, taking
 * the count NEGATIVE: nothing could be served from cache again, and the next
 * invalidation would publish an increment of zero, so the change that raised it
 * would reach no other instance at all.
 *
 * What rules that out is not a lock here but the shape of the only path in.
 * This is called from one place, the top of {@link readShared}; `readShared` is
 * called from one place, {@link refreshEpoch}; and that call sits between a
 * check of `inFlight` and its assignment with no await in between, so a second
 * read cannot start while one is running. A second caller added anywhere else
 * would need its own answer to this, and the subtraction is where it would go
 * wrong.
 *
 * ## The count stays owed until the row has it
 *
 * Subtracted only after the statement resolves, so a write nobody accepted
 * leaves this process distrusting its caches rather than believing it has
 * caught up — and so does a write still in flight, which the row has not
 * accepted yet either.
 */
async function persistPendingBumps(): Promise<void> {
  const owed = pendingBumps;
  if (owed === 0) return;

  const table = epochTable();
  // ONE statement, so there is no row count to read and no create-or-update
  // branch to get wrong. The previous shape asked the driver how many rows an
  // UPDATE touched and inserted when the answer was zero, which is three
  // different result shapes across three drivers and a silent no-op whenever
  // one of them is misread — the counter then sticks at its first value and
  // every later invalidation is lost, while every individual statement
  // succeeds. An upsert cannot have that failure: the row is created if it is
  // absent and incremented if it is present, decided by the database.
  const insert = executor().insert(table).values({
    id: RBAC_EPOCH_ROW_ID,
    revision: owed,
    // Only ever written when the row is CREATED; the conflict branch below
    // leaves it alone, so a live counter keeps its identity for life.
    generation: randomUUID(),
    updatedAt: new Date(),
  });
  const raise = {
    target: table.id,
    set: {
      revision: sql`${table.revision} + ${owed}`,
      updatedAt: new Date(),
    },
  };
  if (typeof insert.onConflictDoUpdate === "function") {
    await insert.onConflictDoUpdate(raise);
  } else if (typeof insert.onDuplicateKeyUpdate === "function") {
    // MySQL spells the same statement differently and takes no target.
    await insert.onDuplicateKeyUpdate({ set: raise.set });
  } else {
    await insert;
  }

  pendingBumps -= owed;
}

/**
 * Record that authorization data changed, install-wide.
 *
 * The increment is one statement the database evaluates itself, so two
 * instances invalidating at the same moment produce two increments rather than
 * one lost update — which a read-modify-write from here would not.
 *
 * The value this process then answers with is READ BACK rather than assumed.
 * Inventing `epoch + 1` locally is what made a degraded instance diverge, and
 * it is also simply wrong whenever somebody else bumped in the same interval.
 * Spelled as a FORCED refresh rather than as a second write path, because
 * pushing the backlog and adopting what the row then says are already the two
 * halves of one read: {@link refreshEpoch} drains before it queries, and
 * forcing is what guarantees the query it makes is one this change is inside
 * rather than an older one already in flight.
 *
 * A failed write leaves the count owed rather than applied, and
 * {@link epochIsTrustworthy} then reports that nothing here may be served from
 * cache until the shared row accepts it.
 */
export async function bumpEpoch(): Promise<string> {
  pendingBumps += 1;
  return refreshEpoch({ force: true });
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
  revision = 0;
  generation = "";
  readAt = 0;
  degraded = false;
  pendingBumps = 0;
  inFlight = null;
}

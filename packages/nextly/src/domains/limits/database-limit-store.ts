/**
 * The limit store kept in the site's database, shared by every instance.
 *
 * One row per key, in `nextly_limit_store`. An update runs in a transaction of
 * its own, never the caller's (refused while the calling flow has one open):
 * a count undone by the rollback of the work it guarded would let a failed
 * attempt go uncounted.
 *
 * Inside it, the update first takes every one of its keys' rows, creating the
 * missing ones, in one fixed order: the sorted order of their ids. A row is
 * taken by an upsert that updates it, which locks a row that exists and
 * creates one that does not, so a key's first update waits for a concurrent
 * one like any other, and two updates naming the same keys in opposite
 * orders take them in the same order and never deadlock. It then reads the
 * rows and the database's clock, lets the caller decide, and writes.
 *
 * Live entries are held to a bound, through a count of occupied rows per
 * secret generation, kept in a row of its own and taken after the keys' rows.
 * An update that would take the count past the bound rolls back, the store
 * removes expired entries and recounts, and the update runs once more; if it
 * still has no room it is answered as unavailable. No live entry is ever
 * removed to make room.
 *
 * @experimental
 * @module domains/limits/database-limit-store
 */
import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  like,
  lte,
  ne,
  notLike,
  sql,
  type SQL,
} from "drizzle-orm";

import { getStaticRelations } from "../../database/static-relations";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import {
  LIMIT_STORE_COUNTER_PREFIX,
  limitStoreTables,
} from "../../schemas/limit-store";
import { affectedRowCount } from "../../shared/lib/affected-row-count";
import { assertNoOpenTransaction } from "../../shared/lib/open-transaction";
import { runAdapterTransaction } from "../../shared/lib/run-adapter-transaction";

import { watchCapacity } from "./capacity-watch";
import {
  checkLimitKeys,
  limitStoreUnavailable,
  limitStoreUnavailableReason,
  serialiseLimitWrite,
  type LimitStore,
  type LimitUpdate,
  type SerialisedLimit,
  type StoredLimit,
} from "./limit-store";
import { databaseNowMs } from "./store-clock";

/** How many live entries the database store holds unless told otherwise. */
export const DATABASE_LIMIT_STORE_DEFAULT_MAX_ENTRIES = 1_000_000;

/**
 * How often each instance sweeps expired entries away: an expired entry is
 * gone within this long, plus the time to work through a backlog.
 */
export const DATABASE_LIMIT_STORE_SWEEP_INTERVAL_MS = 5 * 60_000;

/** Rows removed per sweep transaction, so no sweep holds locks for long. */
const SWEEP_BATCH = 1000;

/** Batches per sweep run; what is left waits for the next run. */
const SWEEP_MAX_BATCHES = 100;

/** The least time between two sweeps made to find room for an update. */
const ROOM_SWEEP_INTERVAL_MS = 1000;

/** Attempts at a transaction the database aborted for a lock conflict. */
const CONFLICT_ATTEMPTS = 3;

/** A counter row never expires. */
const COUNTER_EXPIRES_AT = Number.MAX_SAFE_INTEGER;

/** How the database store is set up. */
export interface DatabaseLimitStoreOptions {
  /** The site's database adapter. */
  adapter: DrizzleAdapter;
  /** The generation the install's current secret writes under. */
  generation: string;
  /** The most live entries; {@link DATABASE_LIMIT_STORE_DEFAULT_MAX_ENTRIES} by default. */
  maxEntries?: number;
  /**
   * How often to sweep on its own, in milliseconds;
   * {@link DATABASE_LIMIT_STORE_SWEEP_INTERVAL_MS} by default, `false` for
   * none (a test that sweeps by hand).
   */
  sweepIntervalMs?: number | false;
}

/** The database store, with what shuts it down. */
export interface DatabaseLimitStore extends LimitStore {
  /**
   * Stop sweeping on its own, and settle once a sweep already running has
   * finished, so nothing still uses the adapter after it. Further calls
   * still work.
   */
  close(): Promise<void>;
}

/** A row as an update reads it, with the database's clock. */
interface EntryRow {
  id: string;
  value: string | null;
  expiresAt: number;
  generation: string;
  now: number;
}

/** A select, as far as this store drives it. */
interface StoreQuery<R> extends PromiseLike<R[]> {
  orderBy(...columns: unknown[]): StoreQuery<R>;
  limit(rows: number): StoreQuery<R>;
  for(strength: "update"): StoreQuery<R>;
}

/** The statements this store issues, on a handle or in a transaction. */
interface StoreDb {
  select<R>(fields: Record<string, unknown>): {
    from(table: unknown): { where(condition: unknown): StoreQuery<R> };
  };
  insert(table: unknown): {
    values(rows: unknown): {
      onConflictDoUpdate(args: unknown): Promise<unknown>;
      onDuplicateKeyUpdate(args: unknown): Promise<unknown>;
    };
  };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
}

/** A row the store writes. */
interface WrittenRow {
  id: string;
  value: string | null;
  expiresAt: number;
  generation: string;
}

/**
 * The id an entry's row is stored under: the SHA-256, in hex, of its
 * generation and its key. With the generation in it, two generations' entries
 * for one key are two rows: during a rolling rotation the instances of each
 * count apart, rather than overwriting each other's live count.
 */
function rowId(generation: string, key: string): string {
  return createHash("sha256")
    .update(generation, "utf8")
    .update("\u0000")
    .update(key, "utf8")
    .digest("hex");
}

/**
 * Whether `error`, or one it was raised from, is the database aborting a
 * transaction for a lock conflict, which a fresh attempt may get past.
 * Drizzle wraps the driver's error, so the code is looked for down the chain.
 */
function isLockConflict(error: unknown): boolean {
  for (
    let at: unknown = error, depth = 0;
    typeof at === "object" && at !== null && depth < 5;
    at = (at as { cause?: unknown }).cause, depth += 1
  ) {
    const { code, errno } = at as { code?: unknown; errno?: unknown };
    // PostgreSQL deadlock and serialization failure; MySQL deadlock and lock
    // wait timeout.
    if (code === "40P01" || code === "40001") return true;
    if (errno === 1213 || errno === 1205) return true;
  }
  return false;
}

/** Create the store kept in the site's database. */
export function createDatabaseLimitStore(
  options: DatabaseLimitStoreOptions
): DatabaseLimitStore {
  const { adapter, generation } = options;
  const maxEntries =
    options.maxEntries ?? DATABASE_LIMIT_STORE_DEFAULT_MAX_ENTRIES;
  const dialect = adapter.getCapabilities().dialect;
  const table = limitStoreTables(dialect).nextlyLimitStore;
  const now = databaseNowMs(dialect);
  const counterId = `${LIMIT_STORE_COUNTER_PREFIX}${generation}`;
  const watch = watchCapacity("database", maxEntries);
  const relations = getStaticRelations(dialect);

  /** A select that reads the rows it names as they now stand, locked. */
  const locked = <R>(query: StoreQuery<R>): StoreQuery<R> =>
    // SQLite runs one writer at a time, and has no `FOR UPDATE`.
    dialect === "sqlite" ? query : query.for("update");

  /**
   * Run `work` in a transaction of its own, again when the database aborts it
   * for a lock conflict. What `work` throws reaches the caller as thrown.
   */
  const inOwnTransaction = async <T>(
    work: (db: StoreDb) => Promise<T>
  ): Promise<T> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runAdapterTransaction<T, TransactionContext>(
          run => adapter.transaction(ctx => run(ctx)),
          ctx => work(ctx.drizzleWithRelations<StoreDb>(relations))
        );
      } catch (error) {
        if (attempt >= CONFLICT_ATTEMPTS || !isLockConflict(error)) throw error;
        // Taken in one order, the store's locks should never conflict; one
        // that does is worth seeing, though the next attempt may well pass.
        getNextlyLogger().warn({
          kind: "limit-store-conflict-retried",
          message: error instanceof Error ? error.message : String(error),
          attempt,
        });
      }
    }
  };

  /**
   * Take `rows` for this transaction, in the order given, creating the ones
   * that do not exist. Updating a row is what locks it; doing nothing on a
   * conflict would take no lock at all.
   */
  const claim = async (db: StoreDb, rows: WrittenRow[]): Promise<void> => {
    const insert = db.insert(table).values(rows);
    if (dialect === "mysql") {
      await insert.onDuplicateKeyUpdate({ set: { id: sql`${table.id}` } });
    } else {
      await insert.onConflictDoUpdate({
        target: table.id,
        set: { id: sql`${table.id}` },
      });
    }
  };

  /** The row holding the occupied count, as first created. */
  const counterRow: WrittenRow = {
    id: counterId,
    value: "0",
    expiresAt: COUNTER_EXPIRES_AT,
    generation,
  };

  /** The occupied count, read while this transaction holds its row. */
  const readCounter = async (db: StoreDb): Promise<number> => {
    await claim(db, [counterRow]);
    const [row] = await locked(
      db
        .select<{ value: string | null }>({ value: table.value })
        .from(table)
        .where(eq(table.id, counterId))
    );
    const occupied = Number(row?.value ?? 0);
    return Number.isFinite(occupied) && occupied > 0 ? occupied : 0;
  };

  /**
   * Recount the occupied rows of this generation into its counter. Run after
   * a sweep, so the count also corrects itself if it ever drifted.
   */
  const recount = (): Promise<number> =>
    inOwnTransaction(async db => {
      await claim(db, [counterRow]);
      const [row] = await db
        .select<{ occupied: number }>({ occupied: count() })
        .from(table)
        .where(
          and(
            eq(table.generation, generation),
            isNotNull(table.value),
            notLike(table.id, `${LIMIT_STORE_COUNTER_PREFIX}%`)
          )
        );
      const occupied = Number(row?.occupied ?? 0);
      await db
        .update(table)
        .set({ value: String(occupied) })
        .where(eq(table.id, counterId));
      return occupied;
    });

  /**
   * What a sweep removes: expired entries, whatever generation wrote them.
   *
   * Another generation's entries are kept until they expire, never sooner:
   * during a rolling deployment that rotates the secret, instances of both
   * generations run at once, and removing each other's live entries would
   * start their counts again for as long as the rollout lasts. They never
   * count against this generation's bound, which is counted per generation.
   */
  const removable: SQL | undefined = and(
    lte(table.expiresAt, now),
    notLike(table.id, `${LIMIT_STORE_COUNTER_PREFIX}%`)
  );

  /**
   * Remove the counter of every other generation that has no entries left:
   * its instances are gone, and nothing will count under it again.
   */
  const removeSpentCounters = async (): Promise<void> => {
    const counters = await adapter
      .getDrizzle<StoreDb>()
      .select<{ id: string; generation: string }>({
        id: table.id,
        generation: table.generation,
      })
      .from(table)
      .where(
        and(
          like(table.id, `${LIMIT_STORE_COUNTER_PREFIX}%`),
          ne(table.generation, generation)
        )
      );
    for (const counter of counters) {
      await inOwnTransaction(async db => {
        // The counter first, locked, so an instance of that generation that
        // writes its first entry meanwhile is either counted below or waits
        // for this to finish; never counted out of a live counter.
        const [held] = await locked(
          db
            .select<{ id: string }>({ id: table.id })
            .from(table)
            .where(eq(table.id, counter.id))
        );
        if (held === undefined) return;
        const [left] = await db
          .select<{ rows: number }>({ rows: count() })
          .from(table)
          .where(
            and(
              eq(table.generation, counter.generation),
              notLike(table.id, `${LIMIT_STORE_COUNTER_PREFIX}%`)
            )
          );
        if (Number(left?.rows ?? 0) === 0) {
          await db.delete(table).where(eq(table.id, counter.id));
        }
      });
    }
  };

  /**
   * Remove expired entries, a batch per transaction, then spent counters,
   * then recount. Ids are removed in sorted order, the order updates take
   * rows in.
   */
  const sweepRows = async (): Promise<number> => {
    let removed = 0;
    for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch += 1) {
      const found = await inOwnTransaction(async db => {
        const ids = (
          await db
            .select<{ id: string }>({ id: table.id })
            .from(table)
            .where(removable)
            .orderBy(table.id)
            .limit(SWEEP_BATCH)
        ).map(row => row.id);
        if (ids.length === 0) return { ids: 0, removed: 0 };
        // The condition is checked again as each row is removed: an update
        // may have renewed an entry since it was found.
        const result = await db
          .delete(table)
          .where(and(inArray(table.id, ids), removable));
        return { ids: ids.length, removed: affectedRowCount(result, dialect) };
      });
      removed += found.removed;
      if (found.ids < SWEEP_BATCH) break;
    }
    await removeSpentCounters();
    const occupied = await recount();
    watch.observe(occupied);
    return removed;
  };

  /** A sweep nobody waits for; a failure is logged, and the next one retries. */
  /**
   * The sweep under way, if one is. One at a time on each instance: a sweep
   * slowed by a lock wait or an outage is joined, never piled on, so sweeps
   * cannot gather connections and locks behind it.
   */
  let running: Promise<number> | undefined;
  const sweepOnce = (): Promise<number> => {
    running ??= sweepRows().finally(() => {
      running = undefined;
    });
    return running;
  };

  /** A sweep nobody waits for, unless one is under way; a failure is logged. */
  const sweepInBackground = () => {
    if (running !== undefined) return;
    sweepOnce().catch((error: unknown) => {
      getNextlyLogger().warn({
        kind: "limit-store-sweep-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  // The first call only recounts this generation's entries, so the bound is
  // judged against a true count: one query. Removing expired entries can be
  // a long job after a restart, so it runs in the background instead of
  // holding the call. Kept until it succeeds; a failure is retried by the
  // next call.
  let ready: Promise<void> | undefined;
  const ensureReady = (): Promise<void> => {
    ready ??= recount().then(
      occupied => {
        watch.observe(occupied);
        startSweeping();
      },
      (error: unknown) => {
        ready = undefined;
        throw error;
      }
    );
    return ready;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  /** Sweep now in the background, and then on the interval, until closed. */
  const startSweeping = () => {
    const interval =
      options.sweepIntervalMs ?? DATABASE_LIMIT_STORE_SWEEP_INTERVAL_MS;
    // Closed for good: a store kept after the services were released must
    // not start reaching for its adapter again.
    if (closed || timer !== undefined || interval === false) return;
    sweepInBackground();
    timer = setInterval(sweepInBackground, interval);
    // Never what keeps the process running.
    timer.unref?.();
  };

  let lastRoomSweep: number | undefined;
  /**
   * Sweep to find room. A sweep already under way is waited for, since it
   * may be about to free the room; otherwise one is started, unless one
   * finished moments ago. True when a sweep has run for this call.
   */
  const makeRoom = async (): Promise<boolean> => {
    if (running !== undefined) {
      await running;
      return true;
    }
    const at = Date.now();
    if (
      lastRoomSweep !== undefined &&
      at - lastRoomSweep < ROOM_SWEEP_INTERVAL_MS
    ) {
      return false;
    }
    lastRoomSweep = at;
    await sweepOnce();
    return true;
  };

  /**
   * Whether a row counts against the bound: it holds a value of this
   * generation, expired or not. The sweep is what removes expired ones.
   */
  const occupies = (row: EntryRow | undefined): boolean =>
    row !== undefined && row.generation === generation && row.value !== null;

  /**
   * Take the rows of `ids` for this transaction, in their sorted order,
   * creating the missing ones without a value, and read them with the
   * database's clock.
   */
  const takeRows = async (
    db: StoreDb,
    ids: string[]
  ): Promise<{ byId: Map<string, EntryRow>; clock: number }> => {
    await claim(
      db,
      ids.map(id => ({ id, value: null, expiresAt: 0, generation }))
    );
    const rows = await locked(
      db
        .select<EntryRow>({
          id: table.id,
          value: table.value,
          expiresAt: table.expiresAt,
          generation: table.generation,
          now,
        })
        .from(table)
        .where(inArray(table.id, ids))
    );
    return {
      byId: new Map(rows.map(row => [row.id, row])),
      clock: Number(rows[0]?.now),
    };
  };

  /** The live entries among the rows, and how many rows occupy room. */
  const liveEntries = (
    keyOf: ReadonlyMap<string, string>,
    byId: ReadonlyMap<string, EntryRow>,
    clock: number
  ): { current: Map<string, StoredLimit>; occupied: number } => {
    const current = new Map<string, StoredLimit>();
    let occupied = 0;
    for (const [id, key] of keyOf) {
      const row = byId.get(id);
      if (row === undefined || row.value === null || !occupies(row)) continue;
      occupied += 1;
      if (row.expiresAt > clock) {
        current.set(key, {
          value: JSON.parse(row.value) as unknown,
          expiresAt: row.expiresAt,
        });
      }
    }
    return { current, occupied };
  };

  /**
   * What becomes of one row: written; removed, when deleted, written already
   * expired, or created by this update and left unwritten; or kept as it is.
   */
  const fateOf = (
    row: EntryRow | undefined,
    change: SerialisedLimit | null | undefined,
    clock: number
  ): "write" | "remove" | "keep" => {
    if (change === undefined) return row?.value === null ? "remove" : "keep";
    return change === null || change.expiresAt <= clock ? "remove" : "write";
  };

  /** Write what an update decided; answer how many of its rows then occupy room. */
  const writeChanges = async (
    db: StoreDb,
    keyOf: ReadonlyMap<string, string>,
    byId: ReadonlyMap<string, EntryRow>,
    changes: ReadonlyMap<string, SerialisedLimit | null>,
    clock: number
  ): Promise<number> => {
    let occupied = 0;
    const removed: string[] = [];
    for (const [id, key] of keyOf) {
      const row = byId.get(id);
      const change = changes.get(key);
      const fate = fateOf(row, change, clock);
      if (fate === "remove") {
        removed.push(id);
      } else if (fate === "keep") {
        if (occupies(row)) occupied += 1;
      } else if (change) {
        occupied += 1;
        await db
          .update(table)
          .set({ value: change.json, expiresAt: change.expiresAt, generation })
          .where(eq(table.id, id));
      }
    }
    if (removed.length > 0) {
      await db.delete(table).where(inArray(table.id, removed));
    }
    return occupied;
  };

  /**
   * Move the occupied count by `added`, refusing with the unavailable answer
   * when that takes it past the bound. `final` says no sweep will follow, so
   * that refusal is the one logged.
   */
  const countOccupied = async (
    db: StoreDb,
    added: number,
    final: boolean
  ): Promise<void> => {
    if (added === 0) return;
    // Taken after the keys' rows, as every update and sweep takes it.
    const occupied = await readCounter(db);
    const next = Math.max(0, occupied + added);
    if (added > 0 && next > maxEntries) {
      if (final) watch.refused(occupied);
      throw limitStoreUnavailable("full", {
        logContext: { store: "database", maxEntries },
      });
    }
    await db
      .update(table)
      .set({ value: String(next) })
      .where(eq(table.id, counterId));
    watch.observe(next);
  };

  /**
   * One update, in one transaction. Throws the unavailable answer for want of
   * room, which rolls the whole update back.
   */
  const attemptUpdate = <T>(
    keys: string[],
    apply: (
      current: ReadonlyMap<string, StoredLimit>,
      now: number
    ) => LimitUpdate<T>,
    final: boolean,
    applyFailure: { error?: unknown }
  ): Promise<T> => {
    // In sorted order, the order every update and sweep takes rows in.
    const keyOf = new Map(
      keys
        .map(key => [rowId(generation, key), key] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
    return inOwnTransaction(async db => {
      const { byId, clock } = await takeRows(db, [...keyOf.keys()]);
      const { current, occupied } = liveEntries(keyOf, byId, clock);
      let decided: LimitUpdate<T>;
      try {
        decided = apply(current, clock);
      } catch (error) {
        applyFailure.error = error;
        throw error;
      }
      const changes = serialiseLimitWrite(keys, decided.write);
      const after = await writeChanges(db, keyOf, byId, changes, clock);
      await countOccupied(db, after - occupied, final);
      return decided.result;
    });
  };

  /**
   * The answer a call gives for `error`: the caller's own and programming
   * errors as they are, anything the database raised as unavailable.
   */
  const answerFor = (error: unknown, applyFailure: { error?: unknown }) => {
    if (applyFailure.error !== undefined) return applyFailure.error;
    if (limitStoreUnavailableReason(error) !== undefined) return error;
    if (NextlyError.isCode(error, "INTERNAL_ERROR")) return error;
    return limitStoreUnavailable("unreachable", {
      cause: error,
      logContext: { store: "database" },
    });
  };

  return {
    shared: true,

    async update(keys, apply) {
      const named = checkLimitKeys(keys);
      assertNoOpenTransaction(adapter, "A limit store update");
      const applyFailure: { error?: unknown } = {};
      try {
        await ensureReady();
        try {
          return await attemptUpdate(named, apply, false, applyFailure);
        } catch (error) {
          if (limitStoreUnavailableReason(error) !== "full") throw error;
          if (!(await makeRoom())) {
            watch.refused(maxEntries);
            throw error;
          }
          return await attemptUpdate(named, apply, true, applyFailure);
        }
      } catch (error) {
        throw answerFor(error, applyFailure);
      }
    },

    async read(keys) {
      const named = checkLimitKeys(keys);
      const keyOf = new Map(named.map(key => [rowId(generation, key), key]));
      try {
        // No recount and no sweep from a read: a read may be made inside
        // the caller's transaction, and must write nothing.
        const db = adapter.getDrizzle<StoreDb>();
        const rows = await db
          .select<{ id: string; value: string; expiresAt: number }>({
            id: table.id,
            value: table.value,
            expiresAt: table.expiresAt,
          })
          .from(table)
          .where(
            and(
              inArray(table.id, [...keyOf.keys()]),
              eq(table.generation, generation),
              isNotNull(table.value),
              // Expired on the database's clock, never the caller's.
              gt(table.expiresAt, now)
            )
          );
        const found = new Map<string, StoredLimit>();
        for (const row of rows) {
          const key = keyOf.get(row.id);
          if (key === undefined) continue;
          found.set(key, {
            value: JSON.parse(row.value) as unknown,
            expiresAt: Number(row.expiresAt),
          });
        }
        return found;
      } catch (error) {
        throw answerFor(error, {});
      }
    },

    async sweep() {
      assertNoOpenTransaction(adapter, "A limit store sweep");
      try {
        return await sweepOnce();
      } catch (error) {
        throw answerFor(error, {});
      }
    },

    async close() {
      closed = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await running?.catch(() => undefined);
    },
  };
}

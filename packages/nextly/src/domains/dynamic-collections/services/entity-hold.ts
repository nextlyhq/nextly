/**
 * The hold that keeps entry writes off an entity while a save deletes its fields' values, on
 * PostgreSQL and SQLite. A save takes the exclusive side from its count until its registry row is
 * written; an entry write takes the shared side before it reads or writes the entity's table, so
 * it waits for such a save and then meets the definition the save recorded. MySQL holds the same
 * span with named locks and the registry row (`holdCollectionsIn`); PostgreSQL with an advisory
 * lock; SQLite, whose writes in a process all run on one connection, with a lock in the process.
 *
 * @module domains/dynamic-collections/services/entity-hold
 */
import type {
  SqlParam,
  StatementSession,
} from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { NextlyError } from "../../../errors/nextly-error";

/** What a hold is on: a collection, named by its slug. */
export interface EntityRef {
  readonly kind: "collection";
  readonly slug: string;
}

/** The one name `entity`'s hold goes by on every database: its kind, then its slug. */
export function entityHoldKey(entity: EntityRef): string {
  return `${entity.kind}:${entity.slug}`;
}

/**
 * How long a write or a save waits for the other side of an entity's hold before it is refused
 * with nothing changed, as long as MySQL's named locks wait (`takeNamedCollectionLocks`).
 */
export const ENTITY_HOLD_WAIT_MS = 30_000;

/** The refusal of a hold not had in time, or held by a save where waiting is not possible. */
function entityBeingChanged(entity: EntityRef, reason: string): NextlyError {
  return new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
    logContext: { reason, entity: entityHoldKey(entity) },
  });
}

/** The refusal of an entry write a save keeps from its turn on SQLite's one connection. */
function entityBusy(entity: EntityRef, reason: string): NextlyError {
  return NextlyError.databaseBusy({
    logContext: { reason, entity: entityHoldKey(entity) },
  });
}

/**
 * `attempt` run until it answers true, pausing a little longer each time, and `refused` thrown once
 * `waitMs` has passed without it: a wait bounded as the other databases' lock waits are.
 */
async function attemptUntil(
  attempt: () => Promise<boolean>,
  refused: () => NextlyError,
  waitMs: number
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (let pause = 20; ; pause = Math.min(pause * 2, 500)) {
    if (await attempt()) return;
    const left = deadline - Date.now();
    if (left <= 0) throw refused();
    await new Promise(resolve => setTimeout(resolve, Math.min(pause, left)));
  }
}

/** The rows a query answers where it runs: a transaction, a migration try's handle, a session. */
export type RowsOn = (
  query: SQL
) => Promise<ReadonlyArray<Record<string, unknown>>>;

/** `entity`'s PostgreSQL advisory lock keys: Nextly's entity holds, then the entity, hashed there. */
function advisoryKeysOf(entity: EntityRef): SQL {
  return sql`hashtext(${"nextly:entity"}), hashtext(${entityHoldKey(entity)})`;
}

/** Whether the one row `rows` answers for `lock` says it was got. */
async function got(rows: RowsOn, lock: SQL): Promise<boolean> {
  const [row] = await rows(sql`SELECT ${lock} AS ${sql.identifier("held")}`);
  return row?.held === true;
}

/**
 * Whether an entry write has its share of `entity`'s hold on PostgreSQL, at one attempt, in its
 * transaction (`rows` runs there), held until that transaction ends: false while a save holds it.
 */
export function tryShareEntityOnPostgres(
  rows: RowsOn,
  entity: EntityRef
): Promise<boolean> {
  return got(
    rows,
    sql`pg_try_advisory_xact_lock_shared(${advisoryKeysOf(entity)})`
  );
}

/**
 * An entry write's share of `entity`'s hold on PostgreSQL, in its transaction (`rows` runs there),
 * held until that transaction ends. Writes share it with each other; a save holding it waits them
 * out, and they wait for it, each at most `waitMs`, then refused with nothing written. It waits in
 * the transaction, so for a write that may not give its transaction up and open it again.
 */
export function shareEntityOnPostgres(
  rows: RowsOn,
  entity: EntityRef,
  waitMs = ENTITY_HOLD_WAIT_MS
): Promise<void> {
  return attemptUntil(
    () => tryShareEntityOnPostgres(rows, entity),
    () => entityBeingChanged(entity, "entity-share-timeout"),
    waitMs
  );
}

/**
 * The refusal, at once, of an entry write's share of `entity` on PostgreSQL where a save holds it and
 * the write may not wait: on a transaction its caller opened, which keeps a connection the save
 * needs to finish.
 */
export async function refuseUnlessSharedOnPostgres(
  rows: RowsOn,
  entity: EntityRef
): Promise<void> {
  if (!(await tryShareEntityOnPostgres(rows, entity))) {
    throw entityBeingChanged(entity, "entity-held-in-open-transaction");
  }
}

/**
 * A write made by `attempt`, each time on a transaction of its own, until it is had: an attempt that
 * finds `entity` held by a save ends (`held: false`) with nothing written, and the write waits for
 * the save with no transaction open, so the save has every connection of the pool for the rest of
 * its work. Refused once `waitMs` has passed without it.
 */
export async function attemptWithoutWaitingInside<T>(
  entity: EntityRef,
  attempt: () => Promise<{ held: true; value: T } | { held: false }>,
  waitMs = ENTITY_HOLD_WAIT_MS
): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (let pause = 20; ; pause = Math.min(pause * 2, 500)) {
    const outcome = await attempt();
    if (outcome.held) return outcome.value;
    const left = deadline - Date.now();
    if (left <= 0) throw entityBeingChanged(entity, "entity-share-timeout");
    await new Promise(resolve => setTimeout(resolve, Math.min(pause, left)));
  }
}

/**
 * A deleting save's hold of `entity` on PostgreSQL on a connection held for it alone (`session`,
 * from `withSession`), for a save whose change runs on other connections (a push): exclusive until
 * `release`, which runs on the same connection, and in any case until the session's connection
 * closes.
 */
export async function holdEntityOnPostgresSession(
  session: StatementSession,
  entity: EntityRef,
  waitMs = ENTITY_HOLD_WAIT_MS
): Promise<{ release: () => Promise<void> }> {
  const compiler = new PgDialect();
  const rows: RowsOn = query => {
    const compiled = compiler.sqlToQuery(query);
    return session.execute<Record<string, unknown>>(
      compiled.sql,
      compiled.params as SqlParam[]
    );
  };
  await attemptUntil(
    () => got(rows, sql`pg_try_advisory_lock(${advisoryKeysOf(entity)})`),
    () => entityBeingChanged(entity, "entity-hold-timeout"),
    waitMs
  );
  return {
    release: async () => {
      await rows(sql`SELECT pg_advisory_unlock(${advisoryKeysOf(entity)})`);
    },
  };
}

/** SQLite's busy timeout where a site sets none, as its adapter opens the database. */
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** One entity's hold in this process: the writes sharing it, and whether a save holds it. */
interface ProcessHold {
  sharing: number;
  held: boolean;
  /** Saves waiting for it: while one waits, a new write waits behind it. */
  saving: number;
  waiting: Array<() => void>;
  /** The database's busy timeout as the latest save found it: how long a write waits for one. */
  busyTimeoutMs: number;
}

/** The holds of the entities written through each adapter in this process, by `entityHoldKey`. */
const processHolds = new WeakMap<object, Map<string, ProcessHold>>();

function processHoldOf(owner: object, entity: EntityRef): ProcessHold {
  let holds = processHolds.get(owner);
  if (holds === undefined) {
    holds = new Map();
    processHolds.set(owner, holds);
  }
  const key = entityHoldKey(entity);
  let hold = holds.get(key);
  if (hold === undefined) {
    hold = {
      sharing: 0,
      held: false,
      saving: 0,
      waiting: [],
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
    };
    holds.set(key, hold);
  }
  return hold;
}

/** Wakes everything waiting on `hold`, to look again. */
function wake(hold: ProcessHold): void {
  for (const waiter of hold.waiting.splice(0)) waiter();
}

/** Waits until `free` answers true on `hold`, at most `waitMs`, then `refused`. */
async function waitInProcess(
  hold: ProcessHold,
  free: () => boolean,
  /** Takes what `free` found free, in the same synchronous step, so no flow can take it between. */
  grant: () => void,
  refused: () => NextlyError,
  waitMs: number
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (free()) {
      grant();
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) throw refused();
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, left);
      hold.waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * An entry write's share of `entity`'s hold in this process, through `owner` (the adapter it
 * writes through), on SQLite: taken BEFORE the write's transaction opens, since every transaction
 * of the process waits its turn on one connection and a save holding the entity needs turns of its
 * own to finish. Waits while a save holds it or waits for it, as long as a write waits for a busy
 * SQLite file, which is the database's busy timeout, then refused as such a write is: the database
 * busy, nothing written. `waitOf` says how much of that time this write has left, all of it where it
 * is left out.
 */
export async function shareEntityInProcess(
  owner: object,
  entity: EntityRef,
  waitOf: (busyTimeoutMs: number) => number = whole => whole
): Promise<() => void> {
  const hold = processHoldOf(owner, entity);
  await waitInProcess(
    hold,
    () => !hold.held && hold.saving === 0,
    () => {
      hold.sharing += 1;
    },
    () => entityBusy(entity, "entity-share-timeout"),
    waitOf(hold.busyTimeoutMs)
  );
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.sharing -= 1;
    wake(hold);
  };
}

/**
 * Refuses, at once, as the database being busy, an entry write on a transaction already open (a
 * caller's, or one the flow opened) while a save holds `entity` in this process on SQLite: the write
 * holds the one connection's turn, and the save needs a turn to finish, so waiting for it would wait
 * forever.
 * Where no save holds it, a save that takes it later counts in a turn of its own, after this
 * transaction has ended, so its count includes the write.
 */
export function refuseWhileHeldInProcess(
  owner: object,
  entity: EntityRef
): void {
  if (processHoldOf(owner, entity).held) {
    throw entityBusy(entity, "entity-held-in-open-transaction");
  }
}

/**
 * A deleting save's hold of `entity` in this process, through `owner`, on SQLite: exclusive, taken
 * once the writes sharing it have ended (new ones wait behind it), at most `waitMs`, then refused
 * before anything changes. Held until `release`. `busyTimeoutMs` is the database's busy timeout as
 * the save finds it, before its own statements bound their tries by another: how long a write waits
 * for this save.
 */
export async function holdEntityInProcess(
  owner: object,
  entity: EntityRef,
  {
    waitMs = ENTITY_HOLD_WAIT_MS,
    busyTimeoutMs = SQLITE_BUSY_TIMEOUT_MS,
  }: { waitMs?: number; busyTimeoutMs?: number } = {}
): Promise<() => void> {
  const hold = processHoldOf(owner, entity);
  hold.saving += 1;
  hold.busyTimeoutMs = busyTimeoutMs;
  try {
    await waitInProcess(
      hold,
      () => !hold.held && hold.sharing === 0,
      () => {
        hold.held = true;
      },
      () => entityBeingChanged(entity, "entity-hold-timeout"),
      waitMs
    );
  } finally {
    hold.saving -= 1;
    // A save that stopped waiting lets the writes queued behind it look again.
    wake(hold);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.held = false;
    wake(hold);
  };
}

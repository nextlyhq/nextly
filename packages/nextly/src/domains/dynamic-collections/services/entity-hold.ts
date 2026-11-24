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
import type { AddressKind } from "../../../shared/address-rule";

/**
 * What a hold is on: a collection, a Single, or a field group, named by its kind and slug. The kind
 * is part of the hold's name, so a Single and a collection that share a slug are held apart.
 */
export interface EntityRef {
  readonly kind: AddressKind;
  readonly slug: string;
  /**
   * The registry table that holds the entity's row, where it is not the kind's own: a field group's,
   * which a database may hold under either of two names. Part of what is held, not of its name.
   */
  readonly registryTable?: string;
}

/** What an entity is called in a refusal a person reads. */
export const ENTITY_NOUN: Readonly<Record<AddressKind, string>> = {
  collection: "collection",
  single: "Single",
  fieldGroup: "field group",
};

/** The one name `entity`'s hold goes by on every database: its kind, then its slug. */
export function entityHoldKey(entity: EntityRef): string {
  return `${entity.kind}:${entity.slug}`;
}

/**
 * How long a write or a save waits for the other side of an entity's hold before it is refused
 * with nothing changed, as long as MySQL's named locks wait (`takeNamedCollectionLocks`).
 */
const ENTITY_HOLD_WAIT_MS = 30_000;

/** The refusal of a hold not had in time, or held by a save where waiting is not possible. */
function entityBeingChanged(entity: EntityRef, reason: string): NextlyError {
  return new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage: `This ${ENTITY_NOUN[entity.kind]} is being changed elsewhere. Try again in a moment.`,
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

/** One entity's hold in this process: the writes sharing it, and whether a save holds it. */
interface ProcessHold {
  sharing: number;
  held: boolean;
  /** Saves waiting for it: while one waits, a new write waits behind it. */
  saving: number;
  waiting: Array<() => void>;
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
    hold = { sharing: 0, held: false, saving: 0, waiting: [] };
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
  refused: () => NextlyError,
  waitMs: number
): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!free()) {
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
 * own to finish. Waits while a save holds it or waits for it, at most `waitMs`, then refused.
 */
export async function shareEntityInProcess(
  owner: object,
  entity: EntityRef,
  waitMs = ENTITY_HOLD_WAIT_MS
): Promise<() => void> {
  const hold = processHoldOf(owner, entity);
  await waitInProcess(
    hold,
    () => !hold.held && hold.saving === 0,
    () => entityBeingChanged(entity, "entity-share-timeout"),
    waitMs
  );
  hold.sharing += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.sharing -= 1;
    wake(hold);
  };
}

/**
 * Refuses, at once, an entry write on a transaction already open (a caller's, or one the flow
 * opened) while a save holds `entity` in this process on SQLite: the write holds the one
 * connection's turn, and the save needs a turn to finish, so waiting for it would wait forever.
 * Where no save holds it, a save that takes it later counts in a turn of its own, after this
 * transaction has ended, so its count includes the write.
 */
export function refuseWhileHeldInProcess(
  owner: object,
  entity: EntityRef
): void {
  if (processHoldOf(owner, entity).held) {
    throw entityBeingChanged(entity, "entity-held-in-open-transaction");
  }
}

/**
 * A deleting save's hold of `entity` in this process, through `owner`, on SQLite: exclusive, taken
 * once the writes sharing it have ended (new ones wait behind it), at most `waitMs`, then refused
 * before anything changes. Held until `release`.
 */
export async function holdEntityInProcess(
  owner: object,
  entity: EntityRef,
  waitMs = ENTITY_HOLD_WAIT_MS
): Promise<() => void> {
  const hold = processHoldOf(owner, entity);
  hold.saving += 1;
  try {
    await waitInProcess(
      hold,
      () => !hold.held && hold.sharing === 0,
      () => entityBeingChanged(entity, "entity-hold-timeout"),
      waitMs
    );
  } finally {
    hold.saving -= 1;
    // A save that stopped waiting lets the writes queued behind it look again.
    wake(hold);
  }
  hold.held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    hold.held = false;
    wake(hold);
  };
}

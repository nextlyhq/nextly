/**
 * A deleting save's hold of its entity (a collection, a Single or a field group), from before its
 * count until the registry row the save
 * writes records the new definition: entry writes take the hold's share side (`holdEntityForWrite`)
 * and wait for it, so a write made for the old definition never lands between the save's count
 * and its delete, nor between its change and its registry write.
 *
 * The caller that writes the registry row opens a scope (`saveHoldScope`) and ends it once the row
 * is written, however the save ended; the save takes the hold through it where it counts
 * (`take`), once. Each database holds it its own way:
 *
 * - MySQL: the entity's named locks and its registry row `FOR UPDATE` on a connection kept for the
 *   scope (`holdEntityOnSession`); the save's own statements run on other connections.
 * - PostgreSQL: the entity's advisory lock, exclusive, on a connection kept for the scope
 *   (`holdEntityOnPostgresSession`).
 * - SQLite: the entity's lock in this process (`holdEntityInProcess`).
 *
 * @module domains/schema/builder-save/save-hold
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SqlParam,
  StatementSession,
} from "@nextlyhq/adapter-drizzle/types";

import { holdEntityOnSession } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import {
  type EntityRef,
  entityHoldKey,
  holdEntityInProcess,
  holdEntityOnPostgresSession,
} from "../../dynamic-collections/services/entity-hold";
import {
  openPostgresBesidePool,
  poolCanSpareOne,
} from "../busy-table/watch-connection";

/** A save's hold, kept until `end`. */
export interface SaveHoldScope {
  /**
   * Takes `entity`'s hold through `adapter`, once for the scope: later calls find it taken.
   * Refused, with nothing changed, where another change holds the entity past the hold's wait
   * (`COLLECTION_BEING_CHANGED`).
   */
  take(adapter: DrizzleAdapter, entity: EntityRef): Promise<void>;
  /**
   * Lets the hold go, however the save ended. A release that fails is told and passed over: the
   * connection the hold was taken on is closed, which lets it go.
   */
  end(): Promise<void>;
}

/** A scope holding nothing until a save takes its hold through it. */
export function saveHoldScope(logger: {
  warn(message: string): void;
}): SaveHoldScope {
  let held: { entity: EntityRef; release: () => Promise<void> } | undefined;
  let taking: Promise<void> | undefined;
  return {
    async take(adapter, entity) {
      // Taken once: a second save step of the same scope (its count, then its push) finds it held.
      taking ??= takeSaveHold(adapter, entity).then(release => {
        held = { entity, release };
      });
      await taking;
    },
    async end() {
      const ending = held;
      held = undefined;
      taking = undefined;
      await ending?.release().catch((error: unknown) => {
        logger.warn(
          `'${entityHoldKey(ending.entity)}': its hold for the save could not be let go (${error instanceof Error ? error.message : String(error)}); closing the connection it was taken on lets it go.`
        );
      });
    },
  };
}

/** `entity`'s hold for a save through `adapter`, and what lets it go. */
async function takeSaveHold(
  adapter: DrizzleAdapter,
  entity: EntityRef
): Promise<() => Promise<void>> {
  const dialect = adapter.getCapabilities().dialect;
  if (dialect === "sqlite") {
    const release = await holdEntityInProcess(adapter, entity);
    return () => Promise.resolve(release());
  }
  const { session, close } =
    (await sessionBesidePool(adapter)) ?? (await sessionKeptOpen(adapter));
  let release: () => Promise<void>;
  try {
    ({ release } =
      dialect === "mysql"
        ? await holdEntityOnSession(adapter, session, entity)
        : await holdEntityOnPostgresSession(session, entity));
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
  // Released on its connection, which then closes whatever the release did.
  return async () => {
    try {
      await release();
    } finally {
      await close();
    }
  };
}

/** What a save's hold connection beside the pool is named, so an operator can tell what it is. */
const SAVE_HOLD_APPLICATION_NAME = "nextly save hold";

/**
 * On PostgreSQL with a pool of one connection, a connection opened beside the pool for the hold
 * (`openPostgresBesidePool`), as the busy-table watch and the schema lock's renewals open one:
 * kept on the pool's only connection, the hold would leave the save's own count and statements
 * waiting for a second one that never comes. Undefined elsewhere: a pool that can spare a
 * connection keeps the hold on one of its own (`sessionKeptOpen`), and MySQL's sessions open
 * outside its pool.
 */
async function sessionBesidePool(adapter: DrizzleAdapter): Promise<
  | {
      session: StatementSession;
      close: () => Promise<void>;
    }
  | undefined
> {
  if (
    adapter.getCapabilities().dialect !== "postgresql" ||
    poolCanSpareOne(adapter, "postgresql")
  ) {
    return undefined;
  }
  const connection = await openPostgresBesidePool(
    adapter,
    SAVE_HOLD_APPLICATION_NAME
  );
  if (connection === undefined) return undefined;
  return {
    session: {
      execute: <T>(text: string, params?: SqlParam[]) =>
        connection.execute<T>(text, params ?? []),
    },
    close: () => connection.close(),
  };
}

/**
 * A connection of `adapter` held for one caller (`withSession`) and kept open until `close`: the
 * session's work waits for it, so the connection, and a lock taken on it, outlasts the call that
 * opened it.
 */
async function sessionKeptOpen(adapter: DrizzleAdapter): Promise<{
  session: StatementSession;
  close: () => Promise<void>;
}> {
  let closed: () => void = () => undefined;
  const closing = new Promise<void>(resolve => {
    closed = resolve;
  });
  let opened: (session: StatementSession) => void = () => undefined;
  const open = new Promise<StatementSession>(resolve => {
    opened = resolve;
  });
  const ended = adapter.withSession(async session => {
    opened(session);
    await closing;
  });
  // A session that cannot open ends with its failure before it is ever given; one that ended
  // otherwise was given first, and answers with it.
  const first = await Promise.race<
    { session: StatementSession } | { error: unknown }
  >([
    open.then(session => ({ session })),
    ended.then(
      () => open.then(session => ({ session })),
      (error: unknown) => ({ error })
    ),
  ]);
  if ("error" in first) throw first.error;
  const { session } = first;
  return {
    session,
    close: async () => {
      closed();
      await ended;
    },
  };
}

/**
 * A deleting save's hold of its collection, from before its count until the registry row the save
 * writes records the new definition: entry writes take the hold's share side (`holdEntityForWrite`)
 * and wait for it, so a write made for the old definition never lands between the save's count
 * and its delete, nor between its change and its registry write.
 *
 * The caller that writes the registry row opens a scope (`saveHoldScope`) and ends it once the row
 * is written, however the save ended; the save takes the hold through it where it counts
 * (`take`), once. Each database holds it its own way:
 *
 * - MySQL: the collection's named locks and its registry row `FOR UPDATE` on a connection kept for
 *   the scope (`holdCollectionOnSession`); the save's own statements run on other connections.
 * - PostgreSQL: the entity's advisory lock, exclusive, on a connection kept for the scope
 *   (`holdEntityOnPostgresSession`).
 * - SQLite: the entity's lock in this process (`holdEntityInProcess`).
 *
 * @module domains/schema/builder-save/save-hold
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { StatementSession } from "@nextlyhq/adapter-drizzle/types";

import { holdCollectionOnSession } from "../../dynamic-collections/services/dynamic-collection-registry-service";
import {
  holdEntityInProcess,
  holdEntityOnPostgresSession,
} from "../../dynamic-collections/services/entity-hold";

/** A save's hold, kept until `end`. */
export interface SaveHoldScope {
  /**
   * Takes collection `slug`'s hold through `adapter`, once for the scope: later calls find it
   * taken. Refused, with nothing changed, where another change holds the collection past the
   * hold's wait (`COLLECTION_BEING_CHANGED`).
   */
  take(adapter: DrizzleAdapter, slug: string): Promise<void>;
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
  let held: { slug: string; release: () => Promise<void> } | undefined;
  let taking: Promise<void> | undefined;
  return {
    async take(adapter, slug) {
      // Taken once: a second save step of the same scope (its count, then its push) finds it held.
      taking ??= takeSaveHold(adapter, slug).then(release => {
        held = { slug, release };
      });
      await taking;
    },
    async end() {
      const ending = held;
      held = undefined;
      taking = undefined;
      await ending?.release().catch((error: unknown) => {
        logger.warn(
          `Collection '${ending.slug}': its hold for the save could not be let go (${error instanceof Error ? error.message : String(error)}); closing the connection it was taken on lets it go.`
        );
      });
    },
  };
}

/** Collection `slug`'s hold for a save through `adapter`, and what lets it go. */
async function takeSaveHold(
  adapter: DrizzleAdapter,
  slug: string
): Promise<() => Promise<void>> {
  const dialect = adapter.getCapabilities().dialect;
  if (dialect === "sqlite") {
    const release = await holdEntityInProcess(adapter, {
      kind: "collection",
      slug,
    });
    return () => Promise.resolve(release());
  }
  const { session, close } = await sessionKeptOpen(adapter);
  let release: () => Promise<void>;
  try {
    ({ release } =
      dialect === "mysql"
        ? await holdCollectionOnSession(adapter, session, slug)
        : await holdEntityOnPostgresSession(session, {
            kind: "collection",
            slug,
          }));
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

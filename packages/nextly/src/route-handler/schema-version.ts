/**
 * The schema version this server copy serves, and the signal that tells it
 * another copy changed the schema.
 *
 * The version is the database's stored schema version's `seq`
 * (`domains/schema/schema-version`), which every write of registry rows moves
 * in that write's own transaction, whoever made it: this copy, another copy
 * of the app, `nextly migrate` or a migration file. A copy's definitions (the
 * Drizzle tables its entry reads and writes are built from) are loaded from
 * the registry rows, so a `seq` that moved means they may describe a schema
 * the database no longer has.
 *
 * - **Read rarely, and once for everyone.** The stored version is read at most
 *   once per {@link SCHEMA_VERSION_READ_INTERVAL_MS} per process, by the first
 *   request to find the last read too old; every request arriving while that
 *   read runs waits for it rather than reading again. Every other request
 *   reads nothing. One indexed read of one row, every couple of seconds while
 *   requests arrive, and none while they do not.
 * - **A change reloads the definitions before the request goes on.** When the
 *   `seq` read differs from the one this copy's definitions were loaded at,
 *   they are loaded again from the registry rows (`reloadDynamicTables`, and
 *   the collection read path's own table cache dropped), and only then do the
 *   waiting requests run. So a change is served everywhere within the interval
 *   plus the reload, with no restart.
 * - **The first read loads them again too.** Nothing records which `seq` the
 *   start loaded the definitions at, so a change made between that load and
 *   this copy's first read would otherwise never be seen. The first read of a
 *   process (or of a new database connection) therefore reloads once.
 *
 * The admin reads the same value from the `X-Nextly-Schema-Version` header and
 * refetches its schema when it increases; it is one number for every copy, so
 * a tab that moves between copies sees it only ever increase.
 *
 * Kept in a module of its own so the collection dispatcher marks a change
 * without loading the route handler, which reaches the boot entry and nearly
 * all of the package; the readers and the reload are imported when first
 * needed for the same reason.
 *
 * @module route-handler/schema-version
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../di/container";
import { isServicesRegistered } from "../di/service-access";
import type { CollectionsHandler } from "../services/collections-handler";
import { isWithinLifetime, monotonicNow } from "../shared/lib/lifetime";

/**
 * How long one read of the stored schema version is reused by this process:
 * the bound, with the reload after it, on how long another copy's schema
 * change goes unserved here.
 */
export const SCHEMA_VERSION_READ_INTERVAL_MS = 2000;

/** What this process knows of the schema version. */
interface ServedSchema {
  /** The adapter the version was read through: a new one starts afresh. */
  database: object | undefined;
  /** The `seq` this process's definitions were loaded at. */
  seq: number | undefined;
  /** When the read that settled `seq` began, on a clock that never steps back. */
  readAt: number | undefined;
  /** Set by {@link bumpSchemaVersion}: the next request reads again. */
  stale: boolean;
  /** The read (and any reload after it) every concurrent request waits on. */
  inFlight: Promise<void> | null;
}

// On `globalThis`: a Next.js server holds several copies of a package's
// modules, and a copy each would read and reload once per copy.
const globalForSchema = globalThis as unknown as {
  __nextly_servedSchema?: ServedSchema;
};

function served(): ServedSchema {
  globalForSchema.__nextly_servedSchema ??= {
    database: undefined,
    seq: undefined,
    readAt: undefined,
    stale: false,
    inFlight: null,
  };
  return globalForSchema.__nextly_servedSchema;
}

/** The registered adapter, or undefined while the services are not up. */
function registeredAdapter(): DrizzleAdapter | undefined {
  if (!isServicesRegistered()) return undefined;
  try {
    return container.get<DrizzleAdapter>("adapter");
  } catch {
    return undefined;
  }
}

/**
 * The schema version this copy serves, after making sure its definitions
 * follow the stored one: read again where the last read is older than
 * {@link SCHEMA_VERSION_READ_INTERVAL_MS}, and the definitions reloaded where
 * it moved. Undefined while the services are not started, or where the
 * version could never be read. Never throws: a read that fails keeps what
 * this copy has, and is tried again after the interval.
 */
export async function servedSchemaVersion(): Promise<number | undefined> {
  const adapter = registeredAdapter();
  if (adapter === undefined) return undefined;
  const state = served();
  for (;;) {
    if (
      state.database === adapter &&
      !state.stale &&
      isWithinLifetime(state.readAt, SCHEMA_VERSION_READ_INTERVAL_MS)
    ) {
      return state.seq;
    }
    if (state.inFlight !== null) {
      // Joined rather than repeated; what it settled is judged again above,
      // since a change marked while it ran asks for a read of its own.
      await state.inFlight;
      continue;
    }
    const reading = followStoredVersion(state, adapter).finally(() => {
      if (state.inFlight === reading) state.inFlight = null;
    });
    state.inFlight = reading;
    // Awaited before judging again: the read clears `stale` as it begins, so
    // the fresh-enough test above would otherwise pass on the old read.
    await reading;
  }
}

/**
 * Read the stored version and, where it is not the one the definitions were
 * loaded at, load them again. Always settles `readAt` and `database`, so a
 * failure is retried after the interval rather than by every request.
 */
async function followStoredVersion(
  state: ServedSchema,
  adapter: DrizzleAdapter
): Promise<void> {
  const startedAt = monotonicNow();
  // Cleared as the read begins: a change marked while it runs marks it again.
  state.stale = false;
  const known = state.database === adapter ? state.seq : undefined;
  try {
    const { readSchemaVersion } = await import(
      "../domains/schema/schema-version"
    );
    const stored = await readSchemaVersion(
      adapter.getDrizzle(),
      adapter.getCapabilities().dialect
    );
    // No stored version: no registry write has recorded one yet.
    const seq = stored.present ? (stored.version?.seq ?? 0) : 0;
    if (seq !== known) await loadDefinitionsAgain();
    state.seq = seq;
  } catch {
    // The version could not be read (a database `nextly migrate` has not
    // prepared, a dropped connection): this copy keeps serving what it has.
    if (state.database !== adapter) state.seq = undefined;
  }
  state.database = adapter;
  state.readAt = startedAt;
}

/**
 * Load this copy's definitions again from the registry rows: the entity
 * tables the adapter resolves (`reloadDynamicTables`, which also drops the
 * cached registry rows), and the tables the collection read path keeps a
 * cache of its own of, dropped so each is built from the rows on next use.
 */
async function loadDefinitionsAgain(): Promise<void> {
  const { reloadDynamicTables } = await import("../init/reload-dynamic-tables");
  await reloadDynamicTables("[Nextly]");
  let handler: CollectionsHandler | undefined;
  try {
    handler = container.get<CollectionsHandler>("collectionsHandler");
  } catch {
    // Not registered: there is no collection cache to drop.
    handler = undefined;
  }
  handler?.forgetCollectionSchemas();
}

/**
 * Say the schema changed in this process (a Schema Builder save, say): the
 * next request reads the stored version at once rather than after the
 * interval, so its response carries the new version. Returns the version this
 * copy serves until then, or 0 where none was read yet.
 */
export function bumpSchemaVersion(): number {
  const state = served();
  state.stale = true;
  return state.seq ?? 0;
}

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
 *   once per {@link SCHEMA_VERSION_READ_INTERVAL_MS} per process (through
 *   `stored-schema-seq`, the read the registry row cache follows too), by the first
 *   request to find the last read too old; every request arriving while that
 *   read runs waits for it rather than reading again. Every other request
 *   reads nothing. One indexed read of one row, every couple of seconds while
 *   requests arrive, and none while they do not. The interval runs from when
 *   a read finished, so a slow read answers its requests and only schedules
 *   the next one.
 * - **A change reloads the definitions before the request goes on.** When the
 *   `seq` read differs from the one this copy's definitions were loaded at,
 *   they are loaded again from the registry rows (`reloadDynamicTables`, and
 *   the collection read path's own table cache dropped), and only then do the
 *   waiting requests run. So a change is served everywhere within the interval
 *   plus the reload, with no restart. A reload that did not register every
 *   entity leaves the version served where it was, and is tried again.
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
import {
  markSchemaChanged,
  SCHEMA_VERSION_READ_INTERVAL_MS,
  storedSchemaSeq,
} from "../domains/schema/stored-schema-seq";
import type { CollectionsHandler } from "../services/collections-handler";
import { isWithinLifetime, monotonicNow } from "../shared/lib/lifetime";

// The interval the stored version is read at, kept beside the read itself
// (`stored-schema-seq`) and named here, where the served version's callers
// have always found it.
export { SCHEMA_VERSION_READ_INTERVAL_MS };

/** What this process knows of the schema version. */
interface ServedSchema {
  /** The adapter the version was read through: a new one starts afresh. */
  database: object | undefined;
  /** The `seq` this process's definitions were loaded at. */
  seq: number | undefined;
  /**
   * When the last read (and any reload after it) finished, on a clock that
   * never steps back: the interval runs from here, so it only ever schedules
   * later reads, however long that one took.
   */
  readAt: number | undefined;
  /** Set by {@link bumpSchemaVersion}: the next request reads again. */
  stale: boolean;
  /**
   * Whether the definitions were loaded at `seq`: false from a reload that did
   * not register every entity until one does, and while false every read
   * reloads again, even one finding the version it served.
   */
  inSync: boolean;
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
    inSync: true,
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
    if (state.inFlight !== null) {
      // Joined rather than repeated. A request arriving while a read runs
      // waits for it, never for the version before it: that read may be the
      // one a change marked here asked for.
      await state.inFlight;
      // What it settled answers this request, however long it took, unless a
      // change was marked while it ran, which asks for a read of its own.
      if (state.database === adapter && !state.stale) return state.seq;
      continue;
    }
    if (
      state.database === adapter &&
      !state.stale &&
      isWithinLifetime(state.readAt, SCHEMA_VERSION_READ_INTERVAL_MS)
    ) {
      return state.seq;
    }
    const reading = followStoredVersion(state, adapter).finally(() => {
      if (state.inFlight === reading) state.inFlight = null;
    });
    state.inFlight = reading;
  }
}

/**
 * Run `load`, a load of this copy's definitions from the registry rows made
 * by the start, and record the stored version it loaded them at: the version
 * is read just before, so a change landing while they load is still seen as
 * a move by the next follow. Without the record the first follow (a page's
 * first Direct API call, the first admin request) could not tell what the
 * start loaded, and loaded every definition again to be sure. Not recorded
 * where the version could not be read, where `loaded` says the load fell
 * short, or where a change was marked here while it ran.
 */
export async function loadingDefinitions<T>(
  load: () => Promise<T>,
  options: {
    /** The adapter loaded through; the registered one where not given. */
    adapter?: DrizzleAdapter;
    /** Whether `load` loaded every definition. */
    loaded?: (result: T) => boolean;
  } = {}
): Promise<T> {
  const adapter = options.adapter ?? registeredAdapter();
  if (adapter === undefined) return load();
  const before = await versionBeforeLoading(adapter);
  const result = await load();
  if ((options.loaded ?? (() => true))(result)) {
    definitionsLoaded(adapter, before);
  }
  return result;
}

/** The stored version read just before a load, for {@link definitionsLoaded}. */
export interface VersionBeforeLoading {
  seq: number | undefined;
  stale: boolean;
}

/**
 * {@link loadingDefinitions}'s first half, for a caller whose load is not
 * one call: the stored version, read now, before the definitions load.
 */
export async function versionBeforeLoading(
  adapter: DrizzleAdapter
): Promise<VersionBeforeLoading> {
  const seq = await storedSchemaSeq(adapter, { fresh: true });
  return { seq, stale: served().stale };
}

/**
 * {@link loadingDefinitions}'s second half: every definition loaded, at the
 * version read before the load began.
 */
export function definitionsLoaded(
  adapter: DrizzleAdapter,
  before: VersionBeforeLoading
): void {
  const state = served();
  if (
    before.seq === undefined ||
    before.stale ||
    state.stale ||
    state.inFlight !== null
  ) {
    return;
  }
  state.database = adapter;
  state.seq = before.seq;
  state.inSync = true;
  state.readAt = monotonicNow();
}

/**
 * Run `operation` once this copy's definitions follow the stored schema
 * version ({@link servedSchemaVersion}), as every admin API request does
 * before it is handled: for the Direct API, which every page a site renders
 * and every script reads through. A process that serves no admin request
 * (an instance that has only rendered pages since it started, a script)
 * would otherwise keep the definitions it started with however the schema
 * changed elsewhere, and a removed column would fail its reads while an
 * added one went unread.
 *
 * Costs a memory check within the interval, one indexed read after it, and
 * a reload only where the version moved. Nothing is read inside an open
 * transaction: the call is part of a write already under way, which reads
 * the definitions it began with.
 */
export async function withCurrentSchema<T>(
  operation: () => Promise<T>
): Promise<T> {
  const adapter = registeredAdapter() as
    | Partial<Pick<DrizzleAdapter, "transactionOpenInFlow">>
    | undefined;
  if (adapter !== undefined && adapter.transactionOpenInFlow?.() !== true) {
    await servedSchemaVersion();
  }
  return operation();
}

/**
 * Read the stored version and, where it is not the one the definitions were
 * loaded at, load them again; the version is advanced only once they loaded.
 * Always settles `readAt` and `database`, so a failure (a read, or a reload)
 * is tried again after the interval rather than by every request.
 */
async function followStoredVersion(
  state: ServedSchema,
  adapter: DrizzleAdapter
): Promise<void> {
  // Cleared as the read begins: a change marked while it runs marks it again.
  state.stale = false;
  const known = state.database === adapter ? state.seq : undefined;
  // Read now, through the one read the process shares (`stored-schema-seq`),
  // so the registry row cache files what it reads under the count this read
  // found rather than reading it again. It never throws.
  const seq = await storedSchemaSeq(adapter, { fresh: true });
  if (seq === undefined) {
    // The version could not be read (a database `nextly migrate` has not
    // prepared, a dropped connection): this copy keeps serving what it has.
    if (state.database !== adapter) state.seq = undefined;
  } else if (seq !== known || !state.inSync) {
    // A reload that did not register every entity leaves the version served
    // where it was and marks the definitions out of step, so the next read
    // tries again, whether or not the stored version moved meanwhile.
    try {
      state.inSync = await loadDefinitionsAgain();
      if (state.inSync) state.seq = seq;
      else if (state.database !== adapter) state.seq = undefined;
    } catch {
      // The reload could not run at all: kept as a failed read, served as
      // before and tried again after the interval.
      if (state.database !== adapter) state.seq = undefined;
    }
  }
  state.database = adapter;
  state.readAt = monotonicNow();
}

/**
 * Load this copy's definitions again from the registry rows: the entity
 * tables the adapter resolves (`reloadDynamicTables`, which also drops the
 * cached registry rows), and the tables the collection read path keeps a
 * cache of its own of, dropped so each is built from the rows on next use.
 * Answers whether every entity registered.
 */
async function loadDefinitionsAgain(): Promise<boolean> {
  const { reloadDynamicTables } = await import("../init/reload-dynamic-tables");
  const loaded = await reloadDynamicTables("[Nextly]");
  let handler: CollectionsHandler | undefined;
  try {
    handler = container.get<CollectionsHandler>("collectionsHandler");
  } catch {
    // Not registered: there is no collection cache to drop.
    handler = undefined;
  }
  handler?.forgetCollectionSchemas();
  return loaded;
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
  // The shared read too, so the cached registry rows follow the new count
  // from the next read on rather than after the interval.
  markSchemaChanged();
  return state.seq ?? 0;
}

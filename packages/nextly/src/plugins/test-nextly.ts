/**
 * `createTestNextly` — the integration harness.
 *
 * Boots a REAL Nextly instance (not mocks), running the full plugin lifecycle
 * (resolve → setup → schema sync → init), so plugin authors and the framework
 * can integration-test hooks, events, and lifecycle. Lives in core and is
 * re-exported from `@nextlyhq/plugin-sdk/testing`.
 *
 * In-memory SQLite by default, which needs no server and no cleanup. Pass
 * `dialect` to boot against PostgreSQL or MySQL instead: that instance gets a
 * database of its own, dropped when it is destroyed. Column types, default
 * expressions, and JSON handling differ enough between dialects that SQLite
 * alone will not reveal a defect in any of them.
 *
 * @module plugins/test-nextly
 */

import { randomBytes } from "node:crypto";

import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

import type { CollectionConfig } from "../collections/config/define-collection";
import { createAdapter } from "../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
  type ProvisionableDialect,
} from "../database/test-database-ddl";
import {
  clearServices,
  getService,
  registerServices,
  shutdownServices,
} from "../di/register";
import { getNextly, resetNextlyInstance } from "../direct-api/nextly";
import type { Nextly } from "../direct-api/nextly";
import { resetEmailProviderRegistry } from "../domains/email/services/email-provider-registry";
import { normalizeLocalization } from "../domains/i18n/config/normalize";
import type { LocalizationConfig } from "../domains/i18n/config/types";
import { clearFieldTypes } from "../domains/schema/field-types/field-type-registry";
import {
  refreshEndpointPresence,
  resetWebhookActivation,
} from "../domains/webhooks/recording-activation";
import { resetWebhookRecordingPolicy } from "../domains/webhooks/recording-policy";
import { NextlyError } from "../errors/nextly-error";
import type { EventBus } from "../events/event-bus";
import { getEventBus, resetEventBus } from "../events/event-bus";
import type { FieldGroupConfig } from "../field-groups/config/types";
import { resetFilterRegistry } from "../filters";
import { getHookRegistry, resetHookRegistry } from "../hooks/hook-registry";
import type { HookRegistry } from "../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../init/schema-snapshot-cache";
import type { CollectionAccessRules } from "../services/access";
import type { Logger } from "../services/shared";
import { _resetEnvCache } from "../shared/lib/env";
import type { SingleConfig } from "../singles/config/types";
import { getImageProcessor } from "../storage/image-processor";

import {
  PG_ABORTED_TRANSACTION_SQLSTATE,
  isAbortedTransactionError,
  recordAbortedTransaction,
} from "./aborted-transaction-sightings";
import type { PluginDefinition } from "./plugin-context";
import { resetPluginRouteRegistry } from "./routes/route-registry";
import { clearPluginServices } from "./services/plugin-services-registry";
import { clearPluginSubscriptions } from "./subscription-tracker";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

/** The dialects a test instance can boot on. */
export type TestDialect = "sqlite" | "postgresql" | "mysql";

/**
 * The environment variable naming the SERVER each non-SQLite dialect connects
 * to. The database in that URL is only used to reach the server: every boot
 * creates and drops its own.
 */
const DIALECT_SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/**
 * Which dialects this process is CONFIGURED to boot on.
 *
 * SQLite is always included — it runs in memory with no server. The others are
 * included when their server URL is set, so a suite can cover every dialect a
 * developer has configured without failing on the ones they have not.
 *
 * Configured is not the same as reachable, and this deliberately does not
 * probe: a URL pointing at a stopped container is still reported, and the
 * suite will fail against it rather than skip. That is the intended outcome —
 * a dialect someone asked for and cannot reach is a broken environment, and
 * silently skipping it is how the gaps this harness exists to close were
 * hidden in the first place.
 */
export function getConfiguredTestDialects(): TestDialect[] {
  const configured: TestDialect[] = ["sqlite"];
  for (const dialect of ["postgresql", "mysql"] as const) {
    if (process.env[DIALECT_SERVER_URL_ENV[dialect]]) configured.push(dialect);
  }
  return configured;
}

/**
 * Read the driver's text off an unknown thrown value, for the recorded sighting.
 *
 * Only the two shapes that can actually carry it. Anything else is not a database error, and
 * stringifying it would produce "[object Object]" rather than a message worth reporting. The
 * message is what gets shown to whoever has to find the swallowed error; whether the value counts
 * as an abort at all is decided structurally by `isAbortedTransactionError`.
 */
function driverMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string"
    ? error
    : `aborted transaction reported without a readable message (SQLSTATE ${PG_ABORTED_TRANSACTION_SQLSTATE})`;
}

/**
 * The savepoint pair the abort probe needs from a transaction context.
 *
 * Both optional on the interface, and only implemented where the dialect has savepoints —
 * PostgreSQL being the one that matters here, since it is the only dialect that poisons a
 * transaction in the first place.
 */
interface AbortProbeContext {
  savepoint?: (name: string) => Promise<void>;
  releaseSavepoint?: (name: string) => Promise<void>;
}

/**
 * Fixed name, distinctive enough not to collide with a savepoint a test took itself. Created and
 * released immediately, so nesting cannot leave more than one of these outstanding.
 */
const ABORT_PROBE_SAVEPOINT = "nextly_abort_probe";

/**
 * Ask the transaction for one more statement to find out whether it is still usable.
 *
 * PostgreSQL marks a transaction aborted the moment a statement in it fails and keeps it that
 * way until COMMIT or ROLLBACK. A COMMIT on an aborted transaction is accepted and silently
 * downgraded to a rollback, so a callback that catches its own failure and returns normally
 * leaves `transaction()` resolving over a transaction that discarded every write. From outside,
 * one more statement is the only thing that reveals it: the aborted state answers, because the
 * error that caused it is gone.
 *
 * The statement is a savepoint rather than a `SELECT`, for two reasons. An aborted transaction
 * rejects `SAVEPOINT` with the same code it rejects everything else by, so it answers the question
 * just as well — and it goes through the adapter's own method, which keeps this file free of the
 * SQL string a shipped module has no business carrying. On a healthy transaction the savepoint is
 * released immediately, leaving nothing behind.
 *
 * A probe failure that is NOT the abort signature propagates. The probe is meant to observe the
 * transaction rather than change it, and a statement of its own that fails has changed it: the
 * transaction is now aborted because of this query, and reporting success would be a lie.
 */
async function probeForAbortedTransaction(
  ctx: AbortProbeContext
): Promise<void> {
  if (typeof ctx?.savepoint !== "function") return;
  try {
    await ctx.savepoint(ABORT_PROBE_SAVEPOINT);
  } catch (error) {
    if (isAbortedTransactionError(error)) {
      recordAbortedTransaction(driverMessage(error));
      // Left to resolve or reject as it would have. The callback caused this, and changing the
      // outcome would change the path under test; the recorded sighting is what fails the test.
      return;
    }
    // Anything else means the probe itself broke the transaction — a `statement_timeout` from the
    // `timeoutMs` option is the realistic case. PostgreSQL would then accept the COMMIT as a
    // rollback and the call would resolve having discarded every write, so swallowing this would
    // manufacture exactly the silent loss the guard exists to catch.
    throw error;
  }
  // Reached only when the transaction was healthy, so the savepoint exists and releasing it is
  // what leaves the transaction exactly as the callback left it.
  await ctx.releaseSavepoint?.(ABORT_PROBE_SAVEPOINT);
}

/**
 * Wrap an adapter so a transaction left in PostgreSQL's aborted state is recorded.
 *
 * An existence check is easy to write as "run a query and catch the failure". That is a valid
 * probe on SQLite and MySQL and a transaction-killer on PostgreSQL: the check catches its own
 * error, reports "absent", and every later statement in the same transaction fails. The symptom
 * then surfaces far from its cause, and on one dialect only.
 *
 * Two places can see it and both are needed. An abort that propagates out of `transaction()` is
 * caught below. An abort that never escapes — because the callback swallowed it and returned
 * normally, which is what the bulk write paths do for per-item errors while `stopOnError` is
 * false — cannot reach that catch, and is found instead by probing the context once the callback
 * resolves.
 *
 * Recording is all this does. The assertion lives in the shared setup file so it covers every
 * integration test without each one opting in, and control flow is deliberately left alone:
 * turning a resolved transaction into a rejected one would change the path under test.
 *
 * One case stays uncovered: a callback that swallows the poisoning error and then throws
 * something unrelated. The probe cannot run, and the outer catch sees only the substitute, so
 * the sighting is lost — but that failure is at least loud, because the substitute propagates.
 */
const GUARDED = Symbol.for("nextly.abortedTransactionGuardInstalled");

function guardAgainstAbortedTransactions<T extends TestAdapter>(adapter: T): T {
  // An adapter can be handed to `createTestNextly` more than once — that is how a test keeps an
  // in-memory database alive across boots. Wrapping the wrapper would nest a probe per boot, so a
  // single abort would report two, three, four times and each transaction would pay for every
  // boot that ever happened.
  const marker = adapter as unknown as Record<symbol, boolean>;
  if (marker[GUARDED]) return adapter;

  const originalTransaction = adapter.transaction?.bind(adapter);
  if (!originalTransaction) return adapter;
  const wrapped = async (...args: unknown[]): Promise<unknown> => {
    const [callback, ...rest] = args;
    // Probe on the context the callback itself used, so the question reaches the transaction
    // that may have been poisoned rather than a fresh connection from the pool.
    const instrumented =
      typeof callback === "function"
        ? async (ctx: AbortProbeContext): Promise<unknown> => {
            const result = await (
              callback as (c: AbortProbeContext) => Promise<unknown>
            )(ctx);
            await probeForAbortedTransaction(ctx);
            return result;
          }
        : callback;
    try {
      return await (
        originalTransaction as (...a: unknown[]) => Promise<unknown>
      )(instrumented, ...rest);
    } catch (error) {
      if (isAbortedTransactionError(error)) {
        recordAbortedTransaction(driverMessage(error));
      }
      throw error;
    }
  };
  (adapter as { transaction: unknown }).transaction = wrapped;
  marker[GUARDED] = true;
  return adapter;
}

export interface CreateTestNextlyOptions {
  /**
   * Boot against a real database server instead of in-memory SQLite.
   *
   * A dedicated database is created for this instance and dropped by
   * `destroy()`, because the shared test database is written to by every other
   * suite in the run and cannot answer a question about schema state. Requires
   * the dialect's server URL (`TEST_POSTGRES_URL` / `TEST_MYSQL_URL`) unless
   * `serverUrl` is given; check `getConfiguredTestDialects()` to skip
   * cleanly when it is not configured.
   *
   * Ignored when `adapter` is supplied: that adapter is used as given, and
   * nothing is provisioned or dropped for it. Note that `destroy()` still
   * disconnects it, as it always has — supplying an adapter chooses the
   * connection, not its lifetime.
   */
  dialect?: TestDialect;
  /**
   * Server to create the throwaway database on, overriding the environment
   * variable for `dialect`. The database named in it is only used to connect.
   */
  serverUrl?: string;
  /** Plugins to boot (their full lifecycle runs). */
  plugins?: PluginDefinition[];
  /** Code-first collections to register (tables created on the in-memory DB). */
  collections?: CollectionConfig[];
  /** Code-first singles. */
  singles?: SingleConfig[];
  /** Code-first field groups. */
  fieldGroups?: FieldGroupConfig[];
  /** Content-localization config (i18n). Normalized and wired so localized reads resolve. */
  localization?: LocalizationConfig;
  /** Override the adapter (defaults to a fresh in-memory SQLite adapter). */
  adapter?: TestAdapter;
  /** Override the logger (defaults to a near-silent test logger). */
  logger?: Logger;
  /**
   * Stored per-collection access rules (`accessRules`) keyed by slug. Code-first
   * `defineCollection` carries only code `access` functions, so an integration
   * test that needs a STORED rule (for example an owner-only publish rule) sets
   * it here. After boot the rule is written to the collection's
   * `dynamic_collections` row exactly as the Schema Builder would persist it, so
   * the access path surfaces it through `getCollection`.
   */
  collectionAccessRules?: Record<string, CollectionAccessRules>;
  /**
   * Stored per-single access rules, keyed by slug. Mirrors
   * `collectionAccessRules` for Singles: written to the `dynamic_singles` row
   * after boot so the access path surfaces a STORED rule (for example an
   * owner-only publish rule) that a code-first `defineSingle` cannot carry.
   */
  singleAccessRules?: Record<string, CollectionAccessRules>;
}

export interface TestNextly {
  /** The booted direct-API facade for CRUD assertions. */
  nextly: Nextly;
  /** Container accessor for inspecting any registered service. */
  getService: typeof getService;
  /** The live hook registry (assert hook registration/execution). */
  hooks: HookRegistry;
  /** The live event bus (assert emissions; call `events.settle()`). */
  events: EventBus;
  /** The underlying adapter (raw DB inspection). */
  adapter: TestAdapter;
  /** Tear down: run plugin destroy (T9), disconnect, reset all singletons. */
  destroy(): Promise<void>;
}

/**
 * A throwaway database created for one test instance.
 *
 * `release` drops it and puts the environment back. The adapter itself is not
 * disconnected here: `shutdownServices` owns that, and it has to happen before
 * the drop or PostgreSQL refuses to remove a database still being connected to.
 */
interface ProvisionedDatabase {
  adapter: TestAdapter;
  release(): Promise<void>;
}

/**
 * Capture the environment variables a boot is about to change, and return the
 * function that puts them back.
 *
 * A variable that was absent has to be removed rather than assigned back:
 * `process.env.X = undefined` stores the string "undefined", and the files that
 * follow in this process would read it as configured. Restoring the variables
 * is not enough on its own either — the validated environment is cached from
 * its first read.
 */
function snapshotEnv(): () => void {
  const previousUrl = process.env.DATABASE_URL;
  const previousDialect = process.env.DB_DIALECT;
  // One-shot. `destroy()` may be called more than once, and a repeat must not
  // reapply a snapshot that has already been honoured — by then the values it
  // holds are stale, and whatever set the environment since (the next test's
  // setup, the next instance) owns it. The same reasoning covers a retried
  // release: the first attempt restored, so the retry has nothing to put back.
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    _resetEnvCache();
  };
}

/**
 * What the currently booted instance has done to this process, held here
 * rather than only in its closure.
 *
 * A handle that is never destroyed still owns a database and an environment,
 * and the next `createTestNextly` call can only reach them through this: its
 * defensive reset disconnects the previous adapter, but the previous handle's
 * closure is gone. Without it, an abandoned server-backed instance leaks its
 * database on every recovery, and an abandoned SQLite one leaves `DB_DIALECT`
 * reading `sqlite` for the rest of the run.
 *
 * `provisioned` is set for a server-backed boot (its `release` restores the
 * environment itself); `restoreEnv` is set for a SQLite boot, which changes
 * the environment but provisions nothing.
 */
let active: { provisioned?: ProvisionedDatabase; restoreEnv?: () => void } = {};

/**
 * Finish the work an instance started and did not await.
 *
 * Boot fires an endpoint-presence read without awaiting it
 * (`di/registrations/register-webhooks.ts`), and plugin event handlers are
 * post-commit and asynchronous. Either can still be in flight when the
 * connection goes away, and the consequences differ by dialect: on MySQL a
 * query reaching a closed pool is raised as an unhandled exception, which ends
 * the whole run; on PostgreSQL the session it holds open makes a later
 * `DROP DATABASE` fail, which the recovery path swallows — leaking the
 * database for good.
 *
 * Handlers settle first: draining them can schedule webhook work, so the
 * presence read has to come after.
 */
async function drainPendingWork(): Promise<void> {
  await getEventBus()
    .settle()
    .catch(() => {});
  await refreshEndpointPresence().catch(() => {});
}

/**
 * Reclaim the database a previous instance left behind, and hand back the
 * environment snapshot it never got to restore.
 *
 * Deliberately not symmetric with `destroy()`. The environment belongs to
 * whoever boots next: a boot that provisions immediately sets its own, and a
 * boot that supplies its own adapter inherits the current one on purpose —
 * restoring here would leave that second kind with no dialect configured at
 * all.
 *
 * Discarding the snapshot instead would strand the process one instance short
 * of where it started: the incoming boot would capture the abandoned
 * instance's `sqlite` as the value to return to, so no later `destroy()` could
 * reach the environment that existed before it. Returning it lets the next
 * instance adopt it and put the process back properly.
 *
 * A provisioned handle restores its own snapshot inside `release`, because the
 * environment it set names a database about to be dropped; only the SQLite
 * path leaves one pending. Best-effort by design — a failed drop is swallowed
 * here rather than blocking the boot that is trying to start.
 */
async function releaseActiveDatabase(): Promise<(() => void) | undefined> {
  const previous = active;
  active = {};
  await previous.provisioned?.release().catch(() => {});
  return previous.restoreEnv;
}

/**
 * Create a dedicated database for this boot and connect to it.
 *
 * The environment is set before the adapters are built and restored by
 * `release`: creating an adapter reads pool settings through the lazy env
 * proxy, whose validation requires `DATABASE_URL` even when the URL is passed
 * explicitly. It stays set for the lifetime of the instance because code
 * reached during a test reads it too — the HMR and dispatcher apply paths take
 * the MySQL database name from it.
 */
async function provisionDatabase(
  dialect: ProvisionableDialect,
  serverUrl: string
): Promise<ProvisionedDatabase> {
  // Random, not derived from the process id: containers routinely run node as
  // PID 1, so two runners sharing one server would pick the same name and
  // delete each other's database mid-run. Random names are also why nothing
  // is dropped before creating — there is no stale name to clear, and a
  // pre-emptive DROP is exactly the statement that would destroy a peer's
  // database if a name ever did collide.
  const name = `nextly_t_${randomBytes(12).toString("hex")}`;

  const databaseUrl = new URL(serverUrl);
  databaseUrl.pathname = `/${name}`;

  const restoreEnv = snapshotEnv();

  let server: TestAdapter | undefined;
  let databaseExists = false;
  try {
    process.env.DATABASE_URL = serverUrl;
    process.env.DB_DIALECT = dialect;
    // Everything that reads the dialect through the `env` proxy — the boolean
    // conversion in `toDialectBool`, the schema services' fallback — would
    // otherwise answer for whichever dialect booted first in this process.
    _resetEnvCache();
    server = await createAdapter({ type: dialect, url: serverUrl });
    const serverAdapter = server;

    await serverAdapter.executeQuery(createDatabaseStatement(dialect, name));
    databaseExists = true;

    process.env.DATABASE_URL = databaseUrl.toString();
    _resetEnvCache();
    const adapter = await createAdapter({
      type: dialect,
      url: databaseUrl.toString(),
    });

    // A handle destroyed twice — an explicit cleanup plus an `afterEach` — must
    // not drop the database a second time through a server adapter the first
    // call already disconnected. The SQLite path has always tolerated a repeat
    // destroy, so this one does too.
    let released = false;

    return {
      adapter,
      async release() {
        if (released) return;
        // Marked released only once the drop has actually happened, and the
        // server connection is left open until then. A drop that fails — a
        // transient error, or a session the server still counts as attached —
        // is therefore retryable by a later `destroy()` or by the next boot's
        // recovery, rather than leaking a randomly named database for the rest
        // of the run.
        try {
          await serverAdapter.executeQuery(
            dropDatabaseStatement(dialect, name)
          );
        } catch (error) {
          // Put back either way: it names a database this instance owns, and
          // the files that follow share this process.
          restoreEnv();
          throw error;
        }
        released = true;
        // A failed disconnect must not strand the environment either.
        try {
          await serverAdapter.disconnect();
        } finally {
          restoreEnv();
        }
      },
    };
  } catch (error) {
    // Nothing is returned to release on this path, so the database, the
    // connection to the server, and the environment are cleaned up here. The
    // database is dropped only when it was actually created: without this a
    // failure to connect to it — a transient blip, an exhausted connection
    // limit — would abandon it on the server for good.
    if (databaseExists && server) {
      await server
        .executeQuery(dropDatabaseStatement(dialect, name))
        .catch(() => {});
    }
    await server?.disconnect().catch(() => {});
    restoreEnv();
    throw error;
  }
}

/**
 * Resolve the server URL for a dialect, or explain what is missing.
 */
function resolveServerUrl(
  dialect: ProvisionableDialect,
  override: string | undefined
): string {
  const envName = DIALECT_SERVER_URL_ENV[dialect];
  const url = override ?? process.env[envName];
  if (!url) {
    // The guidance is the whole value of this error, so it goes in the public
    // message: `internal()` would reduce it to "An unexpected error occurred."
    // and the harness has no logger wired up to surface the context instead.
    throw NextlyError.invalidInput({
      message:
        `createTestNextly({ dialect: "${dialect}" }) needs a server to ` +
        `connect to. Set ${envName}, or pass serverUrl. Use ` +
        `getConfiguredTestDialects() to skip when it is not configured.`,
    });
  }
  return url;
}

// Near-silent logger so the boot doesn't flood test output, but real failures
// still surface via error().
const defaultTestLogger: Logger = {
  debug() {},
  info() {},
  // Silenced so the boot doesn't flood test output; real failures still
  // surface via error().
  warn() {},
  error(message, meta) {
    console.error(message, meta ?? "");
  },
};

/**
 * Boot a real, isolated Nextly instance on in-memory SQLite.
 *
 * Always call `await handle.destroy()` (e.g. in `afterEach`) so the next boot
 * starts clean — `registerServices` throws if services are already registered.
 */
export async function createTestNextly(
  opts: CreateTestNextlyOptions = {}
): Promise<TestNextly> {
  // Before the reset below, which discards the promises: `shutdownServices`
  // disconnects the adapter and `resetEventBus` drops pending handlers, so an
  // instance the caller never destroyed would otherwise have its unawaited
  // work land on a closed pool — or keep a session open that makes its own
  // database undroppable.
  await drainPendingWork();
  // Defensive reset in case a prior test left services registered.
  await shutdownServices();
  resetHookRegistry();
  resetEventBus();
  clearPluginSubscriptions();
  clearPluginServices();
  resetEmailProviderRegistry();
  clearFieldTypes();
  resetFilterRegistry();
  resetWebhookRecordingPolicy();
  resetWebhookActivation();
  resetPluginRouteRegistry();
  resetNextlyInstance();
  // Each boot is a fresh, distinct in-memory database. The schema-snapshot
  // cache is a globalThis singleton scoped to a single live DB; if left
  // warm from a prior boot it makes the runtime auto-sync skip the push
  // ("schema unchanged"), so the new DB never gets its tables. Clear it so
  // every boot pushes its full desired schema (replaces the old
  // ensureCollectionTables workaround).
  clearCachedSnapshot();
  clearLiveSnapshots();
  // After `shutdownServices` above has disconnected the previous adapter, so a
  // database this drops has nothing attached to it. Covers the instance that
  // was never destroyed: its closure is unreachable, but its database is not.
  // Any environment snapshot it never restored comes back here to be adopted
  // below, so the process can still be returned to where it started.
  const inheritedRestore = await releaseActiveDatabase();

  let adapter = opts.adapter;
  // Created for a non-SQLite boot and dropped by destroy(). Undefined when the
  // caller supplied their own adapter or the boot is on in-memory SQLite.
  let provisioned: ProvisionedDatabase | undefined;
  // Set when this boot changes the environment without provisioning anything,
  // so `destroy()` can put it back the way the provisioned path does. Starts
  // as whatever an abandoned instance left pending: adopting it is what makes
  // this instance's teardown restore the environment that predates it, and it
  // is the right target even for a boot that changes nothing itself.
  //
  // Adopted BEFORE anything can fail. Acquiring the database is the first
  // step that throws — an unset server URL, an unreachable server — and until
  // this instance owns the pending snapshot there is nothing to put the
  // environment back with.
  let restoreEnv: (() => void) | undefined = inheritedRestore;
  if (!adapter && opts.dialect && opts.dialect !== "sqlite") {
    try {
      provisioned = await provisionDatabase(
        opts.dialect,
        resolveServerUrl(opts.dialect, opts.serverUrl)
      );
    } catch (error) {
      // `provisionDatabase` restores its own snapshot; this is the abandoned
      // instance's, which nothing else will reach once this boot gives up.
      restoreEnv?.();
      throw error;
    }
    adapter = provisioned.adapter;
  }
  if (!adapter) {
    // The inherited snapshot points further back than one taken now would, so
    // it wins when there is one.
    restoreEnv = inheritedRestore ?? snapshotEnv();
    // Force the SQLite dialect so the env validation the factory triggers
    // (env.DATABASE_URL access) passes without a configured database — SQLite
    // needs no DATABASE_URL, and production-only checks are skipped under test.
    process.env.DB_DIALECT = "sqlite";
    // Same reason as the provisioned path: a previous boot on another dialect
    // would otherwise still be the one this process's `env` reports.
    _resetEnvCache();
    // `memory: true` forces an in-memory DB. The factory otherwise falls back
    // to a default SQLite *file*, which would persist across test runs. The
    // SqliteAdapter honours `memory` ahead of any url, but the factory's
    // AdapterConfig type doesn't declare it — hence the cast.
    adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
  }
  const logger = opts.logger ?? defaultTestLogger;
  adapter = guardAgainstAbortedTransactions(adapter);
  active = { provisioned, restoreEnv };

  try {
    return await bootServices(adapter, logger, opts, provisioned, restoreEnv);
  } catch (error) {
    // Two different failures reach here, and each needs a different half.
    //
    // If registration SUCCEEDED and a later step failed, the plugins are live
    // and their `destroy()` callbacks have to run — only `shutdownServices`
    // does that, and it no-ops harmlessly when registration never completed.
    await shutdownServices().catch(() => {});
    // If registration did NOT complete, the flag was never set, so nothing
    // above cleared the container. It has to be cleared explicitly:
    // `registerSingleton` installs a factory that keeps any instance already
    // built, so a half-registered adapter would survive re-registration and
    // the next boot would be handed this disconnected one — pointing at a
    // database that no longer exists.
    clearServices();
    // Disconnected before the database is dropped, and regardless of who
    // supplied it: a successful boot's `destroy()` closes the adapter through
    // `shutdownServices` either way, so doing anything else here would make
    // teardown depend on whether the boot got far enough to succeed.
    await adapter.disconnect().catch(() => {});
    // A boot that fails after the database was created would otherwise leave
    // it on the server, along with whatever this instance changed about the
    // environment — on either the provisioned or the SQLite path. Unlike the
    // recovery path above, nothing is about to set an environment here.
    await releaseActiveDatabase();
    restoreEnv?.();
    throw error;
  }
}

/**
 * The boot itself, split out so a failure anywhere in it can release the
 * database its caller created.
 */
async function bootServices(
  adapter: TestAdapter,
  logger: Logger,
  opts: CreateTestNextlyOptions,
  provisioned: ProvisionedDatabase | undefined,
  restoreEnv: (() => void) | undefined
): Promise<TestNextly> {
  await registerServices({
    adapter,
    imageProcessor: getImageProcessor(),
    logger,
    // Wire the (freshly reset) global hook registry into the collection
    // services so the entry/query/mutation/bulk paths run hooks — without it
    // those services get `hookRegistry: undefined` and any read/bulk-write
    // through `ctx.services.collections` throws "executeBeforeOperation is not
    // a function". Mirrors production boot (registerServices always gets one).
    hookRegistry: getHookRegistry(),
    plugins: opts.plugins,
    collections: opts.collections,
    singles: opts.singles,
    fieldGroups: opts.fieldGroups,
    localization: opts.localization
      ? normalizeLocalization(opts.localization)
      : undefined,
    // Record every event by default so machinery tests are independent of
    // webhook endpoint setup; suites that exercise the endpoint gate turn this
    // off. Passed through the config (not set after) so it is published before
    // plugin init() runs, and boot-time plugin events are recorded too.
    webhookAuditEnabled: true,
  });

  // Physical tables for code-first + plugin-contributed collections are created
  // non-interactively by the runtime auto-sync during registerServices (the
  // applyDesiredSchema add_table fast-path), so no harness-side DDL is needed.

  // Persist any stored access rules onto the already-synced collection rows. The
  // access path reads `accessRules` off the collection metadata (getCollection),
  // which is uncached, so writing the row after boot is enough for it to surface
  // — no separate cache invalidation is needed.
  if (opts.collectionAccessRules) {
    for (const [slug, accessRules] of Object.entries(
      opts.collectionAccessRules
    )) {
      const where: WhereClause = {
        and: [{ column: "slug", op: "=", value: slug }],
      };
      await adapter.update("dynamic_collections", { accessRules }, where);
    }
  }

  // Same for Singles: the single access path reads `accessRules` off the
  // (uncached) single metadata, so writing the row after boot surfaces it.
  if (opts.singleAccessRules) {
    for (const [slug, accessRules] of Object.entries(opts.singleAccessRules)) {
      const where: WhereClause = {
        and: [{ column: "slug", op: "=", value: slug }],
      };
      await adapter.update("dynamic_singles", { accessRules }, where);
    }
  }

  return {
    nextly: getNextly(),
    getService,
    hooks: getHookRegistry(),
    events: getEventBus(),
    adapter,
    async destroy() {
      // Everything the instance started but did not await has to finish while
      // the connection is still open.
      await drainPendingWork();
      // shutdownServices runs plugin destroy() once T9 wires it, then
      // disconnects the adapter and clears the container.
      await shutdownServices();
      resetHookRegistry();
      resetEventBus();
      clearPluginSubscriptions();
      clearPluginServices();
      resetEmailProviderRegistry();
      clearFieldTypes();
      resetFilterRegistry();
      resetWebhookRecordingPolicy();
      resetPluginRouteRegistry();
      resetNextlyInstance();
      clearCachedSnapshot();
      clearLiveSnapshots();
      // Last, and only after the adapter is closed: PostgreSQL will not drop a
      // database that still has a session attached. `shutdownServices`
      // normally does the disconnecting, but it swallows a rejection from it
      // and then no-ops on every later call, so a repeat would have no way to
      // clear a session left behind — this is idempotent and does. The SQLite
      // path provisions nothing but still changed the environment, so that is
      // put back here too.
      if (!opts.adapter) await adapter.disconnect().catch(() => {});
      await provisioned?.release();
      restoreEnv?.();
      active = {};
    },
  };
}

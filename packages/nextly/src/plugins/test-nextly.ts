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
import type { ComponentConfig } from "../components/config/types";
import { createAdapter } from "../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
  type ProvisionableDialect,
} from "../database/test-database-ddl";
import { getService, registerServices, shutdownServices } from "../di/register";
import { getNextly, resetNextlyInstance } from "../direct-api/nextly";
import type { Nextly } from "../direct-api/nextly";
import { resetEmailProviderRegistry } from "../domains/email/services/email-provider-registry";
import { normalizeLocalization } from "../domains/i18n/config/normalize";
import type { LocalizationConfig } from "../domains/i18n/config/types";
import { clearFieldTypes } from "../domains/schema/field-types/field-type-registry";
import { resetWebhookActivation } from "../domains/webhooks/recording-activation";
import { resetWebhookRecordingPolicy } from "../domains/webhooks/recording-policy";
import { NextlyError } from "../errors/nextly-error";
import type { EventBus } from "../events/event-bus";
import { getEventBus, resetEventBus } from "../events/event-bus";
import { resetFilterRegistry } from "../filters";
import { getHookRegistry, resetHookRegistry } from "../hooks/hook-registry";
import type { HookRegistry } from "../hooks/hook-registry";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../init/schema-snapshot-cache";
import type { CollectionAccessRules } from "../services/access";
import type { Logger } from "../services/shared";
import type { SingleConfig } from "../singles/config/types";
import { getImageProcessor } from "../storage/image-processor";

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
 * Which dialects this process can actually boot on.
 *
 * SQLite is always available — it runs in memory with no server. The others
 * are available only when their server URL is configured, so a suite can cover
 * every dialect a developer has running without failing on the ones they do
 * not.
 */
export function getAvailableTestDialects(): TestDialect[] {
  const available: TestDialect[] = ["sqlite"];
  for (const dialect of ["postgresql", "mysql"] as const) {
    if (process.env[DIALECT_SERVER_URL_ENV[dialect]]) available.push(dialect);
  }
  return available;
}

export interface CreateTestNextlyOptions {
  /**
   * Boot against a real database server instead of in-memory SQLite.
   *
   * A dedicated database is created for this instance and dropped by
   * `destroy()`, because the shared test database is written to by every other
   * suite in the run and cannot answer a question about schema state. Requires
   * the dialect's server URL (`TEST_POSTGRES_URL` / `TEST_MYSQL_URL`) unless
   * `serverUrl` is given; check `getAvailableTestDialects()` to skip cleanly
   * when it is not configured.
   *
   * Ignored when `adapter` is supplied — an explicit adapter means the caller
   * owns the connection and its lifetime.
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
  /** Code-first components. */
  components?: ComponentConfig[];
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

  const previousUrl = process.env.DATABASE_URL;
  const previousDialect = process.env.DB_DIALECT;
  // A variable that was absent has to be removed rather than assigned back:
  // `process.env.X = undefined` stores the string "undefined", and the test
  // files that follow in this process would read it as configured.
  const restoreEnv = (): void => {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
  };

  let server: TestAdapter | undefined;
  let databaseExists = false;
  try {
    process.env.DATABASE_URL = serverUrl;
    process.env.DB_DIALECT = dialect;
    server = await createAdapter({ type: dialect, url: serverUrl });
    const serverAdapter = server;

    await serverAdapter.executeQuery(createDatabaseStatement(dialect, name));
    databaseExists = true;

    process.env.DATABASE_URL = databaseUrl.toString();
    const adapter = await createAdapter({
      type: dialect,
      url: databaseUrl.toString(),
    });

    return {
      adapter,
      async release() {
        // Nested so each step still runs when an earlier one throws. A failed
        // drop must not strand the environment pointing at a database this
        // instance owns, and a failed disconnect must not either — the files
        // that follow share this process.
        try {
          await serverAdapter.executeQuery(
            dropDatabaseStatement(dialect, name)
          );
        } finally {
          try {
            await serverAdapter.disconnect();
          } finally {
            restoreEnv();
          }
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
    throw NextlyError.internal({
      logContext: {
        reason:
          `createTestNextly({ dialect: "${dialect}" }) needs a server to ` +
          `connect to. Set ${envName}, or pass serverUrl. Use ` +
          `getAvailableTestDialects() to skip when it is not configured.`,
      },
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

  let adapter = opts.adapter;
  // Created for a non-SQLite boot and dropped by destroy(). Undefined when the
  // caller supplied their own adapter or the boot is on in-memory SQLite.
  let provisioned: ProvisionedDatabase | undefined;
  if (!adapter && opts.dialect && opts.dialect !== "sqlite") {
    provisioned = await provisionDatabase(
      opts.dialect,
      resolveServerUrl(opts.dialect, opts.serverUrl)
    );
    adapter = provisioned.adapter;
  }
  if (!adapter) {
    // Force the SQLite dialect so the env validation the factory triggers
    // (env.DATABASE_URL access) passes without a configured database — SQLite
    // needs no DATABASE_URL, and production-only checks are skipped under test.
    process.env.DB_DIALECT = "sqlite";
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

  try {
    return await bootServices(adapter, logger, opts, provisioned);
  } catch (error) {
    // `registerServices` marks itself registered only on a successful boot, so
    // a later `shutdownServices()` will not close this pool — it has to be
    // disconnected here, and before the database is dropped. Only when this
    // function created it: an adapter the caller supplied is theirs to close.
    if (!opts.adapter) await adapter.disconnect().catch(() => {});
    // A boot that fails after the database was created would otherwise leave
    // it on the server, along with the environment this instance set.
    await provisioned?.release().catch(() => {});
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
  provisioned: ProvisionedDatabase | undefined
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
    components: opts.components,
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
      // Last, and only after shutdownServices has disconnected: PostgreSQL
      // will not drop a database that still has a session attached.
      await provisioned?.release();
    },
  };
}

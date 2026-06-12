/**
 * `createTestNextly` — in-memory integration harness (D46).
 *
 * Boots a REAL Nextly instance on in-memory SQLite (not mocks), running the
 * full plugin lifecycle (resolve → setup → schema sync → init), so plugin
 * authors and the framework can integration-test hooks, events, and lifecycle
 * without a live database. Lives in core and is re-exported from
 * `@nextlyhq/plugin-sdk/testing` (D43).
 *
 * @module plugins/test-nextly
 */

import type { CollectionConfig } from "../collections/config/define-collection";
import type { ComponentConfig } from "../components/config/types";
import { createAdapter } from "../database/factory";
import { getService, registerServices, shutdownServices } from "../di/register";
import { getNextly, resetNextlyInstance } from "../direct-api/nextly";
import type { Nextly } from "../direct-api/nextly";
import type { EventBus } from "../events/event-bus";
import { getEventBus, resetEventBus } from "../events/event-bus";
import { resetFilterRegistry } from "../filters";
import { getHookRegistry, resetHookRegistry } from "../hooks/hook-registry";
import type { HookRegistry } from "../hooks/hook-registry";
import type { FieldDefinition } from "../schemas/dynamic-collections";
import type { Logger } from "../services/shared";
import type { SingleConfig } from "../singles/config/types";
import { getImageProcessor } from "../storage/image-processor";

import type { PluginDefinition } from "./plugin-context";

type TestAdapter = Awaited<ReturnType<typeof createAdapter>>;

export interface CreateTestNextlyOptions {
  /** Plugins to boot (their full lifecycle runs). */
  plugins?: PluginDefinition[];
  /** Code-first collections to register (tables created on the in-memory DB). */
  collections?: CollectionConfig[];
  /** Code-first singles. */
  singles?: SingleConfig[];
  /** Code-first components. */
  components?: ComponentConfig[];
  /** Override the adapter (defaults to a fresh in-memory SQLite adapter). */
  adapter?: TestAdapter;
  /** Override the logger (defaults to a near-silent test logger). */
  logger?: Logger;
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

// Near-silent logger so the boot doesn't flood test output, but real failures
// still surface via error().
const defaultTestLogger: Logger = {
  debug() {},
  info() {},
  // The runtime auto-sync warns when it can't create code-first tables on
  // SQLite (drizzle-kit's interactive rename prompt — a P2 pipeline gap);
  // `ensureCollectionTables` below compensates, so that warn is benign noise.
  warn() {},
  error(message, meta) {
    console.error(message, meta ?? "");
  },
};

/** Split generated migration SQL into individually-executable statements. */
function splitSqlStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map(chunk =>
      chunk
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(statement => statement.length > 0);
}

/**
 * Create physical tables for code-first collections directly, non-
 * interactively. The runtime auto-sync (registerServices) can't create them on
 * SQLite without hitting drizzle-kit's interactive rename prompt, so we mirror
 * the established `generateMigrationSQL` + `executeQuery` path that the single
 * and component dispatchers use. The runtime schema descriptors are already
 * registered in the resolver during boot, so once the physical table exists
 * CRUD works.
 */
async function ensureCollectionTables(
  adapter: TestAdapter,
  collections: CollectionConfig[] | undefined
): Promise<void> {
  if (!collections || collections.length === 0) return;

  const { DynamicCollectionSchemaService } = await import(
    "../domains/dynamic-collections/services/dynamic-collection-schema-service"
  );
  const dialect = adapter.getCapabilities().dialect;
  const schemaService = new DynamicCollectionSchemaService(undefined, dialect);

  for (const collection of collections) {
    const base = collection.dbName ?? collection.slug.replace(/-/g, "_");
    const tableName = base.startsWith("dc_") ? base : `dc_${base}`;
    if (await adapter.tableExists(tableName)) continue;

    const sql = schemaService.generateMigrationSQL(
      tableName,
      (collection.fields ?? []) as unknown as FieldDefinition[],
      { hasStatus: (collection as { status?: boolean }).status === true }
    );
    for (const statement of splitSqlStatements(sql)) {
      await adapter.executeQuery(statement);
    }
  }
}

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
  resetFilterRegistry();
  resetNextlyInstance();

  let adapter = opts.adapter;
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

  await registerServices({
    adapter,
    imageProcessor: getImageProcessor(),
    logger,
    plugins: opts.plugins,
    collections: opts.collections,
    singles: opts.singles,
    components: opts.components,
  });

  // Create code-first collection tables non-interactively (the SQLite runtime
  // auto-sync can't — see ensureCollectionTables).
  await ensureCollectionTables(adapter, opts.collections);

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
      resetFilterRegistry();
      resetNextlyInstance();
    },
  };
}

/**
 * `createTestNextly` — in-memory integration harness.
 *
 * Boots a REAL Nextly instance on in-memory SQLite (not mocks), running the
 * full plugin lifecycle (resolve → setup → schema sync → init), so plugin
 * authors and the framework can integration-test hooks, events, and lifecycle
 * without a live database. Lives in core and is re-exported from
 * `@nextlyhq/plugin-sdk/testing`.
 *
 * @module plugins/test-nextly
 */

import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

import type { CollectionConfig } from "../collections/config/define-collection";
import type { ComponentConfig } from "../components/config/types";
import { createAdapter } from "../database/factory";
import { getService, registerServices, shutdownServices } from "../di/register";
import { getNextly, resetNextlyInstance } from "../direct-api/nextly";
import type { Nextly } from "../direct-api/nextly";
import { resetEmailProviderRegistry } from "../domains/email/services/email-provider-registry";
import { normalizeLocalization } from "../domains/i18n/config/normalize";
import type { LocalizationConfig } from "../domains/i18n/config/types";
import { clearFieldTypes } from "../domains/schema/field-types/field-type-registry";
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

export interface CreateTestNextlyOptions {
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
      resetPluginRouteRegistry();
      resetNextlyInstance();
      clearCachedSnapshot();
      clearLiveSnapshots();
    },
  };
}

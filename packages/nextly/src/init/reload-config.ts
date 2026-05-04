// What: re-reads nextly.config.ts and applies code-first schema deltas in
// the same process. Called from getNextly() when the HMR listener has
// flipped the reload flag.
//
// Why a helper: keeps init.ts clean. The actual config-loading + DDL apply
// flows through the F2 applyDesiredSchema pipeline.
//
// Safety stance (F4 Option E PR 4):
//   - Pure additive deltas (add table/column, default change) auto-apply.
//   - Drop+add pairs that the rename detector picks up as candidates flow
//     through to the pipeline so the clack PromptDispatcher can confirm
//     them in the terminal.
//   - Standalone drops (a removed field with no rename target), table
//     drops, and lossy type / NOT NULL changes are still skipped with a
//     warning. Until F5 ships a real Classifier, code-first has no
//     terminal UI for those, and silent auto-apply would lose data.
//   - Tables where drops > adds also get skipped: the dispatcher can only
//     match `min(drops, adds)` pairs, so the surplus drops would silently
//     become data loss even after the user confirms renames.
//   - Non-TTY runtimes (CI, IDE task runners) still hit the rename
//     prompt, but ClackTerminalPromptDispatcher throws TTYRequiredError
//     which the pipeline maps to CONFIRMATION_REQUIRED_NO_TTY. We log
//     that and keep the dev server alive.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { createApplyDesiredSchema } from "../domains/schema/pipeline/apply";
import { RealClassifier } from "../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../domains/schema/pipeline/database-url";
import { buildDesiredTableFromFields } from "../domains/schema/pipeline/diff/build-from-fields";
import { diffSnapshots } from "../domains/schema/pipeline/diff/diff";
import { introspectLiveSnapshot } from "../domains/schema/pipeline/diff/introspect-live";
import type {
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../domains/schema/pipeline/diff/types";
import { RealPreCleanupExecutor } from "../domains/schema/pipeline/pre-cleanup/executor";
import { ClackTerminalPromptDispatcher } from "../domains/schema/pipeline/prompt-dispatcher/clack-terminal";
import type {
  MigrationJournal,
  PromptDispatcher,
} from "../domains/schema/pipeline/pushschema-pipeline-interfaces";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../domains/schema/pipeline/pushschema-pipeline-stubs";
import { PushSchemaPipeline } from "../domains/schema/pipeline/pushschema-pipeline";
import { RegexRenameDetector } from "../domains/schema/pipeline/rename-detector";
import type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "../domains/schema/pipeline/types";
import { generateRuntimeSchema } from "../domains/schema/services/runtime-schema-generator";
import { DrizzleStatementExecutor } from "../domains/schema/services/drizzle-statement-executor";
import { resolveCollectionTableName } from "../domains/schema/utils/resolve-table-name";
import { getProductionNotifier } from "../runtime/notifications/index";

// Service-resolver shape. Defaulted to the real getService at runtime;
// tests inject a lighter-weight resolver to avoid pulling DI internals.
// Return value is `unknown` because ESLint's no-redundant-type-constituents
// rule rejects `unknown | Promise<unknown>`; `unknown` already includes
// Promises and the call site awaits the result so both shapes work.
type ServiceResolver = (name: string) => unknown;

type LoggerLike = {
  warn: (msg: string) => void;
  info: (msg: string) => void;
  error: (msg: string) => void;
};

// Minimal duck-typed shape for the database adapter — only the readonly
// `dialect` property and `getDrizzle()` method we invoke. Matches the
// public surface of DrizzleAdapter; full type imported from
// adapter-drizzle would couple this module to the adapter package.
interface AdapterLike {
  readonly dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle(): unknown;
}

type CollectionDef = {
  slug?: string;
  tableName?: string;
  fields?: unknown[];
  labels?: { singular?: string; plural?: string };
  description?: string;
  timestamps?: boolean;
  admin?: unknown;
  dbName?: string;
};

type SingleDef = {
  slug?: string;
  fields?: unknown[];
  label?: { singular?: string } | string;
  description?: string;
  admin?: unknown;
  dbName?: string;
};

type ComponentDef = {
  slug?: string;
  fields?: unknown[];
  label?: { singular?: string } | string;
  description?: string;
  admin?: unknown;
};

// Minimal duck-typed surfaces of registry services used here.
interface CollectionRegistrySurface {
  syncCodeFirstCollections(configs: unknown[]): Promise<unknown>;
}
interface SingleRegistrySurface {
  syncCodeFirstSingles(configs: unknown[]): Promise<unknown>;
  updateMigrationStatus(slug: string, status: string): Promise<unknown>;
}
interface ComponentRegistrySurface {
  syncCodeFirstComponents(configs: unknown[]): Promise<unknown>;
}
interface SchemaRegistrySurface {
  registerDynamicSchema(tableName: string, table: unknown): void;
}
interface CollectionsHandlerSurface {
  refreshCollectionSchema(tableName: string, freshTable: unknown): void;
}

// Minimal field shape passed to buildDesiredTableFromFields. Mirrors the
// MinimalFieldDef in build-from-fields.ts (kept duck-typed here to avoid
// importing private types).
interface MinimalField {
  name: string;
  type: string;
  required?: boolean;
}

// Default resolver: lazy-imports DI to avoid a circular import with init.ts.
async function defaultResolver(name: string): Promise<unknown> {
  const { getService } = await import("../di/register");
  // The DI key types are a fixed map; we cast through the resolver edge.
  return getService(name as Parameters<typeof getService>[0]);
}

// Reload entry point. resolver is optional and exists primarily for tests.
// dispatcher is also test-only: injects a fake PromptDispatcher (e.g., one
// that records prompts and auto-confirms) so tests don't need a real TTY.
export async function reloadNextlyConfig(opts?: {
  resolver?: ServiceResolver;
  dispatcher?: PromptDispatcher;
}): Promise<void> {
  const resolverArg = opts?.resolver;
  const resolve = (name: string): unknown =>
    resolverArg ? resolverArg(name) : defaultResolver(name);

  // Re-read disk. The config-loader has its own in-memory cache; we
  // explicitly clear it so we definitely pick up the just-saved file
  // even on hosts with coarse mtime resolution.
  // The whole load is wrapped in try/catch because users routinely save
  // nextly.config.ts mid-edit with syntax errors during dev. Without this
  // guard, the loader rejection bubbles through getNextly() and turns
  // every subsequent request into a 500.
  let newConfig: { collections?: CollectionDef[]; singles?: SingleDef[]; components?: ComponentDef[] } | undefined;
  try {
    const { loadConfig, clearConfigCache } = await import(
      "../cli/utils/config-loader"
    );
    clearConfigCache();
    const result = await loadConfig();
    newConfig = (result as {
      config?: { collections?: CollectionDef[]; singles?: SingleDef[]; components?: ComponentDef[] };
    }).config;
  } catch (err) {
    // NextlyError wraps the underlying loader/bundler error in
    // `cause` (and surfaces a generic public message like "Failed to
    // load Nextly configuration."). Surface BOTH the public message
    // and the cause so an operator can actually diagnose the
    // problem instead of seeing the bare wrapper text.
    const msg = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error && typeof err.cause === "string"
          ? err.cause
          : undefined;
    const logContext =
      err && typeof err === "object" && "logContext" in err
        ? JSON.stringify((err as { logContext: unknown }).logContext)
        : undefined;
    const detail = cause
      ? `${msg} (cause: ${cause})`
      : logContext
        ? `${msg} (context: ${logContext})`
        : msg;

    console.warn(
      `[Nextly HMR] Could not reload nextly.config.ts: ${detail}. ` +
        `Keeping the previously-loaded config. Fix the syntax error and ` +
        `save again to retry.`
    );
    return;
  }
  if (!newConfig) return;

  // databaseAdapter doubles as our DI-readiness probe. We don't need any
  // other service from DI in this path — the new gate gets prior-state
  // straight from the live DB via introspectLiveSnapshot, not from the
  // collection registry as the F1 preview gate did.
  let logger: LoggerLike | undefined;
  let adapter: AdapterLike | undefined;
  // F8 PR 5: pull the journal from DI so HMR-driven applies get
  // recorded alongside admin-UI applies. Optional — if DI hasn't
  // registered it (e.g. very early HMR), we fall back to the noop
  // and the apply still proceeds.
  let migrationJournal: MigrationJournal | undefined;
  try {
    logger = (await resolve("logger")) as LoggerLike;
    // The adapter is registered under the key "adapter" in
    // packages/nextly/src/di/register.ts. A stale "databaseAdapter"
    // key here used to silently throw, which the catch below swallowed,
    // so reloadNextlyConfig returned without doing anything. End result:
    // code-first HMR + boot-time auto-apply silently never fired,
    // and renames/drops in `nextly.config.ts` never propagated to the
    // DB until the user manually ran `nextly db:sync`.
    adapter = (await resolve("adapter")) as AdapterLike;
    migrationJournal = (await resolve("migrationJournal")) as
      | MigrationJournal
      | undefined;
  } catch {
    // DI not initialised yet (init-time race). Nothing to do.
    return;
  }
  if (!adapter) return;

  // dialect is an abstract readonly property on DrizzleAdapter, not a
  // method (a previous iteration mistakenly called .getDialect() which
  // would crash at runtime).
  const dialect = adapter.dialect;
  const db = adapter.getDrizzle();

  // Normalize collections to (slug, tableName, fields, status) tuples. Drop
  // entries without a slug — they can't be addressed. `status` propagates so
  // the diff knows whether to expect/inject the status system column.
  const targets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
    status?: boolean;
  }> = [];
  for (const c of newConfig.collections ?? []) {
    if (!c.slug) continue;
    targets.push({
      slug: c.slug,
      tableName: c.tableName ?? resolveCollectionTableName(c.slug, c.dbName),
      fields: (c.fields ?? []) as MinimalField[],
      status: (c as { status?: boolean }).status === true,
    });
  }

  // Normalize singles. Table name follows single_<slug> convention.
  const singleTargets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
    status?: boolean;
  }> = [];
  for (const s of newConfig.singles ?? []) {
    if (!s.slug) continue;
    const { resolveSingleTableName } = await import(
      "../domains/singles/services/resolve-single-table-name"
    );
    singleTargets.push({
      slug: s.slug,
      tableName: resolveSingleTableName({ slug: s.slug, dbName: s.dbName }),
      fields: (s.fields ?? []) as MinimalField[],
      status: (s as { status?: boolean }).status === true,
    });
  }

  // Normalize components. Table name is always comp_<slug_with_underscores>.
  const componentTargets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
  }> = [];
  for (const c of newConfig.components ?? []) {
    if (!c.slug) continue;
    componentTargets.push({
      slug: c.slug,
      tableName: `comp_${c.slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")}`,
      fields: (c.fields ?? []) as MinimalField[],
    });
  }

  if (targets.length === 0 && singleTargets.length === 0 && componentTargets.length === 0) return;

  // ONE batched introspect for every managed table the config knows about
  // (collections + singles). If the call fails, abort the reload entirely —
  // it's a connection-level failure, not a per-table problem.
  let liveSnapshot: NextlySchemaSnapshot;
  try {
    liveSnapshot = await introspectLiveSnapshot(
      db,
      dialect,
      [
        ...targets.map(t => t.tableName),
        ...singleTargets.map(t => t.tableName),
        ...componentTargets.map(t => t.tableName),
      ]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(
      `[Nextly HMR] Could not introspect live schema: ${msg}. ` +
        `No code-first schema changes were applied this cycle.`
    );
    return;
  }
  const liveByTable = new Map<string, TableSpec>();
  for (const t of liveSnapshot.tables) liveByTable.set(t.name, t);

  // Per-collection diff + safety classification. Replaces the F1 preview
  // gate. Pure-additive collections + collections whose drop+add pairs
  // can be fully covered by rename candidates flow through to the
  // pipeline. Everything else gets logged + skipped.
  // Track whether any entity actually needs DDL. We still populate every
  // desired* map unconditionally so that drizzle-kit's pushSchema sees the
  // full set of managed tables. Without this, unchanged tables that already
  // exist in the live DB are absent from the desired schema we hand to
  // drizzle-kit, which treats them as "dropped" and offers to rename them
  // into the new (e.g. single_*) tables — the false-positive rename prompt
  // the user sees on a first-install where collections are synced before
  // singles.
  let hasChanges = false;

  const desiredCollections: Record<string, DesiredCollection> = {};
  for (const target of targets) {
    // Always register the entry so drizzle-kit's schema stays complete.
    const entry: DesiredCollection = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredCollection["fields"],
      status: target.status === true,
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect,
        { hasStatus: target.status === true }
      );
      const operations = diffSnapshots(live, { tables: [desiredTable] });

      if (operations.length === 0) {
        desiredCollections[target.slug] = entry;
        continue;
      }

      const classification = classifyForCodeFirst(operations, dialect);
      if (!classification.safe) {
        logger?.warn(
          `[Nextly HMR] Code-first change for '${target.slug}' needs review ` +
            `(${classification.reason}). Auto-apply skipped to prevent ` +
            `data loss without explicit resolutions. Use the admin Schema ` +
            `Builder to confirm with resolutions, or revert the config edit.`
        );
        desiredCollections[target.slug] = entry;
        continue;
      }

      hasChanges = true;
      desiredCollections[target.slug] = entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping '${target.slug}' due to error during diff: ${msg}`
      );
    }
  }

  // Per-single diff + safety classification — mirrors the collections loop.
  const desiredSingles: Record<string, DesiredSingle> = {};
  for (const target of singleTargets) {
    const entry: DesiredSingle = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredSingle["fields"],
      status: target.status === true,
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect,
        { hasStatus: target.status === true }
      );
      const operations = diffSnapshots(live, { tables: [desiredTable] });

      if (operations.length === 0) {
        desiredSingles[target.slug] = entry;
        continue;
      }

      const classification = classifyForCodeFirst(operations, dialect);
      if (!classification.safe) {
        logger?.warn(
          `[Nextly HMR] Code-first change for single '${target.slug}' needs review ` +
            `(${classification.reason}). Auto-apply skipped. Use the admin Schema ` +
            `Builder to confirm with resolutions, or revert the config edit.`
        );
        desiredSingles[target.slug] = entry;
        continue;
      }

      hasChanges = true;
      desiredSingles[target.slug] = entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping single '${target.slug}' due to error during diff: ${msg}`
      );
    }
  }

  // Per-component diff + safety classification — mirrors the singles loop.
  const desiredComponents: Record<string, DesiredComponent> = {};
  for (const target of componentTargets) {
    const entry: DesiredComponent = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredComponent["fields"],
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect
      );
      const operations = diffSnapshots(live, { tables: [desiredTable] });

      if (operations.length === 0) {
        desiredComponents[target.slug] = entry;
        continue;
      }

      const classification = classifyForCodeFirst(operations, dialect);
      if (!classification.safe) {
        logger?.warn(
          `[Nextly HMR] Code-first change for component '${target.slug}' needs review ` +
            `(${classification.reason}). Auto-apply skipped. Use the admin Schema ` +
            `Builder to confirm with resolutions, or revert the config edit.`
        );
        desiredComponents[target.slug] = entry;
        continue;
      }

      hasChanges = true;
      desiredComponents[target.slug] = entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping component '${target.slug}' due to error during diff: ${msg}`
      );
    }
  }

  // Nothing to apply across collections, singles, or components.
  if (!hasChanges) return;

  // One batch pipeline call with the full snapshot. The pipeline runs its
  // own introspect + diff inside (the gate's diff above is for safety
  // classification only), so it's self-contained.
  const databaseName =
    dialect === "mysql"
      ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
      : undefined;

  const desired: DesiredSchema = {
    collections: desiredCollections,
    singles: desiredSingles,
    components: desiredComponents,
  };

  // Per-call factory (not the DI-bound applyDesiredSchema in
  // pipeline/index.ts) so we can thread MySQL databaseName + the
  // resolved adapter into the F3 PushSchemaPipeline at this site.
  // F8 will collapse both seams into the unified pipeline.
  const promptDispatcher =
    opts?.dispatcher ?? new ClackTerminalPromptDispatcher();
  const apply = createApplyDesiredSchema({
    applyPipeline: (desiredArg, sourceArg, channelArg) => {
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        // F5 PR 5: real classifier emits add_not_null_with_nulls,
        // add_required_field_no_default, and type_change events from the
        // typed Operation[] stream. ClackTerminalPromptDispatcher renders
        // them in the terminal; RealPreCleanupExecutor runs UPDATE/DELETE.
        classifier: new RealClassifier(),
        promptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        // F8 PR 5: real journal from DI; falls back to noop if DI
        // hasn't registered it yet (very-early HMR cycles).
        migrationJournal: migrationJournal ?? noopMigrationJournal,
        // F10 PR 3: HMR applies print a terminal box + write the
        // NDJSON line. Same singleton across HMR cycles.
        notifier: getProductionNotifier(),
      });
      return pipeline.apply({
        desired: desiredArg,
        db,
        dialect,
        source: sourceArg,
        promptChannel: channelArg,
        databaseName,
      });
    },
    // Unused for source='code' — HMR skips the version check.
    readSchemaVersionForSlug: () => Promise.resolve(null),
    // Unused for HMR — we don't surface bumped versions in the log.
    readNewSchemaVersionsForSlugs: () => Promise.resolve({}),
  });

  const applyResult = await apply(desired, "code", {
    promptChannel: "terminal",
  });

  if (applyResult.success) {
    // Sync dynamic_collections metadata so the fields JSON reflects the
    // new config. The pipeline above only applies DDL to dc_<slug>; without
    // this call, admin-UI queries still read the old field list until the
    // server restarts and registerServices runs syncCodeFirstCollections.
    try {
      const registry = (await resolve(
        "collectionRegistryService"
      )) as CollectionRegistrySurface;
      const codeFirstConfigs = (newConfig.collections ?? [])
        .filter((c): c is CollectionDef & { slug: string } => !!c.slug)
        .map(c => ({
          slug: c.slug,
          labels: {
            singular: c.labels?.singular ?? c.slug,
            plural: c.labels?.plural ?? `${c.slug}s`,
          },
          fields: c.fields ?? [],
          description: c.description,
          tableName: c.dbName,
          timestamps: c.timestamps,
          admin: c.admin,
        }));
      await registry.syncCodeFirstCollections(codeFirstConfigs);
    } catch {
      // Non-fatal: DDL was applied; metadata sync failed. The next boot
      // or HMR cycle will retry via registerServices.
    }

    // Mirror the same metadata sync for singles — keeps dynamic_singles.fields
    // in step with the DDL changes the pipeline just applied.
    try {
      const singleReg = (await resolve(
        "singleRegistryService"
      )) as SingleRegistrySurface;
      const codeFirstSingleConfigs = (newConfig.singles ?? [])
        .filter((s): s is SingleDef & { slug: string } => !!s.slug)
        .map(s => {
          const labelStr =
            typeof s.label === "string"
              ? s.label
              : s.label?.singular ??
                s.slug
                  .split(/[-_]/)
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ");
          return {
            slug: s.slug,
            label: labelStr,
            fields: s.fields ?? [],
            description: s.description,
            tableName: s.dbName,
            admin: s.admin,
          };
        });
      if (codeFirstSingleConfigs.length > 0) {
        await singleReg.syncCodeFirstSingles(codeFirstSingleConfigs);

        // registerSingle defaults migration_status to 'pending'. The
        // pipeline above just created any missing physical tables, so
        // mark them 'applied'. We use the pre-pipeline liveByTable
        // snapshot: any single whose table was absent before the
        // pipeline ran is now on-disk — no extra DB query needed.
        for (const target of singleTargets) {
          if (!liveByTable.has(target.tableName)) {
            try {
              await singleReg.updateMigrationStatus(target.slug, "applied");
            } catch {
              // Non-fatal: migration status is metadata only.
            }
          }
        }
      }
    } catch {
      // Non-fatal: same reasoning as collection metadata sync above.
    }

    // Sync dynamic_components metadata — keeps dynamic_components.fields
    // in step with the DDL changes the pipeline just applied.
    try {
      const compReg = (await resolve(
        "componentRegistryService"
      )) as ComponentRegistrySurface;
      const codeFirstComponentConfigs = (newConfig.components ?? [])
        .filter((c): c is ComponentDef & { slug: string } => !!c.slug)
        .map(c => {
          const labelStr =
            typeof c.label === "string"
              ? c.label
              : c.label?.singular ??
                c.slug
                  .split(/[-_]/)
                  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ");
          return {
            slug: c.slug,
            label: labelStr,
            fields: c.fields ?? [],
            description: c.description,
            admin: c.admin,
          };
        });
      if (codeFirstComponentConfigs.length > 0) {
        await compReg.syncCodeFirstComponents(codeFirstComponentConfigs);
      }
    } catch {
      // Non-fatal: same reasoning as collection/single metadata sync above.
    }

    // Pre-compute fresh Drizzle table objects for all affected collections,
    // singles, and components. Synchronous (schema generation, no DB I/O).
    // Shared between the cache-refresh blocks below so we don't generate twice.
    const collectionFreshTables = new Map<string, unknown>();
    const singleFreshTables = new Map<string, unknown>();
    const componentFreshTables = new Map<string, unknown>();
    try {
      for (const c of Object.values(desiredCollections)) {
        const { table } = generateRuntimeSchema(
          c.tableName,
          c.fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: c.status === true }
        );
        collectionFreshTables.set(c.tableName, table);
      }
      for (const s of Object.values(desiredSingles)) {
        const { table } = generateRuntimeSchema(
          s.tableName,
          s.fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: s.status === true }
        );
        singleFreshTables.set(s.tableName, table);
      }
      for (const comp of Object.values(desiredComponents)) {
        const { table } = generateRuntimeSchema(
          comp.tableName,
          comp.fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect
        );
        componentFreshTables.set(comp.tableName, table);
      }
    } catch {
      // Non-fatal: all refresh blocks below will no-op on empty maps.
    }

    // Refresh SchemaRegistry.dynamicSchemas — used by the adapter's CRUD
    // path (INSERT / UPDATE / DELETE) for dc_*, single_*, and comp_* tables.
    try {
      const schemaReg = (await resolve("schemaRegistry")) as SchemaRegistrySurface;
      for (const [tableName, table] of collectionFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
      for (const [tableName, table] of singleFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
      for (const [tableName, table] of componentFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
    } catch {
      // Non-fatal: next request will still fail with stale schema, but
      // a server restart will recover. Log is intentionally omitted here
      // to avoid noise — the DDL itself succeeded.
    }

    // Refresh CollectionFileManager.schemaRegistry — used by the SELECT /
    // GET query path for collections (loadDynamicSchema). Singles GET goes
    // through the adapter (SchemaRegistry above), so only dc_* tables need
    // this second refresh.
    try {
      const collHandler = (await resolve(
        "collectionsHandler"
      )) as CollectionsHandlerSurface;
      for (const [tableName, table] of collectionFreshTables) {
        collHandler.refreshCollectionSchema(tableName, table);
      }
    } catch {
      // Non-fatal: same reasoning as SchemaRegistry block above.
    }

    // Signal all connected browser tabs to reload so they immediately
    // reflect the updated schema without a manual F5.
    try {
      const { broadcastDevReload } = await import(
        "../runtime/dev-reload-broadcaster"
      );
      broadcastDevReload();
    } catch {
      // Non-fatal.
    }
  }

  if (!applyResult.success) {
    const code = applyResult.error.code;

    if (code === "CONFIRMATION_REQUIRED_NO_TTY") {
      // Boot-time + HMR runs in a request-handler context where the
      // dev server's TTY is not directly attached to the prompt
      // dispatcher's stdin. Renames + drops can't be confirmed
      // safely from here. The pure-additive pipeline already
      // applied any safe changes; only structural changes are
      // pending. Surface a top-level, scannable instruction so the
      // user knows exactly what to do, rather than burying it in
      // a "FAILED" line that reads like a bug.
      const detail = applyResult.error.message
        .replace(/^TTY required for schema confirmation\.\s*/i, "")
        .replace(
          /\s*Run from an interactive terminal,.*$/i,
          ""
        )
        .trim();
      console.warn(
        `\n[Nextly] Schema change needs your confirmation:\n` +
          `  ${detail}\n\n` +
          `Renames + drops auto-apply only when you confirm them.\n` +
          `To apply, run one of:\n` +
          `  • pnpm nextly db:sync         (prompts in this terminal)\n` +
          `  • pnpm nextly migrate:create  (generates a committable migration)\n` +
          `  • Use the admin UI Schema Builder at /admin\n\n` +
          `Pure-additive changes (new fields, new collections) apply\n` +
          `automatically on dev start; only structural changes need\n` +
          `explicit confirmation.\n`
      );
    } else {
      logger?.error(
        `[Nextly HMR] Batch apply failed (${code}): ${applyResult.error.message}`
      );
    }
  }
}

// Decides whether a collection's ops are safe to auto-apply in code-first.
// The gate borrows the pipeline's own RegexRenameDetector dialect rules
// implicitly through the diff so it sees the same drop+add candidates
// the pipeline + clack dispatcher will.
//
//   - Pure additive (add_*, change_column_default) -> safe.
//   - drop_column in a table where the same-table drop count <= add count
//     -> safe (the dispatcher can pair every drop to at least one
//     potential rename target; the user confirms or declines per drop).
//   - drop_column in a table where drops > adds -> unsafe. The dispatcher
//     can only ever confirm `min(drops, adds)` renames, so the surplus
//     drops fall through as drop_and_add (silent data loss). Standalone
//     drops with zero same-table adds are the same case (drops > 0,
//     adds = 0).
//   - drop_table, change_column_type, NOT NULL adds -> unsafe (lossy
//     and no Classifier-driven prompt yet; F5 will refine).
function classifyForCodeFirst(
  operations: Operation[],
  _dialect: SupportedDialect
): { safe: true } | { safe: false; reason: string } {
  if (operations.length === 0) return { safe: true };

  // Per-table drop / add counts. The asymmetry test below is the
  // load-bearing rename safety check: if every drop has at least one
  // potential rename target in the same table (drops <= adds) the
  // dispatcher can ask the user; otherwise some drops would silently
  // become data loss even after the user confirms.
  const dropsPerTable = new Map<string, number>();
  const addsPerTable = new Map<string, number>();
  for (const op of operations) {
    if (op.type === "drop_column") {
      dropsPerTable.set(
        op.tableName,
        (dropsPerTable.get(op.tableName) ?? 0) + 1
      );
    } else if (op.type === "add_column") {
      addsPerTable.set(op.tableName, (addsPerTable.get(op.tableName) ?? 0) + 1);
    }
  }

  const reasons: string[] = [];
  for (const [t, drops] of dropsPerTable) {
    const adds = addsPerTable.get(t) ?? 0;
    if (drops > adds) {
      const surplus = drops - adds;
      reasons.push(
        adds === 0
          ? `drops ${drops} column(s) from '${t}' with no replacement(s); ${surplus} cannot be renamed without data loss`
          : `drops ${drops} columns from '${t}' but only ${adds} replacement(s); at least ${surplus} cannot be renamed without data loss`
      );
    }
  }
  for (const op of operations) {
    if (op.type === "drop_table") {
      reasons.push(`drops table '${op.tableName}'`);
    } else if (op.type === "change_column_type") {
      reasons.push(
        `changes column '${op.columnName}' type from '${op.fromType}' to '${op.toType}'`
      );
    } else if (op.type === "change_column_nullable" && !op.toNullable) {
      reasons.push(
        `adds NOT NULL to column '${op.columnName}' (would fail on existing rows without a default)`
      );
    }
  }

  if (reasons.length > 0) {
    return { safe: false, reason: reasons.join("; ") };
  }
  return { safe: true };
}

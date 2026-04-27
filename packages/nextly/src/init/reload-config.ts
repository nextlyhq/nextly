// What: re-reads nextly.config.ts and applies safe code-first schema deltas
// in the same process. Called from getNextly() when the HMR listener has
// flipped the reload flag.
//
// Why a helper: keeps init.ts clean. The actual config-loading + DDL apply
// flows through the F2 applyDesiredSchema pipeline (which currently shims
// over SchemaChangeService.apply). reloadNextlyConfig just orchestrates them.
//
// Safety stance: code-first auto-apply runs only for SAFE deltas (additive
// changes, type-compatible widenings). Destructive deltas (drops, narrowing
// type changes, NOT NULL additions on non-empty columns) are logged and
// skipped because they need user-supplied resolutions to avoid data loss.
// F8's PromptDispatcher will route those prompts to the terminal in a
// later task; until then, destructive code-first edits require either
// (a) reverting the config, (b) using the admin Schema Builder, or
// (c) waiting for F8.

import { createApplyDesiredSchema } from "../domains/schema/pipeline/apply.js";
import { extractDatabaseNameFromUrl } from "../domains/schema/pipeline/database-url.js";
import {
  noopClassifier,
  noopMigrationJournal,
  noopPreRenameExecutor,
  noopPromptDispatcher,
} from "../domains/schema/pipeline/pushschema-pipeline-stubs.js";
import { PushSchemaPipeline } from "../domains/schema/pipeline/pushschema-pipeline.js";
import { RegexRenameDetector } from "../domains/schema/pipeline/rename-detector.js";
import type {
  DesiredCollection,
  DesiredSchema,
} from "../domains/schema/pipeline/types.js";
import { DrizzleStatementExecutor } from "../domains/schema/services/drizzle-statement-executor.js";

// Service-resolver shape. Defaulted to the real getService at runtime;
// tests inject a lighter-weight resolver to avoid pulling DI internals.
// Return value is `unknown` because ESLint's no-redundant-type-constituents
// rule rejects `unknown | Promise<unknown>`; `unknown` already includes
// Promises and the call site awaits the result so both shapes work.
type ServiceResolver = (name: string) => unknown;

// Minimal contracts for the services we touch. The actual DI layer types
// are richer; we only need these methods so we constrain the resolver to
// what we actually use, which keeps the helper testable.
type SchemaPreviewLite = {
  hasChanges: boolean;
  hasDestructiveChanges: boolean;
  classification: string;
};

type SchemaApplyLite = {
  success: boolean;
  newSchemaVersion?: number;
  error?: string;
};

type SchemaChangeServiceLike = {
  preview: (
    tableName: string,
    currentFields: unknown[],
    newFields: unknown[]
  ) => Promise<SchemaPreviewLite>;
  apply: (
    slug: string,
    tableName: string,
    currentFields: unknown[],
    newFields: unknown[],
    currentSchemaVersion: number,
    registry: unknown,
    resolutions: unknown,
    options: { source: "code" | "ui" }
  ) => Promise<SchemaApplyLite>;
};

type RegistryLike = {
  getCollectionBySlug: (slug: string) => Promise<{
    slug: string;
    tableName?: string;
    fields?: unknown[];
    schemaVersion?: number;
  } | null>;
};

type LoggerLike = {
  warn: (msg: string) => void;
  info: (msg: string) => void;
  error: (msg: string) => void;
};

type CollectionDef = {
  slug?: string;
  tableName?: string;
  fields?: unknown[];
};

// Default resolver: lazy-imports DI to avoid a circular import with init.ts.
async function defaultResolver(name: string): Promise<unknown> {
  const { getService } = await import("../di/register.js");
  // The DI key types are a fixed map; we cast through the resolver edge.
  return getService(name as Parameters<typeof getService>[0]);
}

// Reload entry point. resolver is optional and exists primarily for tests.
export async function reloadNextlyConfig(opts?: {
  resolver?: ServiceResolver;
}): Promise<void> {
  const resolverArg = opts?.resolver;
  // Returns whatever the resolver gives us; the call sites `await` so a
  // Promise<service> or a sync service both resolve correctly.
  const resolve = (name: string): unknown =>
    resolverArg ? resolverArg(name) : defaultResolver(name);

  // Re-read disk. The config-loader has its own in-memory cache; we
  // explicitly clear it so we definitely pick up the just-saved file
  // even on hosts with coarse mtime resolution.
  // The whole load is wrapped in try/catch because users routinely save
  // nextly.config.ts mid-edit with syntax errors during dev. Without this
  // guard, the loader rejection bubbles through getNextly() and turns
  // every subsequent request into a 500. The wrapper used to log+continue
  // here; we preserve that behavior. Logger isn't yet resolved (services
  // may not exist), so we use console.warn directly.
  let newConfig: { collections?: CollectionDef[] } | undefined;
  try {
    const { loadConfig, clearConfigCache } = await import(
      "../cli/utils/config-loader.js"
    );
    clearConfigCache();
    const result = await loadConfig();
    newConfig = (result as { config?: { collections?: CollectionDef[] } })
      .config;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Nextly HMR] Could not reload nextly.config.ts: ${msg}. ` +
        `Keeping the previously-loaded config. Fix the syntax error and ` +
        `save again to retry.`
    );
    return;
  }
  if (!newConfig) return;

  let schemaChangeService: SchemaChangeServiceLike | undefined;
  let registry: RegistryLike | undefined;
  let logger: LoggerLike | undefined;

  try {
    schemaChangeService = (await resolve(
      "schemaChangeService"
    )) as SchemaChangeServiceLike;
    registry = (await resolve("collectionRegistryService")) as RegistryLike;
    logger = (await resolve("logger")) as LoggerLike;
  } catch {
    // DI not initialised yet (init-time race). Nothing to do.
    return;
  }

  if (!schemaChangeService || !registry) return;

  // Phase 1: per-collection preview to gate destructive changes.
  // F3 stubs do no rename detection — destructive deltas (DROP+ADD,
  // narrowing type changes, NOT NULL on non-empty columns without
  // defaults) would silently lose data if we let them through. The
  // preview step is the only protection HMR has until F4-F8 land
  // real RenameDetector + Classifier + PromptDispatcher.
  //
  // Safe collections accumulate into a single DesiredSchema snapshot
  // for one batch pipeline call (Phase 2 below). Destructive ones get
  // logged + skipped with the existing user-facing message.
  const desiredCollections: Record<string, DesiredCollection> = {};
  const collections = newConfig.collections ?? [];

  for (const collection of collections) {
    const slug = collection.slug;
    if (!slug) continue;
    const tableName = collection.tableName ?? `dc_${slug}`;
    const newFields = collection.fields ?? [];

    try {
      const current = await registry.getCollectionBySlug(slug);
      const currentFields = current?.fields ?? [];

      const preview = await schemaChangeService.preview(
        tableName,
        currentFields,
        newFields
      );

      if (!preview.hasChanges) continue;

      if (preview.hasDestructiveChanges) {
        logger?.warn(
          `[Nextly HMR] Code-first change for '${slug}' needs review ` +
            `(classification: ${preview.classification}). Auto-apply skipped ` +
            `to prevent data loss without explicit resolutions. Use the ` +
            `admin Schema Builder to confirm with resolutions, or revert ` +
            `the config edit.`
        );
        continue;
      }

      desiredCollections[slug] = {
        slug,
        tableName,
        fields: newFields as DesiredCollection["fields"],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping '${slug}' due to error during preview: ${msg}`
      );
    }
  }

  // Nothing safe to apply.
  if (Object.keys(desiredCollections).length === 0) return;

  // Phase 2: one batch pipeline call with the full safe-snapshot.
  // Resolves the database adapter so we can construct the F3 pipeline
  // with the right dialect + drizzle client. MySQL needs databaseName
  // extracted from DATABASE_URL; PG and SQLite ignore it.
  const safeCount = Object.keys(desiredCollections).length;
  let adapter: AdapterLike | undefined;
  try {
    adapter = (await resolve("databaseAdapter")) as AdapterLike;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(
      `[Nextly HMR] Could not resolve database adapter to apply ${safeCount} safe deltas: ${msg}`
    );
    return;
  }
  if (!adapter) {
    logger?.error(
      `[Nextly HMR] Database adapter unavailable; ${safeCount} safe deltas not applied`
    );
    return;
  }

  // dialect is an abstract readonly property on DrizzleAdapter, not a
  // method (a previous iteration mistakenly called .getDialect() which
  // would crash at runtime).
  const dialect = adapter.dialect;
  const db = adapter.getDrizzle();
  const databaseName =
    dialect === "mysql"
      ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
      : undefined;

  const desired: DesiredSchema = {
    collections: desiredCollections,
    singles: {},
    components: {},
  };

  // Per-call factory (not the DI-bound applyDesiredSchema in
  // pipeline/index.ts) so we can thread MySQL databaseName + the
  // resolved adapter into the F3 PushSchemaPipeline at this site.
  // F8 will collapse both seams into the unified pipeline.
  const apply = createApplyDesiredSchema({
    applyPipeline: (desiredArg, sourceArg, channelArg) => {
      const pipeline = new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: noopClassifier,
        promptDispatcher: noopPromptDispatcher,
        preRenameExecutor: noopPreRenameExecutor,
        migrationJournal: noopMigrationJournal,
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

  if (!applyResult.success) {
    logger?.error(
      `[Nextly HMR] Batch apply failed (${applyResult.error.code}): ${applyResult.error.message}`
    );
  }
}

// Minimal duck-typed shape for the database adapter — only the
// readonly `dialect` property and `getDrizzle()` method we invoke.
// Matches the public surface of DrizzleAdapter; full type imported
// from adapter-drizzle would couple this module to the adapter package.
interface AdapterLike {
  readonly dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle(): unknown;
}

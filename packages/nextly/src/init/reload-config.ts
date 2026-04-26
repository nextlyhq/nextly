// What: re-reads nextly.config.ts and applies safe code-first schema deltas
// in the same process. Called from getNextly() when the HMR listener has
// flipped the reload flag.
//
// Why a helper: keeps init.ts clean. The actual config-loading + DDL apply
// happens via existing services (config-loader, SchemaChangeService).
// reloadNextlyConfig just orchestrates them.
//
// Safety stance: code-first auto-apply runs only for SAFE deltas (additive
// changes, type-compatible widenings). Destructive deltas (drops, narrowing
// type changes, NOT NULL additions on non-empty columns) are logged and
// skipped because they need user-supplied resolutions to avoid data loss.
// F8's PromptDispatcher will route those prompts to the terminal in a
// later task; until then, destructive code-first edits require either
// (a) reverting the config, (b) using the admin Schema Builder, or
// (c) waiting for F8.

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
  const { loadConfig, clearConfigCache } = await import(
    "../cli/utils/config-loader.js"
  );
  clearConfigCache();
  const result = await loadConfig();
  const newConfig = (result as { config?: { collections?: CollectionDef[] } })
    .config;
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

  const collections = newConfig.collections ?? [];
  for (const collection of collections) {
    const slug = collection.slug;
    if (!slug) continue;
    const tableName = collection.tableName ?? `dc_${slug}`;
    const newFields = collection.fields ?? [];

    try {
      const current = await registry.getCollectionBySlug(slug);
      // New collection (no row yet): treat current as empty so apply runs
      // as a CREATE TABLE path. [] -> [...new] is fully additive.
      const currentFields = current?.fields ?? [];
      const currentSchemaVersion = current?.schemaVersion ?? 0;

      const preview = await schemaChangeService.preview(
        tableName,
        currentFields,
        newFields
      );

      if (!preview.hasChanges) continue;

      if (preview.hasDestructiveChanges) {
        // Loud log so the user understands why their config edit did not
        // take effect. Do not throw; other collections in the same reload
        // pass should still be processed.
        logger?.warn(
          `[Nextly HMR] Destructive code-first change detected for '${slug}' ` +
            `(classification: ${preview.classification}). Auto-apply skipped to ` +
            `prevent data loss. Use the admin Schema Builder to confirm with ` +
            `resolutions, or revert the config edit.`
        );
        continue;
      }

      // Safe delta: apply with no resolutions, source 'code'.
      const applyResult = await schemaChangeService.apply(
        slug,
        tableName,
        currentFields,
        newFields,
        currentSchemaVersion,
        registry,
        undefined,
        { source: "code" }
      );

      if (!applyResult.success) {
        logger?.error(
          `[Nextly HMR] Apply failed for '${slug}': ${applyResult.error ?? "unknown error"}`
        );
      }
    } catch (err) {
      // One collection failing must not block the rest. Log and continue.
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn(
        `[Nextly HMR] Skipping '${slug}' due to error during reload: ${msg}`
      );
    }
  }
}

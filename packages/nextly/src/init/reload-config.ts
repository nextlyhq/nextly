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
//     prompt, but ClackTerminalPromptDispatcher throws TTYRequiredError
//     which the pipeline maps to CONFIRMATION_REQUIRED_NO_TTY. We log
//     that and keep the dev server alive.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

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
import { PushSchemaPipeline } from "../domains/schema/pipeline/pushschema-pipeline";
import type {
  MigrationJournal,
  PromptDispatcher,
} from "../domains/schema/pipeline/pushschema-pipeline-interfaces";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../domains/schema/pipeline/pushschema-pipeline-stubs";
import { mergeRegisteredCollectionsSafely } from "../domains/schema/pipeline/registered-collections";
import { RegexRenameDetector } from "../domains/schema/pipeline/rename-detector";
import type {
  DesiredCollection,
  DesiredFieldGroup,
  DesiredSchema,
  DesiredSingle,
} from "../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../domains/schema/services/drizzle-statement-executor";
import { generateRuntimeSchema } from "../domains/schema/services/runtime-schema-generator";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../domains/schema/utils/resolve-table-name";
// Resolve the versioning config on the HMR sync path so a `versions` change
// while `next dev` is running persists without a restart (parity with di/register).
import { resolveVersionsConfig } from "../domains/versions/resolve-config";
import { storedWebhookRecording } from "../domains/webhooks/builder-webhooks";
import { setWebhookAuditEnabled } from "../domains/webhooks/recording-activation";
import {
  pruneRemovedCodeFirstRecording,
  setWebhookRecording,
  type WebhookRecordingScope,
} from "../domains/webhooks/recording-policy";
import { collectPluginContributedSlugs } from "../domains/webhooks/recording-provenance";
import { resolveWebhookRecording } from "../domains/webhooks/resolve-recording-config";
import type { RevalidateConfig } from "../revalidation/types";
import { getProductionNotifier } from "../runtime/notifications/index";
import type { VersionsConfig } from "../schemas/versions/types";
import { ComponentSchemaService } from "../services/components/component-schema-service";

import { clearLiveSnapshots, setLiveSnapshot } from "./schema-snapshot-cache";

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
  status?: boolean;
  /** i18n: localized collections omit translatable cols from main + register a companion. */
  localized?: boolean;
  /** Content-versioning option; persisted (resolved) to dynamic_collections.versions. */
  versions?: boolean | VersionsConfig;
  /** Webhook recording opt-out; resolved into the process-level recording policy. */
  webhooks?: boolean | { record?: boolean };
  /** Cache-revalidation config; persisted to dynamic_collections.revalidate. */
  revalidate?: RevalidateConfig;
};

type SingleDef = {
  slug?: string;
  fields?: unknown[];
  label?: { singular?: string } | string;
  description?: string;
  admin?: unknown;
  dbName?: string;
  status?: boolean;
  /** i18n flag; persisted to dynamic_singles.localized. */
  localized?: boolean;
  /** Content-versioning option; persisted (resolved) to dynamic_singles.versions. */
  versions?: boolean | VersionsConfig;
  /** Webhook recording opt-out; resolved into the process-level recording policy. */
  webhooks?: boolean | { record?: boolean };
  /** Cache-revalidation config; persisted to dynamic_singles.revalidate. */
  revalidate?: RevalidateConfig;
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
  // All registered collections (code + UI) — keeps UI-created ones in the
  // desired schema so drizzle-kit doesn't treat them as orphan drops. Optional
  // so partial resolver fakes still satisfy the type.
  getAllCollections?(): Promise<
    Array<{
      slug?: string;
      tableName?: string;
      fields?: unknown[];
      status?: boolean;
      localized?: boolean;
    }>
  >;
  updateMigrationStatus(slug: string, status: string): Promise<unknown>;
}
interface SingleRegistrySurface {
  syncCodeFirstSingles(configs: unknown[]): Promise<unknown>;
  // Refresh the live code-first config snapshot the default resolver reads, so
  // an HMR-added single or changed function default is honoured. `keepPriorFor`
  // holds the slugs whose sync failed, so their prior snapshot is retained.
  // Optional for partial resolver fakes.
  setCodeFirstSingles?(
    singles: unknown[],
    options?: { keepPriorFor?: ReadonlySet<string> }
  ): void;
  // Drop removed singles from the live default snapshot BEFORE any reload path
  // can abort, so a removed-but-readable single can't auto-create from stale
  // function defaults. Optional for partial resolver fakes.
  pruneCodeFirstSingles?(presentSlugs: ReadonlySet<string>): void;
  updateMigrationStatus(slug: string, status: string): Promise<unknown>;
  // See CollectionRegistrySurface.getAllCollections — same orphan-drop guard,
  // for UI-created singles. Optional for partial resolver fakes.
  getAllSingles?(): Promise<
    Array<{
      slug?: string;
      tableName?: string;
      fields?: unknown[];
      status?: boolean;
    }>
  >;
}
/**
 * The slugs whose single sync failed. `syncCodeFirstSingles` resolves with an
 * `errors[]` (per-single failures) rather than rejecting, so a partial failure
 * is read from there; those slugs keep their prior default snapshot.
 */
function failedSingleSlugs(syncResult: unknown): Set<string> {
  const errs = (syncResult as { errors?: Array<{ slug?: string }> } | undefined)
    ?.errors;
  const slugs = new Set<string>();
  if (Array.isArray(errs)) {
    for (const entry of errs) if (entry?.slug) slugs.add(entry.slug);
  }
  return slugs;
}

/**
 * Evict removed singles from the live default snapshot, keyed on the slugs the
 * new config still declares. Runs EARLY on every reload — before the empty-
 * target return, the metadata-only branch, the DDL apply, and every abort path
 * (introspection failure, deferred/failed schema apply) — so a removed single's
 * registry row (which stays readable) can never auto-create from stale function
 * defaults even when a later `setCodeFirstSingles` never runs. Remove-only, so
 * it never pairs a surviving single's new fields with stale serialized metadata.
 * Non-fatal: a missing registry just leaves the snapshot for the next reload.
 */
async function pruneRemovedSingleDefaults(
  resolve: ServiceResolver,
  presentSingles: SingleDef[]
): Promise<void> {
  try {
    const singleReg = (await resolve(
      "singleRegistryService"
    )) as SingleRegistrySurface;
    const presentSlugs = new Set(
      presentSingles
        .map(single => single.slug)
        .filter((slug): slug is string => typeof slug === "string")
    );
    singleReg.pruneCodeFirstSingles?.(presentSlugs);
  } catch {
    // DI not initialised or the registry is absent — nothing to prune.
  }
}

interface ComponentRegistrySurface {
  syncCodeFirstComponents(configs: unknown[]): Promise<unknown>;
  // See CollectionRegistrySurface.getAllCollections — same orphan-drop guard,
  // for UI-created components (components have no status column). Optional.
  getAllComponents?(): Promise<
    Array<{ slug?: string; tableName?: string; fields?: unknown[] }>
  >;
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

// Build the code-first registry-sync payload for collections. Shared by the
// post-DDL sync and the metadata-only (no-DDL) HMR path so a change to
// registry-only metadata (versions/localized/status/labels/description) reaches
// the registry too, not just schema (DDL) changes.
function buildCollectionSyncPayload(collections: CollectionDef[]) {
  return collections
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
      // Draft/Published flag + versioning persisted to dynamic_collections so a
      // code-first toggle reaches the registry.
      status: c.status === true,
      // i18n: forward the localized master switch. The reload apply pipeline
      // carries `localized` into buildDesiredTableFromFields, so a localized
      // toggle produces a real schema diff (main table drops translatable cols,
      // companion table is created) and reaches this sync only AFTER the DDL
      // path ran. On the metadata-only path localized is unchanged from the
      // physical schema. Omitting it here would write `localized === undefined
      // === true = false`, flipping a localized collection's flag OFF on every
      // reload and desyncing the registry from the companion table.
      localized: c.localized === true,
      versions: resolveVersionsConfig(c.versions, c.status),
      // Forward the cache-revalidation config verbatim (no resolver — the
      // authored `{ tags?, disable? }` shape is persisted as-is).
      revalidate: c.revalidate,
      // Mirror the recording opt-out onto the registry row. The live policy is
      // published separately from config, but without this the row stays null
      // and the read-only Builder shows recording enabled for a collection
      // whose writes are actually suppressed.
      webhooks: storedWebhookRecording(c.webhooks),
    }));
}

// Build the code-first registry-sync payload for singles (see above).
function buildSingleSyncPayload(singles: SingleDef[]) {
  return singles
    .filter((s): s is SingleDef & { slug: string } => !!s.slug)
    .map(s => {
      const labelStr =
        typeof s.label === "string"
          ? s.label
          : (s.label?.singular ??
            s.slug
              .split(/[-_]/)
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "));
      return {
        slug: s.slug,
        label: labelStr,
        fields: s.fields ?? [],
        description: s.description,
        tableName: s.dbName,
        admin: s.admin,
        status: s.status === true,
        localized: s.localized === true,
        versions: resolveVersionsConfig(s.versions, s.status),
        // Forward the cache-revalidation config verbatim (no resolver).
        revalidate: s.revalidate,
        // Mirror the recording opt-out onto the registry row (same reason as
        // collections above).
        webhooks: storedWebhookRecording(s.webhooks),
      };
    });
}

// Normalize code-first components to the registry sync shape. Shared by the DDL
// path and the metadata-only path so a component's metadata (e.g. a `hidden`
// field flag, which drives webhook payload stripping) stays in step either way.
function buildComponentSyncPayload(components: ComponentDef[]) {
  return components
    .filter((c): c is ComponentDef & { slug: string } => !!c.slug)
    .map(c => {
      const labelStr =
        typeof c.label === "string"
          ? c.label
          : (c.label?.singular ??
            c.slug
              .split(/[-_]/)
              .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "));
      return {
        slug: c.slug,
        label: labelStr,
        fields: c.fields ?? [],
        description: c.description,
        admin: c.admin,
        // i18n: forward the localized master switch — otherwise the reload flips
        // a localized component's flag OFF every HMR/boot.
        localized: (c as { localized?: boolean }).localized === true,
      };
    });
}

// Metadata-only registry sync for the no-DDL HMR path: a `versions`/`localized`/
// status/labels edit produces no schema operations, so the main flow's
// `if (!hasChanges) return` would otherwise skip persistence until a restart.
// The registry syncs change-detect internally and no-op when nothing changed;
// this runs only when nextly.config.ts changes (not on every HMR tick).
// Returns per-scope success. The caller republishes each scope's recording
// policy only when that scope's sync succeeded, so a failed sync never leaves a
// new recording decision active while the mutation services still read the old
// field tree (which drives sensitive-field stripping) — and one scope's failure
// does not block the other's committed decisions.
async function syncCodeFirstMetadataOnly(
  resolve: ServiceResolver,
  newConfig: {
    collections?: CollectionDef[];
    singles?: SingleDef[];
    fieldGroups?: ComponentDef[];
  },
  logger?: LoggerLike
): Promise<{ collections: boolean; singles: boolean; components: boolean }> {
  let collections = true;
  let singles = true;
  let components = true;
  try {
    const registry = (await resolve(
      "collectionRegistryService"
    )) as CollectionRegistrySurface;
    const payload = buildCollectionSyncPayload(newConfig.collections ?? []);
    if (payload.length > 0) await registry.syncCodeFirstCollections(payload);
  } catch (err) {
    collections = false;
    logger?.warn(
      `[Nextly HMR] metadata-only collection sync failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  try {
    const singleReg = (await resolve(
      "singleRegistryService"
    )) as SingleRegistrySurface;
    const payload = buildSingleSyncPayload(newConfig.singles ?? []);
    let failedSlugs = new Set<string>();
    if (payload.length > 0) {
      failedSlugs = failedSingleSlugs(
        await singleReg.syncCodeFirstSingles(payload)
      );
    }
    // Refresh the live default source after the sync: successful singles adopt
    // the new config; a single whose sync failed keeps its prior snapshot so its
    // new fields never pair with stale serialized metadata.
    singleReg.setCodeFirstSingles?.(newConfig.singles ?? [], {
      keepPriorFor: failedSlugs,
    });
  } catch (err) {
    singles = false;
    logger?.warn(
      `[Nextly HMR] metadata-only single sync failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  // A component's metadata (e.g. a `hidden` field flag) can change with no
  // schema diff and drives webhook payload stripping, so sync it here too — the
  // caller gates the recording policy on this before activating a new decision.
  try {
    const compReg = (await resolve(
      "componentRegistryService"
    )) as ComponentRegistrySurface;
    const payload = buildComponentSyncPayload(newConfig.fieldGroups ?? []);
    if (payload.length > 0) await compReg.syncCodeFirstComponents(payload);
  } catch (err) {
    components = false;
    logger?.warn(
      `[Nextly HMR] metadata-only component sync failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return { collections, singles, components };
}

/**
 * Publish one scope's recording decisions from the reloaded config. The two
 * directions have asymmetric safety, so they are gated differently:
 *
 * - Opt-OUTS (`record: false`) are applied UNCONDITIONALLY, even when this
 *   scope's metadata sync failed or was deferred. Turning recording OFF builds
 *   no payload and reads no field tree, so a just-loaded privacy opt-out is safe
 *   to honor immediately — and MUST be, or a reload that flips `webhooks` to
 *   `false` while an unrelated diff is deferred would keep leaking events.
 * - Opt-INS (`record: true`, including a removed slug reverting to the default)
 *   DO read the field tree when a payload is later expanded, so they are applied
 *   ONLY when `synced` is true. Otherwise expansion would strip against a stale
 *   component/field tree and could emit a value that is now hidden. Pruning a
 *   removed code-first slug reverts it to the recording default, so it is an
 *   opt-in and waits on `synced` too. Plugin-sourced decisions are never pruned.
 */
function publishScopeRecording(
  scope: WebhookRecordingScope,
  entities: Array<{
    slug?: string;
    webhooks?: CollectionDef["webhooks"];
  }>,
  pluginSlugs: Set<string>,
  synced: boolean
): void {
  // Provenance comes from the plugin contribution list, not `admin.isPlugin`:
  // a plugin's opt-out must be tagged `plugin` so the prune below never removes
  // it, even when the plugin never sets that presentation flag.
  const sourceOf = (slug: string): "code" | "plugin" =>
    pluginSlugs.has(slug) ? "plugin" : "code";

  // Opt-outs first, always: safe regardless of sync state (recording is off).
  for (const e of entities) {
    if (!e.slug) continue;
    if (resolveWebhookRecording(e.webhooks).record === false) {
      setWebhookRecording(scope, e.slug, false, sourceOf(e.slug));
    }
  }

  // Opt-ins and removed-slug pruning only once the field tree is in step.
  if (!synced) return;
  const present = new Set<string>();
  for (const e of entities) {
    if (e.slug) present.add(e.slug);
  }
  pruneRemovedCodeFirstRecording(scope, present);
  for (const e of entities) {
    if (!e.slug) continue;
    if (resolveWebhookRecording(e.webhooks).record === true) {
      setWebhookRecording(scope, e.slug, true, sourceOf(e.slug));
    }
  }
}

/**
 * Republish the webhook recording policy from the reloaded config, so a live
 * `webhooks` opt-out/opt-in takes effect without a restart.
 *
 * Called at two points, by design, with different `scopes`:
 *   - BEFORE introspection with both scopes `false` — publishes only the
 *     privacy-critical OPT-OUTS (which need no field tree) so they take effect
 *     even if a later step of this reload (introspection, an unsafe diff, the
 *     apply) aborts. Opt-INs are suppressed by the false flags.
 *   - AFTER each scope's metadata sync succeeds with that scope `true` — adds
 *     the OPT-INS (and removed-slug pruning), which DO read the field tree, so a
 *     reload whose schema apply fails never leaves a recording opt-in ahead of
 *     the still-old runtime field tree.
 *
 * Per-scope on purpose: `scopes` names the entity kinds whose metadata sync
 * actually succeeded, so a PARTIAL reload (collections synced, singles/component
 * failed) still activates the committed collections' opt-ins instead of holding
 * them hostage to an unrelated failure. Opt-OUTS ignore the gate entirely (see
 * {@link publishScopeRecording}), which is what makes the pre-sync call safe.
 */
function republishRecordingPolicies(
  newConfig: {
    collections?: CollectionDef[];
    singles?: SingleDef[];
    plugins?: unknown[];
  },
  scopes: { collections: boolean; singles: boolean }
): void {
  const pluginCollections = collectPluginContributedSlugs(
    newConfig.plugins,
    "collections"
  );
  const pluginSingles = collectPluginContributedSlugs(
    newConfig.plugins,
    "singles"
  );
  publishScopeRecording(
    "collection",
    newConfig.collections ?? [],
    pluginCollections,
    scopes.collections
  );
  publishScopeRecording(
    "single",
    newConfig.singles ?? [],
    pluginSingles,
    scopes.singles
  );
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
  let newConfig:
    | {
        collections?: CollectionDef[];
        singles?: SingleDef[];
        fieldGroups?: ComponentDef[];
        webhookAuditEnabled?: boolean;
      }
    | undefined;
  try {
    const { loadConfig, clearConfigCache } = await import(
      "../cli/utils/config-loader"
    );
    clearConfigCache();
    const result = await loadConfig();
    newConfig = (
      result as {
        config?: {
          collections?: CollectionDef[];
          singles?: SingleDef[];
          fieldGroups?: ComponentDef[];
          webhookAuditEnabled?: boolean;
        };
      }
    ).config;

    // The reload repopulates the field-type registry through `loadConfig` but
    // never goes back through `registerServices`, so the boot gate does not run
    // again. Editing a plugin field's options while the dev server is up would
    // otherwise materialize a declaration its own type rejects, and the app
    // would only refuse it on the next restart — long after the schema changed.
    const { assertPluginFieldDeclarations } = await import(
      "../shared/lib/assert-plugin-field-declarations"
    );
    assertPluginFieldDeclarations({
      collections: newConfig?.collections,
      singles: newConfig?.singles,
      fieldGroups: newConfig?.fieldGroups,
    });
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
        ? JSON.stringify(err.logContext)
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

  // Republish the audit seam from the reloaded config, so toggling
  // `webhooks.audit` in nextly.config.ts takes effect on save without a restart.
  // `loadConfig()` returns a sanitized config, so the flag is the resolved flat
  // `webhookAuditEnabled`, not the raw `webhooks.audit` block. It is a single
  // process-global flag that reads no field tree, so — like a recording opt-out
  // — it is safe to apply immediately, before the schema diff is synced.
  setWebhookAuditEnabled(newConfig.webhookAuditEnabled ?? false);

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

  // Evict removed singles from the live default snapshot up front, before any
  // return/abort below, so a single dropped from the config can never
  // auto-create from its stale function defaults even if this reload later
  // aborts (introspection failure, deferred/failed apply) before the
  // metadata-sync `setCodeFirstSingles` runs.
  await pruneRemovedSingleDefaults(resolve, newConfig.singles ?? []);

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
    localized?: boolean;
  }> = [];
  for (const c of newConfig.collections ?? []) {
    if (!c.slug) continue;
    targets.push({
      slug: c.slug,
      tableName: c.tableName ?? resolveCollectionTableName(c.slug, c.dbName),
      fields: (c.fields ?? []) as MinimalField[],
      status: c.status === true,
      // i18n: propagate the localized flag so the HMR diff omits translatable
      // columns from the main table and the runtime schema is regenerated with
      // the companion split.
      localized: c.localized === true,
    });
  }

  // Normalize singles. Table name follows single_<slug> convention.
  const singleTargets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
    status?: boolean;
    localized?: boolean;
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
      status: s.status === true,
      // i18n: carry `localized` so the HMR diff omits translatable columns from the
      // single's main table and registers its companion, mirroring the collection path.
      localized: (s as { localized?: boolean }).localized === true,
    });
  }

  // Normalize components. Every name resolves canonically to
  // comp_<slug_with_underscores>.
  const componentTargets: Array<{
    slug: string;
    tableName: string;
    fields: MinimalField[];
    localized?: boolean;
  }> = [];
  for (const c of newConfig.fieldGroups ?? []) {
    if (!c.slug) continue;
    componentTargets.push({
      slug: c.slug,
      tableName: resolveComponentTableName(c.slug),
      fields: (c.fields ?? []) as MinimalField[],
      // i18n: carry `localized` so the HMR diff omits translatable columns from the
      // component's main table and registers its companion.
      localized: (c as { localized?: boolean }).localized === true,
    });
  }

  if (
    targets.length === 0 &&
    singleTargets.length === 0 &&
    componentTargets.length === 0
  ) {
    // Nothing managed remains, but a reload that removed the LAST code-first
    // collection/single still has to reconcile the recording policy before
    // bailing: the removed entity's DB table can stay writable, so a lingering
    // `webhooks: false` opt-out would silently suppress its events until
    // restart. Prune both code-first namespaces against the now-empty config
    // (present sets are empty, so every code-sourced opt-out is dropped;
    // plugin decisions are preserved). No metadata to sync here, so this is the
    // only reconciliation the empty-target path needs.
    republishRecordingPolicies(newConfig, { collections: true, singles: true });
    // The live default snapshot was already pruned to the (now empty) present
    // set above, so a removed single's stale defaults are gone by here.
    return;
  }

  // Apply recording OPT-OUTS now, before introspection and the schema apply.
  // Turning recording off builds no payload and reads no field tree, so an
  // opt-out is always safe to honor immediately — and every path from here can
  // still bail early (introspection throwing, an unsafe diff deferring, the
  // apply failing), each of which consumes the reload event. Publishing opt-outs
  // up front means a reload that sets `webhooks: false` stops recording even when
  // one of those later steps aborts; opt-INs (and pruning) still wait for a
  // successful field-tree sync, applied by the per-scope republishes below.
  republishRecordingPolicies(newConfig, { collections: false, singles: false });

  // Extracted once so the same list is passed to introspectLiveSnapshot
  // AND registered in the live-snapshot cache for the pipeline to reuse.
  const managedTableNames = [
    ...targets.map(t => t.tableName),
    ...singleTargets.map(t => t.tableName),
    ...componentTargets.map(t => t.tableName),
  ];

  // Cache is meant to dedupe within a single logical apply boundary only —
  // wipe any stale entry from a previous apply before we start this one.
  clearLiveSnapshots();

  // ONE batched introspect for every managed table the config knows about
  // (collections + singles). If the call fails, abort the reload entirely —
  // it's a connection-level failure, not a per-table problem.
  let liveSnapshot: NextlySchemaSnapshot;
  try {
    liveSnapshot = await introspectLiveSnapshot(db, dialect, managedTableNames);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error(
      `[Nextly HMR] Could not introspect live schema: ${msg}. ` +
        `No code-first schema changes were applied this cycle.`
    );
    return;
  }

  // Register so PushSchemaPipeline.apply can skip its own introspect call
  // within this apply boundary. See setLiveSnapshot for the contract.
  setLiveSnapshot(managedTableNames, liveSnapshot);
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
  // True when a real schema diff existed but was NOT applied this cycle (an
  // unsafe change needing review, or a diff that threw). In that state the
  // registry's `fields` would disagree with the physical table, so the no-DDL
  // metadata-only sync below must be skipped rather than persist unmigrated
  // schema metadata; it retries on the next clean reload or restart.
  let deferredSchemaChange = false;

  const desiredCollections: Record<string, DesiredCollection> = {};
  for (const target of targets) {
    // Always register the entry so drizzle-kit's schema stays complete.
    const entry: DesiredCollection = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredCollection["fields"],
      status: target.status === true,
      // i18n: carry `localized` on the desired entry so the runtime-schema
      // regeneration below omits translatable columns and registers a companion.
      localized: target.localized === true,
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect,
        // i18n: omit translatable columns from the main table's desired snapshot
        // so the HMR diff doesn't re-add them (they live in the companion). H2.
        {
          hasStatus: target.status === true,
          localized: target.localized === true,
        }
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
        deferredSchemaChange = true;
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
      deferredSchemaChange = true;
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
      localized: target.localized === true,
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect,
        {
          hasStatus: target.status === true,
          localized: target.localized === true,
        }
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
        deferredSchemaChange = true;
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
      deferredSchemaChange = true;
    }
  }

  // Per-component diff + safety classification — mirrors the singles loop.
  const desiredComponents: Record<string, DesiredFieldGroup> = {};
  for (const target of componentTargets) {
    const entry: DesiredFieldGroup = {
      slug: target.slug,
      tableName: target.tableName,
      fields: target.fields as DesiredFieldGroup["fields"],
      localized: target.localized === true,
    };
    try {
      const live = liveByTable.has(target.tableName)
        ? { tables: [liveByTable.get(target.tableName)!] }
        : { tables: [] };
      const desiredTable = buildDesiredTableFromFields(
        target.tableName,
        target.fields,
        dialect,
        { localized: target.localized === true }
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
        deferredSchemaChange = true;
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
      deferredSchemaChange = true;
    }
  }

  // No schema (DDL) changes to apply. Registry-only metadata (versions,
  // localized, status, labels, description) can still have changed, and it does
  // not surface as a schema diff — so run the idempotent metadata sync before
  // returning, otherwise a metadata-only edit (e.g. toggling `versions`) would
  // not persist until the dev server restarts.
  if (!hasChanges) {
    // Only sync when the schema is genuinely in step (every entity had a zero-op
    // diff). If a real schema change was deferred (unsafe/needs review) or a diff
    // threw, syncing would persist `fields` that disagree with the physical
    // table, so skip and let a later clean reload / restart reconcile.
    if (!deferredSchemaChange) {
      const synced = await syncCodeFirstMetadataOnly(
        resolve,
        newConfig,
        logger
      );
      // Publish each scope's (possibly toggled) recording policy ONLY when that
      // scope's metadata sync succeeded — a `webhooks` change surfaces as no
      // schema diff, so this is the path a live opt-out/opt-in toggle flows
      // through, but a failed field-tree sync must not activate the new opt-IN
      // while the mutation services still strip against the old fields. A
      // referenced component's field tree drives webhook payload stripping, so
      // also hold BOTH scopes' opt-ins back until the component sync succeeds:
      // otherwise a reload that both enables recording and hides a component
      // field would expand payloads against the stale component tree and leak
      // PII. Opt-OUTs ignore this gate (see publishScopeRecording).
      republishRecordingPolicies(newConfig, {
        collections: synced.collections && synced.components,
        singles: synced.singles && synced.components,
      });
    } else {
      // A real schema change was deferred (unsafe / needs review) or a diff
      // threw, so the field metadata must NOT be synced — the physical table
      // disagrees. A recording OPT-OUT is still safe to honor now (recording
      // turns off, no payload is built against any field tree), and skipping it
      // would keep a newly opted-out entity's events flowing to the outbox until
      // a later clean reload or restart. Reconcile with both scopes unsynced so
      // opt-outs apply immediately while opt-ins stay gated on a good sync.
      republishRecordingPolicies(newConfig, {
        collections: false,
        singles: false,
      });
    }
    return;
  }

  // Preserve registered collections that aren't in the code config (e.g.
  // Schema-Builder ones). HMR only knows nextly.config.ts; the shared helper
  // owns both the merge and the policy for an unreadable registry, so this
  // path and `db:sync` cannot drift apart again.
  Object.assign(
    desiredCollections,
    await mergeRegisteredCollectionsSafely(
      desiredCollections,
      async () => {
        const collectionRegistry = (await resolve(
          "collectionRegistryService"
        )) as CollectionRegistrySurface;
        return typeof collectionRegistry?.getAllCollections === "function"
          ? await collectionRegistry.getAllCollections()
          : [];
      },
      logger
        ? { warn: (m: string) => logger.warn(`[Nextly HMR] ${m}`) }
        : undefined
    )
  );

  // Same preservation for singles created via the UI (registry-only).
  try {
    const singleRegistry = (await resolve(
      "singleRegistryService"
    )) as SingleRegistrySurface;
    if (typeof singleRegistry?.getAllSingles === "function") {
      const dbSingles = await singleRegistry.getAllSingles();
      for (const s of dbSingles) {
        if (!s?.slug || !s?.tableName) continue;
        if (desiredSingles[s.slug]) continue; // code config wins
        desiredSingles[s.slug] = {
          slug: s.slug,
          tableName: s.tableName,
          fields: (s.fields ?? []) as DesiredSingle["fields"],
          status: s.status === true,
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(
      `[Nextly HMR] Could not load existing singles to preserve them ` +
        `during code-first apply: ${msg}. UI-created singles may be ` +
        `flagged for drop this cycle.`
    );
  }

  // Same preservation for components created via the UI (registry-only).
  try {
    const componentRegistry = (await resolve(
      "componentRegistryService"
    )) as ComponentRegistrySurface;
    if (typeof componentRegistry?.getAllComponents === "function") {
      const dbComponents = await componentRegistry.getAllComponents();
      for (const c of dbComponents) {
        if (!c?.slug || !c?.tableName) continue;
        if (desiredComponents[c.slug]) continue; // code config wins
        desiredComponents[c.slug] = {
          slug: c.slug,
          tableName: c.tableName,
          fields: (c.fields ?? []) as DesiredFieldGroup["fields"],
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn(
      `[Nextly HMR] Could not load existing components to preserve them ` +
        `during code-first apply: ${msg}. UI-created components may be ` +
        `flagged for drop this cycle.`
    );
  }

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
    // Publish each scope's recording policy only AFTER its field-tree metadata
    // sync succeeds (see the assignment after the syncs below): the DDL applied,
    // but if a sync then fails, activating the new decision while the mutation
    // services still read stale fields would record/suppress events against the
    // wrong stripping config. Tracked per scope so a partial failure (e.g.
    // singles fail) does not block the committed scope's decisions.
    let collectionSynced = true;
    let singleSynced = true;
    let componentSynced = true;
    // Sync dynamic_collections metadata so the fields JSON reflects the
    // new config. The pipeline above only applies DDL to dc_<slug>; without
    // this call, admin-UI queries still read the old field list until the
    // server restarts and registerServices runs syncCodeFirstCollections.
    try {
      const registry = (await resolve(
        "collectionRegistryService"
      )) as CollectionRegistrySurface;
      const codeFirstConfigs = buildCollectionSyncPayload(
        newConfig.collections ?? []
      );
      await registry.syncCodeFirstCollections(codeFirstConfigs);

      // registerCollection defaults migration_status to 'pending'; the pipeline
      // just created any missing tables, so mark them 'applied' (mirrors the
      // singles branch / di/register.ts). Without this a code collection added
      // after initial setup shows "pending" forever. Absent in the pre-pipeline
      // liveByTable snapshot ⇒ just created.
      for (const target of targets) {
        if (!liveByTable.has(target.tableName)) {
          try {
            await registry.updateMigrationStatus(target.slug, "applied");
          } catch {
            // Non-fatal: migration status is metadata only.
          }
        }
      }
    } catch {
      // Non-fatal: DDL was applied; metadata sync failed. The next boot
      // or HMR cycle will retry via registerServices.
      collectionSynced = false;
    }

    // Mirror the same metadata sync for singles — keeps dynamic_singles.fields
    // in step with the DDL changes the pipeline just applied.
    try {
      const singleReg = (await resolve(
        "singleRegistryService"
      )) as SingleRegistrySurface;
      const codeFirstSingleConfigs = buildSingleSyncPayload(
        newConfig.singles ?? []
      );
      let failedSlugs = new Set<string>();
      if (codeFirstSingleConfigs.length > 0) {
        // syncCodeFirstSingles resolves with an errors[] rather than rejecting;
        // a per-single failure means its serialized metadata is stale, so that
        // slug keeps its prior default snapshot below rather than the new fields.
        failedSlugs = failedSingleSlugs(
          await singleReg.syncCodeFirstSingles(codeFirstSingleConfigs)
        );

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
      // Refresh the live default source after the sync: successful singles adopt
      // the new config; a single whose sync failed keeps its prior snapshot so
      // its new fields never pair with stale serialized metadata.
      singleReg.setCodeFirstSingles?.(newConfig.singles ?? [], {
        keepPriorFor: failedSlugs,
      });
    } catch {
      // Non-fatal: same reasoning as collection metadata sync above.
      singleSynced = false;
    }

    // Sync dynamic_components metadata — keeps dynamic_components.fields
    // in step with the DDL changes the pipeline just applied.
    try {
      const compReg = (await resolve(
        "componentRegistryService"
      )) as ComponentRegistrySurface;
      const codeFirstComponentConfigs = buildComponentSyncPayload(
        newConfig.fieldGroups ?? []
      );
      if (codeFirstComponentConfigs.length > 0) {
        await compReg.syncCodeFirstComponents(codeFirstComponentConfigs);
      }
    } catch {
      // Non-fatal: same reasoning as collection/single metadata sync above.
      componentSynced = false;
    }

    // Activate each scope's recording policy once its OWN field tree AND the
    // shared component field tree are in step — never before. Webhook payload
    // stripping resolves sensitive fields through the component registry too
    // (webhookFieldTree / expandComponentFields), so a failed component sync
    // holds both scopes' new decisions back; but a singles-only sync failure no
    // longer blocks the committed collections' decisions (and vice versa).
    republishRecordingPolicies(newConfig, {
      collections: collectionSynced && componentSynced,
      singles: singleSynced && componentSynced,
    });

    // Pre-compute fresh Drizzle table objects for all affected collections,
    // singles, and components. Synchronous (schema generation, no DB I/O).
    // Shared between the cache-refresh blocks below so we don't generate twice.
    const collectionFreshTables = new Map<string, unknown>();
    const singleFreshTables = new Map<string, unknown>();
    const componentFreshTables = new Map<string, unknown>();
    // Companion `_locales` tables for localized collections (i18n M3b-2), keyed
    // by companion table name — registered alongside the main tables below.
    const companionFreshTables = new Map<string, unknown>();
    try {
      const { buildCompanionRuntimeTable } = await import(
        "../domains/i18n/runtime/companion-registration"
      );
      for (const c of Object.values(desiredCollections)) {
        // `localized` now travels on the DesiredCollection entry (set above from
        // the config target), so the main table is regenerated without the
        // translatable columns and the companion is registered.
        const localized = c.localized === true;
        const { table } = generateRuntimeSchema(
          c.tableName,
          c.fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: c.status === true, localized }
        );
        collectionFreshTables.set(c.tableName, table);
        if (localized) {
          const companion = buildCompanionRuntimeTable({
            slug: c.slug ?? c.tableName,
            tableName: c.tableName,
            fields: c.fields as { name: string; type: string }[],
            dialect,
            // companion carries a per-locale `_status` column when the
            // collection has Draft/Published (mirrors loadCompanionSchema). M9.
            localized: true,
            status: c.status === true,
          });
          if (companion) {
            companionFreshTables.set(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
      for (const s of Object.values(desiredSingles)) {
        // i18n: a localized single omits its translatable columns from the main
        // runtime table and registers the companion `single_<slug>_locales` table —
        // mirrors the collection branch above.
        const localized = (s as { localized?: boolean }).localized === true;
        const { table } = generateRuntimeSchema(
          s.tableName,
          s.fields as Parameters<typeof generateRuntimeSchema>[1],
          dialect,
          { status: s.status === true, localized }
        );
        singleFreshTables.set(s.tableName, table);
        if (localized) {
          const companion = buildCompanionRuntimeTable({
            slug: s.slug ?? s.tableName,
            tableName: s.tableName,
            fields: s.fields as { name: string; type: string }[],
            dialect,
            localized: true,
            status: s.status === true,
          });
          if (companion) {
            companionFreshTables.set(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
      // Components must use the component schema generator, NOT the collection/
      // single generateRuntimeSchema. Components link to their parent document
      // via _parent_id/_parent_table/_parent_field/_order; the collection
      // generator instead injects id/title/slug base columns and omits
      // _parent_id. Using it here clobbered the correct boot-time descriptor,
      // breaking every component read (filter by _parent_id) and write (insert
      // _parent_*) after an HMR config reload.
      const componentSchemaService = new ComponentSchemaService(dialect);
      for (const comp of Object.values(desiredComponents)) {
        // i18n: a localized component omits its translatable columns from the main
        // comp_ runtime table and registers the companion `comp_<slug>_locales` table.
        const localized = (comp as { localized?: boolean }).localized === true;
        const table = componentSchemaService.generateRuntimeSchema(
          comp.tableName,
          comp.fields,
          { localized }
        );
        componentFreshTables.set(comp.tableName, table);
        if (localized) {
          const companion = buildCompanionRuntimeTable({
            slug: comp.slug ?? comp.tableName,
            tableName: comp.tableName,
            fields: comp.fields as { name: string; type: string }[],
            dialect,
            localized: true,
            status: false,
          });
          if (companion) {
            companionFreshTables.set(
              companion.companionTableName,
              companion.table
            );
          }
        }
      }
    } catch {
      // Non-fatal: all refresh blocks below will no-op on empty maps.
    }

    // Refresh SchemaRegistry.dynamicSchemas — used by the adapter's CRUD
    // path (INSERT / UPDATE / DELETE) for dc_*, single_*, and comp_* tables.
    try {
      const schemaReg = (await resolve(
        "schemaRegistry"
      )) as SchemaRegistrySurface;
      for (const [tableName, table] of collectionFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
      for (const [tableName, table] of singleFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
      for (const [tableName, table] of componentFreshTables) {
        schemaReg.registerDynamicSchema(tableName, table);
      }
      // Localized companion `_locales` tables (i18n M3b-2) — same resolver so
      // the adapter can reach them for reads/writes once M4 wires the joins.
      for (const [tableName, table] of companionFreshTables) {
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

    // The DDL apply failed (needs-TTY confirmation, an executor error, ...), so
    // the field-tree syncs and the recording republish under `if (success)` were
    // skipped. Existing tables and services stay writable, though, so a recording
    // OPT-OUT loaded this cycle must still take effect — recording off builds no
    // payload, so the un-synced field tree is irrelevant, and leaving the old
    // record-enabled decision active would keep leaking the newly private
    // entity's events. Reconcile with both scopes unsynced: opt-outs apply now,
    // opt-ins stay gated on a later clean apply (mirrors the deferred path above).
    republishRecordingPolicies(newConfig, {
      collections: false,
      singles: false,
    });

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
        .replace(/\s*Run from an interactive terminal,.*$/i, "")
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

// Decides whether a collection's ops can be auto-applied from code-first.
//
// Most destructive ops now flow into the pipeline's Classifier +
// ClackTerminalPromptDispatcher (drop_column → destructive_drop event;
// rename pairs → shrinking-pool prompt). This gate only catches the
// shapes for which the pipeline does not yet have an interactive
// resolution UX:
//
//   - drop_table: no destructive-confirm event exists for tables yet.
//   - change_column_type: only emits a warning, no resolution.
//   - change_column_nullable (NOT NULL adds on existing rows): pipeline
//     classifier emits add_not_null_with_nulls + asks the user, BUT
//     only when there are actually NULL rows. Tables with no NULLs flow
//     through silently — fine. Tables that DO have NULLs prompt
//     correctly. This gate is therefore a no-op for the NOT NULL case
//     today; kept here only as a future-proof slot.
//
// Pure-drop, mixed drop+add, type widenings, and additive changes all
// pass through to the pipeline.
function classifyForCodeFirst(
  operations: Operation[],
  _dialect: SupportedDialect
): { safe: true } | { safe: false; reason: string } {
  if (operations.length === 0) return { safe: true };

  const reasons: string[] = [];
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

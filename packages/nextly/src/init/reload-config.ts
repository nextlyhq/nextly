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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { MIGRATION_TARGET } from "../domains/field-groups/migration/manifest";
import { withMigrationExcluded } from "../domains/field-groups/migration/sync-guard";
import {
  chooseTypeColumns,
  resolveFieldGroupRegistryName,
} from "../domains/field-groups/storage/resolve-storage-names";
import type { I18nTransitionKind } from "../domains/i18n/migration/transition-state";
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
import { readIdentifierCaseRules } from "../domains/schema/utils/read-identifier-case";
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
import { describeError } from "../errors/index";
import { NextlyError } from "../errors/nextly-error";
import type { PluginFieldType } from "../plugins/contributions";
import type { RevalidateConfig } from "../revalidation/types";
import { getProductionNotifier } from "../runtime/notifications/index";
import { STORAGE_FORMAT } from "../schemas/storage-format";
import type { VersionsConfig } from "../schemas/versions/types";
import { FieldGroupSchemaService } from "../services/field-groups/field-group-schema-service";

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
  getDrizzle<T = unknown>(): T;
  // Needed to resolve which field-group registry this database holds: the
  // storage migration renames it, so the name is read from the catalog rather
  // than spelled here.
  listTables(): Promise<string[]>;
  // The registry read goes through the adapter's statement path so the driver
  // envelopes are normalised in one place rather than per caller.
  queryStatement<T = Record<string, unknown>>(statement: SQL): Promise<T[]>;
  // Needed to provision the localized companion below: creating the table and adding
  // columns to it are both DDL, and the status backfill that accompanies a new `_status`
  // column is a write.
  executeQuery<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
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
      "fieldGroupRegistryService"
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
  // The curated `emit` is NOT attached here: it reads the field tree to strip
  // secrets from its payload, so it waits on `synced` exactly like an opt-in
  // (attached below). Otherwise a reload that adds `emit` while making a field
  // newly sensitive could ship the stale field's value unstripped.
  for (const e of entities) {
    if (!e.slug) continue;
    const resolved = resolveWebhookRecording(e.webhooks);
    if (resolved.record === false) {
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
    const resolved = resolveWebhookRecording(e.webhooks);
    if (resolved.record === true) {
      setWebhookRecording(scope, e.slug, true, sourceOf(e.slug), resolved.emit);
    } else if (resolved.emit) {
      // Re-publish the opt-out WITH its curated emit now that the field tree is
      // in step, so the curated payload strips against current metadata.
      setWebhookRecording(
        scope,
        e.slug,
        false,
        sourceOf(e.slug),
        resolved.emit
      );
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

/**
 * Create, and bring into step, the `_locales` companion of every localized collection, single
 * and field group in the reloaded config.
 *
 * It does NOT seed existing content into the companion. `ensureCompanionTable` is
 * creation-only and leaves whatever is already on the main table where it is, so a successful
 * reload is not evidence that default-locale data has been carried across — enabling
 * localization on an entity that already has content still leaves that content unreadable
 * until the transition seeds it. Copying it is the gated pipeline's job.
 *
 * The reload path is the `next dev` counterpart to the CLI's `ensureLocalizedCompanions`: it is
 * where a config edit lands when the app is running under plain `next dev` rather than
 * `nextly db:sync --watch`. `ensureCompanionTable` is idempotent, so entities that already have
 * their companion cost one introspection each.
 *
 * Never throws: a companion that cannot be provisioned must not take down a config reload. The
 * write guard in the mutation services is what protects content in the meantime.
 */
async function ensureLocalizedCompanionsForReload(
  adapter: AdapterLike,
  config: {
    collections?: unknown[];
    singles?: unknown[];
    fieldGroups?: unknown[];
    localization?: { defaultLocale?: string };
  },
  // `<kind>:<slug>` for every entity whose schema change was classified unsafe (or whose diff
  // threw) this cycle, so it was NOT applied. Those must be skipped: creating a companion for
  // a transition that has not happened is worse than leaving it absent. The Schema Builder
  // later applies the real transition, and `buildCompanionTransitionStatements` decides
  // whether to SEED the existing main-table values by looking at whether the companion is
  // already there. Finding one — empty, created from a config that was never applied — sends
  // it down the plain reconcile branch instead, and the default-locale content is lost.
  //
  // Deliberately per entity rather than a single "something was deferred" flag: entities whose
  // schema IS in step still need provisioning on this pass, and skipping them wholesale
  // reintroduces the missing-companion window this function exists to close.
  deferred: ReadonlySet<string> = new Set(),
  /**
   * Which side of the schema apply this pass runs on.
   *
   * `beforeApply` exists because enabling localization removes the translatable columns from the
   * entity's desired main table, so the apply wants to DROP them. Running only afterwards means
   * the copy either never happens (the drop was classified destructive and the entity deferred)
   * or happens too late (the operator confirmed, and the values are already gone). This pass
   * therefore copies first, which makes the drop that follows harmless.
   *
   * It is restricted to entities whose main table already exists, because those are the only ones
   * that can hold content worth copying — and because a companion carries a foreign key to its
   * main table, which a brand-new entity does not have until the apply creates it. Those are left
   * to `afterApply`, which is also where column reconciliation belongs: the apply is what adds the
   * columns a reconcile would be looking for.
   */
  phase: "beforeApply" | "afterApply" = "afterApply"
): Promise<{
  preservationFailed: string[];
  restoreFailed: string[];
  schemaChanged: boolean;
}> {
  // Entities whose content could not be copied into their companion. The caller must not let the
  // apply run for these: the copy is the only thing standing between the apply's DROP and the
  // values it would take with it.
  const preservationFailed: string[] = [];
  // Entities whose content could not be copied BACK onto main when localization was turned off.
  // The caller must not publish the non-localized configuration for these: the app would read the
  // stale main values, accept edits on them, and a later successful retry would copy the
  // companion's older values over the top.
  const restoreFailed: string[] = [];
  // Whether this pass altered any main table. A transition can relax a retained column, and on
  // SQLite — which cannot change nullability at all — it drops one instead. The caller cached a
  // live snapshot before this ran, and the pipeline reuses it, so an apply working from that
  // snapshot would re-emit a DROP for a column that is already gone.
  let schemaChanged = false;
  // Same policy the CLI applies: production schema changes belong to `nextly migrate`.
  if (process.env.NODE_ENV === "production")
    return { preservationFailed, restoreFailed, schemaChanged };

  const {
    ensureCompanionTable,
    reconcileCompanionColumns,
    mainTableExists,
    resolveCompanionSeedDebt,
  } = await import("../domains/i18n/runtime/companion-io");
  const { resolveCollectionTableName, resolveComponentTableName } =
    await import("../domains/schema/utils/resolve-table-name");
  const { resolveSingleTableName } = await import(
    "../domains/singles/services/resolve-single-table-name"
  );

  type Localizable = {
    slug?: string;
    dbName?: string;
    localized?: boolean;
    status?: boolean;
    fields?: { name: string; type: string; localized?: boolean }[];
  };
  // The kind prefixes the `deferred` keys, because a collection and a single may share a slug
  // and only one of them may have been deferred. It is also part of the transition record's
  // key, for the same reason, so it is typed rather than left an open string.
  const groups: [
    I18nTransitionKind,
    Localizable[],
    (e: Localizable) => string,
  ][] = [
    [
      "collection",
      (config.collections ?? []) as Localizable[],
      e => resolveCollectionTableName(e.slug!, e.dbName),
    ],
    [
      "single",
      (config.singles ?? []) as Localizable[],
      e => resolveSingleTableName({ slug: e.slug!, dbName: e.dbName }),
    ],
    [
      "fieldGroup",
      (config.fieldGroups ?? []) as Localizable[],
      e => resolveComponentTableName(e.slug!),
    ],
  ];

  // Where transitions are recorded. Resolved whether or not the app names a default locale: an app
  // that has just removed its `localization` block still has companions to unwind, and asking for a
  // locale first would hide exactly those entities.
  const { bindTransitionRecorder, resolveTransitionStore } = await import(
    "../domains/i18n/migration/transition-recorder"
  );
  const { beginI18nTransition, settleI18nTransition } = await import(
    "../domains/i18n/migration/transition-state"
  );
  const transitionStore = await resolveTransitionStore(adapter);
  // The same store, plus the locale a newly created companion gets recorded with.
  const transitions = bindTransitionRecorder(transitionStore, config);

  for (const [kind, entities, resolveTableName] of groups) {
    for (const entity of entities) {
      if (!entity.slug) continue;
      if (deferred.has(`${kind}:${entity.slug}`)) continue;
      if (entity.localized !== true) {
        // Turning localization off is a transition too. Only the Schema Builder used to perform
        // it, so an entity localized from configuration and then un-localized kept its content in
        // a companion nothing reads any more, and fell back to whatever the main table held before
        // it was localized. Restoring runs after the apply, which is what puts those columns back.
        if (phase === "afterApply") {
          const { restoreDisabledCompanion } = await import(
            "../domains/i18n/runtime/restore-companion"
          );
          await restoreDisabledCompanion(
            adapter,
            {
              kind,
              slug: entity.slug,
              tableName: resolveTableName(entity),
              fields: entity.fields ?? [],
              dialect: adapter.dialect,
              defaultLocale: transitions?.defaultLocale,
              store: transitionStore,
            },
            error => {
              restoreFailed.push(entity.slug!);
              console.error(
                `[nextly] Could not restore "${entity.slug}" from its translations table after ` +
                  `localization was turned off. Its content is still in ` +
                  `${resolveTableName(entity)}_locales: ` +
                  `${error instanceof Error ? error.message : String(error)}`
              );
            }
          );
        }
        continue;
      }
      const tableName = resolveTableName(entity);
      if (
        phase === "beforeApply" &&
        !(await mainTableExists(adapter, tableName))
      ) {
        // Nothing to preserve and nothing to hang a foreign key on yet. The post-apply pass
        // creates this entity's companion once the apply has produced its main table.
        continue;
      }
      const provisioned = await ensureCompanionTable(
        adapter,
        {
          slug: entity.slug,
          tableName,
          fields: entity.fields ?? [],
          dialect: adapter.dialect,
          status: entity.status === true,
          // Turns creation into a transition: content already on the main table is
          // copied in as this locale's rows, instead of being left behind an empty
          // companion that reads null.
          sourceLocale: transitions?.defaultLocale,
          // Written before the DDL rather than after a successful return: MySQL commits DDL
          // implicitly, so a crash in between would leave a companion the next run treats as
          // pre-existing and never records. It is also what makes a failed copy recoverable.
          recordTransition: transitions
            ? () =>
                beginI18nTransition(transitions, {
                  kind,
                  slug: entity.slug!,
                  sourceLocale: transitions.defaultLocale,
                })
            : undefined,
          // Lets an existing companion be finished rather than skipped. `enabling` means an
          // earlier run created the table and did not complete the copy; `restored` means the
          // companion outlived a disable, so its default-locale rows describe a main table that
          // has been authoritative ever since and must be overwritten rather than trusted.
          seedIncomplete: transitions
            ? () =>
                resolveCompanionSeedDebt(transitions, kind, entity.slug!, {
                  defaultLocale: transitions.defaultLocale,
                })
            : undefined,
          settleTransition: transitions
            ? token =>
                settleI18nTransition(transitions, {
                  kind,
                  slug: entity.slug!,
                  // The claim this settles, handed back by whichever of the two callbacks above
                  // made it. A settlement that did not name one would close whatever claim it
                  // found, including one taken over while this copy ran.
                  token,
                })
            : undefined,
        },
        error => {
          if (phase === "beforeApply") preservationFailed.push(entity.slug!);
          console.warn(
            `[nextly] Could not prepare the translations table for "${entity.slug}". ` +
              `Writes in a non-default locale will be refused until it exists: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }
      );
      // Creating the table is not enough on its own: `ensureCompanionTable` returns
      // immediately when one already exists, so marking a FURTHER field localized on an
      // already-localized entity takes the no-DDL path, syncs its metadata, and leaves the
      // companion a column short — the write then splits that value into a column that is not
      // there. The CLI sync reconciles for the same reason; the HMR path needs it too.
      //
      // Safe here despite issuing DDL, because the production guard at the top of this
      // function has already returned: this runs only under `next dev`. The reconcile is
      // additive, so it never removes a column even when a field stops being localized.
      //
      // A transition ran, so the main table may no longer look the way the caller's cached
      // snapshot says. Only tracked before the apply — afterwards there is no apply left to
      // mislead.
      if (provisioned && phase === "beforeApply") schemaChanged = true;
      // Skipped before the apply, which is what creates the columns a reconcile would be looking
      // for. Running it early would compare the companion against a main table the apply has not
      // finished shaping.
      if (phase === "beforeApply") continue;
      await reconcileCompanionColumns(
        adapter,
        {
          slug: entity.slug,
          tableName: resolveTableName(entity),
          fields: entity.fields ?? [],
          dialect: adapter.dialect,
          status: entity.status === true,
        },
        error => {
          console.warn(
            `[nextly] Could not update the translations table for "${entity.slug}". ` +
              `Newly translatable fields may fail to save until it is in step: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }
      );
    }
  }

  return { preservationFailed, restoreFailed, schemaChanged };
}

// Reload entry point. resolver is optional and exists primarily for tests.
// dispatcher is also test-only: injects a fake PromptDispatcher (e.g., one
// that records prompts and auto-confirms) so tests don't need a real TTY.
/**
 * Serialize reloads across every caller.
 *
 * The reload captures the field-type registry, then `loadConfig` clears and
 * rebuilds that same process-global. Two runs overlapping would let one capture
 * a registry the other is halfway through replacing, and an abandoned run would
 * then restore a set that was never live. HMR already refuses to schedule while
 * its own reload is pending, but `boot-apply` calls straight through without
 * marking anything in flight, so HMR and boot can still meet.
 *
 * Serialized by queueing one trailing run, not by handing the caller the run
 * already going. A caller arriving mid-run represents an edit that run may have
 * read the file too early to see, and the HMR flag is drained before the call —
 * so returning the in-flight promise would drop that edit until the next save
 * or a restart. One trailing run is enough however many callers arrive: they
 * all want the state after the last of them.
 */
const globalForReload = globalThis as unknown as {
  __nextly_reloadInFlight?: Promise<void>;
  __nextly_reloadQueued?: Promise<void>;
};

export function reloadNextlyConfig(opts?: {
  resolver?: ServiceResolver;
  dispatcher?: PromptDispatcher;
}): Promise<void> {
  // Checked before the running one: the queued run is cleared inside its own
  // continuation, which is a microtask later than the running one's cleanup.
  // A caller landing in between would otherwise start a second concurrent run
  // alongside the queued one.
  const queued = globalForReload.__nextly_reloadQueued;
  if (queued) return queued;

  const running = globalForReload.__nextly_reloadInFlight;
  if (running) {
    globalForReload.__nextly_reloadQueued = running
      // A failed reload must not swallow the edit that arrived during it: the
      // next config is read either way, and this caller sees its own outcome.
      .catch(() => undefined)
      .then(() => {
        delete globalForReload.__nextly_reloadQueued;
        return startReload(opts);
      });
    return globalForReload.__nextly_reloadQueued;
  }

  return startReload(opts);
}

function startReload(opts?: {
  resolver?: ServiceResolver;
  dispatcher?: PromptDispatcher;
}): Promise<void> {
  const started = runReload(opts).finally(() => {
    delete globalForReload.__nextly_reloadInFlight;
  });
  globalForReload.__nextly_reloadInFlight = started;
  return started;
}

/**
 * Run a reload with a field-group storage migration excluded throughout.
 *
 * `next dev` routes config edits here rather than through the CLI watcher, so
 * this is the schema-applying path most users are on: it builds field-group
 * diffs, applies DDL, and its pre-cleanup issues UPDATE and DELETE.
 * Mid-migration that work reads a database where some tables carry pre-rename
 * names and some post-rename, with the registry pointers moving one step at a
 * time.
 *
 * The exclusion is *held* rather than sampled, because a migration starting
 * between a check and the apply leaves exactly the same window open. Holding is
 * safe here specifically because reloads are already serialized in this process
 * — `reloadNextlyConfig` keeps one in flight and queues the next — so taking
 * the lock cannot make a concurrent edit lose its turn.
 *
 * A refusal abandons the reload rather than throwing: the previous config stays
 * in place, whereas an exception escaping here reaches the dev server and turns
 * every later request into a 500.
 */
async function runReload(opts?: {
  resolver?: ServiceResolver;
  dispatcher?: PromptDispatcher;
}): Promise<void> {
  const resolveService = (name: string): unknown =>
    opts?.resolver ? opts.resolver(name) : defaultResolver(name);

  let adapter: AdapterLike | undefined;
  let logger: LoggerLike | undefined;
  try {
    logger = (await resolveService("logger")) as LoggerLike;
    adapter = (await resolveService("adapter")) as AdapterLike;
  } catch {
    // DI is not up yet. `applyReload` resolves again and abandons on its own,
    // so there is nothing to exclude against and nothing to report here.
  }
  if (!adapter) return applyReload(opts);

  // Tells a refused exclusion apart from a failure inside the reload itself,
  // which must propagate exactly as it did before this wrapper existed.
  let reloadStarted = false;
  try {
    await withMigrationExcluded(
      {
        // `AdapterLike` is a narrow view of the registered adapter, which is a
        // `DrizzleAdapter` at runtime.
        adapter: adapter as unknown as DrizzleAdapter,
        logger: logger as unknown as Parameters<
          typeof withMigrationExcluded
        >[0]["logger"],
        label: "hmr reload",
        // This path applies DDL by design, so it may establish the lock table
        // rather than proceeding unprotected without one.
        mayCreateLock: true,
      },
      () => {
        reloadStarted = true;
        return applyReload(opts);
      }
    );
  } catch (error) {
    if (reloadStarted) throw error;
    // Logged apart on purpose: a refusal is routine and expected, while a check
    // that could not run at all would otherwise disable schema applies silently
    // and look like nothing happened.
    if (NextlyError.is(error)) {
      logger?.warn(
        `[Nextly HMR] schema reload skipped: ${describeError(error)}`
      );
    } else {
      logger?.error(
        `[Nextly HMR] could not establish migration state, skipping schema reload: ${describeError(error)}`
      );
    }
  }
}

/** What a reload knows about where its field groups are physically stored. */
export interface StoredFieldGroupTables {
  /** `slug` → the physical table name the registry records. */
  tables: Map<string, string>;
  /**
   * Whether those names can be relied on.
   *
   * 🔴 The distinction this type exists for: a registry that is ABSENT means a
   * fresh database, where deriving `comp_*` names is correct. A registry that
   * is PRESENT but unreadable means the names are UNKNOWN, and deriving them
   * addresses storage that is not there — which is how a reload creates an
   * empty table beside the populated one it meant to edit. Only the first case
   * may guess.
   */
  usable: boolean;
  /**
   * Why the read failed, when it did.
   *
   * Present only on the failure path, and carried so the caller's log can name
   * the cause rather than only the symptom.
   */
  reason?: string;
}

/**
 * The physical table name each field group is stored under.
 *
 * Read rather than derived: `resolveComponentTableName` answers what this
 * release's creator WOULD name a table, while the registry records what it is
 * actually called. They differ for an author-chosen `dbName`, and after the
 * storage migration for every field group.
 *
 * Issued through the adapter's statement path so the three driver envelopes are
 * normalised in one place, and so an unrecognised shape is refused rather than
 * reported as no rows.
 */
export async function readStoredFieldGroupTables(
  adapter: AdapterLike
): Promise<StoredFieldGroupTables> {
  const tables = new Map<string, string>();
  try {
    const registryTable = await resolveFieldGroupRegistryName(adapter);
    const rows = await adapter.queryStatement<{
      slug?: unknown;
      table_name?: unknown;
    }>(
      sql`SELECT ${sql.identifier("slug")}, ${sql.identifier("table_name")} FROM ${sql.identifier(registryTable)}`
    );
    for (const row of rows) {
      if (typeof row.slug === "string" && typeof row.table_name === "string") {
        tables.set(row.slug, row.table_name);
      }
    }
    return { tables, usable: true };
  } catch (error) {
    // The reason travels with the verdict. Without it the caller can only say
    // "could not read stored field-group table names", which tells an operator
    // nothing about whether they are looking at a permission problem, a dropped
    // connection, or a malformed row — and this is the failure that defers a
    // whole reload, so it is the one worth diagnosing.
    return {
      tables,
      usable: (await registryIsAbsent(adapter)) === true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Whether the database genuinely has no field-group registry.
 *
 * The distinction that matters after a failed read: absent means a fresh
 * database, where deriving names is correct; present-but-unreadable means the
 * names are unknown, and deriving them would address storage that is not there.
 * Answered `undefined` when even this cannot be established, which is treated
 * as unreadable.
 */
async function registryIsAbsent(
  adapter: AdapterLike
): Promise<boolean | undefined> {
  try {
    const tables = await adapter.listTables();
    return !tables.some(
      table =>
        table === STORAGE_FORMAT.registryTable ||
        table === MIGRATION_TARGET.registryTable
    );
  } catch {
    return undefined;
  }
}

async function applyReload(opts?: {
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
        localization?: { defaultLocale?: string };
      }
    | undefined;
  let previousFieldTypes: PluginFieldType[] | undefined;
  let restoreFieldTypes: (() => void) | undefined;
  /**
   * Put the field-type registry back when a reload does not take effect.
   *
   * `loadConfig` swaps the process-global registry as it reads the new config,
   * but a reload can still be abandoned after that — DI not ready, the live
   * schema unreadable, a schema change deferred as unsafe. Those paths keep the
   * previous config and metadata, so leaving the new types installed would run
   * the abandoned reload's `validate`, storage mapping and `validateOptions`
   * against a schema that never changed.
   *
   * Not called on the paths that simply had nothing to do: there the new config
   * IS the live one, and its types belong in the registry.
   */
  const abandonReload = (): void => {
    restoreFieldTypes?.();
  };
  try {
    const { loadConfig, clearConfigCache } = await import(
      "../cli/utils/config-loader"
    );
    const { allFieldTypes, clearFieldTypes, registerFieldType } = await import(
      "../domains/schema/field-types/field-type-registry"
    );
    // `loadConfig` clears and repopulates the process-global field-type
    // registry, so a reload that is then rejected would leave the new
    // definitions installed under the retained config — writes would run the
    // refused reload's `validate` and storage mapping until the next good one.
    // The previous set is captured here and put back if anything below fails.
    previousFieldTypes = allFieldTypes();
    restoreFieldTypes = () => {
      clearFieldTypes();
      for (const fieldType of previousFieldTypes ?? []) {
        registerFieldType(fieldType);
      }
    };
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
    // The registry was rebuilt from the config that just failed; put the
    // working set back so the retained config keeps the behavior it was
    // validated with.
    abandonReload();
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
  // The loader returned without a config: the swap already happened inside it,
  // and nothing below will run, so the new types must not outlive the attempt.
  if (!newConfig) {
    abandonReload();
    return;
  }

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
    abandonReload();
    return;
  }
  // Resolution can succeed and still hand back no adapter, which is the same
  // outcome as it throwing: nothing below runs, so the reload never lands.
  if (!adapter) {
    abandonReload();
    return;
  }

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
  // 🔴 The STORED physical name wins over the one derived from the slug.
  //
  // `resolveComponentTableName` answers what this release's creator WOULD name
  // a table; the registry records what the table is actually called. Those
  // differ for an author-chosen `dbName`, and — after the storage migration —
  // for every field group. Deriving the name would make the reload diff against
  // a table that is not there, decide the component is new, and create an empty
  // one beside the populated one it meant to edit.
  //
  // Best effort by design: a registry that cannot be read leaves every name
  // derived, which is exactly the behaviour of a database that has no registry
  // yet.
  const stored = await readStoredFieldGroupTables(adapter);
  const storedComponentTables = stored.tables;
  const storedNamesUsable = stored.usable;
  /** Field groups left out of this reload because their storage is unknown. */
  const skippedComponentSlugs = new Set<string>();
  if (!storedNamesUsable) {
    logger?.warn(
      "[Nextly HMR] Could not read stored field-group table names" +
        (stored.reason ? `: ${stored.reason}` : "") +
        ". Deferring the field-group apply to the next reload."
    );
  }

  for (const c of newConfig.fieldGroups ?? []) {
    if (!c.slug) continue;
    // Skipped entirely when the stored names could not be established: a
    // derived name is a guess about physical storage, and guessing here is what
    // creates the empty table.
    if (!storedNamesUsable) {
      skippedComponentSlugs.add(c.slug);
      continue;
    }
    componentTargets.push({
      slug: c.slug,
      tableName:
        storedComponentTables.get(c.slug) ?? resolveComponentTableName(c.slug),
      fields: (c.fields ?? []) as MinimalField[],
      // i18n: carry `localized` so the HMR diff omits translatable columns from the
      // component's main table and registers its companion.
      localized: (c as { localized?: boolean }).localized === true,
    });
  }

  // 🔴 Checked BEFORE the empty-target branch below. `loadConfig` has already
  // replaced the process-global field-type registry, so returning without
  // restoring it leaves the deferred config's validators and storage mappings
  // live against a schema this reload chose not to touch. The empty-target
  // branch is for a config that genuinely declares nothing; a config whose
  // entities were all SKIPPED is a different state and must unwind.
  if (skippedComponentSlugs.size > 0 && componentTargets.length === 0) {
    logger?.warn(
      "[Nextly HMR] Every field group was deferred; abandoning this reload."
    );
    abandonReload();
    return;
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
    abandonReload();
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
  let deferredSchemaChange = skippedComponentSlugs.size > 0;
  // Which entities were deferred, as `<kind>:<slug>`. The flag above answers "may the
  // metadata-only sync run at all"; this answers "may THIS entity be provisioned", which is a
  // per-entity question — see `ensureLocalizedCompanionsForReload`.
  const deferredEntities = new Set<string>(
    // `fieldGroup:` — the prefix every other producer and consumer of this set
    // uses. A deferral recorded under a different key is not a deferral: the
    // localization helper checks membership and would carry on deriving the
    // obsolete name for an entity this reload deliberately skipped.
    [...skippedComponentSlugs].map(slug => `fieldGroup:${slug}`)
  );

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
        deferredEntities.add(`collection:${target.slug}`);
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
      deferredEntities.add(`collection:${target.slug}`);
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
        deferredEntities.add(`single:${target.slug}`);
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
      deferredEntities.add(`single:${target.slug}`);
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
        deferredEntities.add(`fieldGroup:${target.slug}`);
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
      deferredEntities.add(`fieldGroup:${target.slug}`);
    }
  }

  // No schema (DDL) changes to apply. Registry-only metadata (versions,
  // localized, status, labels, description) can still have changed, and it does
  // not surface as a schema diff — so run the idempotent metadata sync before
  // returning, otherwise a metadata-only edit (e.g. toggling `versions`) would
  // not persist until the dev server restarts.
  if (!hasChanges) {
    // Provisioning for the path where nothing is applied. It has to be INSIDE this branch: a
    // disable that needs DDL to put the main columns back reaches here before the apply has added
    // them, so a restore run now would find nothing to copy, copy nothing, and still record the
    // transition as finished — after which the post-apply pass skips it and the recreated columns
    // stay empty while the content sits in a companion nothing reads.
    //
    // A missing `_locales` table produces no schema diff either, because companion tables are
    // excluded from it, so `hasChanges` stays false and this is the only pass that repairs it.
    const noDdlProvisioning = await ensureLocalizedCompanionsForReload(
      adapter,
      newConfig,
      deferredEntities
    );

    // The same gate the post-apply path applies. A failed restore would otherwise reach
    // `syncCodeFirstMetadataOnly` below and publish the non-localized metadata anyway — pointing
    // reads at main while its values are still the pre-localization ones.
    if (noDdlProvisioning.restoreFailed.length > 0) {
      logger?.error(
        `[nextly] Localization stays on for ${noDdlProvisioning.restoreFailed.join(", ")}: their ` +
          `content could not be copied back out of the translations table. Fix the error above ` +
          `and save again — the content is intact where it is.`
      );
      abandonReload();
      return;
    }

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
      // The physical tables still match the PREVIOUS config, so the previous
      // field types are the ones that describe them.
      abandonReload();
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
      "fieldGroupRegistryService"
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

  // Before the apply, so an entity gaining localization has its existing content copied into the
  // companion while the main table still carries it. The apply's DROP of those columns is then a
  // cleanup rather than a loss, and it no longer matters whether the operator confirms it.
  const preservation = await ensureLocalizedCompanionsForReload(
    adapter,
    newConfig,
    deferredEntities,
    "beforeApply"
  );

  // The apply is what removes the translatable columns from the main table. Running it after a
  // copy that did not complete would take the only remaining copy of those values with it, and no
  // later resume could reconstruct them — introspection would no longer find the columns to read.
  // So the whole apply waits rather than proceeding entity by entity: the schema stays as it is,
  // the content stays where it is, and the next save retries the copy from a position that still
  // has everything.
  if (preservation.preservationFailed.length > 0) {
    const names = preservation.preservationFailed.join(", ");
    logger.error(
      `[nextly] Schema changes were not applied: existing content could not be copied into the ` +
        `translations table for ${names}. Applying now would drop the columns holding that ` +
        `content. Fix the error above and save again.`
    );
    return;
  }

  // The snapshot registered above was taken before the pass ran, and the pipeline reuses it rather
  // than introspecting again. A transition can relax a retained column — and on SQLite, which
  // cannot change nullability, it drops one — so an apply working from that snapshot re-emits a
  // DROP for a column that is already gone and fails. Dropping the cache costs one introspection,
  // and only in the cycle where a transition actually happened.
  if (preservation.schemaChanged) clearLiveSnapshots();

  const applyResult = await apply(desired, "code", {
    promptChannel: "terminal",
  });

  if (applyResult.success) {
    // Create the `_locales` companion of every localized entity, now that the apply
    // has produced their main tables. `next dev` routes config edits here rather
    // than through the CLI watcher, so without this an entity turned localized under
    // ordinary HMR had its companion registered in the runtime registry while the
    // database had no such table — non-default writes were then refused until a
    // restart. Runs after the apply because the companion carries a foreign key to
    // its main table, which a brand-new entity does not have before it.
    const postApply = await ensureLocalizedCompanionsForReload(
      adapter,
      newConfig,
      deferredEntities
    );

    // An entity whose content could not be copied back onto main is left alone, exactly as the
    // pre-apply pass leaves an entity whose content could not be copied INTO its companion.
    // Publishing the non-localized configuration now would point reads at main while its values
    // are still the pre-localization ones, let editors write on top of them, and then let a later
    // successful retry copy the companion's older values over those edits. The registry keeps
    // describing the entity as localized until the copy succeeds, so reads keep resolving through
    // the companion that still holds the content.
    if (postApply.restoreFailed.length > 0) {
      logger.error(
        `[nextly] Localization stays on for ${postApply.restoreFailed.join(", ")}: their content ` +
          `could not be copied back out of the translations table. Fix the error above and save ` +
          `again — the content is intact where it is.`
      );
      return;
    }

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
        "fieldGroupRegistryService"
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
      const fieldGroupSchemaService = new FieldGroupSchemaService(dialect);
      // The discriminator each component table actually carries, taken from the
      // batched snapshot this reload already read rather than probed again. That
      // snapshot covers every managed table including the component ones, so a
      // second introspection here would be a duplicate round trip on the HMR
      // path — and `chooseTypeColumns` needs nothing the snapshot does not hold.
      const componentTypeColumns = chooseTypeColumns(
        liveSnapshot.tables.map(table => ({
          table: table.name,
          columns: table.columns.map(column => column.name),
        })),
        Object.values(desiredComponents).map(comp => comp.tableName),
        // Asked of the server, never assumed: MySQL's table-name folding is
        // `lower_case_table_names`, which is server configuration, and a static
        // guess is wrong in one direction or the other on every server.
        await readIdentifierCaseRules(adapter)
      );
      for (const comp of Object.values(desiredComponents)) {
        // i18n: a localized component omits its translatable columns from the main
        // comp_ runtime table and registers the companion `comp_<slug>_locales` table.
        const localized = (comp as { localized?: boolean }).localized === true;
        const table = fieldGroupSchemaService.generateRuntimeSchema(
          comp.tableName,
          comp.fields,
          {
            localized,
            typeColumn:
              componentTypeColumns.get(comp.tableName) ??
              STORAGE_FORMAT.columns.type,
          }
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

    // The DDL never landed, so the live tables still match the previous config
    // and the previous field types are the ones that describe them. Same
    // reasoning as the deferred-diff branch above.
    abandonReload();

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

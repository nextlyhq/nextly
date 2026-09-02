// Tests for reloadNextlyConfig: the helper that drains an HMR reload flag
// and reapplies code-first schema state.
//
// F4 Option E PR 4 rewrite: the F1 preview gate is gone. Per-collection
// safety is decided by introspect+diff+rename-detector (the same code the
// pipeline runs internally). The mocks below pin introspectLiveSnapshot
// (called once with all desired tables) and let real
// buildDesiredTableFromFields + diffSnapshots run, so the test asserts
// the gate behavior against actual diff output. Pipeline is still mocked
// so we don't hit drizzle-kit.

import { readFileSync } from "node:fs";

import { getColumns } from "drizzle-orm";

import { buildDesiredTableFromFields } from "../../domains/schema/pipeline/diff/build-from-fields";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createLockingAdapter } from "../../domains/field-groups/migration/__tests__/helpers/locking-adapter";
import {
  hashManifest,
  MIGRATION_TARGET,
  type ManifestEntry,
} from "../../domains/field-groups/migration/manifest";
import { MIGRATION_MARKER_VERSION } from "../../domains/field-groups/migration/state";
import { STORAGE_FORMAT } from "../../schemas/storage-format";

/** The registry rename every run performs, spelled from the catalog so it stays a valid plan. */
const IN_FLIGHT_PLAN: ManifestEntry[] = [
  {
    kind: "registry",
    from: STORAGE_FORMAT.registryTable,
    to: MIGRATION_TARGET.registryTable,
  },
];
import {
  HookRegistry,
  getHookRegistry,
  setActiveHookRegistry,
} from "../../hooks/hook-registry";
import { setInitializedPlugins } from "../../plugins/initialized-plugins";
import { createPluginContext } from "../../plugins/plugin-context";

import type { BuildDesiredTableOptions } from "../../domains/schema/pipeline/diff/build-from-fields";
import type {
  ColumnSpec,
  NextlySchemaSnapshot,
} from "../../domains/schema/pipeline/diff/types";
import type { PromptDispatcher } from "../../domains/schema/pipeline/pushschema-pipeline-interfaces";

// vi.hoisted lets mock factories see these spies.
const {
  loadConfigSpy,
  clearConfigCacheSpy,
  pipelineCtorSpy,
  pipelineApplySpy,
  introspectSpy,
  warnSpy,
  errorSpy,
} = vi.hoisted(() => ({
  loadConfigSpy: vi.fn(),
  clearConfigCacheSpy: vi.fn(),
  pipelineCtorSpy: vi.fn(),
  pipelineApplySpy: vi.fn(),
  introspectSpy: vi.fn(),
  warnSpy: vi.fn(),
  errorSpy: vi.fn(),
}));

vi.mock("../../cli/utils/config-loader", () => ({
  loadConfig: loadConfigSpy,
  clearConfigCache: clearConfigCacheSpy,
}));

// Mock PushSchemaPipeline. The constructor records the deps object so
// tests can assert wiring (e.g., that the injected dispatcher actually
// arrives). apply() routes to its own spy.
vi.mock("../../domains/schema/pipeline/pushschema-pipeline", () => ({
  PushSchemaPipeline: class {
    constructor(deps: unknown) {
      pipelineCtorSpy(deps);
    }
    apply(args: unknown) {
      return pipelineApplySpy(args);
    }
  },
}));

// Mock the executor — constructor only needed (no method calls in this
// test path, since the pipeline mock above swallows the apply call).
vi.mock("../../domains/schema/services/drizzle-statement-executor", () => ({
  DrizzleStatementExecutor: class {
    executeStatements() {
      return Promise.resolve();
    }
  },
}));

// Pin live-DB introspection. Real buildDesiredTableFromFields and
// diffSnapshots run on top of whatever snapshot the test sets here.
vi.mock("../../domains/schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: introspectSpy,
}));

describe("reloadNextlyConfig", () => {
  beforeEach(() => {
    loadConfigSpy.mockReset();
    clearConfigCacheSpy.mockReset();
    pipelineCtorSpy.mockReset();
    pipelineApplySpy.mockReset();
    introspectSpy.mockReset();
    warnSpy.mockReset();
    errorSpy.mockReset();
    pipelineApplySpy.mockResolvedValue({
      success: true,
      statementsExecuted: 1,
      renamesApplied: 0,
    });
  });

  // Build a service resolver fake. Returns the service or undefined per
  // service name. Tests pass this into reloadNextlyConfig via opts.resolver.
  function buildResolver(opts?: {
    /** Catalog listing the reload probes to tell absent from unreadable. */
    catalogTables?: string[];
    /** Rows the field-group registry returns for `slug` / `table_name`. */
    registryRows?: Array<{ slug: string; table_name: string }>;
    withAdapter?: boolean;
    allCollections?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      status?: boolean;
      source?: string;
    }>;
    allSingles?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      status?: boolean;
      source?: string;
    }>;
    allComponents?: Array<{
      slug: string;
      tableName: string;
      fields?: unknown[];
      source?: string;
    }>;
    /** Force the metadata-only collection sync to reject, so its scope is unsynced. */
    failCollectionMetaSync?: boolean;
    /** Force the component field-tree sync to reject, so its scope is unsynced. */
    failComponentSync?: boolean;
    /** Seed a `nextly_meta` migration marker the storage guard will read. */
    migrationMarker?: unknown;
    /**
     * What the collection metadata sync REPORTS it rewrote.
     *
     * The real `syncCodeFirstCollections` answers a `SyncResult`, and the
     * reload reads its `updated` list to learn which existing rows it just
     * reset to `pending`. A fake resolving `{}` says "nothing was rewritten",
     * so a test about an EDITED collection has to state the report.
     */
    collectionSyncResult?: unknown;
  }) {
    const withAdapter = opts?.withAdapter ?? true;
    const lockDouble = createLockingAdapter({
      lockTableExists: false,
      marker: opts?.migrationMarker,
    });
    const syncCodeFirstComponentsSpy = opts?.failComponentSync
      ? vi.fn().mockRejectedValue(new Error("component sync failed"))
      : vi.fn().mockResolvedValue({});
    const registerDynamicSchemaSpy = vi.fn();
    const updateCollectionMigrationStatusSpy = vi
      .fn()
      .mockResolvedValue(undefined);
    const setCodeFirstSinglesSpy = vi.fn();
    const pruneCodeFirstSinglesSpy = vi.fn();
    const services: Record<string, unknown> = {
      logger: { warn: warnSpy, info: vi.fn(), error: errorSpy },
      // The DI key is "adapter" (renamed from "databaseAdapter" — see the
      // comment in reload-config.ts line ~205 for the history).
      // The reload holds the migration lock for its duration, so the fake has
      // to answer the whole exclusion rather than just the marker read. Shared
      // with the session's own suite so the two cannot drift into disagreeing
      // about what the lock does.
      adapter: withAdapter
        ? Object.assign(lockDouble.adapter, {
            dialect: "sqlite" as const,
            getCapabilities: () => ({ dialect: "sqlite" }),
            getDrizzle: lockDouble.adapter.getDrizzle.bind(lockDouble.adapter),
            // The reload resolves each field group's PHYSICAL table name from
            // the registry, and distinguishes "no registry" from "registry
            // unreadable" by listing the catalog. A double that cannot answer
            // that is indistinguishable from a database whose registry read
            // failed, which is the state the reload now refuses to guess past.
            listTables: vi.fn().mockResolvedValue(opts?.catalogTables ?? []),
            // The stored `slug → table_name` rows. Read through the adapter's
            // statement path so the three driver envelopes are normalised in
            // one place; the double answers the normalised shape.
            queryStatement: vi.fn().mockResolvedValue(opts?.registryRows ?? []),
          })
        : undefined,
      collectionRegistryService: {
        syncCodeFirstCollections: opts?.failCollectionMetaSync
          ? vi.fn().mockRejectedValue(new Error("meta sync failed"))
          : vi.fn().mockResolvedValue(opts?.collectionSyncResult ?? {}),
        // Mirrors CollectionRegistryService.getAllCollections — the DB-backed
        // list of every registered collection (code + UI). Defaults to empty.
        getAllCollections: vi
          .fn()
          .mockResolvedValue(opts?.allCollections ?? []),
        updateMigrationStatus: updateCollectionMigrationStatusSpy,
      },
      singleRegistryService: {
        syncCodeFirstSingles: vi.fn().mockResolvedValue({}),
        getAllSingles: vi.fn().mockResolvedValue(opts?.allSingles ?? []),
        setCodeFirstSingles: setCodeFirstSinglesSpy,
        pruneCodeFirstSingles: pruneCodeFirstSinglesSpy,
      },
      fieldGroupRegistryService: {
        syncCodeFirstComponents: syncCodeFirstComponentsSpy,
        getAllComponents: vi.fn().mockResolvedValue(opts?.allComponents ?? []),
      },
      schemaRegistry: {
        registerDynamicSchema: registerDynamicSchemaSpy,
      },
      migrationJournal: undefined,
    };
    return Object.assign((name: string) => services[name], {
      syncCodeFirstComponentsSpy,
      registerDynamicSchemaSpy,
      updateCollectionMigrationStatusSpy,
      setCodeFirstSinglesSpy,
      pruneCodeFirstSinglesSpy,
    });
  }

  // The live-database state a diff in this file starts from: the system
  // columns the schema builder injects for a table carrying no user fields.
  // Asked of `buildDesiredTableFromFields` with an empty field list, so it is
  // produced by the same builder the reload feeds its desired side from and
  // the two agree on the system columns by construction. A diff then reports
  // only the delta a test deliberately set up.
  //
  // Derived rather than written out because a written-out list cannot track
  // the builder: a new system column, or a default added to an existing one,
  // makes every fixture in the file disagree with the desired side, and that
  // disagreement surfaces as spurious operations on unrelated tests rather
  // than as a failure naming its cause.
  //
  // The table name is load-bearing — singles (`single_` prefix) get no owner
  // column — so the fixture is asked per table rather than shared.
  function reservedColumns(
    tableName: string,
    options: BuildDesiredTableOptions = { builtBy: "codeFirst" }
  ): ColumnSpec[] {
    return buildDesiredTableFromFields(tableName, [], "sqlite", options)
      .columns;
  }

  // Build a single-table NextlySchemaSnapshot for the introspect mock.
  // Multi-table snapshots use buildSnapshot() below.
  function liveSnapshot(
    table: string,
    columns: Array<{
      name: string;
      type: string;
      nullable?: boolean;
      default?: string;
    }>
  ): NextlySchemaSnapshot {
    return buildSnapshot([
      {
        name: table,
        columns,
      },
    ]);
  }

  function buildSnapshot(
    tables: Array<{
      name: string;
      columns: Array<{
        name: string;
        type: string;
        nullable?: boolean;
        default?: string;
      }>;
    }>
  ): NextlySchemaSnapshot {
    return {
      tables: tables.map(t => ({
        name: t.name,
        columns: t.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable ?? true,
          default: c.default,
        })),
      })),
    };
  }

  it("re-reads the config from disk on every call (clears the loader cache first)", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });
    expect(clearConfigCacheSpy).toHaveBeenCalledTimes(1);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
  });

  // `next dev` routes config edits here rather than through the CLI watcher, so
  // this is the schema-applying path most users are on. Mid-migration the
  // database has some tables under pre-rename names and some under post-rename
  // ones, and the apply below runs DDL plus a pre-cleanup that issues UPDATE and
  // DELETE — work that cannot be reasoned about against half-renamed storage.
  it("abandons the reload while a field-group migration is in flight", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    const resolver = buildResolver({
      // 🔴 `version` and `manifestHash` are DERIVED. Written out by hand, the marker is rejected as
      // unreadable before its status is read — and an unreadable marker abandons the reload too, so
      // this test passed while never reaching the in-flight check it is named for.
      migrationMarker: {
        version: MIGRATION_MARKER_VERSION,
        status: "migrating",
        direction: "up",
        migrationId: "run-1",
        step: 1,
        registryHash: "r",
        manifestHash: hashManifest(IN_FLIGHT_PLAN),
        appliedManifest: IN_FLIGHT_PLAN,
      },
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    // 🔴 The warning's REASON is matched, not just the fact that one was logged. A marker the
    // parser rejects abandons the reload and logs the same "schema reload skipped" prefix, so the
    // prefix alone cannot tell an in-flight migration from an unreadable marker — and for a while
    // this test was reporting the second while claiming the first.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("migration is in flight")
    );
  });

  it("introspects all desired tables in ONE batched call", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
          {
            slug: "users",
            tableName: "dc_users",
            fields: [{ name: "email", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        { name: "dc_posts", columns: reservedColumns("dc_posts") },
        { name: "dc_users", columns: reservedColumns("dc_users") },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(introspectSpy).toHaveBeenCalledTimes(1);
    const args = introspectSpy.mock.calls[0] as [unknown, string, string[]];
    expect(args[2]).toEqual(["dc_posts", "dc_users"]);
  });

  it("batches additive deltas into ONE PushSchemaPipeline.apply call with source 'code'", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", reservedColumns("dc_posts"))
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, unknown> };
      source: string;
      promptChannel: string;
    };
    expect(call.source).toBe("code");
    expect(call.promptChannel).toBe("terminal");
    expect(Object.keys(call.desired.collections)).toEqual(["posts"]);
  });

  it("preserves UI-created collections (registry-only) in the desired schema so a code-first apply never drops them", async () => {
    // User's exact scenario: a `test_collection` exists (created via the admin
    // UI, so it lives in the DB/registry but NOT in nextly.config.ts). The user
    // then adds `code_collection` in code. The HMR apply must include
    // test_collection in the desired schema, otherwise drizzle-kit (which, on
    // SQLite, introspects the whole DB) flags dc_test_collection as a
    // data-losing orphan DROP and the apply fails.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "code_collection",
            tableName: "dc_code_collection",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    // Live DB has neither code table yet → dc_code_collection is a new table.
    introspectSpy.mockResolvedValue(buildSnapshot([]));

    const resolver = buildResolver({
      allCollections: [
        // The new code collection (already covered by the config loop).
        {
          slug: "code_collection",
          tableName: "dc_code_collection",
          fields: [{ name: "body", type: "text" }],
        },
        // The pre-existing UI collection — must be preserved.
        {
          slug: "test_collection",
          tableName: "dc_test_collection",
          fields: [{ name: "note", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { collections: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.collections);
    expect(keys).toContain("code_collection"); // the code change itself
    expect(keys).toContain("test_collection"); // UI collection PRESERVED
    expect(call.desired.collections.test_collection?.tableName).toBe(
      "dc_test_collection"
    );
  });

  it("marks a newly-created code-first collection as 'applied' after a successful apply", async () => {
    // User's bug: a collection added in code AFTER initial DB setup gets its
    // table created by the HMR apply, but registerCollection defaults
    // migration_status to 'pending' and nothing flips it — so the builder
    // listing shows "pending" forever. Mirrors the singles branch.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "books",
            tableName: "dc_books",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    // dc_books absent from the live DB → it's a brand-new table.
    introspectSpy.mockResolvedValue(buildSnapshot([]));

    const resolver = buildResolver();
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    expect(resolver.updateCollectionMigrationStatusSpy).toHaveBeenCalledWith(
      "books",
      "applied"
    );
  });

  it("marks an EDITED code-first collection as 'applied' after a successful apply", async () => {
    // The other half of the same bug. `updateCollection` resets an existing
    // row's migration_status to 'pending' whenever the fields change, and the
    // DDL for that change is what the apply just performed -- but the table was
    // present before the apply, so the pre-pipeline `liveByTable` snapshot
    // cannot tell that its migration is done. The row then reports an
    // outstanding migration for a table already at the new shape, and the
    // widget source refresh (which reads migration_status to decide whether a
    // collection can be queried) withdraws that collection's generated cards
    // for the rest of the dev session.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "books",
            tableName: "dc_books",
            fields: [{ name: "title", type: "text" }],
          },
        ],
      },
    });
    // dc_books ALREADY EXISTS and is missing the new column -- an ALTER of a
    // live table, which is the case the snapshot branch cannot see.
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        { name: "dc_books", columns: reservedColumns("dc_books") },
      ])
    );

    const resolver = buildResolver({
      collectionSyncResult: { created: [], updated: ["books"], unchanged: [] },
    });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    expect(resolver.updateCollectionMigrationStatusSpy).toHaveBeenCalledWith(
      "books",
      "applied"
    );
  });

  it("leaves an UNCHANGED collection's migration status alone", async () => {
    // The control the assertion above needs: marking every target 'applied'
    // would pass that test too, and would overwrite a status that legitimately
    // says a migration is outstanding. Only the rows the sync REPORTS it
    // rewrote are re-marked.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "books",
            tableName: "dc_books",
            fields: [{ name: "title", type: "text" }],
          },
          {
            slug: "authors",
            tableName: "dc_authors",
            fields: [{ name: "name", type: "text" }],
          },
        ],
      },
    });
    // BOTH tables already exist, so neither is caught by the snapshot branch.
    introspectSpy.mockResolvedValue(
      buildSnapshot([
        { name: "dc_books", columns: reservedColumns("dc_books") },
        { name: "dc_authors", columns: reservedColumns("dc_authors") },
      ])
    );

    const resolver = buildResolver({
      collectionSyncResult: {
        created: [],
        updated: ["books"],
        unchanged: ["authors"],
      },
    });
    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(resolver.updateCollectionMigrationStatusSpy).toHaveBeenCalledWith(
      "books",
      "applied"
    );
    expect(
      resolver.updateCollectionMigrationStatusSpy
    ).not.toHaveBeenCalledWith("authors", "applied");
  });

  it("preserves UI-created singles (registry-only) in the desired schema", async () => {
    // A code change (new single) triggers the apply; a pre-existing UI single
    // must ride along in the desired schema so drizzle-kit doesn't drop it.
    loadConfigSpy.mockResolvedValue({
      config: {
        singles: [
          { slug: "settings", fields: [{ name: "site_name", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(buildSnapshot([])); // single_settings is new

    const resolver = buildResolver({
      allSingles: [
        {
          slug: "settings",
          tableName: "single_settings",
          fields: [{ name: "site_name", type: "text" }],
        },
        {
          slug: "ui_single",
          tableName: "single_ui_single",
          fields: [{ name: "x", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { singles: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.singles);
    expect(keys).toContain("settings"); // code change
    expect(keys).toContain("ui_single"); // UI single PRESERVED
  });

  it("preserves UI-created components (registry-only) in the desired schema", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        fieldGroups: [
          { slug: "hero", fields: [{ name: "title", type: "text" }] },
        ],
      },
    });
    introspectSpy.mockResolvedValue(buildSnapshot([])); // comp_hero is new

    const resolver = buildResolver({
      allComponents: [
        {
          slug: "hero",
          tableName: "comp_hero",
          fields: [{ name: "title", type: "text" }],
        },
        {
          slug: "ui_comp",
          tableName: "comp_ui_comp",
          fields: [{ name: "y", type: "text" }],
          source: "ui",
        },
      ],
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    const call = pipelineApplySpy.mock.calls[0]?.[0] as {
      desired: { components: Record<string, { tableName: string }> };
    };
    const keys = Object.keys(call.desired.components);
    expect(keys).toContain("hero"); // code change
    expect(keys).toContain("ui_comp"); // UI component PRESERVED
  });

  it("lets a drop+add pair (rename candidate) flow through to the pipeline", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    // Live has `body text`; desired has `summary text`. Same type family
    // -> rename candidate -> gate lets it through.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...reservedColumns("dc_posts"),
        { name: "body", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("passes a standalone drop through to the pipeline (destructive_drop event handled by ClassifierEvent + dispatcher)", async () => {
    // The HMR gate used to block standalone drops because the pipeline
    // had no destructive-confirm event for them. Now drop_column
    // emits a destructive_drop ClassifierEvent that the dispatcher
    // prompts on, so the HMR layer just hands off.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            fields: [],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_users", [
        ...reservedColumns("dc_users"),
        { name: "phone", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
    // No "needs review" warning — the pipeline's dispatcher owns the
    // confirmation UX now.
    const blockingWarning = warnSpy.mock.calls
      .map(c => c[0] as string)
      .find(s => s.includes("needs review"));
    expect(blockingWarning).toBeUndefined();
  });

  it("passes asymmetric drop+add (drops > adds) through to the pipeline", async () => {
    // Previously gated at the HMR layer. The pipeline's shrinking-pool
    // prompt now handles the rename ambiguity for the paired columns,
    // and surplus drops emit destructive_drop events.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "users",
            tableName: "dc_users",
            fields: [{ name: "mobile", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_users", [
        ...reservedColumns("dc_users"),
        { name: "phone", type: "text", nullable: true },
        { name: "fax", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
  });

  it("skips a column type change and logs a warning", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            // `checkbox` is the field type that classifies as a boolean
            // column, which renders as the SQLite `integer` token and so
            // differs from the live `text` -> change_column_type op.
            fields: [{ name: "active", type: "checkbox" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...reservedColumns("dc_posts"),
        { name: "active", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warningArg = warnSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("active");
    expect(warningArg).toContain("type");
  });

  it("passes a 3-drop / 1-add asymmetric change through to the pipeline", async () => {
    // The pipeline's rename detector pairs the 1 add against one of the
    // drops via the shrinking-pool prompt; the other 2 drops emit
    // destructive_drop ClassifierEvents that the dispatcher prompts on.
    // The HMR layer no longer pre-blocks asymmetric edits.
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...reservedColumns("dc_posts"),
        { name: "body", type: "text", nullable: true },
        { name: "tagline", type: "text", nullable: true },
        { name: "byline", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
  });

  it("skips collections that have no changes (diff returns empty)", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    // Live state already matches desired -> no operations.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...reservedColumns("dc_posts"),
        { name: "body", type: "text", nullable: true },
      ])
    );

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
  });

  it("does not crash when the database adapter is unavailable from DI", async () => {
    loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
    const { reloadNextlyConfig } = await import("../reload-config");
    await expect(
      reloadNextlyConfig({
        resolver: buildResolver({ withAdapter: false }),
      })
    ).resolves.toBeUndefined();
  });

  it("aborts (no pipeline call) and logs error when batched introspect fails", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockRejectedValue(new Error("connection refused"));

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(pipelineApplySpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const errorArg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorArg).toContain("introspect");
    expect(errorArg).toContain("connection refused");
  });

  it("logs an error if the batch pipeline call returns a non-TTY-related failure", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", reservedColumns("dc_posts"))
    );
    pipelineApplySpy.mockResolvedValue({
      success: false,
      statementsExecuted: 0,
      renamesApplied: 0,
      error: { code: "PUSHSCHEMA_FAILED", message: "drizzle-kit error" },
    });

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(errorSpy).toHaveBeenCalled();
    const errorArg = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorArg).toContain("PUSHSCHEMA_FAILED");
    expect(errorArg).toContain("drizzle-kit error");
  });

  it("logs a WARN (not error) when the pipeline reports CONFIRMATION_REQUIRED_NO_TTY", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "summary", type: "text" }],
          },
        ],
      },
    });
    // drop body + add summary = rename candidate -> gate lets through ->
    // pipeline runs, dispatcher would prompt, but sim a non-TTY result.
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", [
        ...reservedColumns("dc_posts"),
        { name: "body", type: "text", nullable: true },
      ])
    );
    pipelineApplySpy.mockResolvedValue({
      success: false,
      statementsExecuted: 0,
      renamesApplied: 0,
      error: {
        code: "CONFIRMATION_REQUIRED_NO_TTY",
        message: "TTY required for schema confirmation",
      },
    });

    // The CONFIRMATION_REQUIRED_NO_TTY path uses console.warn (not
    // logger.warn) to surface a top-level, scannable instruction in the
    // dev terminal without a logger prefix.
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({ resolver: buildResolver() });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    const warningArg = consoleSpy.mock.calls[0]?.[0] as string;
    expect(warningArg).toContain("confirmation");

    consoleSpy.mockRestore();
  });

  it("passes the injected dispatcher straight into the pipeline", async () => {
    loadConfigSpy.mockResolvedValue({
      config: {
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields: [{ name: "body", type: "text" }],
          },
        ],
      },
    });
    introspectSpy.mockResolvedValue(
      liveSnapshot("dc_posts", reservedColumns("dc_posts"))
    );

    const fakeDispatcher: PromptDispatcher = {
      dispatch: () =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: [],
          proceed: true,
        }),
    };

    const { reloadNextlyConfig } = await import("../reload-config");
    await reloadNextlyConfig({
      resolver: buildResolver(),
      dispatcher: fakeDispatcher,
    });

    expect(pipelineCtorSpy).toHaveBeenCalledTimes(1);
    const deps = pipelineCtorSpy.mock.calls[0]?.[0] as {
      promptDispatcher: PromptDispatcher;
    };
    expect(deps.promptDispatcher).toBe(fakeDispatcher);
  });

  describe("component support", () => {
    it("includes component table names in the batched introspect call", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "hero", fields: [{ name: "title", type: "text" }] },
            {
              slug: "seo-meta",
              fields: [{ name: "description", type: "text" }],
            },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_hero", columns: reservedColumns("comp_hero") },
          { name: "comp_seo_meta", columns: reservedColumns("comp_seo_meta") },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(introspectSpy).toHaveBeenCalledTimes(1);
      const tableNames = (
        introspectSpy.mock.calls[0] as [unknown, string, string[]]
      )[2];
      expect(tableNames).toContain("comp_hero");
      expect(tableNames).toContain("comp_seo_meta");
    });

    it("normalises slug to comp_<snake_case> table name (hyphens → underscores)", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "seo-meta", fields: [{ name: "title", type: "text" }] },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_seo_meta", columns: reservedColumns("comp_seo_meta") },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      const tableNames = (
        introspectSpy.mock.calls[0] as [unknown, string, string[]]
      )[2];
      expect(tableNames).toContain("comp_seo_meta");
      expect(tableNames).not.toContain("comp_seo-meta");
    });

    it("flows an additive component field change through to the pipeline", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
          ],
        },
      });
      // Live table exists with only reserved columns — subtitle is a new add.
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_hero", columns: reservedColumns("comp_hero") },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      const call = pipelineApplySpy.mock.calls[0]?.[0] as {
        desired: { components: Record<string, unknown> };
      };
      expect(Object.keys(call.desired.components)).toContain("hero");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("refreshes the comp_* runtime schema with component link columns, not document title/slug", async () => {
      // Regression: the HMR refresh rebuilt comp_* runtime descriptors with the
      // collection/single generator (id/title/slug, no _parent_id), clobbering
      // the correct boot-time registration. Component reads filter by _parent_id
      // and writes insert the _parent_* columns, so a descriptor missing them
      // makes every save of a document embedding the component fail with a 500.
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            {
              slug: "meta-data",
              fields: [{ name: "metaTitle", type: "text" }],
            },
          ],
        },
      });
      // metaTitle is absent from the live table, so the diff is an additive
      // change: hasChanges flips true and the refresh block re-registers the
      // runtime descriptor (the code path that used the wrong generator).
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: "comp_meta_data",
            columns: reservedColumns("comp_meta_data"),
          },
        ])
      );

      const resolver = buildResolver();
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver });

      const registered = resolver.registerDynamicSchemaSpy.mock.calls.find(
        call => call[0] === "comp_meta_data"
      );
      expect(
        registered,
        "comp_meta_data must be re-registered after an HMR refresh"
      ).toBeTruthy();
      const columns = Object.keys(getColumns(registered![1] as never));
      // Component link columns the query/mutation services depend on.
      expect(columns).toContain("_parent_id");
      expect(columns).toContain("_parent_table");
      expect(columns).toContain("_parent_field");
      expect(columns).toContain("_order");
      // Document base columns must never leak onto a component table.
      expect(columns).not.toContain("title");
      expect(columns).not.toContain("slug");
    });

    it("passes a standalone drop on a component table through to the pipeline", async () => {
      // Same behavior as the collection/single equivalent: the
      // pipeline classifier emits a destructive_drop event and the
      // dispatcher prompts the user. HMR layer no longer pre-blocks.
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "hero", fields: [] }, // removed `headline` field
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: "comp_hero",
            columns: [
              ...reservedColumns("comp_hero"),
              { name: "headline", type: "text", nullable: true },
            ],
          },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      const blockingWarning = warnSpy.mock.calls
        .map(c => c[0] as string)
        .find(s => s.includes("needs review"));
      expect(blockingWarning).toBeUndefined();
    });

    it("calls syncCodeFirstComponents after a successful apply", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            {
              slug: "hero",
              label: { singular: "Hero" },
              fields: [{ name: "subtitle", type: "text" }],
            },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_hero", columns: reservedColumns("comp_hero") },
        ])
      );

      const resolver = buildResolver();
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver });

      expect(resolver.syncCodeFirstComponentsSpy).toHaveBeenCalledTimes(1);
      const configs = resolver.syncCodeFirstComponentsSpy.mock
        .calls[0]?.[0] as Array<{ slug: string; label: string }>;
      expect(configs[0]?.slug).toBe("hero");
      expect(configs[0]?.label).toBe("Hero");
    });

    it("calls registerDynamicSchema for the component table after a successful apply", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "hero", fields: [{ name: "subtitle", type: "text" }] },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "comp_hero", columns: reservedColumns("comp_hero") },
        ])
      );

      const resolver = buildResolver();
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver });

      expect(resolver.registerDynamicSchemaSpy).toHaveBeenCalledWith(
        "comp_hero",
        expect.anything()
      );
    });

    it("does not call the pipeline when all component diffs are empty", async () => {
      loadConfigSpy.mockResolvedValue({
        config: {
          fieldGroups: [
            { slug: "hero", fields: [{ name: "title", type: "text" }] },
          ],
        },
      });
      // Live already matches desired.
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: "comp_hero",
            columns: [
              ...reservedColumns("comp_hero"),
              { name: "title", type: "text", nullable: true },
            ],
          },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(pipelineApplySpy).not.toHaveBeenCalled();
    });
  });

  describe("webhook recording policy reconciliation", () => {
    it("prunes a removed code-first opt-out when the config empties out", async () => {
      const {
        setWebhookRecording,
        isWebhookRecordingEnabled,
        resetWebhookRecordingPolicy,
      } = await import("../../domains/webhooks/recording-policy");
      resetWebhookRecordingPolicy();
      // A code-first Single/collection previously opted OUT of recording. It is
      // then deleted from the config, so this reload sees zero managed targets
      // and takes the empty-target early return.
      setWebhookRecording("collection", "leads", false, "code");
      setWebhookRecording("single", "settings", false, "code");
      // A plugin opt-out must survive the code-first reconcile untouched.
      setWebhookRecording("collection", "form-submissions", false, "plugin");
      loadConfigSpy.mockResolvedValue({
        config: { collections: [], singles: [], components: [] },
      });

      const { reloadNextlyConfig } = await import("../reload-config");
      const resolver = buildResolver();
      await reloadNextlyConfig({ resolver });

      // The removed code-first entities revert to the default (record)...
      expect(isWebhookRecordingEnabled("collection", "leads")).toBe(true);
      expect(isWebhookRecordingEnabled("single", "settings")).toBe(true);
      // ...while the plugin opt-out is preserved.
      expect(isWebhookRecordingEnabled("collection", "form-submissions")).toBe(
        false
      );
      // The live default snapshot is pruned to the (now empty) present set so a
      // removed single's function defaults can't run from a stale snapshot.
      expect(resolver.pruneCodeFirstSinglesSpy).toHaveBeenCalledWith(new Set());
      resetWebhookRecordingPolicy();
    });

    it("applies a new opt-out even when the metadata sync fails, but gates opt-ins", async () => {
      const {
        setWebhookRecording,
        isWebhookRecordingEnabled,
        resetWebhookRecordingPolicy,
      } = await import("../../domains/webhooks/recording-policy");
      resetWebhookRecordingPolicy();
      // `posts` carries a stale opt-out from a previous decision; the reload now
      // wants it to record again (an opt-IN). `leads` is newly set to
      // `webhooks: false` (an opt-OUT). Both diffs are zero-op, so the reload
      // takes the metadata-only path — where the collection sync then FAILS,
      // leaving that scope unsynced.
      setWebhookRecording("collection", "posts", false, "code");
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            { slug: "posts", tableName: "dc_posts" },
            { slug: "leads", tableName: "dc_leads", webhooks: false },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "dc_posts", columns: reservedColumns("dc_posts") },
          { name: "dc_leads", columns: reservedColumns("dc_leads") },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({
        resolver: buildResolver({ failCollectionMetaSync: true }),
      });

      // The opt-OUT applies despite the failed sync — recording off builds no
      // payload, so the stale field tree is irrelevant, and holding it back would
      // keep leaking the newly private collection's events.
      expect(isWebhookRecordingEnabled("collection", "leads")).toBe(false);
      // The opt-IN is gated: `posts` keeps its stale opt-out until a clean sync,
      // so payload expansion never runs against a field tree that failed to sync.
      expect(isWebhookRecordingEnabled("collection", "posts")).toBe(false);
      resetWebhookRecordingPolicy();
    });

    it("keeps a plugin-contributed opt-out through a code-first reconcile, without admin.isPlugin", async () => {
      const { isWebhookRecordingEnabled, resetWebhookRecordingPolicy } =
        await import("../../domains/webhooks/recording-policy");
      resetWebhookRecordingPolicy();
      // A plugin contributes an opted-out collection via `contributes.collections`
      // and does NOT set the optional `admin.isPlugin` presentation flag. The
      // folded reload config lists it (loadConfig folds contributions) AND the
      // plugin list, so provenance is derived from the contribution — not the
      // flag — and the prune must never touch it.
      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "audit",
              contributes: { collections: [{ slug: "audit-log" }] },
            },
          ],
          collections: [
            { slug: "posts", tableName: "dc_posts" },
            { slug: "audit-log", tableName: "dc_audit_log", webhooks: false },
          ],
        },
      });
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          { name: "dc_posts", columns: reservedColumns("dc_posts") },
          { name: "dc_audit_log", columns: reservedColumns("dc_audit_log") },
        ])
      );

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      // The plugin's opt-out is honored and survives the reconcile...
      expect(isWebhookRecordingEnabled("collection", "audit-log")).toBe(false);
      // ...while the plain code collection records by default.
      expect(isWebhookRecordingEnabled("collection", "posts")).toBe(true);
      resetWebhookRecordingPolicy();
    });

    it("applies a new opt-out even when live introspection throws", async () => {
      const { isWebhookRecordingEnabled, resetWebhookRecordingPolicy } =
        await import("../../domains/webhooks/recording-policy");
      resetWebhookRecordingPolicy();
      // A live reload sets a nonempty collection to `webhooks: false`, but the
      // batched `introspectLiveSnapshot` throws (a transient DB blip). The reload
      // event is already consumed, so if the opt-out were published only after a
      // successful sync it would never take effect until a restart. Opt-outs are
      // published BEFORE introspection, so this one stops recording immediately.
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            { slug: "leads", tableName: "dc_leads", webhooks: false },
          ],
        },
      });
      introspectSpy.mockRejectedValue(new Error("connection reset"));

      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      // Introspection failed, so no schema was applied...
      expect(pipelineApplySpy).not.toHaveBeenCalled();
      // ...but the opt-out took effect anyway.
      expect(isWebhookRecordingEnabled("collection", "leads")).toBe(false);
      resetWebhookRecordingPolicy();
    });
  });

  /**
   * 🔴 The reload must address a field group's STORED table name.
   *
   * `resolveComponentTableName` answers what this release's creator WOULD name a
   * table; the registry records what it is actually called. They differ for an
   * author-chosen `dbName` and, after the storage migration, for every field
   * group. Deriving the name makes the diff miss the populated table, read the
   * component as new, and create an empty one beside it — silently, and looking
   * exactly like content loss.
   */

  // A config reload has to refresh the hooks the config declares. The registry
  // holds the function objects registered at boot, so without this an edited
  // hook keeps its old body and a deleted one keeps firing until restart.
  describe("declared hooks", () => {
    const SLUG = "hookposts";
    const TABLE = "dc_hookposts";
    const SINGLE_SLUG = "hooksettings";
    const SINGLE_KEY = `single:${SINGLE_SLUG}`;

    /**
     * The services a plugin context resolves at construction. None are reached
     * by the hook methods, but they are resolved eagerly.
     */
    const stubServices = ((name: string) => {
      switch (name) {
        case "logger":
          return {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          };
        case "config":
          return { plugins: [] };
        default:
          return {};
      }
    }) as unknown as Parameters<typeof createPluginContext>[0];

    const PLUGIN = {
      name: "form-builder",
      version: "1.0.0",
      // Boot-checked core-compatibility range; required on every definition.
      nextly: "*",
    };

    /** A collection whose live table already matches, so the reload lands. */
    function settledCollection(hooks?: unknown) {
      return {
        slug: SLUG,
        tableName: TABLE,
        fields: [{ name: "body", type: "text" }],
        ...(hooks ? { hooks } : {}),
      };
    }

    function settleIntrospect() {
      introspectSpy.mockResolvedValue(
        liveSnapshot(TABLE, [
          ...reservedColumns(TABLE),
          { name: "body", type: "text", nullable: true },
        ])
      );
    }

    beforeEach(() => {
      const registry = getHookRegistry();
      registry.clearCollection(SLUG);
      registry.clearCollection(SINGLE_KEY);
      registry.clearCollection("posts");
      registry.clearCollection("notes");
      // Suspension is registry-wide, so it leaks between tests exactly as the
      // handler maps would.
      registry.setSuspendedOwners([]);
      // Boot state the reload reads; each test sets what it needs.
      setInitializedPlugins([
        "form-builder",
        "toggling-plugin",
        "enabled-plugin",
      ]);
      settleIntrospect();
    });

    it("replaces a collection hook the config changed", async () => {
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [original] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      // The control: the first reload registered, so what follows is about
      // replacement rather than about nothing ever arriving.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [edited] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      // One, not two: appending would leave the previous handler in place,
      // which is the shape of the bug -- the edited hook appears to work while
      // the handler the author deleted goes on running ahead of it.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(edited).toHaveBeenCalledTimes(1);
      expect(original).not.toHaveBeenCalled();
    });

    it("stops running a hook the config removed", async () => {
      const registry = getHookRegistry();
      const removed = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [removed] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection()] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
    });

    it("keeps a plugin's handler on the same collection", async () => {
      // The hazard the selective clear exists for: the form builder registers
      // straight into a collection's namespace, its `init` belongs to service
      // registration rather than to the reload, and nothing else knows how to
      // put the handler back.
      const registry = getHookRegistry();
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      const fromPlugin = vi.fn(() => undefined);
      ctx.hooks.on("afterRead", SLUG, fromPlugin);

      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(2);
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(fromPlugin).toHaveBeenCalledTimes(1);
    });

    it("keeps a plugin's handler on a single too", async () => {
      // Two call sites: making the collection clear selective and leaving the
      // single one wholesale reads as done and still wipes.
      const registry = getHookRegistry();
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      const fromPlugin = vi.fn(() => undefined);
      ctx.hooks.on("afterRead", SINGLE_KEY, fromPlugin);

      loadConfigSpy.mockResolvedValue({
        config: {
          singles: [
            {
              slug: SINGLE_SLUG,
              fields: [{ name: "site_name", type: "text" }],
              hooks: { afterRead: [() => undefined] },
            },
          ],
        },
      });
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SINGLE_KEY)).toBe(2);
      await registry.execute("afterRead", {
        collection: SINGLE_KEY,
        operation: "read",
        data: {},
        context: {},
      });
      expect(fromPlugin).toHaveBeenCalledTimes(1);
    });

    it("does not register hooks for a disabled plugin's entities", async () => {
      // A disabled plugin's entities stay in the config so the schema stays
      // deterministic, but its runtime behaviour must not run.
      const registry = getHookRegistry();
      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "disabled-plugin",
              enabled: false,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
    });

    it("still registers an ENABLED plugin's entities", async () => {
      // The mirror. Without it, a filter that excluded every plugin-contributed
      // entity would look correct, and so would registering nothing at all.
      const registry = getHookRegistry();
      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "enabled-plugin",
              enabled: true,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      const { reloadNextlyConfig } = await import("../reload-config");
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    });

    it("clears the hooks of a plugin that has just been disabled", async () => {
      // The transition, which the steady state above does not cover: the
      // plugin's declarations registered under the config's own ownership while
      // it was enabled, so leaving its slug out of the re-registration would
      // stop new handlers being added and remove nothing -- the plugin would go
      // on running after being switched off.
      const registry = getHookRegistry();
      const whileEnabled = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "toggling-plugin",
              enabled: true,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [whileEnabled] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "toggling-plugin",
              enabled: false,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [whileEnabled] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
    });

    it("stops running the hooks of a collection removed from the config", async () => {
      // A removed code-first entity is RETAINED rather than dropped -- only
      // `nextly prune` removes an orphan -- so it stays addressable and would
      // go on running a hook that no longer exists in nextly.config.ts. Merely
      // leaving it out of the re-registration removes nothing.
      const registry = getHookRegistry();
      const orphaned = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [orphaned] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
    });

    it("leaves a plugin's handler on a removed collection alone", async () => {
      // The sweep removes what the config can rebuild and nothing else. A
      // plugin's registration is not rebuildable by a reload, so removing the
      // collection from the config must not take it too.
      const registry = getHookRegistry();
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      const fromPlugin = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      ctx.hooks.on("afterRead", SLUG, fromPlugin);
      expect(registry.getHookCount("afterRead", SLUG)).toBe(2);

      loadConfigSpy.mockResolvedValue({ config: { collections: [] } });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(fromPlugin).toHaveBeenCalledTimes(1);
    });

    it("writes to the registry service registration bound, not the global one", async () => {
      // A caller may supply its own registry, and that is where the live
      // handlers went. Replacing them in the global singleton instead would
      // leave the active registry running the handler the edit removed while
      // the edited one sits where no service will reach it.
      const active = new HookRegistry();
      setActiveHookRegistry(active);
      try {
        const edited = vi.fn(() => undefined);
        loadConfigSpy.mockResolvedValue({
          config: { collections: [settledCollection({ afterRead: [edited] })] },
        });
        const { reloadNextlyConfig } = await import("../reload-config");
        await reloadNextlyConfig({ resolver: buildResolver() });

        expect(active.getHookCount("afterRead", SLUG)).toBe(1);
        // And it did not go to the singleton, which is the instance it would
        // have reached before.
        expect(getHookRegistry().getHookCount("afterRead", SLUG)).toBe(0);
      } finally {
        setActiveHookRegistry(undefined);
      }
    });

    it("commits on the no-DDL landing, which is the hook-only edit's path", async () => {
      // The path a save that changes ONLY a hook takes: the live table already
      // matches, so there is no diff, no apply, and the reload returns from the
      // no-changes branch. That branch published nothing, so the edit staged a
      // replacement and never applied it -- the central case of this change,
      // silently not working.
      //
      // Reaching it needs the collection to be KNOWN to the registry; a slug the
      // resolver has never seen reads as new and takes the apply path instead,
      // which is why the tests above did not cover this.
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const fields = [{ name: "body", type: "text" }];
      const noDiff = (hook: () => undefined) => ({
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields,
            hooks: { afterRead: [hook] },
          },
        ],
      });
      // Built with the same builder the reload uses, rather than hand-listing
      // the system columns. A hand-written list drifts the moment a system
      // column is added -- which is exactly why the neighbouring no-change
      // fixtures are currently red -- and a stale one silently turns this into
      // an apply-path test again.
      introspectSpy.mockResolvedValue({
        tables: [
          buildDesiredTableFromFields("dc_posts", fields, "sqlite", {
            builtBy: "codeFirst" as const,
            hasStatus: false,
            localized: false,
          }),
        ],
      } as NextlySchemaSnapshot);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({ config: noDiff(original) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", "posts")).toBe(1);

      pipelineApplySpy.mockClear();
      loadConfigSpy.mockResolvedValue({ config: noDiff(edited) });
      await reloadNextlyConfig({ resolver: buildResolver() });

      // The control that this is the branch under test: no DDL was applied, so
      // a commit that only ran after an apply would not have run at all.
      expect(pipelineApplySpy).not.toHaveBeenCalled();

      expect(registry.getHookCount("afterRead", "posts")).toBe(1);
      await registry.execute("afterRead", {
        collection: "posts",
        operation: "read",
        data: {},
        context: {},
      });
      expect(edited).toHaveBeenCalledTimes(1);
      expect(original).not.toHaveBeenCalled();
    });

    it("stops a plugin deleted from the config, and does not resume a disabled one", async () => {
      // Deleting a plugin is not the same edit as disabling it, and the config
      // cannot describe what it no longer contains: a suspension set derived
      // from the new plugin list alone can never name a deleted plugin, so it
      // would keep running -- and deleting one that was already disabled would
      // actively bring it back.
      const registry = getHookRegistry();
      const fromPlugin = vi.fn(() => undefined);
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      ctx.hooks.on("afterRead", SLUG, fromPlugin);
      const { reloadNextlyConfig } = await import("../reload-config");

      const withPlugins = (plugins: unknown[]) => ({
        plugins,
        collections: [settledCollection()],
      });
      const read = async () =>
        registry.execute("afterRead", {
          collection: SLUG,
          operation: "read",
          data: {},
          context: {},
        });

      loadConfigSpy.mockResolvedValue({
        config: withPlugins([{ name: PLUGIN.name, enabled: true }]),
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      await read();
      // The control: it runs while the plugin is there.
      expect(fromPlugin).toHaveBeenCalledTimes(1);

      // Disabled, then deleted outright. The second edit must not undo the
      // first.
      loadConfigSpy.mockResolvedValue({
        config: withPlugins([{ name: PLUGIN.name, enabled: false }]),
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      loadConfigSpy.mockResolvedValue({ config: withPlugins([]) });
      await reloadNextlyConfig({ resolver: buildResolver() });

      fromPlugin.mockClear();
      await read();
      expect(fromPlugin).not.toHaveBeenCalled();
    });

    it("leaves plugin owners alone when the config declares no plugin list", async () => {
      // An absent `plugins` key is no information. Reading it as "every plugin
      // is gone" would suspend the lot on any config that simply does not
      // mention them, which is a far worse failure than the one above.
      const registry = getHookRegistry();
      const fromPlugin = vi.fn(() => undefined);
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      ctx.hooks.on("afterRead", SLUG, fromPlugin);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection()] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(fromPlugin).toHaveBeenCalledTimes(1);
    });

    it("puts a newly declared config hook ahead of a late app hook", async () => {
      // With no previous config entry there is no position to preserve, and
      // appending would order the same edit differently depending on whether
      // the process restarted: a restart registers the config during
      // registerServices, before an app module evaluates.
      const registry = getHookRegistry();
      const order: string[] = [];
      const { reloadNextlyConfig } = await import("../reload-config");

      // No config hook for this phase yet, then an app registers one.
      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection()] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      registry.register("afterRead", SLUG, () => void order.push("app"));
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      // The config declares one for the first time.
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            settledCollection({ afterRead: [() => void order.push("config")] }),
          ],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      order.length = 0;
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(order).toEqual(["config", "app"]);
    });

    it("holds hooks back when the metadata sync fails after the DDL", async () => {
      // The DDL lands but the field-tree metadata does not, and the surrounding
      // code deliberately leaves the mutation services reading their previous
      // serialized fields. A handler published against the new config would
      // then supply a field that serialization still ignores.
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [original] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      // The control: a healthy reload installs it, so the assertion below is
      // about the sync failure rather than about nothing ever arriving.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [edited] })] },
      });
      await reloadNextlyConfig({
        resolver: buildResolver({ failCollectionMetaSync: true }),
      });

      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(original).toHaveBeenCalledTimes(1);
      expect(edited).not.toHaveBeenCalled();
    });

    it("holds hooks back when a metadata-only sync fails", async () => {
      // The no-DDL path has its own sync, and it keeps the prior snapshot for
      // whatever it could not persist -- so those entities still validate and
      // serialize against the old field tree, exactly as on the post-DDL path.
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const fields = [{ name: "body", type: "text" }];
      const noDiff = (hook: () => undefined) => ({
        collections: [
          {
            slug: "posts",
            tableName: "dc_posts",
            fields,
            hooks: { afterRead: [hook] },
          },
        ],
      });
      introspectSpy.mockResolvedValue({
        tables: [
          buildDesiredTableFromFields("dc_posts", fields, "sqlite", {
            builtBy: "codeFirst" as const,
            hasStatus: false,
            localized: false,
          }),
        ],
      } as NextlySchemaSnapshot);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({ config: noDiff(original) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", "posts")).toBe(1);

      pipelineApplySpy.mockClear();
      loadConfigSpy.mockResolvedValue({ config: noDiff(edited) });
      await reloadNextlyConfig({
        resolver: buildResolver({ failCollectionMetaSync: true }),
      });
      // The control that this is the no-DDL branch and not the apply one.
      expect(pipelineApplySpy).not.toHaveBeenCalled();

      await registry.execute("afterRead", {
        collection: "posts",
        operation: "read",
        data: {},
        context: {},
      });
      expect(original).toHaveBeenCalledTimes(1);
      expect(edited).not.toHaveBeenCalled();
    });

    it("holds hooks back when the component tree fails to sync", async () => {
      // A component's field tree is shared: the mutation services read it when
      // validating and serializing any entity that references the component, so
      // a failed component sync leaves every scope reading a stale tree, not
      // just the collections that declare one.
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      // The component sync is skipped outright when the config declares no
      // field groups, so a config that declares one is what puts this
      // dimension in play at all.
      const withComponent = (hook: () => undefined) => ({
        collections: [settledCollection({ afterRead: [hook] })],
        fieldGroups: [
          { slug: "hero", fields: [{ name: "headline", type: "text" }] },
        ],
      });
      const settleBoth = (): void => {
        introspectSpy.mockResolvedValue(
          buildSnapshot([
            {
              name: TABLE,
              columns: [
                ...reservedColumns(TABLE),
                { name: "body", type: "text", nullable: true },
              ],
            },
            {
              name: "comp_hero",
              columns: [
                ...reservedColumns("comp_hero"),
                { name: "headline", type: "text", nullable: true },
              ],
            },
          ])
        );
      };

      settleBoth();
      loadConfigSpy.mockResolvedValue({ config: withComponent(original) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      // The control: the same config with a healthy component sync installs
      // the handler, so the assertion below is about the sync failure.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      settleBoth();
      loadConfigSpy.mockResolvedValue({ config: withComponent(edited) });
      await reloadNextlyConfig({
        resolver: buildResolver({ failComponentSync: true }),
      });

      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(original).toHaveBeenCalledTimes(1);
      expect(edited).not.toHaveBeenCalled();
    });

    it("holds an APPLIED collection's hooks back when another's diff is refused", async () => {
      // The batch succeeds for one collection while another's diff is refused.
      // The applied collection reaches the post-DDL commit with a non-empty
      // deferred set, and its edited handler is still withheld: the reload
      // applied part of a boot, so the runtime it would run against is only
      // partly the one the config describes.
      const registry = getHookRegistry();
      const original = vi.fn(() => undefined);
      const edited = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      // `dc_refused` has a live `text` column the config declares as a
      // checkbox: a column type change the gate refuses rather than applies.
      const refusedCollection = {
        slug: "refused",
        tableName: "dc_refused",
        fields: [{ name: "active", type: "checkbox" }],
      };
      // The edited collection gains a column, so its own diff is additive and
      // DOES apply -- without that this reload would never reach the post-DDL
      // commit and the deferred set would not be the thing under test.
      const appliedCollection = (hook: () => undefined) => ({
        slug: SLUG,
        tableName: TABLE,
        fields: [
          { name: "body", type: "text" },
          { name: "summary", type: "text" },
        ],
        hooks: { afterRead: [hook] },
      });
      const settleBothTables = (): void => {
        introspectSpy.mockResolvedValue(
          buildSnapshot([
            {
              name: TABLE,
              columns: [
                ...reservedColumns(TABLE),
                { name: "body", type: "text", nullable: true },
              ],
            },
            {
              name: "dc_refused",
              columns: [
                ...reservedColumns("dc_refused"),
                { name: "active", type: "text", nullable: true },
              ],
            },
          ])
        );
      };

      // The control installs the handler through the same applying reload,
      // without the refusal in the config, so the difference between the two
      // reloads is the deferred set and nothing else.
      settleBothTables();
      pipelineApplySpy.mockClear();
      loadConfigSpy.mockResolvedValue({
        config: { collections: [appliedCollection(original)] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      settleBothTables();
      pipelineApplySpy.mockClear();
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [appliedCollection(edited), refusedCollection],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      // The control that this reload reached the post-DDL commit rather than
      // bailing on the deferred branch, which withholds for its own reason.
      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);

      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(original).toHaveBeenCalledTimes(1);
      expect(edited).not.toHaveBeenCalled();
    });

    it("keeps the newly loaded field types when it withholds after a successful apply", async () => {
      // Withholding hooks and rolling back the plugin field-type registry are
      // separate decisions, and this branch is inside a successful apply: the
      // DDL and the runtime schema caches were generated FROM the field types
      // this reload loaded. Putting the previous ones back would leave
      // validation and storage transforms running definitions the landed
      // schema no longer matches.
      const registry = getHookRegistry();
      const edited = vi.fn(() => undefined);
      const { registerFieldType, clearFieldTypes, getFieldType } = await import(
        "../../domains/schema/field-types/field-type-registry"
      );
      const { reloadNextlyConfig } = await import("../reload-config");

      clearFieldTypes();
      registerFieldType({
        type: "legacy-rating",
        storage: "number",
        component: "plugin/legacy-rating",
      });

      const refusedCollection = {
        slug: "refused",
        tableName: "dc_refused",
        fields: [{ name: "active", type: "checkbox" }],
      };
      const appliedCollection = {
        slug: SLUG,
        tableName: TABLE,
        fields: [
          { name: "body", type: "text" },
          { name: "summary", type: "text" },
        ],
        hooks: { afterRead: [edited] },
      };
      introspectSpy.mockResolvedValue(
        buildSnapshot([
          {
            name: TABLE,
            columns: [
              ...reservedColumns(TABLE),
              { name: "body", type: "text", nullable: true },
            ],
          },
          {
            name: "dc_refused",
            columns: [
              ...reservedColumns("dc_refused"),
              { name: "active", type: "text", nullable: true },
            ],
          },
        ])
      );

      // The real `loadConfig` clears and repopulates the process-global
      // field-type registry as it reads the new config, so the mock has to do
      // the same or a rollback would have nothing observable to undo.
      loadConfigSpy.mockImplementation(async () => {
        clearFieldTypes();
        registerFieldType({
          type: "fresh-rating",
          storage: "number",
          component: "plugin/fresh-rating",
        });
        return {
          config: { collections: [appliedCollection, refusedCollection] },
        };
      });

      pipelineApplySpy.mockClear();
      await reloadNextlyConfig({ resolver: buildResolver() });

      // Controls: the apply ran (so this is the post-DDL branch) and the gate
      // withheld (so this is the withholding side of it).
      expect(pipelineApplySpy).toHaveBeenCalledTimes(1);
      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);

      expect(getFieldType("fresh-rating")).toBeDefined();
      expect(getFieldType("legacy-rating")).toBeUndefined();

      clearFieldTypes();
    });

    it("does not half-enable a plugin that never initialized", async () => {
      // `init` does not re-run on a config reload, so flipping `enabled: false`
      // to true produces a plugin the config calls enabled and the process
      // never started -- no services, no subscriptions. Installing the hooks
      // its collections declare would put handlers live that depend on both.
      const registry = getHookRegistry();
      const fromPlugin = vi.fn(() => undefined);
      setInitializedPlugins([]);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "late-plugin",
              enabled: true,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [fromPlugin] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(0);
    });

    it("registers a plugin's entities once it HAS initialized", async () => {
      // The mirror. Without it, a filter that excluded every plugin-contributed
      // entity would look correct.
      const registry = getHookRegistry();
      setInitializedPlugins(["late-plugin"]);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [
            {
              name: "late-plugin",
              enabled: true,
              contributes: { collections: [{ slug: SLUG }] },
            },
          ],
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    });

    it("suspends a disabled plugin that has not registered anything yet", async () => {
      // A plugin can register lazily -- from a route, an event handler, a timer
      // -- so at reconciliation time it may hold no registrations at all. A
      // suspension set built only from what the registry currently holds cannot
      // name it, and its later handler would run despite `enabled: false`.
      const registry = getHookRegistry();
      setInitializedPlugins(["lazy-plugin"]);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          plugins: [{ name: "lazy-plugin", enabled: false }],
          collections: [settledCollection()],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      // Registered only AFTER the reload decided who was suspended.
      const late = vi.fn(() => undefined);
      const ctx = createPluginContext(stubServices, registry, {
        name: "lazy-plugin",
        version: "1.0.0",
        nextly: "*",
      });
      ctx.hooks.on("afterRead", SLUG, late);

      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(late).not.toHaveBeenCalled();
      // Registered, not deleted -- re-enabling brings it back.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
    });

    it("has exactly the landing points its paths need", () => {
      // A count rather than a proof. The scan this replaces looked for a
      // resolution in the lines before each early return, and passed while the
      // no-DDL landing had none -- it was reading an `undoOptimisticReloadWork()` that
      // belonged to the sibling branch. Line proximity cannot tell those apart,
      // so the paths are covered by the behaviour tests above instead and this
      // only stops a fourth landing appearing unnoticed.
      const source = readFileSync(
        new URL("../reload-config.ts", import.meta.url),
        "utf8"
      );
      const commits = source.match(/^\s*commitReload\(/gm) ?? [];
      // Empty targets, the no-DDL branch, and after a successful apply. Two
      // branches deliberately publish nothing: the post-apply localization
      // failure returns before the runtime-schema refresh, and the no-DDL
      // deferred branch skips the metadata sync for every entity.
      expect(commits).toHaveLength(3);
    });

    it("keeps a late app hook behind the config's, across a reload", async () => {
      // Registration order is FIFO and the owners interleave: plugins during
      // init, the config right after, and an app whenever the module holding
      // its `registerHook` call is evaluated -- which can be later than both.
      // Clearing the config's entries and appending the replacements would put
      // the app's handler in front of them, so an unrelated config save would
      // silently reorder a transforming chain.
      const registry = getHookRegistry();
      const order: string[] = [];
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            settledCollection({ afterRead: [() => void order.push("config")] }),
          ],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      registry.register("afterRead", SLUG, () => void order.push("app"));
      expect(registry.getHookCount("afterRead", SLUG)).toBe(2);

      // A second save, editing the config hook but not the app one.
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            settledCollection({
              afterRead: [() => void order.push("config2")],
            }),
          ],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      order.length = 0;
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(order).toEqual(["config2", "app"]);
    });

    it("stops a disabled plugin's own registrations, and resumes them", async () => {
      // Its declarations are handled by leaving them out of the rebuild, but a
      // `ctx.hooks.on` registration cannot be: `init` does not re-run on a
      // config reload, so removing it would leave re-enabling the plugin short
      // of its handler until a restart. Suspended instead, and resumed by a
      // later config that no longer disables it.
      const registry = getHookRegistry();
      const fromPlugin = vi.fn(() => undefined);
      const ctx = createPluginContext(stubServices, registry, PLUGIN);
      ctx.hooks.on("afterRead", SLUG, fromPlugin);
      const { reloadNextlyConfig } = await import("../reload-config");

      const configWith = (enabled: boolean) => ({
        plugins: [{ name: PLUGIN.name, enabled, contributes: {} }],
        collections: [settledCollection()],
      });
      const read = async () =>
        registry.execute("afterRead", {
          collection: SLUG,
          operation: "read",
          data: {},
          context: {},
        });

      loadConfigSpy.mockResolvedValue({ config: configWith(true) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      await read();
      // The control: it runs while the plugin is enabled, so "not called"
      // below cannot be a handler that never worked.
      expect(fromPlugin).toHaveBeenCalledTimes(1);

      loadConfigSpy.mockResolvedValue({ config: configWith(false) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      fromPlugin.mockClear();
      await read();
      expect(fromPlugin).not.toHaveBeenCalled();
      // Still registered, not deleted -- which is what makes the next step
      // possible without a restart.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({ config: configWith(true) });
      await reloadNextlyConfig({ resolver: buildResolver() });
      await read();
      expect(fromPlugin).toHaveBeenCalledTimes(1);
    });

    it("does not publish the new hook before the schema lands", async () => {
      // Peer requests keep being served from the cached instance while a reload
      // is in flight, so a handler published ahead of the DDL can run against
      // the old table. The staged work is committed only once the apply has
      // reported success, so anything observing the registry mid-reload sees
      // the previous handler.
      const registry = getHookRegistry();
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [settledCollection({ afterRead: [() => undefined] })],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      // Observed from inside the apply, which is the window a peer request
      // would be served in.
      let duringApply = -1;
      pipelineApplySpy.mockImplementation(() => {
        duringApply = registry.getHookCount("afterRead", SLUG);
        return Promise.resolve({
          success: true,
          statementsExecuted: 1,
          renamesApplied: 0,
        });
      });
      introspectSpy.mockResolvedValue(
        liveSnapshot(TABLE, reservedColumns(TABLE))
      );
      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [
            settledCollection({
              afterRead: [() => undefined, () => undefined],
            }),
          ],
        },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });

      // One during the apply -- still the previous config's -- and two after.
      expect(duringApply).toBe(1);
      expect(registry.getHookCount("afterRead", SLUG)).toBe(2);
    });

    it("puts the previous hooks back when the reload is abandoned", async () => {
      // A save carrying BOTH a hook edit and a schema change that is then
      // refused must leave the previous handlers in place: the database still
      // has the previous schema, and a handler written against a field the
      // refused edit renamed would read something that is not there. The work
      // is staged rather than applied up front, so an abandoned reload simply
      // never commits it. Here DI hands back no adapter, one of those paths.
      const registry = getHookRegistry();
      const landed = vi.fn(() => undefined);
      const abandoned = vi.fn(() => undefined);
      const { reloadNextlyConfig } = await import("../reload-config");

      loadConfigSpy.mockResolvedValue({
        config: { collections: [settledCollection({ afterRead: [landed] })] },
      });
      await reloadNextlyConfig({ resolver: buildResolver() });
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);

      loadConfigSpy.mockResolvedValue({
        config: {
          collections: [settledCollection({ afterRead: [abandoned] })],
        },
      });
      await reloadNextlyConfig({
        resolver: buildResolver({ withAdapter: false }),
      });

      // Still one, and still the one from the reload that landed.
      expect(registry.getHookCount("afterRead", SLUG)).toBe(1);
      await registry.execute("afterRead", {
        collection: SLUG,
        operation: "read",
        data: {},
        context: {},
      });
      expect(landed).toHaveBeenCalledTimes(1);
      expect(abandoned).not.toHaveBeenCalled();
    });
  });
});

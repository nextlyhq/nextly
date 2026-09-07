/**
 * The sweep that moves a registry row to `applied` once its table exists.
 *
 * The behaviour under test is narrow and the consequences are not: a row left
 * `pending` means a collection with no dashboard cards, and a row wrongly marked
 * `failed` means one an operator has to un-fail by hand.
 */
import { describe, expect, it, vi } from "vitest";

import { reconcileMigrationMetadata } from "../reconcile-metadata";

const silent = {
  info: () => {},
  warn: () => {},
  debug: () => {},
};

/**
 * An adapter that knows which tables exist.
 *
 * `tableExists` is the only thing the sweep asks it, so the fixture is the set
 * of names that answer true — which is also exactly the state a migration run
 * leaves behind.
 */
function adapterWith(tables: string[]) {
  return {
    tableExists: vi.fn(async (name: string) => tables.includes(name)),
    // The sweep builds a `SchemaEventsRepository` to prove a snapshot's
    // migration ran before registration may claim `applied`. These cases stub
    // `registerFn`, so the repository is constructed and never queried — but
    // constructing it is what needs a Drizzle handle.
    getDrizzle: () => ({}),
  } as never;
}

/** A registry service reduced to the two calls the sweep makes. */
function registryOf(rows: unknown[]) {
  return {
    getPendingMigrations: vi.fn(async () => rows),
    updateMigrationStatusWithVerification: vi.fn(async () => ({
      verified: true,
    })),
  };
}

/**
 * The three services are constructed inside the module, so they are replaced
 * here rather than injected. Each returns its own rows so a test can tell which
 * registry a count came from.
 */
function mockRegistries(
  collections: unknown[] = [],
  singles: unknown[] = [],
  fieldGroups: unknown[] = []
) {
  const made = {
    collection: registryOf(collections),
    single: registryOf(singles),
    fieldGroup: registryOf(fieldGroups),
  };
  vi.doMock(
    "../../../collections/services/collection-registry-service",
    () => ({
      CollectionRegistryService: class {
        getPendingMigrations = made.collection.getPendingMigrations;
        updateMigrationStatusWithVerification =
          made.collection.updateMigrationStatusWithVerification;
      },
    })
  );
  vi.doMock("../../../singles/services/single-registry-service", () => ({
    SingleRegistryService: class {
      getPendingMigrations = made.single.getPendingMigrations;
      updateMigrationStatusWithVerification =
        made.single.updateMigrationStatusWithVerification;
    },
  }));
  vi.doMock(
    "../../../field-groups/services/field-group-registry-service",
    () => ({
      FieldGroupRegistryService: class {
        getPendingMigrations = made.fieldGroup.getPendingMigrations;
        updateMigrationStatusWithVerification =
          made.fieldGroup.updateMigrationStatusWithVerification;
      },
    })
  );
  return made;
}

async function run(opts: {
  tables: string[];
  collections?: unknown[];
  singles?: unknown[];
  fieldGroups?: unknown[];
  registerFn?: () => Promise<{
    collectionsRegistered: number;
    singlesRegistered: number;
  }>;
}) {
  vi.resetModules();
  const made = mockRegistries(
    opts.collections ?? [],
    opts.singles ?? [],
    opts.fieldGroups ?? []
  );
  const { reconcileMigrationMetadata: fresh } = await import(
    "../reconcile-metadata"
  );
  const result = await fresh({
    adapter: adapterWith(opts.tables),
    dialect: "sqlite",
    migrationsDir: "/tmp/migrations",
    logger: silent,
    registerFn: (opts.registerFn ??
      (async () => ({
        collectionsRegistered: 0,
        singlesRegistered: 0,
      }))) as never,
  });
  return { result, made };
}

describe("reconcileMigrationMetadata", () => {
  it("is exported for the migrate command to call", () => {
    // The whole defect was that nothing called the reconciliation half, so the
    // reachability of this function is itself worth an assertion.
    expect(typeof reconcileMigrationMetadata).toBe("function");
  });

  it("marks a pending row applied once its table exists", async () => {
    const { result, made } = await run({
      tables: ["dc_posts"],
      collections: [{ slug: "posts", tableName: "dc_posts" }],
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).toHaveBeenCalledWith("posts", "dc_posts");
    expect(result.marked).toBe(1);
    expect(result.stillPending).toBe(0);
  });

  /*
   * 🔴 The assertion this module exists to guarantee. After a migrate run, a
   * `pending` row with no table has two indistinguishable causes: a migration
   * that failed, and a migration file that was never generated.
   * `updateMigrationStatusWithVerification` writes `failed` for both, so the
   * sweep must not reach it — condemning the second turns a collection still
   * waiting for its DDL into one somebody has to repair by hand.
   */
  it("leaves a row alone when its table is not there, never marking it failed", async () => {
    const { result, made } = await run({
      tables: [],
      collections: [{ slug: "posts", tableName: "dc_posts" }],
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).not.toHaveBeenCalled();
    expect(result.marked).toBe(0);
    expect(result.stillPending).toBe(1);
  });

  it("sweeps collections, singles and field groups", async () => {
    // All three registries carry a migration status, and a sweep that reached
    // only collections would leave the other two permanently behind.
    const { result, made } = await run({
      tables: ["dc_posts", "ds_home", "fg_seo"],
      collections: [{ slug: "posts", tableName: "dc_posts" }],
      singles: [{ slug: "home", tableName: "ds_home" }],
      fieldGroups: [{ slug: "seo", tableName: "fg_seo" }],
    });

    expect(made.collection.getPendingMigrations).toHaveBeenCalledOnce();
    expect(made.single.getPendingMigrations).toHaveBeenCalledOnce();
    expect(made.fieldGroup.getPendingMigrations).toHaveBeenCalledOnce();
    expect(result.marked).toBe(3);
  });

  it("keeps going when one row cannot be recorded", async () => {
    vi.resetModules();
    const made = mockRegistries([
      { slug: "posts", tableName: "dc_posts" },
      { slug: "pages", tableName: "dc_pages" },
    ]);
    made.collection.updateMigrationStatusWithVerification
      .mockRejectedValueOnce(new Error("row is locked"))
      .mockResolvedValueOnce({ verified: true });

    const { reconcileMigrationMetadata: fresh } = await import(
      "../reconcile-metadata"
    );
    const result = await fresh({
      adapter: adapterWith(["dc_posts", "dc_pages"]),
      dialect: "sqlite",
      migrationsDir: "/tmp/migrations",
      logger: silent,
      registerFn: (async () => ({
        collectionsRegistered: 0,
        singlesRegistered: 0,
      })) as never,
    });

    // One failure costs ONE row its status, not the rest of the sweep.
    expect(result.marked).toBe(1);
    expect(result.stillPending).toBe(1);
  });

  it("reports what registration inserted", async () => {
    const { result } = await run({
      tables: [],
      registerFn: async () => ({
        collectionsRegistered: 2,
        singlesRegistered: 1,
      }),
    });

    expect(result.collectionsRegistered).toBe(2);
    expect(result.singlesRegistered).toBe(1);
  });

  it("skips a row carrying no usable slug or table name", async () => {
    // Counted as still pending rather than dropped, so the totals stay honest
    // about what the sweep could not act on.
    const { result, made } = await run({
      tables: ["dc_posts"],
      collections: [{ slug: "", tableName: "dc_posts" }, { tableName: null }],
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(2);
  });

  /*
   * 🔴 A registry that cannot be READ must not read as a registry with nothing
   * to do. This is the failure that shipped: `nextly migrate` installs no table
   * resolver, so every `adapter.select` refuses with "not found in schema
   * registry", the per-registry guard catches all three, and the pass returns
   * zeroes -- identical to a database that was already correct. The command
   * announced success having repaired nothing, in exactly the production case
   * it was written for.
   *
   * `unreadable` is what separates the two. Asserting `marked === 0` cannot:
   * it is zero in both.
   */
  it("reports a registry it could not read at all", async () => {
    vi.resetModules();
    const made = mockRegistries();
    made.collection.getPendingMigrations.mockRejectedValue(
      new Error("Table 'dynamic_collections' not found in schema registry")
    );

    const { reconcileMigrationMetadata: fresh } = await import(
      "../reconcile-metadata"
    );
    const result = await fresh({
      adapter: adapterWith([]),
      dialect: "sqlite",
      migrationsDir: "/tmp/migrations",
      logger: silent,
      registerFn: (async () => ({
        collectionsRegistered: 0,
        singlesRegistered: 0,
      })) as never,
    });

    expect(result.unreadable).toContain("collection");
    // The control: the other two were readable, so this is a report about ONE
    // registry rather than a pass that failed wholesale.
    expect(result.unreadable).not.toContain("single");
  });

  it("reports nothing unreadable when every registry answers", async () => {
    // The negative half. Without it, an implementation that always listed all
    // three would satisfy the assertion above.
    const { result } = await run({ tables: [], collections: [] });

    expect(result.unreadable).toEqual([]);
  });
});

/*
 * 🔴 The half table existence cannot answer. When a collection is edited in
 * the Schema Builder the row gets the NEW fields and goes back to `pending`
 * while the physical table is untouched — so `tableExists` says yes for a
 * change that has not migrated, and the sweep used to promote it. The registry
 * then advertises a shape the database has never had.
 */
describe("reconcileMigrationMetadata holds a row an unapplied migration names", () => {
  /** Stands in for reading the migration headers and the applied ledger. */
  function awaitingFn(opts: {
    collections?: string[];
    singles?: string[];
    components?: string[];
  }) {
    return async () => ({
      collections: new Set(opts.collections ?? []),
      singles: new Set(opts.singles ?? []),
      components: new Set(opts.components ?? []),
    });
  }

  async function sweep(opts: {
    tables: string[];
    row: Record<string, unknown>;
    awaiting: ReturnType<typeof awaitingFn>;
  }) {
    vi.resetModules();
    const made = mockRegistries([opts.row]);
    const { reconcileMigrationMetadata: fresh } = await import(
      "../reconcile-metadata"
    );
    const result = await fresh({
      adapter: adapterWith(opts.tables),
      dialect: "sqlite",
      migrationsDir: "/tmp/migrations",
      logger: silent,
      registerFn: (async () => ({
        collectionsRegistered: 0,
        singlesRegistered: 0,
      })) as never,
      readPendingEntitiesFn: opts.awaiting as never,
    });
    return { result, made };
  }

  it("leaves an edited row pending while a migration naming it is unapplied", async () => {
    const { result, made } = await sweep({
      // The old table still stands, which is exactly why existence cannot decide.
      tables: ["dc_posts"],
      row: { slug: "posts", tableName: "dc_posts" },
      awaiting: awaitingFn({ collections: ["posts"] }),
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).not.toHaveBeenCalled();
    expect(result.marked).toBe(0);
    expect(result.awaitingMigration).toBe(1);
    // Counted inside the total rather than beside it, so the two agree.
    expect(result.stillPending).toBe(1);
  });

  it("promotes the same row once nothing names it any more", async () => {
    // The control. Without it, an implementation that withheld EVERY row would
    // satisfy the case above — and withholding every row is the empty-dashboard
    // defect this sweep exists to prevent.
    const { result, made } = await sweep({
      tables: ["dc_posts"],
      row: { slug: "posts", tableName: "dc_posts" },
      awaiting: awaitingFn({}),
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).toHaveBeenCalledWith("posts", "dc_posts");
    expect(result.marked).toBe(1);
    expect(result.awaitingMigration).toBe(0);
  });

  it("promotes a row no migration header names, rather than withholding it", async () => {
    // A code-first collection, or an install whose migrations predate scoped
    // headers. Silence is not disagreement.
    const { result } = await sweep({
      tables: ["dc_authors"],
      row: { slug: "authors", tableName: "dc_authors" },
      awaiting: awaitingFn({ collections: ["posts"] }),
    });

    expect(result.marked).toBe(1);
    expect(result.awaitingMigration).toBe(0);
  });

  it("judges each kind against its own names", async () => {
    // A collection and a single can share a slug in a snapshot header without
    // being the same entity; holding a collection back because a SINGLE of
    // that name is pending would be wrong.
    const { result } = await sweep({
      tables: ["dc_posts"],
      row: { slug: "posts", tableName: "dc_posts" },
      awaiting: awaitingFn({ singles: ["posts"] }),
    });

    expect(result.marked).toBe(1);
    expect(result.awaitingMigration).toBe(0);
  });

  /*
   * 🔴 A `--step` run can leave a generated CREATE unapplied, so the row is
   * BOTH named by an outstanding migration and missing its table. Deciding on
   * the table first files it under "no migration exists yet" and sends the
   * operator to `migrate:create` for a file already sitting in the repository.
   * Both orders withhold the row; only one reports why correctly.
   */
  it("counts a named row with no table as awaiting its migration", async () => {
    const { result, made } = await sweep({
      tables: [],
      row: { slug: "posts", tableName: "dc_posts" },
      awaiting: awaitingFn({ collections: ["posts"] }),
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(1);
    expect(result.awaitingMigration).toBe(1);
  });

  it("still refuses an UNNAMED row whose table is absent", async () => {
    // Existence remains necessary. Nothing naming the slug must not promote a
    // row whose table was never created.
    const { result, made } = await sweep({
      tables: [],
      row: { slug: "posts", tableName: "dc_posts" },
      awaiting: awaitingFn({}),
    });

    expect(
      made.collection.updateMigrationStatusWithVerification
    ).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(1);
    // Not an outstanding migration — the operator is sent to a different remedy.
    expect(result.awaitingMigration).toBe(0);
  });
});

/**
 * The orchestrator's decisions, not its statements.
 *
 * `run` is the only module that puts the others in order, and the order is the
 * safety argument. These cover the two decisions it makes before any step
 * executes: when it may read the state it decides from, and what it will accept
 * as evidence that a run is unnecessary.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import type { Logger } from "../../../../shared/types";

// The catalog probe is the one seam these tests stand in for. It issues
// dialect-specific `information_schema` queries, and reproducing three of those
// would test the query rather than the decision made from its answer. Every
// other collaborator here is the real one: the lock, the marker, the registry
// read, the probe and the verdict.
vi.mock("../../../schema/pipeline/diff/introspect-live", () => ({
  introspectLiveSnapshot: vi.fn(),
}));

import { introspectLiveSnapshot } from "../../../schema/pipeline/diff/introspect-live";
import { FIELD_GROUP_MIGRATION_KEY } from "../state";

import { readRegistryRows, runFieldGroupMigration } from "../run";

const LEGACY_REGISTRY = "dynamic_components";
const TARGET_REGISTRY = "dynamic_field_groups";

/** Every operation the run performs, in the order it performs them. */
type Trace = ("lock" | "marker" | "catalog")[];

interface RunWorld {
  /** `nextly_meta` marker value, or `undefined` for no row. */
  marker?: unknown;
  /** Tables the catalog reports. */
  tables: string[];
  /** Columns per table, defaulted for anything the test does not name. */
  columns?: Record<string, string[]>;
  /** Rows the registry holds. */
  registryRows?: {
    id: string;
    slug: string;
    table_name: string;
    localized?: boolean | number;
  }[];
  /** Model a database predating the i18n `localized` column. */
  noLocalizedColumn?: boolean;
}

/**
 * An adapter double for the reads this orchestrator makes before it executes.
 *
 * It interprets statements through a real Drizzle dialect rather than matching
 * on the template object, so a statement no driver could run cannot pass here
 * either — the same bar the step and session doubles hold.
 *
 * 🔴 It raises bare `Error`s rather than `NextlyError`s, deliberately, and for
 * two different reasons:
 *
 * - A missing relation is what a **driver** raises, and `queryStatement` passes
 *   driver errors through untouched (`adapter-drizzle/src/adapter.ts` calls
 *   `db.execute` and only wraps an unrecognised *result shape*). Raising a
 *   `NextlyError` here would test the code against an error it never meets.
 * - The unrecognised-statement branch is not a database error at all. It is this
 *   harness saying it does not model something the code issued, and it must stay
 *   **distinguishable from a refusal the code under test raises** — every
 *   assertion below matches on `NextlyError.is`, so a `NextlyError` from the
 *   double would let a broken harness satisfy a test about production
 *   behaviour. Measured, not assumed: with `NextlyError` here, three of these
 *   five tests still pass when the double stops modelling the registry read;
 *   with a bare `Error`, all five fail.
 */
function createRunWorld(world: RunWorld) {
  const trace: Trace = [];
  const lock: { seeded: boolean; owner: string | null } = {
    seeded: true,
    owner: null,
  };

  function interpret(statement: SQL): Record<string, unknown>[] {
    const { sql: text, params } = new PgDialect().sqlToQuery(statement);
    const flat = text.replace(/\s+/g, " ").trim();

    if (
      /^SELECT "\w+" FROM "nextly_field_group_lock" WHERE "id" = \$1$/.test(
        flat
      )
    ) {
      return lock.seeded ? [{ id: 1, owner: lock.owner }] : [];
    }
    if (
      /^UPDATE "nextly_field_group_lock" SET "owner" = \$1 WHERE "id" = \$2$/.test(
        flat
      )
    ) {
      // An occupied row refuses a new claim, exactly as the real one does.
      if (lock.owner === null) {
        lock.owner = params[0] as string | null;
        trace.push("lock");
      }
      return [];
    }
    if (
      /^UPDATE "nextly_field_group_lock" SET "owner" = NULL WHERE "id" = \$1 AND "owner" = \$2$/.test(
        flat
      )
    ) {
      if (lock.owner === params[1]) lock.owner = null;
      return [];
    }
    // Two spellings, because production tries the localized column first and
    // falls back when the database predates it. A double that answered only one
    // would certify a read path that cannot run on the other kind of database.
    const registry =
      /^SELECT "id", "slug", "table_name", "localized" FROM "(\w+)"$/.exec(
        flat
      );
    if (registry?.[1] !== undefined) {
      if (!world.tables.includes(registry[1])) {
        throw new Error(`relation "${registry[1]}" does not exist`);
      }
      if (world.noLocalizedColumn === true) {
        throw new Error('column "localized" does not exist');
      }
      return world.registryRows ?? [];
    }
    const registryLegacy =
      /^SELECT "id", "slug", "table_name" FROM "(\w+)"$/.exec(flat);
    if (registryLegacy?.[1] !== undefined) {
      if (!world.tables.includes(registryLegacy[1])) {
        throw new Error(`relation "${registryLegacy[1]}" does not exist`);
      }
      // The column is absent, so no row can report itself localized.
      return (world.registryRows ?? []).map(
        ({ localized: _localized, ...rest }) => rest
      );
    }
    throw new Error(`unrecognised statement: ${flat}`);
  }

  const adapter = {
    dialect: "postgresql" as const,
    getCapabilities: () => ({ dialect: "postgresql" }),
    getDrizzle: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              trace.push("marker");
              return Promise.resolve(
                world.marker === undefined
                  ? []
                  : [
                      {
                        key: FIELD_GROUP_MIGRATION_KEY,
                        value: JSON.stringify(world.marker),
                      },
                    ]
              );
            },
          }),
        }),
      }),
    }),
    executeQuery: () => Promise.resolve([]),
    queryStatement: (statement: SQL) => Promise.resolve(interpret(statement)),
    tableExists: (name: string) => Promise.resolve(world.tables.includes(name)),
    listTables: () => {
      trace.push("catalog");
      return Promise.resolve([...world.tables]);
    },
    transaction: (work: (ctx: unknown) => Promise<unknown>) =>
      work({
        lockRow: () => Promise.resolve(undefined),
        insert: (_table: string, data: { owner: string | null }) => {
          lock.seeded = true;
          lock.owner = data.owner;
          return Promise.resolve(data);
        },
        runStatement: (statement: SQL) => {
          interpret(statement);
          return Promise.resolve();
        },
        queryStatement: (statement: SQL) =>
          Promise.resolve(interpret(statement)),
      }),
  } as unknown as DrizzleAdapter;

  vi.mocked(introspectLiveSnapshot).mockImplementation((_db, _dialect, names) =>
    Promise.resolve({
      tables: names
        .filter(name => world.tables.includes(name))
        .map(name => ({
          name,
          columns: (world.columns?.[name] ?? defaultColumnsFor(name)).map(
            column => ({ name: column, type: "text", nullable: false })
          ),
        })),
    })
  );

  return { adapter, trace };
}

/**
 * What a table of each kind carries when a test does not say.
 *
 * A field-group data table has to carry its discriminator or the probe reports
 * it unmigrated, which would make every test look like the damaged case.
 */
function defaultColumnsFor(table: string): string[] {
  if (table.startsWith("fg_")) {
    return ["id", "_parent_id", "_parent_table", "_field_group_type"];
  }
  if (table.startsWith("comp_")) {
    return ["id", "_parent_id", "_parent_table", "_component_type"];
  }
  return ["id"];
}

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** A marker recording a completed upward run. */
function settledAtV2() {
  return {
    version: 3,
    status: "settled",
    generation: "field-groups-v2",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFieldGroupMigration", () => {
  // 🔴 Every decision this run makes comes from the marker, so reading it
  // before contending for the lock lets another invocation finish the whole
  // migration in between: this one would then acquire the lock holding a marker
  // that says legacy, rebuild an upward plan against migrated storage, and
  // overwrite a settled marker with a fresh in-flight one.
  it("reads the marker only after taking the lock", async () => {
    const { adapter, trace } = createRunWorld({
      marker: settledAtV2(),
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    await expect(
      runFieldGroupMigration({ adapter, logger, direction: "up" })
    ).resolves.toEqual({ ran: false, reason: "already-migrated" });

    expect(trace.indexOf("lock")).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf("marker")).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf("lock")).toBeLessThan(trace.indexOf("marker"));
  });

  // A marker and the storage it describes are separate facts, and they come
  // apart in ways no run causes: a restore from a backup taken before the
  // migration, a table dropped by hand. Believing the marker alone turns every
  // later invocation into a report of success over storage nothing can serve.
  it("refuses a settled marker the catalog contradicts", async () => {
    const { adapter } = createRunWorld({
      marker: settledAtV2(),
      // The marker says the migration finished, but the migrated registry is
      // not there and the legacy one is.
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // The registry existing proves only that the registry exists. A data table it
  // points at is what content is read from, and the read path treats a missing
  // one as an empty result rather than an error — so an incomplete rename would
  // serve blank content while the marker reported success.
  it("refuses a settled marker whose data table is missing", async () => {
    const { adapter } = createRunWorld({
      marker: settledAtV2(),
      tables: [TARGET_REGISTRY],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // The same check the other way: a data table present but still carrying the
  // legacy discriminator has not been migrated, whatever the marker says.
  it("refuses a settled marker whose discriminator was not renamed", async () => {
    const { adapter } = createRunWorld({
      marker: settledAtV2(),
      tables: [TARGET_REGISTRY, "fg_hero"],
      columns: {
        fg_hero: ["id", "_parent_id", "_parent_table", "_component_type"],
      },
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // A rollback reverses a persisted plan and nothing else can supply it: no
  // property of the database says which `fg_*` names this migration created.
  it("refuses a rollback with no recorded plan", async () => {
    const { adapter } = createRunWorld({
      marker: settledAtV2(),
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "down",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toBe("rollback has no recorded plan");
    }
  });
});

describe("companion ownership", () => {
  /**
   * Asked of `readRegistryRows` directly, not of a run's outcome.
   *
   * `hasCompanion` decides whether a table enters the rename plan, and a run
   * that reports `already-migrated` builds no plan at all — so an assertion on
   * its outcome cannot tell a correct answer from a wrong one. Measured: with
   * the ownership condition removed, every outcome-level assertion still passed.
   */
  async function companionFor(
    over: Partial<RunWorld> & {
      rows: { localized?: boolean | number };
    }
  ): Promise<boolean | undefined> {
    const { adapter } = createRunWorld({
      tables: [TARGET_REGISTRY, "fg_hero", "fg_hero_locales"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", ...over.rows },
      ],
      ...over,
    });
    const rows = await readRegistryRows(adapter);
    return rows[0]?.hasCompanion;
  }

  // 🔴 Nextly runs inside the user's own database. A non-localized field group
  // has no companion, so a table sitting on the derived `_locales` name belongs
  // to the application — and adopting it into the plan renames it away.
  it("claims no companion for a group the registry says is not localized", async () => {
    await expect(companionFor({ rows: { localized: 0 } })).resolves.toBe(false);
  });

  it("claims the companion when the flag and the table agree", async () => {
    await expect(companionFor({ rows: { localized: 1 } })).resolves.toBe(true);
  });

  // The flag alone is not enough either: a localized group with no translatable
  // fields has no companion, and the plan must not name a table never created.
  it("claims no companion when the table was never created", async () => {
    await expect(
      companionFor({
        tables: [TARGET_REGISTRY, "fg_hero"],
        rows: { localized: 1 },
      })
    ).resolves.toBe(false);
  });

  // MySQL and SQLite store the flag as 1/0 where Postgres stores a boolean, so
  // reading it as a strict `=== true` would drop every companion on two of the
  // three dialects and leave real storage behind under its legacy name.
  it("reads the flag in both stored forms", async () => {
    await expect(companionFor({ rows: { localized: true } })).resolves.toBe(
      true
    );
    await expect(companionFor({ rows: { localized: 1 } })).resolves.toBe(true);
  });

  // A database that predates the i18n column has no companions at all, so the
  // fallback reporting every row as not localized is the true answer there.
  it("falls back when the database predates the localized column", async () => {
    await expect(
      companionFor({ noLocalizedColumn: true, rows: {} })
    ).resolves.toBe(false);
  });
});

describe("a settled marker older than this build's work", () => {
  // 🔴 `generation` names what storage reached; what that generation MEANS is a
  // property of the build that wrote it. Version 2 ran renames only, version 3
  // also rewrites field definitions, ledger keys and parent pointers — so a
  // version 2 marker describes storage this build considers half-migrated, and
  // every table and column would still check out.
  it("refuses rather than reporting the work complete", async () => {
    const { adapter } = createRunWorld({
      marker: { version: 2, status: "settled", generation: "field-groups-v2" },
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toBe(
        "settled marker predates work this build performs"
      );
    }
  });

  // A `legacy` marker claims no work was done, which is the same claim in every
  // build. Refusing there would strand a rollback that has nothing left to undo.
  it("accepts a legacy marker whatever version wrote it", async () => {
    const { adapter } = createRunWorld({
      marker: { version: 2, status: "settled", generation: "legacy" },
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "comp_hero", localized: 0 },
      ],
    });

    await expect(
      runFieldGroupMigration({ adapter, logger, direction: "down" })
    ).resolves.toEqual({ ran: false, reason: "already-migrated" });
  });
});

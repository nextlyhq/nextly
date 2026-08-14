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
import { FIELD_GROUP_MIGRATION_KEY, MIGRATION_MARKER_VERSION } from "../state";

import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";

import {
  buildMigrationManifest,
  hashManifest,
  hashRegistryIdentity,
} from "../manifest";
import { readRegistryRows, runFieldGroupMigration } from "../run";
import { MIGRATION_LOCK_TABLE } from "../session";
import {
  classifyLockStatement,
  createLockRow,
  interpretLockStatement,
} from "./helpers/migration-lock-double";

const PRESERVING = identifierCaseRules({ dialect: "postgresql" });

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
  /** `_parent_table` value each data table still holds, if any. */
  stalePointers?: Record<string, string>;
  /**
   * Deny only the `localized` column, as column-level privileges do.
   *
   * The failure is dressed exactly as Drizzle dresses one — `Failed query:`
   * followed by the SQL — because that echo is what makes the column's name
   * appear inside a message that has nothing to do with the column missing.
   */
  denyLocalizedColumn?: boolean;
  /**
   * Who already holds the lock row.
   *
   * Only observable when `tables` also contains the lock table: an observing
   * session asks the catalog first, so an owner on a table that does not exist
   * describes a state no database can be in.
   */
  lockOwner?: string;
  /**
   * Called after each marker read has been served, so a test can advance the
   * world the way a concurrent writer does.
   *
   * The hook fires AFTER the value is captured, which is what makes a torn read
   * expressible: the reader gets the marker as it stood, and the catalog it
   * reads next belongs to a later instant. Mutating `world` from here is the
   * whole mechanism — every other read consults `world` at call time.
   */
  onMarkerRead?: () => void;
  /**
   * Names `tableExists` reports absent even though the catalog listing holds them.
   *
   * Models the two reads landing at different instants, which is the only way a
   * test can tell "asked the snapshot" apart from "asked again": both otherwise
   * consult the same `tables` array and agree no matter which the code used.
   */
  invisibleToTableExists?: string[];
  /**
   * Called after each catalog listing is served, with how many have happened.
   *
   * 🔴 The seam that lets the table LIST and the table READ land at different instants. Everything
   * else in this double consults one `tables` array, so the two agree by construction whichever the
   * code asks — which meant no fixture could express a registry that vanishes between being listed
   * and being selected from, and the whole outer-exhaustion path was unreachable from a test.
   */
  onCatalogRead?: (count: number) => void;
  /**
   * Called after each read of the lock row, with how many have happened.
   *
   * A session observes the lock once, at the top, and the retry decision reads
   * it again when judging a failure. Separating "reported the opening
   * observation" from "reported the one that proved a holder" needs the lock to
   * CHANGE between those two reads on the final attempt, and this is the only
   * seam where a test can place that change.
   */
  onLockRead?: (count: number) => void;
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
/**
 * A missing relation as the POSTGRES driver raises it.
 *
 * 🔴 Carries `code: "42P01"`. `isMissingTable` classifies by the driver's own code on postgres and
 * falls back to message text only on sqlite, which has no distinct code — so a bare `Error` with the
 * right words is a shape no adapter produces and one the classifier correctly refuses. A fixture
 * throwing that would exercise the read and never reach the decision made from its failure.
 */
function missingRelation(table: string): Error {
  return Object.assign(new Error(`relation "${table}" does not exist`), {
    code: "42P01",
  });
}

function createRunWorld(world: RunWorld) {
  const trace: Trace = [];
  // The marker is the first thing a run writes that outlives it, so recording the write itself is
  // what makes "this run recorded nothing" an observation. Counting adapter calls would not: the
  // same method serves reads, so a count above zero says nothing about which kind happened.
  const writes = { marker: 0 };
  let lockReads = 0;
  let catalogReads = 0;
  // Seeded with a NULL expiry, which the session reads as a claim that has not lapsed — so a world
  // declaring `lockOwner` still means "somebody holds this", exactly as it did before the column
  // existed. A test that wants a LAPSED claim is a different world and says so.
  const lock = createLockRow(world.lockOwner ?? null);

  function interpret(statement: SQL): Record<string, unknown>[] {
    const { sql: text, params } = new PgDialect().sqlToQuery(statement);
    const flat = text.replace(/\s+/g, " ").trim();

    // The lock's own semantics come from the shared model rather than a copy kept here. A second
    // interpreter of the same statements agrees the day it is written and drifts silently
    // afterwards, and this file only ever needed to OBSERVE the lock, not to define it.
    const lockKind = classifyLockStatement(statement);
    if (lockKind !== undefined) {
      const heldBefore = lock.owner;
      const answer = interpretLockStatement(lock, statement);
      if (lockKind === "state") {
        // Counted and reported AFTER the answer is computed, so a callback that hands the lock to
        // somebody changes what the NEXT read sees rather than the one in flight — which is what
        // lets a test place a writer's arrival at a chosen point.
        lockReads += 1;
        world.onLockRead?.(lockReads);
      }
      if (lockKind === "claim" && heldBefore === null && lock.owner !== null) {
        trace.push("lock");
      }
      return answer;
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
        throw missingRelation(registry[1]);
      }
      if (world.noLocalizedColumn === true) {
        throw new Error('column "localized" does not exist');
      }
      if (world.denyLocalizedColumn === true) {
        throw new Error(`Failed query: ${text}\nparams: `);
      }
      return world.registryRows ?? [];
    }
    const sweep =
      /^SELECT "_parent_table" FROM "(.+?)" WHERE "_parent_table" IN \((.+?)\) LIMIT 1$/.exec(
        flat
      );
    if (sweep?.[1] !== undefined) {
      const held = world.stalePointers?.[sweep[1]];
      // The WHERE is applied, not ignored: a double answering every scan with a
      // row would pass a filter that matches nothing.
      if (held === undefined || !params.includes(held)) return [];
      return [{ _parent_table: held }];
    }
    const registryLegacy =
      /^SELECT "id", "slug", "table_name" FROM "(\w+)"$/.exec(flat);
    if (registryLegacy?.[1] !== undefined) {
      if (!world.tables.includes(registryLegacy[1])) {
        throw missingRelation(registryLegacy[1]);
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
    // Includes the parameter limit because production reads it: a double that
    // omitted it would hand the sweep `undefined` and certify a scan that
    // silently asks for nothing.
    getCapabilities: () => ({
      dialect: "postgresql",
      maxParamsPerQuery: 65535,
    }),
    getDrizzle: () => ({
      // The marker write. Modelled so a run that records its intent is DISTINGUISHABLE from one
      // that only read -- without these the write throws, which a test could mistake for the
      // absence it was hoping to observe.
      insert: () => ({
        values: () => {
          writes.marker += 1;
          return Promise.resolve();
        },
      }),
      update: () => ({
        set: () => ({
          where: () => {
            writes.marker += 1;
            return Promise.resolve();
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              trace.push("marker");
              // Captured before the hook runs, so a hook that advances the world
              // leaves this read holding the marker as it stood — which is
              // exactly the stale half of a torn pair.
              const rows =
                world.marker === undefined
                  ? []
                  : [
                      {
                        key: FIELD_GROUP_MIGRATION_KEY,
                        value: JSON.stringify(world.marker),
                      },
                    ];
              world.onMarkerRead?.();
              return Promise.resolve(rows);
            },
          }),
        }),
      }),
    }),
    executeQuery: () => Promise.resolve([]),
    queryStatement: (statement: SQL) => Promise.resolve(interpret(statement)),
    tableExists: (name: string) =>
      Promise.resolve(
        world.tables.includes(name) &&
          !(world.invisibleToTableExists ?? []).includes(name)
      ),
    listTables: () => {
      trace.push("catalog");
      // Captured before the hook runs, so a hook that removes a table leaves this listing holding
      // it — a name that exists when listed and is gone when read.
      const listed = [...world.tables];
      catalogReads += 1;
      world.onCatalogRead?.(catalogReads);
      return Promise.resolve(listed);
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
          columns: (world.columns?.[name] ?? columnsForTable(world, name)).map(
            column => ({ name: column, type: "text", nullable: false })
          ),
        })),
    })
  );

  return {
    adapter,
    trace,
    writes,
    /**
     * Hand the lock to somebody mid-test, the way a writer claiming it does.
     *
     * The double reads its owner at query time, so this is visible to every
     * later observation — which is what lets a test place a writer's arrival
     * AFTER the observation taken at the top of a session.
     */
    claimLock: (owner: string | null) => {
      lock.owner = owner;
      // A claim handed over mid-test is a live one, and a row handed back is free: NULL means
      // "nothing to expire" in both readings, which is what these worlds meant before the column.
      lock.expiresAt = null;
    },
  };
}

/** A table's columns, honouring a world that predates the i18n column. */
function columnsForTable(world: RunWorld, table: string): string[] {
  const columns = defaultColumnsFor(table);
  if (world.noLocalizedColumn !== true) return columns;
  return columns.filter(column => column !== "localized");
}

/**
 * What a table of each kind carries when a test does not say.
 *
 * A field-group data table has to carry its discriminator or the probe reports
 * it unmigrated, which would make every test look like the damaged case.
 */
function defaultColumnsFor(table: string): string[] {
  // The registry itself, whose `localized` column the read path probes for
  // before selecting it. A world that omitted it would exercise only the
  // pre-i18n branch.
  if (table === TARGET_REGISTRY || table === LEGACY_REGISTRY) {
    return ["id", "slug", "table_name", "localized"];
  }
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

/**
 * A marker recording an upward run this build considers complete.
 *
 * Versioned from the constant rather than a literal, because these cases are
 * about lock ordering and parent pointers rather than about what a version
 * means. A literal here silently becomes a stale marker on the next bump, and
 * the suite then reports a completeness refusal as though it were the behaviour
 * under test. Cases that ARE about a version pin their own literal.
 */
function settledRun() {
  return {
    version: MIGRATION_MARKER_VERSION,
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
      marker: settledRun(),
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        backupConfirmed: true,
      })
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
      marker: settledRun(),
      // The marker says the migration finished, but the migrated registry is
      // not there and the legacy one is.
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // The registry existing proves only that the registry exists. A data table it
  // points at is what content is read from, and the read path treats a missing
  // one as an empty result rather than an error — so an incomplete rename would
  // serve blank content while the marker reported success.
  it("refuses a settled marker whose data table is missing", async () => {
    const { adapter } = createRunWorld({
      marker: settledRun(),
      tables: [TARGET_REGISTRY],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // The same check the other way: a data table present but still carrying the
  // legacy discriminator has not been migrated, whatever the marker says.
  it("refuses a settled marker whose discriminator was not renamed", async () => {
    const { adapter } = createRunWorld({
      marker: settledRun(),
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
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  // A rollback reverses a persisted plan and nothing else can supply it: no
  // property of the database says which `fg_*` names this migration created.
  it("refuses a rollback with no recorded plan", async () => {
    const { adapter } = createRunWorld({
      marker: settledRun(),
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "down",
      backupConfirmed: true,
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
    const rows = await readRegistryRows(adapter, "postgresql", PRESERVING);
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
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toBe(
        "settled marker predates work this build performs"
      );
    }
  });

  // 🔴 Version 3 settled without ever re-examining the registries, so a
  // definition saved while that run was in flight could land behind the rewrite
  // that had already passed and still be recorded as complete. Structure and
  // parent pointers cannot see stored vocabulary, so accepting the marker would
  // report success over legacy field definitions nothing would revisit. Pinned
  // to the literal 3: an offset from the current constant moves with it.
  it("refuses a settled marker from the build with no registry check", async () => {
    const { adapter } = createRunWorld({
      marker: { version: 3, status: "settled", generation: "field-groups-v2" },
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toBe(
        "settled marker predates work this build performs"
      );
      expect(error.logContext?.recordedVersion).toBe(3);
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
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "down",
        backupConfirmed: true,
      })
    ).resolves.toEqual({ ran: false, reason: "already-migrated" });
  });
});

describe("a settled marker over content that was restored", () => {
  /**
   * A completed run, with the plan it applied.
   *
   * Versioned from the constant for the same reason {@link settledRun} is:
   * these cases are about content that disagrees with a current marker, so a
   * stale version would turn them into completeness-refusal cases instead.
   */
  const settledWithPlan = {
    version: MIGRATION_MARKER_VERSION,
    status: "settled",
    generation: "field-groups-v2",
    appliedManifest: [
      { kind: "table", from: "comp_hero", to: "fg_hero" },
      {
        kind: "registry",
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
    ],
  };

  // 🔴 A marker can be current and the content still wrong: restored from a
  // backup taken before the run, or repaired by hand. A stale `_parent_table`
  // is invisible to a structural check — every table and column is exactly
  // where it should be — while nested reads filter on `fg_hero` and find
  // nothing. Reporting `already-migrated` there hides missing content behind a
  // success.
  it("refuses when a row still addresses a renamed-away table", async () => {
    const { adapter } = createRunWorld({
      marker: settledWithPlan,
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
      stalePointers: { fg_hero: "comp_hero" },
    });

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      backupConfirmed: true,
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
    if (NextlyError.is(error)) {
      expect(error.logContext?.reason).toBe(
        "a parent pointer still names storage this run renamed away"
      );
    }
  });

  // A pointer at a table the run never renamed is a legitimate parent — every
  // top-level instance holds one — so the scan must not refuse on it.
  it("accepts a pointer at a table the run did not rename", async () => {
    const { adapter } = createRunWorld({
      marker: settledWithPlan,
      tables: [TARGET_REGISTRY, "fg_hero"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
      stalePointers: { fg_hero: "dc_pages" },
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        backupConfirmed: true,
      })
    ).resolves.toEqual({ ran: false, reason: "already-migrated" });
  });
});

describe("deciding whether the registry carries the i18n column", () => {
  // 🔴 Drizzle wraps a driver error as `Failed query: <the SQL>`, so the SQL's
  // own text — which names `localized` — is inside EVERY message that query can
  // produce. A predicate reading the message therefore falls back on any
  // failure at all, including a permission error on that one column: every
  // companion is then classified as absent and the migration settles with
  // localized storage still under its legacy name. The catalog answers the same
  // question without the ambiguity.
  it("propagates a failure that is not the column being absent", async () => {
    const { adapter } = createRunWorld({
      tables: [TARGET_REGISTRY, "fg_hero"],
      denyLocalizedColumn: true,
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 1 },
      ],
    });

    await expect(
      readRegistryRows(adapter, "postgresql", PRESERVING)
    ).rejects.toThrowError(/Failed query/);
  });

  // The column genuinely absent is still tolerated, and still means the true
  // thing: such a database predates i18n and has no companions at all.
  it("reads a database that predates the column without failing", async () => {
    const { adapter } = createRunWorld({
      tables: [TARGET_REGISTRY, "fg_hero"],
      noLocalizedColumn: true,
      registryRows: [{ id: "1", slug: "hero", table_name: "fg_hero" }],
    });

    const rows = await readRegistryRows(adapter, "postgresql", PRESERVING);
    expect(rows[0]?.hasCompanion).toBe(false);
  });
});

/**
 * The two things an operator does before this touches their data.
 *
 * Both are decisions made before anything executes, which is why they sit beside the other
 * ordering tests: what matters is not that they exist but WHERE in the sequence they act. The
 * acknowledgement is a precondition and must refuse before contending for the lock; the dry run is
 * the opposite and must run late enough to have scored the plan against the live catalog.
 */
describe("the backup acknowledgement", () => {
  /** An un-migrated database with one field group, so there is real work to plan. */
  function unmigrated() {
    return createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });
  }

  it("refuses a run that would write without one", async () => {
    const { adapter } = unmigrated();

    const error = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch((caught: unknown) => caught);

    expect(NextlyError.is(error)).toBe(true);
  });

  it("refuses BEFORE taking the lock", async () => {
    // A precondition that contends for the lock first has already interfered with whatever else
    // was trying to change schema, in order to deliver a refusal it could have given immediately.
    const { adapter, trace } = unmigrated();

    await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
    }).catch(() => undefined);

    expect(trace).toEqual([]);
  });

  it("is not required for a dry run", async () => {
    // The operator's first action is to look at the plan. Demanding they assert a backup before
    // they are allowed to look teaches them to assert it without meaning it.
    const { adapter } = unmigrated();

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).resolves.toMatchObject({ ran: false, reason: "dry-run" });
  });
});

describe("a dry run", () => {
  function unmigrated() {
    return createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });
  }

  it("reports renames scored against the live catalog", async () => {
    const { adapter } = unmigrated();

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    // The separating assertion. A dry run returning before reconciliation has nothing to report,
    // and an empty list is also what a database with no work returns — so a non-empty plan naming
    // the legacy registry is what distinguishes "reconciled" from "returned early".
    expect(outcome.renames.length).toBeGreaterThan(0);
    expect(outcome.renames.some(entry => entry.from === LEGACY_REGISTRY)).toBe(
      true
    );
  });

  // A localized field group moves its `_locales` companion on the same manifest
  // entry as its own table, so a preview reading `from` and `to` off the entry
  // names one rename where two happen -- and omits the one an operator is least
  // likely to predict.
  it("names a localized field group's companion table too", async () => {
    const { adapter } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "comp_hero_locales"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "comp_hero", localized: true },
      ],
    });

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    expect(outcome.renames).toContainEqual({
      from: "comp_hero",
      to: "fg_hero",
    });
    expect(outcome.renames).toContainEqual({
      from: "comp_hero_locales",
      to: "fg_hero_locales",
    });
  });

  it("reads the catalog but records nothing", async () => {
    const { adapter, trace, writes } = unmigrated();

    await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    // 🔴 The lock is NOT taken, and that is the assertion rather than an omission. Claiming it
    // creates the table and writes an owner, so a preview that claimed was issuing DDL -- which a
    // read-only role is refused outright. `trace` records a claim, so its absence is what makes
    // "this wrote nothing" observable rather than merely stated.
    expect(trace).not.toContain("lock");
    expect(writes.marker).toBe(0);
  });

  // The separating case for the whole change. The fixture above pre-seeds the lock row, so it
  // cannot tell "did not claim" from "claimed a row that already existed" -- and the operator this
  // is for meets a database where the table has never been created at all.
  it("touches nothing on a database that has never run a migration", async () => {
    const { adapter, trace, writes } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    // Still a real plan: a run that refused early would also write nothing, and would be
    // indistinguishable from this without asserting the preview it was asked for.
    expect(outcome.renames.length).toBeGreaterThan(0);
    // Nothing can hold a lock whose table does not exist, so `not-held` is a complete answer here
    // rather than an absence of one. `unknown` would be the answer if the table were unreadable.
    expect(outcome.lock).toEqual({ kind: "not-held" });
    expect(trace).not.toContain("lock");
    expect(writes.marker).toBe(0);
  });

  it("reports the holder instead of refusing when a run is in flight", async () => {
    const { adapter } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:up#someone-else",
    });

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    // A claiming session refuses here. Observing reports it, because nothing acts on a preview:
    // the operator needs to know the answer is moving, not to be denied the answer.
    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.lock).toEqual({
      kind: "held",
      owner: "field-group-migration:up#someone-else",
    });
  });
});

/**
 * A preview reads the marker, the registry and the catalog as separate queries and holds no lock,
 * so a writer advancing between them hands it a pair of answers no single instant ever held. The
 * plan is then scored against a world that never existed, and reconciliation refuses — in exactly
 * the contended case an unlocked preview exists to serve.
 *
 * The reads are re-taken TOGETHER rather than the catalog alone, and these fix that: the marker
 * decides the already-migrated exit and which entries are selected, so a retry that re-read only
 * the catalog would converge on a stale marker while looking entirely correct.
 */
describe("a preview that meets a writer mid-run", () => {
  /** How many times the run read the marker, which is once per session. */
  function markerReads(trace: Trace): number {
    return trace.filter(entry => entry === "marker").length;
  }

  /**
   * A catalog that has moved past the marker: the data table already carries its
   * migrated name while nothing recorded says a run reached that point.
   *
   * This is the pair a reader gets by reading the marker before the writer's
   * rename commits and the catalog after — the reads happen in that order, so it
   * is the interleaving this path actually meets.
   */
  function tornWorld(): RunWorld {
    return {
      // 🔴 The lock table AND a holder, because the catalog alone cannot tell these two apart. A
      // data table under its migrated name with nothing recorded is raised by a writer caught
      // mid-rename and equally by a table belonging to someone else that happens to occupy the
      // name this migration wants. An observed holder is the only evidence separating them, so a
      // world modelling contention has to carry one.
      tables: [LEGACY_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:up#someone-else",
    };
  }

  /** The same catalog with nobody writing: a storage conflict, not a torn read. */
  function quietWorld(): RunWorld {
    return {
      tables: [LEGACY_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    };
  }

  // 🔴 THE separating test for re-reading the whole session. The world advances the MARKER between
  // attempts, and nothing else: a retry that re-read only the catalog would still be holding the
  // first marker and would refuse again. Reaching a settled outcome is only possible if the second
  // attempt read the marker afresh.
  it("re-reads the marker, not just the catalog", async () => {
    const world = tornWorld();
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      if (reads > 1) return;
      // The writer finished and settled while the preview was in flight.
      world.marker = settledRun();
      world.tables = [TARGET_REGISTRY, "fg_hero"];
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    // Without the retry this throws; with a catalog-only retry it throws too, because the marker
    // it re-scored against would still be the absent one.
    expect(outcome).toMatchObject({ ran: false, reason: "already-migrated" });
    expect(markerReads(trace)).toBe(2);
  });

  // The control the retry needs to be safe. Retrying a refusal that re-reading cannot clear would
  // burn the attempts and then report it as contention -- turning a correct, loud refusal about the
  // operator's storage into a soft wrong answer, which is worse than the defect being fixed.
  it("does not retry a refusal that re-reading cannot clear", async () => {
    // Both names present: the target this run wants is occupied by something that is not its own
    // finished work. No amount of re-reading changes that.
    const { adapter, trace } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "fg_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason === "migration target name is already in use"
    );

    // The assertion that separates "refused" from "refused after three tries". A permanent refusal
    // reported only at the end would still look like this without it.
    expect(markerReads(trace)).toBe(1);
  });

  // 🔴 THE control for gating the retry on observed contention. This catalog is identical to
  // `tornWorld()` — source gone, target present, nothing recorded — and differs only in that
  // nobody holds the lock. That makes it the storage conflict the branch's own comment describes:
  // a table belonging to someone else sitting on the name this migration wants. Reporting it as an
  // unreconciled plan would describe a database standing still as one that is moving, and bury a
  // real conflict under the word "contention".
  it("refuses a storage conflict rather than calling it contention", async () => {
    const { adapter, trace } = createRunWorld(quietWorld());

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason ===
          "an object using the migrated storage name exists but no recorded progress accounts for it"
    );

    // Re-read three times, then raised. The lock is no longer consulted to decide whether to look
    // again — two probes cannot see a writer that acquires and releases between them — so a quiet
    // database pays two extra read cycles to reach the same answer. The VERDICT is what matters and
    // it is unchanged: an unmoving world is a conflict, however many times it is read.
    expect(markerReads(trace)).toBe(3);
  });

  // 🔴 The lock observation is taken once, at the top of the session, and answers "was anyone
  // writing when this attempt STARTED". The question that decides a retry is "was anyone writing
  // DURING it" — a writer claiming immediately after the observation still moves storage between
  // the marker and catalog reads, producing a genuinely torn refusal that a stale `not-held` would
  // dismiss as a permanent conflict. Deciding on the snapshot alone loses exactly the race the
  // retry exists for.
  it("re-reads the lock before dismissing a torn preview", async () => {
    const world = quietWorld();
    let reads = 0;
    const built = createRunWorld(world);
    world.onMarkerRead = () => {
      reads += 1;
      // A writer claims AFTER this attempt observed the lock as free.
      if (reads === 1) built.claimLock("field-group-migration:down#latecomer");
      // ...and finishes, leaving storage consistent for the retry to score.
      if (reads === 2)
        world.tables = [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE];
    };

    const outcome = await runFieldGroupMigration({
      adapter: built.adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    // Judged on the snapshot alone this is the storage-conflict case above and refuses at once.
    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.basis).toEqual({ kind: "reconciled" });
    expect(markerReads(built.trace)).toBe(2);
  });

  // 🔴 The parent-pointer sweep runs BEFORE the probe inside the settled-marker verification, so
  // it is the refusal an unlocked preview actually meets when a rollback is rewriting `_parent_table`
  // back to legacy names. Classifying only the probe left this one raising ahead of it, and the
  // retry never saw a refusal it recognised.
  it("re-reads when a rollback is rewriting parent pointers", async () => {
    const settledWithPlan = {
      version: MIGRATION_MARKER_VERSION,
      status: "settled",
      generation: "field-groups-v2",
      appliedManifest: [
        { kind: "table", from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry",
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ],
    };
    const world: RunWorld = {
      marker: settledWithPlan,
      tables: [TARGET_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
      // A rollback has already put a legacy name back into the pointer column.
      stalePointers: { fg_hero: "comp_hero" },
      lockOwner: "field-group-migration:down#someone-else",
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      // 🔴 Applied on the SECOND read, and ONLY to the pointers. The hook fires between an
      // attempt's marker read and its later reads, so clearing at read 1 would revert the world
      // before attempt 1 ever reached the sweep — and the refusal it then met would be the probe's,
      // which a different test already covers. Changing nothing else keeps the sweep the only
      // thing that can refuse here.
      if (reads !== 2) return;
      world.stalePointers = {};
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    // Storage and marker agree once the pointers are repaired, so the preview reports the work as
    // done rather than previewing a plan.
    expect(outcome).toMatchObject({ ran: false, reason: "already-migrated" });
    expect(markerReads(trace)).toBe(2);
  });

  /**
   * A marker for a run of `direction` already in flight.
   *
   * The hashes sit at the marker's TOP level and the manifest hash is verified against the plan it
   * carries, so both are built from the same rows the world reports rather than written by hand —
   * a fixture that disagrees with either is rejected as corrupt before the case under test is ever
   * reached, and would fail for a reason that has nothing to do with direction.
   */
  function inFlightMarker(direction: "up" | "down") {
    const rows = [
      { id: "1", slug: "hero", tableName: "comp_hero", hasCompanion: false },
    ];
    const entries = buildMigrationManifest(rows).entries;
    return {
      version: MIGRATION_MARKER_VERSION,
      status: "migrating",
      direction,
      migrationId: "fg-test",
      step: 0,
      registryHash: hashRegistryIdentity(rows),
      manifestHash: hashManifest(entries),
      appliedManifest: entries,
    };
  }

  // 🔴 A localized group's companion is renamed by this migration too, so asking the catalog a
  // SECOND time for it lets the row and its companion describe different instants: the row still
  // under its old name, the companion already moved. That reads as `hasCompanion: false`, which
  // feeds the registry hash — so an in-flight run fails the recorded-hash comparison and refuses
  // PERMANENTLY, a refusal manufactured by the reading at the exact moment a writer is active.
  it("reads a companion from the same snapshot as its registry row", async () => {
    const { adapter } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero", "comp_hero_locales"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "comp_hero", localized: true },
      ],
      // The listing holds it; a second look does not. Only code that trusts the
      // snapshot it already took still finds the companion.
      invisibleToTableExists: ["comp_hero_locales"],
    });

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    expect(outcome.renames).toContainEqual({
      from: "comp_hero_locales",
      to: "fg_hero_locales",
    });
  });

  // 🔴 MySQL commits each `RENAME TABLE` as it is issued and the registry row is updated after, so
  // there is a VALID window in which one consistent catalog holds the migrated companion beside a
  // still-legacy registry row. Asking only the legacy spelling answers "no companion" there, which
  // changes the registry hash — and an in-flight run then fails the recorded-hash comparison and
  // refuses permanently, before the retryable block, while the lock names the writer that caused it.
  //
  // Distinct from the snapshot test above: that one separates "asked once" from "asked twice", this
  // one separates a mid-rename catalog from a settled one. A single fixture cannot do both.
  it("finds a companion already renamed ahead of its registry row", async () => {
    const { adapter } = createRunWorld({
      // Base still legacy, companion already moved — the MySQL intermediate state.
      tables: [LEGACY_REGISTRY, "comp_hero", "fg_hero_locales"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "comp_hero", localized: true },
      ],
    });

    // Asserted on the registry read itself rather than through a dry run. A preview over this
    // catalog legitimately refuses — a migrated name present with nothing recorded is the adoption
    // case — so routing the assertion through it would test that refusal instead of the companion
    // resolution, and would report the same failure whether or not the fix were present.
    const rows = await readRegistryRows(adapter, "postgresql", PRESERVING);

    expect(rows).toEqual([
      {
        id: "1",
        slug: "hero",
        tableName: "comp_hero",
        // Read only under the legacy spelling this is `false`, which drops the companion from the
        // manifest and changes the registry hash an in-flight run is compared against.
        hasCompanion: true,
      },
    ]);
  });

  // 🔴 The already-migrated exit reaches the same window as every other one: a rollback that claims
  // the lock AFTER the preview begins is exactly what makes "already migrated" a moving answer.
  // Reporting the session's opening observation there would conceal the writer this field exists to
  // expose — the same defect as on the unreconciled exit, standing on a second door.
  it("reports a holder that arrived after an already-migrated preview began", async () => {
    const world: RunWorld = {
      marker: settledRun(),
      tables: [TARGET_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: 0 },
      ],
    };
    const built = createRunWorld(world);
    // Claims after the session's own observation, which is lock read 1.
    world.onLockRead = count => {
      if (count === 1)
        built.claimLock("field-group-migration:down#arrived-late");
    };

    const outcome = await runFieldGroupMigration({
      adapter: built.adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    expect(outcome).toMatchObject({ ran: false, reason: "already-migrated" });
    if (outcome.ran !== false || outcome.reason !== "already-migrated") {
      expect.fail("expected an already-migrated outcome");
    }
    // Judged from the session's opening read this is `not-held`, which would report a database
    // being rolled back underneath the preview as one nobody is touching.
    expect(outcome.lock).toEqual({
      kind: "held",
      owner: "field-group-migration:down#arrived-late",
    });
  });

  // 🔴 The ROLLBACK mirror, and the direction where getting it wrong costs most. During a `down`
  // run the registry row still says `fg_hero` while MySQL may already have committed the companion
  // back to `comp_hero_locales`. `retargetName` only maps legacy names FORWARD, so it answers
  // `null` here — the reverse cannot be derived at all, because a prefix rule going down would
  // rename an author's own `fg_hero` to `comp_hero`. Only the recorded plan distinguishes a name
  // this migration made from one that was always there.
  it("finds a companion reverted ahead of its registry row", async () => {
    const { adapter } = createRunWorld({
      // Row still migrated, companion already back — the MySQL window during a rollback.
      tables: [TARGET_REGISTRY, "fg_hero", "comp_hero_locales"],
      registryRows: [
        { id: "1", slug: "hero", table_name: "fg_hero", localized: true },
      ],
    });

    const rows = await readRegistryRows(adapter, "postgresql", PRESERVING, [
      { kind: "table", from: "comp_hero", to: "fg_hero" },
    ]);

    expect(rows).toEqual([
      {
        id: "1",
        slug: "hero",
        tableName: "fg_hero",
        // Derived forward only, this is `false`: the plan then drops the companion and the
        // recorded-hash check strands the rollback.
        hasCompanion: true,
      },
    ]);
  });

  // 🔴 The THIRD exit to carry this defect, which is why the fix was structural rather than another
  // patch. A writer can claim the lock after the session's opening read and before its first
  // mutation, leaving the catalog coherent — so a preview reports a perfectly scored plan beside
  // `not-held` while a run is active, concealing exactly what the field exists to expose.
  it("reports a holder that arrived during a reconciled preview", async () => {
    const world: RunWorld = {
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    };
    const built = createRunWorld(world);
    // Claims after the session's own observation, which is lock read 1.
    world.onLockRead = count => {
      if (count === 1) built.claimLock("field-group-migration:down#arrived");
    };

    const outcome = await runFieldGroupMigration({
      adapter: built.adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    // The plan IS scored — this is the ordinary success path, not a contended one.
    expect(outcome.basis).toEqual({ kind: "reconciled" });
    expect(outcome.renames.length).toBeGreaterThan(0);
    // ...and it still names the writer that arrived while it was being scored.
    expect(outcome.lock).toEqual({
      kind: "held",
      owner: "field-group-migration:down#arrived",
    });
  });

  // 🔴 The retry decision and the reported lock must come from ONE observation. Reducing the
  // recheck to a boolean was enough to decide and not enough to report: the outcome carried the
  // session's opening `not-held` beside a `basis` saying contention, so the single field an
  // operator checks to understand the answer contradicted the answer.
  it("reports the holder that justified an unreconciled plan", async () => {
    const world = quietWorld();
    world.lockOwner = "field-group-migration:down#early";
    // 🔴 The DATABASE has to move for this to reach the unreconciled outcome at all, and it must do
    // so independently of the lock. Owner churn is not movement — several runs failing in turn on
    // one permanent conflict each present a fresh claim — so this alternates which of two groups is
    // caught mid-rename, exactly as a writer working through its plan does.
    world.registryRows = [
      { id: "1", slug: "hero", table_name: "comp_hero" },
      { id: "2", slug: "other", table_name: "comp_other" },
    ];
    let markerReads2 = 0;
    world.onMarkerRead = () => {
      markerReads2 += 1;
      world.tables =
        markerReads2 % 2 === 0
          ? [LEGACY_REGISTRY, "comp_hero", "fg_other", MIGRATION_LOCK_TABLE]
          : [LEGACY_REGISTRY, "comp_other", "fg_hero", MIGRATION_LOCK_TABLE];
    };
    const built = createRunWorld(world);
    // 🔴 The holder must VANISH before the final attempt observes the lock and reappear before that
    // attempt judges its refusal. Otherwise the opening observation and the recheck agree, and the
    // test cannot tell which one the outcome reported. One lock read happens per attempt while a
    // holder is visible, so releasing after the second and reclaiming after the third places the
    // change exactly inside the final attempt.
    world.onLockRead = count => {
      if (count === 2) built.claimLock(null);
      if (count === 3) built.claimLock("field-group-migration:down#latecomer");
    };

    const outcome = await runFieldGroupMigration({
      adapter: built.adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.basis).toMatchObject({ kind: "unreconciled" });
    // The separating assertion: judged from the session's opening snapshot this reads `not-held`,
    // which would describe a contended answer as having no writer behind it.
    expect(outcome.lock).toEqual({
      kind: "held",
      owner: "field-group-migration:down#latecomer",
    });
  });

  // A preview meeting a run going the other way is the case an operator most needs answered, and it
  // was the one that still refused. REPORTED rather than retried: unlike a torn read this is an
  // accurate observation that stays true for as long as the other run takes.
  it("reports rather than refuses when a run goes the other way", async () => {
    const world: RunWorld = {
      marker: inFlightMarker("down"),
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:down#someone-else",
    };
    // 🔴 The step ADVANCES between attempts, which is what a live run does and a crashed one cannot.
    // Without it this fixture is the stranded-migration case below and must refuse.
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      world.marker = { ...inFlightMarker("down"), step: reads };
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.basis).toEqual({
      kind: "unreconciled",
      reason: "a run in the other direction is in flight",
    });
    expect(outcome.renames.length).toBeGreaterThan(0);
    expect(outcome.lock).toMatchObject({ kind: "held" });
    expect(markerReads(trace)).toBe(3);
  });

  // 🔴 The stranded-migration control. This lock survives process death, so a CRASHED `down` run
  // leaves its migrating marker AND its held row behind. Read once, that is indistinguishable from
  // a live run — and reporting it as contention would tell the operator who must act to wait
  // instead. Nothing advances here, and an unchanged world is what exposes the difference.
  it("refuses a stranded run in the other direction", async () => {
    const { adapter, trace } = createRunWorld({
      marker: inFlightMarker("down"),
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:down#crashed",
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason === "a run in the other direction is in flight"
    );

    expect(markerReads(trace)).toBe(3);
  });

  // The writing counterpart, which must NOT be softened: two runs travelling opposite ways over the
  // same storage is the collision the lock exists to prevent.
  it("still refuses a writing run that meets the other direction", async () => {
    const { adapter } = createRunWorld({
      marker: inFlightMarker("down"),
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        backupConfirmed: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason === "a run in the other direction is in flight"
    );
  });

  // 🔴 A writer that acquires AND releases between the two lock probes is invisible to both. The
  // preview reads the old marker, is descheduled while a short migration completes, and then reads
  // the new catalog — a torn read whose sole cause is contention, with `not-held` at either end.
  // Gating the retry on lock visibility refused exactly this, in the one case the retry exists for.
  it("re-reads a tear left by a writer that already finished", async () => {
    const world: RunWorld = {
      // Torn: the migrated name is present with nothing recorded accounting for it.
      tables: [LEGACY_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      // No holder at any point — the writer came and went between probes.
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      // On the SECOND read: the hook fires between an attempt's marker read and its catalog read,
      // so repairing at read 1 would hand attempt 1 the coherent world and it would never tear.
      if (reads !== 2) return;
      // The writer's work is done and the catalog is coherent again.
      world.tables = [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE];
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a 503");
    }
    expect(outcome.basis).toEqual({ kind: "reconciled" });
    // Never observed held, and re-read anyway — which is the whole point.
    expect(outcome.lock).toEqual({ kind: "not-held" });
    expect(markerReads(trace)).toBe(2);
  });

  // 🔴 The move-once-then-stop case. A rival that advances between the first two attempts and then
  // CRASHES leaves the final two reads identical and its claim stranded. A flag recording whether
  // the world ever moved still calls that live, so the preview would report contention while the
  // operator's actual task is recovery — the stranded-run answer arriving one attempt later.
  it("refuses a rival that moved once and then died", async () => {
    const world: RunWorld = {
      marker: inFlightMarker("down"),
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:down#died-midway",
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      // Advances once (so attempts 1 and 2 differ), then never again.
      if (reads === 1) world.marker = { ...inFlightMarker("down"), step: 1 };
    };
    const { adapter, trace } = createRunWorld(world);

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason === "a run in the other direction is in flight"
    );

    expect(markerReads(trace)).toBe(3);
  });

  // 🔴 The OUTER exhaustion path, which no fixture could reach until the catalog seam existed.
  //
  // A later attempt can fail EARLIER than the one before it: `readRegistryRows` lists the catalog
  // and then selects from the registry it found, and a writer renaming between those two queries
  // makes the select raise a missing-table error — before the inner `try` opens, so the inner
  // fallback never sees it. Exhausting there returned a raw driver error instead of the documented
  // preview, in exactly the contended case the outcome exists to describe.
  it("reports a preview when the final attempt loses the registry", async () => {
    const world: RunWorld = {
      // Torn: the migrated name is present with nothing recorded accounting for it, so attempts 1
      // and 2 raise a retryable refusal and populate the remembered plan.
      tables: [LEGACY_REGISTRY, "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:down#writer",
    };
    let markerReadCount = 0;
    world.onMarkerRead = () => {
      markerReadCount += 1;
      // The writer keeps moving, so the world differs between attempts.
      world.lockOwner = `field-group-migration:down#writer-${markerReadCount}`;
    };
    const built = createRunWorld(world);
    world.onLockRead = count => {
      built.claimLock(`field-group-migration:down#writer-${count}`);
    };
    world.onCatalogRead = count => {
      // Two catalog listings happen per attempt — one for the registry read, one for the plan's
      // catalog — so the FINAL attempt's first listing is the fifth. The registry vanishes right
      // after it is listed and before it is selected from.
      if (count === 5) world.tables = ["fg_hero", MIGRATION_LOCK_TABLE];
    };

    const outcome = await runFieldGroupMigration({
      adapter: built.adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a raw driver error");
    }
    expect(outcome.basis).toMatchObject({ kind: "unreconciled" });
    // 🔴 Non-empty, and that is the point: the plan comes from the last attempt that got far enough
    // to build one. Reporting none would say "nothing to do" about a database being written to.
    expect(outcome.renames.length).toBeGreaterThan(0);
  });

  // 🔴 The control that separates the two: owners rotate, storage does not. Several invocations acquiring
  // the lock in turn and failing on ONE permanent conflict each present a fresh claim UUID, so an
  // owner folded into the movement signature makes an unmoving database look like a moving one —
  // and a persistent storage conflict is then reported as contention.
  it("refuses when the lock owner rotates but storage does not", async () => {
    const world = tornWorld();
    const built = createRunWorld(world);
    // A different holder on every observation, and nothing else changes.
    world.onLockRead = count => {
      built.claimLock(`field-group-migration:up#claim-${count}`);
    };

    await expect(
      runFieldGroupMigration({
        adapter: built.adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason ===
          "an object using the migrated storage name exists but no recorded progress accounts for it"
    );
  });

  // 🔴 THE control for the durable-claim hole. A claim outlives the process that made it until its
  // expiry passes, and a run that dies stops renewing rather than releasing — so for that window
  // the row still reads as held with nobody behind it, and every attempt of a retry cycle falls
  // inside it. A held row therefore proves ownership was RECORDED, not that anyone is moving — and
  // combined with a
  // genuinely permanent mismatch it would spend three attempts and then report a storage conflict
  // as contention, which is the answer this whole path exists to remove arriving by another door.
  // Nothing changes across the attempts here, and an unchanged world is the signature of a claim
  // nobody is behind.
  it("refuses a permanent mismatch behind a lock nobody is moving", async () => {
    const { adapter, trace } = createRunWorld(tornWorld());

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason ===
          "an object using the migrated storage name exists but no recorded progress accounts for it"
    );

    // Re-read, because the held row is a reason to look again — but raised, because looking again
    // found the identical world every time.
    expect(markerReads(trace)).toBe(3);
  });

  // The plan is reported rather than withheld, and labelled rather than passed off as scored. An
  // empty list would read as "nothing to do", which is the silent wrong answer this whole path
  // exists to remove.
  it("reports an unreconciled plan when the writer never lets go", async () => {
    // 🔴 The world MOVES between attempts, because that is what separates a live writer from a
    // claim a dead process left behind. Two groups, and which one is caught mid-rename changes each
    // time — a writer working through its plan. A static world with a held row is the durable-claim
    // case below, and must refuse rather than be reported as traffic.
    const world: RunWorld = {
      tables: [LEGACY_REGISTRY, "comp_other", "fg_hero", MIGRATION_LOCK_TABLE],
      registryRows: [
        { id: "1", slug: "hero", table_name: "comp_hero" },
        { id: "2", slug: "other", table_name: "comp_other" },
      ],
      lockOwner: "field-group-migration:up#someone-else",
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      world.tables =
        reads % 2 === 0
          ? [LEGACY_REGISTRY, "comp_hero", "fg_other", MIGRATION_LOCK_TABLE]
          : [LEGACY_REGISTRY, "comp_other", "fg_hero", MIGRATION_LOCK_TABLE];
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.basis).toEqual({
      kind: "unreconciled",
      reason:
        "an object using the migrated storage name exists but no recorded progress accounts for it",
    });
    // 🔴 Never empty. The manifest's renames are an upper bound rather than the outstanding subset,
    // which is what `basis` says -- but reporting none would tell an operator there is no work.
    expect(outcome.renames.length).toBeGreaterThan(0);
    expect(outcome.renames).toContainEqual({
      from: "comp_hero",
      to: "fg_hero",
    });
    expect(markerReads(trace)).toBe(3);
  });

  // A scored plan says so, so a caller can tell the two apart without inspecting the renames.
  it("reports a reconciled basis when nothing is contending", async () => {
    const { adapter } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome");
    }
    expect(outcome.basis).toEqual({ kind: "reconciled" });
  });

  // A discriminator column is renamed by the same run, scored by a different function, and raises
  // the same PAIR of marker-vs-catalog refusals as a table does. Classifying only the table pair
  // left the column pair escaping as a 503 during exactly the contention the retry exists for.
  it("re-reads a torn discriminator column, not only a torn table", async () => {
    const world: RunWorld = {
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      // A holder, because the retry requires an observed writer and not merely a torn-shaped
      // refusal. Without one this same catalog is a permanent mismatch, which is the point of the
      // conflict control above.
      lockOwner: "field-group-migration:down#someone-else",
      // The column already carries its migrated name while nothing recorded says a run got there:
      // a rollback in flight, caught between reverting the column and settling its marker.
      columns: {
        comp_hero: ["id", "_parent_id", "_parent_table", "_field_group_type"],
      },
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      // Applied on the SECOND read, not the first. The hook fires between this
      // attempt's marker read and its catalog read, so changing the world at
      // read 1 would clear the tear before attempt 1 ever saw it — and the test
      // would pass without a retry ever happening.
      if (reads !== 2) return;
      // The rollback finished reverting the column.
      world.columns = {
        comp_hero: ["id", "_parent_id", "_parent_table", "_component_type"],
      };
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(outcome.basis).toEqual({ kind: "reconciled" });
    expect(markerReads(trace)).toBe(2);
  });

  // The column-side control. A table carrying BOTH spellings is not a torn read of one state, it is
  // a database holding two, and re-reading returns it every time.
  it("does not retry a column refusal that describes the database itself", async () => {
    const { adapter, trace } = createRunWorld({
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      columns: {
        comp_hero: [
          "id",
          "_parent_id",
          "_parent_table",
          "_component_type",
          "_field_group_type",
        ],
      },
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason ===
          "both discriminator columns exist on one table"
    );

    expect(markerReads(trace)).toBe(1);
  });

  // The settled-marker check runs BEFORE the plan is ever reconciled, so it sits outside the block
  // that classifies torn reads. An `up` preview reading a settled v2 marker while a `down` run moves
  // storage back to legacy meets a mismatch the database was never in.
  it("re-reads a settled marker the catalog is moving away from", async () => {
    const world: RunWorld = {
      marker: settledRun(),
      // Storage a concurrent rollback has already returned to its legacy names, and the rollback
      // still holding the lock — which is what makes this a torn read rather than a database
      // someone restored inconsistently.
      tables: [LEGACY_REGISTRY, "comp_hero", MIGRATION_LOCK_TABLE],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
      lockOwner: "field-group-migration:down#someone-else",
    };
    let reads = 0;
    world.onMarkerRead = () => {
      reads += 1;
      if (reads > 1) return;
      // The rollback settled, and its marker now agrees with the storage.
      world.marker = {
        version: MIGRATION_MARKER_VERSION,
        status: "settled",
        generation: "legacy",
      };
    };
    const { adapter, trace } = createRunWorld(world);

    const outcome = await runFieldGroupMigration({
      adapter,
      logger,
      direction: "up",
      dryRun: true,
    });

    if (outcome.ran !== false || outcome.reason !== "dry-run") {
      expect.fail("expected a dry-run outcome, not a refusal");
    }
    expect(markerReads(trace)).toBe(2);
  });

  // 🔴 The mismatch that does NOT clear must still refuse. This same check is what catches storage
  // restored from a backup taken before the run, and reporting that as a preview would describe a
  // database the read path cannot serve as though it were merely contended.
  it("still refuses a settled marker the catalog permanently contradicts", async () => {
    const { adapter, trace } = createRunWorld({
      marker: settledRun(),
      tables: [LEGACY_REGISTRY, "comp_hero"],
      registryRows: [{ id: "1", slug: "hero", table_name: "comp_hero" }],
    });

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        dryRun: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason ===
          "marker reports a completed migration but the migrated registry is absent"
    );

    // Re-read, then raised. Nothing moves across the attempts, which is what identifies a database
    // that genuinely disagrees with its marker — restored from a backup taken before the run —
    // rather than one being read mid-flight. Absence of a lock holder is NOT that evidence: a
    // writer can finish between two probes and be invisible to both.
    expect(markerReads(trace)).toBe(3);
  });

  // 🔴 A run that WRITES holds the lock, which excludes the very writer a retry exists to survive.
  // A refusal there is a fact about the database rather than a torn read of one, and re-reading it
  // would spend three sets of reads to arrive at the same refusal -- while a second run that
  // legitimately holds the lock is contended with three times instead of once.
  it("never retries a run that writes", async () => {
    const { adapter, trace } = createRunWorld(tornWorld());

    await expect(
      runFieldGroupMigration({
        adapter,
        logger,
        direction: "up",
        backupConfirmed: true,
      })
    ).rejects.toSatisfy(
      error =>
        NextlyError.is(error) &&
        error.logContext?.reason === "migration lock is held elsewhere"
    );

    // 🔴 Zero, and that is the assertion. Against the very world a preview re-reads, a run that
    // writes never gets as far as the marker: the lock refuses it outright. That is why the retry
    // belongs to the preview alone — the writing path is excluded by the mechanism a retry exists
    // to survive, so it can never be reading a state someone else is moving.
    expect(markerReads(trace)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import {
  buildMigrationManifest,
  invertManifest,
  MIGRATION_TARGET,
  type RegistryRow,
} from "../manifest";
import { probeStorage, reconcilePlan, type TableColumns } from "../reconcile";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return { slug: "hero", tableName: "comp_hero", hasCompanion: false, ...over };
}

const LEGACY_COLUMN = STORAGE_FORMAT.columns.type;
const TARGET_COLUMN = MIGRATION_TARGET.columnType;

/** Postgres: every identifier is quoted, so case is significant. */
const PRESERVING = identifierCaseRules({ dialect: "postgresql" });
/** SQLite, and MySQL under lower_case_table_names=1. */
const FOLDING = identifierCaseRules({ dialect: "sqlite" });

/** A pre-migration catalog: the legacy registry plus the row's own table. */
const BEFORE = ["dynamic_components", "comp_hero"];
/** After the run: everything renamed. */
const AFTER = ["dynamic_field_groups", "fg_hero"];

/** Give every named table the legacy discriminator unless told otherwise. */
function columnsFor(
  tables: readonly string[],
  overrides: Record<string, string[]> = {}
): TableColumns[] {
  return tables.map(table => ({
    table,
    columns: overrides[table] ?? [LEGACY_COLUMN],
  }));
}

function capture(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    expect.fail(`expected a NextlyError, received ${String(error)}`);
  }
  expect.fail("expected a refusal, but the call returned normally");
}

// 🔴 A rollback torn between a rename and its registry pointer update leaves
// the row naming the migrated table while the catalog already holds the legacy
// one. `retargetName` maps a legacy spelling FORWARD and returns null for
// anything else, so it cannot name where a rollback is taking a migrated table —
// only the directed plan can, and without it the row's storage reads as absent.
describe("a rollback torn before its pointer update", () => {
  const migratedRow = { ...row(), tableName: "fg_hero" };
  const down = invertManifest(buildMigrationManifest([row()]).entries).entries;

  // Going down the registry renames first and the table last, so reaching the
  // table step means the two before it are recorded. Its rename then committed
  // -- MySQL commits DDL as it is issued -- while the registry pointer update
  // that shares its transaction did not, which is the supported
  // commit-before-marker window.
  const TORN_CATALOG = ["dynamic_components", "comp_hero"];

  function reconcileTorn() {
    return reconcilePlan({
      entries: down,
      rows: [migratedRow],
      tables: TORN_CATALOG,
      columns: columnsFor(TORN_CATALOG),
      run: { recorded: true, direction: "down", step: 2 },
      direction: "down",
      identifierCase: PRESERVING,
    });
  }

  it("recognises the storage the rollback already restored", () => {
    expect(() => reconcileTorn()).not.toThrow();
  });

  // Widening must not reach past the plan: a row whose storage is genuinely
  // absent still has to be refused, or the migration renames around data that
  // is already gone.
  it("still refuses a row whose storage is absent under either name", () => {
    const error = capture(() =>
      reconcilePlan({
        entries: down,
        rows: [migratedRow],
        tables: ["dynamic_components"],
        columns: columnsFor(["dynamic_components"]),
        run: { recorded: true, direction: "down", step: 2 },
        direction: "down",
        identifierCase: PRESERVING,
      })
    );
    expect(error.logContext?.reason).toBe(
      "registry rows name storage that does not exist"
    );
  });
});

// A localized field group moves two physical tables on ONE entry, and MySQL
// commits each rename as it is issued, so a crash lands between them. The entry
// is unsatisfied while either remains, which is the right answer for the entry
// and the wrong one for the question "what is left to do".
describe("a localized entry torn between its two renames", () => {
  const localized = row({ hasCompanion: true });
  const plan = buildMigrationManifest([localized]).entries;

  // The base has moved, its companion has not, and the registry has not: the
  // first entry's rename committed while the crash took everything after it.
  const TORN_CATALOG = [
    "dynamic_components",
    "fg_hero",
    `comp_hero${STORAGE_FORMAT.companionSuffix}`,
  ];

  function reconcileTorn() {
    return reconcilePlan({
      entries: plan,
      rows: [localized],
      tables: TORN_CATALOG,
      columns: columnsFor(TORN_CATALOG),
      // Position 1 is `step + 1`, the commit-before-marker window the runner
      // supports, which is what makes the moved base explicable rather than an
      // object no recorded progress accounts for.
      run: { recorded: true, direction: "up", step: 0 },
      direction: "up",
      identifierCase: PRESERVING,
    });
  }

  it("reports only the rename that has not happened", () => {
    const entry = reconcileTorn()[0];

    expect(entry?.pendingTableRenames).toEqual([
      {
        from: `comp_hero${STORAGE_FORMAT.companionSuffix}`,
        to: `fg_hero${STORAGE_FORMAT.companionSuffix}`,
      },
    ]);
  });

  // The separating assertion. `satisfied` is the coarser answer, and it is
  // CORRECT for what it describes -- work remains on this entry. Anything
  // deriving the outstanding renames from it reports the moved base as still to
  // move, so this pins that the two answers are allowed to differ.
  it("stays unsatisfied while its companion is outstanding", () => {
    expect(reconcileTorn()[0]?.satisfied).toBeUndefined();
  });

  it("reports both renames before either has happened", () => {
    const untouched = reconcilePlan({
      entries: plan,
      rows: [localized],
      tables: [
        "dynamic_components",
        "comp_hero",
        `comp_hero${STORAGE_FORMAT.companionSuffix}`,
      ],
      columns: columnsFor([
        "dynamic_components",
        "comp_hero",
        `comp_hero${STORAGE_FORMAT.companionSuffix}`,
      ]),
      run: { recorded: false },
      direction: "up",
      identifierCase: PRESERVING,
    });

    expect(untouched[0]?.pendingTableRenames).toEqual([
      { from: "comp_hero", to: "fg_hero" },
      {
        from: `comp_hero${STORAGE_FORMAT.companionSuffix}`,
        to: `fg_hero${STORAGE_FORMAT.companionSuffix}`,
      },
    ]);
  });

  // A column entry moves no table, so an empty list is its real answer. Asserted
  // because the alternative -- leaving it absent and falling back where it is
  // missing -- is how the coarser derivation gets back in.
  it("gives a column entry an empty list rather than none", () => {
    const column = reconcileTorn().find(entry => entry.kind === "column");

    expect(column?.pendingTableRenames).toEqual([]);
  });
});

describe("field-group migration reconciliation", () => {
  const rows = [row()];
  const plan = buildMigrationManifest(rows).entries;

  /** The common case: a plan reconciled before anything has run. */
  function untouched(over: Partial<Parameters<typeof reconcilePlan>[0]> = {}) {
    return reconcilePlan({
      entries: plan,
      rows,
      tables: BEFORE,
      columns: columnsFor(BEFORE),
      run: { recorded: false },
      direction: "up",
      identifierCase: PRESERVING,
      ...over,
    });
  }

  it("leaves outstanding work unmarked on an untouched database", () => {
    const out = untouched();
    expect(out).toHaveLength(plan.length);
    expect(out.every(e => e.satisfied === undefined)).toBe(true);
  });

  // The plan is indexed by position and identified by hash, so progress must not
  // change its length or its order.
  it("annotates applied work instead of removing it", () => {
    const out = reconcilePlan({
      entries: plan,
      rows,
      tables: AFTER,
      columns: columnsFor(AFTER, { fg_hero: [TARGET_COLUMN] }),
      run: { recorded: true, direction: "up", step: plan.length },
      direction: "up",
      identifierCase: PRESERVING,
    });
    expect(out).toHaveLength(plan.length);
    expect(out.map(e => e.kind)).toEqual(plan.map(e => e.kind));
    expect(out.every(e => e.satisfied === true)).toBe(true);
  });

  // Source gone and target present means completed work only when recorded
  // progress reached it. Otherwise the target belongs to something else and
  // adopting it would treat a stranger's table as migrated field-group storage.
  it("refuses an occupied target when no run is recorded", () => {
    const tables = ["comp_hero", "dynamic_field_groups"];
    const refusal = capture(() =>
      untouched({ tables, columns: columnsFor(tables) })
    );
    expect(refusal.logContext?.reason).toMatch(/no recorded progress/);
  });

  it("accepts an occupied target when recorded progress reaches it", () => {
    // A world consistent with that progress: the table and column steps really
    // did run, so only the registry rename sits in the crash window.
    const tables = ["fg_hero", "dynamic_field_groups"];
    const out = untouched({
      tables,
      columns: columnsFor(tables, { fg_hero: [TARGET_COLUMN] }),
      run: { recorded: true, direction: "up", step: plan.length - 1 },
    });
    expect(out.find(e => e.kind === "registry")?.satisfied).toBe(true);
  });

  it("refuses when source and target both exist", () => {
    const tables = [...BEFORE, ...AFTER];
    const refusal = capture(() =>
      untouched({
        tables,
        columns: columnsFor(tables),
        run: { recorded: true, direction: "up", step: plan.length },
      })
    );
    expect(refusal.logContext?.reason).toMatch(/already in use/);
  });

  // A custom-named row produces no rename entry, so an entry-driven check cannot
  // see it. Its table can still be missing, and the legacy read path tolerates
  // that by returning an empty result.
  it("refuses when a row this plan leaves alone has no storage", () => {
    const withCustom = [row(), row({ slug: "seo", tableName: "my_seo_block" })];
    const refusal = capture(() =>
      reconcilePlan({
        entries: buildMigrationManifest(withCustom).entries,
        rows: withCustom,
        tables: BEFORE,
        columns: columnsFor(BEFORE),
        run: { recorded: false },
        direction: "up",
        identifierCase: PRESERVING,
      })
    );
    expect(refusal.logContext?.reason).toMatch(
      /name storage that does not exist/
    );
    expect(refusal.logContext?.missing).toEqual(["my_seo_block"]);
  });

  // A custom-named row is retargeted by nothing, so the plan holds no companion
  // entry for it either: without checking it here, a dropped companion is found
  // only after other objects have already been renamed.
  it("refuses when a row this plan leaves alone has no companion", () => {
    const withCustom = [
      row(),
      row({ slug: "seo", tableName: "my_seo_block", hasCompanion: true }),
    ];
    const tables = [...BEFORE, "my_seo_block"];
    const refusal = capture(() =>
      reconcilePlan({
        entries: buildMigrationManifest(withCustom).entries,
        rows: withCustom,
        tables,
        columns: columnsFor(tables),
        run: { recorded: false },
        direction: "up",
        identifierCase: PRESERVING,
      })
    );
    expect(refusal.logContext?.missing).toEqual([
      `my_seo_block${STORAGE_FORMAT.companionSuffix}`,
    ]);
  });

  it("accepts a left-alone row whose companion is present", () => {
    const withCustom = [
      row(),
      row({ slug: "seo", tableName: "my_seo_block", hasCompanion: true }),
    ];
    const tables = [
      ...BEFORE,
      "my_seo_block",
      `my_seo_block${STORAGE_FORMAT.companionSuffix}`,
    ];
    expect(() =>
      reconcilePlan({
        entries: buildMigrationManifest(withCustom).entries,
        rows: withCustom,
        tables,
        columns: columnsFor(tables),
        run: { recorded: false },
        direction: "up",
        identifierCase: PRESERVING,
      })
    ).not.toThrow();
  });

  // MySQL under `lower_case_table_names=1` reports a verbatim name folded, so an
  // exact-only lookup would call a table that exists missing.
  it("resolves a stored name the catalog reports in a different case", () => {
    const tables = ["DYNAMIC_COMPONENTS", "COMP_HERO"];
    expect(() =>
      untouched({
        tables,
        columns: columnsFor(tables),
        identifierCase: FOLDING,
      })
    ).not.toThrow();
  });

  // The same catalog on a case-preserving server names different tables, so the
  // row's storage is genuinely absent and the near-miss is reported.
  it("refuses a case-different catalog where case is significant", () => {
    const tables = ["DYNAMIC_COMPONENTS", "COMP_HERO"];
    const refusal = capture(() =>
      untouched({ tables, columns: columnsFor(tables) })
    );
    expect(refusal.logContext?.reason).toMatch(
      /name storage that does not exist/
    );
    expect(refusal.logContext?.caseVariants).toEqual({
      comp_hero: "COMP_HERO",
    });
  });

  // The column names its post-rename table, absent from a pre-migration catalog,
  // so it is inspected on the table it has not yet moved off.
  it("keeps a column rename for a table the plan is about to create", () => {
    const column = untouched().find(e => e.kind === "column");
    expect(column).toBeDefined();
    expect(column?.satisfied).toBeUndefined();
  });

  // A table rename that commits before its marker write leaves the table present
  // both before and after the step, so only its columns distinguish outstanding
  // work from work already done.
  it("resumes across a committed table rename the marker did not record", () => {
    const tables = ["dynamic_components", "fg_hero"];
    const out = untouched({
      tables,
      columns: columnsFor(tables),
      run: { recorded: true, direction: "up", step: 0 },
    });
    expect(out[0]).toMatchObject({ kind: "table", satisfied: true });
    expect(out[1]?.kind).toBe("column");
    expect(out[1]?.satisfied).toBeUndefined();
    expect(out[2]?.kind).toBe("registry");
    expect(out[2]?.satisfied).toBeUndefined();
  });

  // Without inspecting columns the resume retries a rename whose source column
  // is already gone, and the retry fails.
  it("marks a column rename the marker did not record as done", () => {
    const tables = ["dynamic_components", "fg_hero"];
    const out = untouched({
      tables,
      columns: columnsFor(tables, { fg_hero: [TARGET_COLUMN] }),
      run: { recorded: true, direction: "up", step: 1 },
    });
    expect(out[1]).toMatchObject({ kind: "column", satisfied: true });
  });

  it("refuses a migrated column no recorded progress accounts for", () => {
    const tables = ["dynamic_components", "comp_hero"];
    const refusal = capture(() =>
      untouched({
        tables,
        columns: columnsFor(tables, { comp_hero: [TARGET_COLUMN] }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(
      /no recorded progress accounts for it/
    );
  });

  it("refuses when a table carries both discriminator spellings", () => {
    const refusal = capture(() =>
      untouched({
        columns: columnsFor(BEFORE, {
          comp_hero: [LEGACY_COLUMN, TARGET_COLUMN],
        }),
      })
    );
    expect(refusal.logContext?.reason).toMatch(/both discriminator columns/);
  });

  // Every field-group data table carries the discriminator, so a table holding
  // neither spelling is not storage this migration can reason about.
  it("refuses when a table carries neither discriminator spelling", () => {
    const refusal = capture(() =>
      untouched({ columns: columnsFor(BEFORE, { comp_hero: ["title"] }) })
    );
    expect(refusal.logContext?.reason).toMatch(/no discriminator column/);
  });

  it("refuses when a table that exists was given no columns", () => {
    const refusal = capture(() => untouched({ columns: [] }));
    expect(refusal.logContext?.reason).toMatch(/given no columns/);
  });

  // MySQL compares column names case-insensitively on every server, so the
  // discriminator must be found whatever case the catalog reports.
  it("resolves the discriminator under the column rules", () => {
    expect(() =>
      untouched({
        columns: columnsFor(BEFORE, {
          comp_hero: [LEGACY_COLUMN.toUpperCase()],
        }),
        identifierCase: FOLDING,
      })
    ).not.toThrow();
  });

  // A down plan is the inverse of an up one, so scoring one against the other's
  // progress would mark real work as done and skip it.
  it("refuses a plan reconciled against a run going the other way", () => {
    const refusal = capture(() =>
      untouched({ run: { recorded: true, direction: "down", step: 1 } })
    );
    expect(refusal.logContext?.reason).toMatch(/the other way/);
  });
});

describe("recorded progress beyond the crash window", () => {
  const rows = [
    row({ slug: "alpha", tableName: "comp_alpha" }),
    row({ slug: "beta", tableName: "comp_beta" }),
  ];
  const plan = buildMigrationManifest(rows).entries;
  // Ordered by stored table name: 1 = alpha's table, 2 = alpha's column,
  // 3 = beta's table, 4 = beta's column, 5 = the registry.
  const BETA_POSITION = 3;

  /**
   * Alpha is fully renamed and `fg_beta` exists, which is the ambiguity: it is
   * this run's work only if recorded progress reached beta's position.
   * `alphaColumn` keeps the world consistent with whichever step is claimed.
   */
  function reconcile(step: number, alphaColumn: string) {
    const tables = ["dynamic_components", "fg_alpha", "fg_beta"];
    return reconcilePlan({
      entries: plan,
      rows,
      tables,
      columns: columnsFor(tables, { fg_alpha: [alphaColumn] }),
      run: { recorded: true, direction: "up", step },
      direction: "up",
      identifierCase: PRESERVING,
    });
  }

  // A marker recording step 1 says nothing about step 3. Treating any run record
  // as blanket permission adopts a table this run never created.
  it("refuses a target beyond the recorded step and its crash window", () => {
    const refusal = capture(() => reconcile(1, LEGACY_COLUMN));
    expect(refusal.logContext?.reason).toMatch(/no recorded progress/);
    expect(refusal.logContext?.position).toBe(BETA_POSITION);
  });

  it("accepts the same target once progress reaches its crash window", () => {
    const out = reconcile(BETA_POSITION - 1, TARGET_COLUMN);
    expect(out[BETA_POSITION - 1]).toMatchObject({
      kind: "table",
      satisfied: true,
    });
  });
});

describe("field-group storage probe", () => {
  function probe(over: Partial<Parameters<typeof probeStorage>[0]> = {}) {
    return probeStorage({
      rows: [row()],
      tables: BEFORE,
      columns: columnsFor(BEFORE),
      identifierCase: PRESERVING,
      generation: "legacy",
      ...over,
    });
  }

  it("reports complete when every referenced object is present", () => {
    const tables = ["dynamic_components", "comp_hero", "comp_hero_locales"];
    const result = probe({
      rows: [row({ hasCompanion: true })],
      tables,
      columns: columnsFor(tables),
    });
    expect(result.migratedObjects).toEqual({ complete: true });
    expect(result.legacyRegistryPresent).toBe(true);
    expect(result.targetRegistryPresent).toBe(false);
  });

  // The read path turns a missing data table into an empty result, so an
  // incomplete rename would serve blank content rather than fail. Naming what is
  // missing is the point: an operator needs to know what to restore.
  it("names every object it could not find", () => {
    const tables = ["dynamic_components"];
    expect(
      probe({
        rows: [row({ hasCompanion: true })],
        tables,
        columns: columnsFor(tables),
      }).migratedObjects
    ).toEqual({
      complete: false,
      missing: ["comp_hero", "comp_hero_locales"],
    });
  });

  it("does not look for a companion a row does not have", () => {
    expect(probe().migratedObjects).toEqual({ complete: true });
  });

  it("reports each registry independently", () => {
    const result = probe({
      rows: [],
      tables: ["dynamic_field_groups"],
      columns: [],
    });
    expect(result.targetRegistryPresent).toBe(true);
    expect(result.legacyRegistryPresent).toBe(false);
  });

  // A table present under its migrated name while still carrying the old column
  // is not migrated storage, and reading it addresses a column that is not there.
  it("reports a table whose discriminator was not migrated", () => {
    expect(
      probe({
        rows: [row({ tableName: "fg_hero" })],
        tables: AFTER,
        columns: columnsFor(AFTER),
        generation: "field-groups-v2",
      }).migratedObjects
    ).toEqual({
      complete: false,
      missing: [`fg_hero.${TARGET_COLUMN}`],
    });
  });

  it("accepts a table whose discriminator was migrated", () => {
    expect(
      probe({
        rows: [row({ tableName: "fg_hero" })],
        tables: AFTER,
        columns: columnsFor(AFTER, { fg_hero: [TARGET_COLUMN] }),
        generation: "field-groups-v2",
      }).migratedObjects
    ).toEqual({ complete: true });
  });

  // Companions hold translations of individual fields and never the type, so
  // requiring the discriminator on them would report every localized group
  // incomplete.
  it("does not require the discriminator on a companion", () => {
    const tables = ["dynamic_components", "comp_hero", "comp_hero_locales"];
    expect(
      probe({
        rows: [row({ hasCompanion: true })],
        tables,
        columns: columnsFor(tables, { comp_hero_locales: ["title"] }),
      }).migratedObjects
    ).toEqual({ complete: true });
  });
});

describe("marker and catalog contradicting each other", () => {
  const rows = [row()];
  const plan = buildMigrationManifest(rows).entries;

  // The guard resumes at `step + 1`, so a position at or below the recorded step
  // never runs again. Reporting it as outstanding is a claim nothing acts on: the
  // rename would be skipped silently and every later step would run against a
  // schema the plan believes has already moved.
  it("refuses a rename the marker records as verified but that never happened", () => {
    const refusal = capture(() =>
      reconcilePlan({
        entries: plan,
        rows,
        tables: BEFORE,
        columns: columnsFor(BEFORE),
        // Step 1 is the table rename, and `comp_hero` is still there.
        run: { recorded: true, direction: "up", step: 1 },
        direction: "up",
        identifierCase: PRESERVING,
      })
    );
    expect(refusal.logContext?.reason).toMatch(
      /records as verified has not been applied/
    );
    expect(refusal.logContext?.position).toBe(1);
  });

  // Same contradiction one level down: the table moved, the column did not, and
  // the marker claims the column step verified.
  it("refuses a column rename the marker records as verified but that never happened", () => {
    const tables = ["dynamic_components", "fg_hero"];
    const refusal = capture(() =>
      reconcilePlan({
        entries: plan,
        rows,
        tables,
        columns: columnsFor(tables),
        // Step 2 is the column rename; `fg_hero` still carries the legacy column.
        run: { recorded: true, direction: "up", step: 2 },
        direction: "up",
        identifierCase: PRESERVING,
      })
    );
    expect(refusal.logContext?.reason).toMatch(
      /column rename the marker records as verified/
    );
  });

  // The crash window is the boundary and must stay accepting: at `step + 1` the
  // statement may simply not have committed, and the runner re-runs it.
  it("accepts an unapplied rename sitting in the crash window", () => {
    expect(() =>
      reconcilePlan({
        entries: plan,
        rows,
        tables: BEFORE,
        columns: columnsFor(BEFORE),
        run: { recorded: true, direction: "up", step: 0 },
        direction: "up",
        identifierCase: PRESERVING,
      })
    ).not.toThrow();
  });
});

describe("probing a settled generation", () => {
  // A completed marker plus a row still naming its legacy table means the rename
  // never happened. Accepting either name would report that complete and let
  // `resolveStorageVerdict` authorise v2 storage that does not exist.
  it("requires the migrated name when probing field-groups-v2", () => {
    const tables = ["dynamic_field_groups", "comp_hero"];
    expect(
      probeStorage({
        rows: [row()],
        tables,
        columns: columnsFor(tables, { comp_hero: [TARGET_COLUMN] }),
        identifierCase: PRESERVING,
        generation: "field-groups-v2",
      }).migratedObjects
    ).toEqual({ complete: false, missing: ["fg_hero"] });
  });

  // The legacy probe is the mirror image: the migrated name must not satisfy it.
  it("requires the stored name when probing legacy", () => {
    const tables = ["dynamic_components", "fg_hero"];
    expect(
      probeStorage({
        rows: [row()],
        tables,
        columns: columnsFor(tables),
        identifierCase: PRESERVING,
        generation: "legacy",
      }).migratedObjects
    ).toEqual({ complete: false, missing: ["comp_hero"] });
  });

  // A custom-named row is already at its final name, so it satisfies a v2 probe
  // as it stands rather than being reported missing forever.
  it("accepts a custom-named row under its own name when probing v2", () => {
    const custom = [row({ slug: "seo", tableName: "my_seo_block" })];
    const tables = ["dynamic_field_groups", "my_seo_block"];
    expect(
      probeStorage({
        rows: custom,
        tables,
        columns: columnsFor(tables, { my_seo_block: [TARGET_COLUMN] }),
        identifierCase: PRESERVING,
        generation: "field-groups-v2",
      }).migratedObjects
    ).toEqual({ complete: true });
  });
});

describe("two rows resolving to one physical object", () => {
  // The plan compares names exactly because it has no dialect, so this alias is
  // invisible to it: `comp_hero`'s derived companion and a custom row named
  // `COMP_HERO_LOCALES` are one table only on a folding server. Left unchecked the
  // plan renames the shared table as the first row's companion and the second
  // row's loss surfaces only after earlier renames have committed.
  const rows = [
    row({ slug: "hero", tableName: "comp_hero", hasCompanion: true }),
    row({ slug: "seo", tableName: "COMP_HERO_LOCALES" }),
  ];

  function reconcile(
    identifierCase: typeof PRESERVING,
    tables: readonly string[]
  ) {
    return reconcilePlan({
      entries: buildMigrationManifest(rows).entries,
      rows,
      tables,
      columns: columnsFor(tables),
      run: { recorded: false },
      direction: "up",
      identifierCase,
    });
  }

  // One physical table, which both rows resolve to because the server folds.
  it("refuses the alias on a folding server", () => {
    const refusal = capture(() =>
      reconcile(FOLDING, [
        "dynamic_components",
        "comp_hero",
        "COMP_HERO_LOCALES",
      ])
    );
    expect(refusal.logContext?.reason).toMatch(/claimed by two field groups/);
    expect(refusal.logContext?.table).toBe("COMP_HERO_LOCALES");
  });

  // Two physical tables. A case-preserving server keeps them apart, so each row
  // claims its own and the same registry is legitimate — the alias check must not
  // fire on spelling alone.
  it("accepts both rows where the server keeps the names apart", () => {
    expect(() =>
      reconcile(PRESERVING, [
        "dynamic_components",
        "comp_hero",
        "comp_hero_locales",
        "COMP_HERO_LOCALES",
      ])
    ).not.toThrow();
  });
});

describe("column metadata keyed in another case", () => {
  // Callers resolve a table before asking for its columns, so lookups arrive with
  // the catalog's spelling. Keying the column index by the caller's spelling
  // instead would miss on a folding server and refuse storage that is present.
  it("finds a table's columns when the catalog reports another case", () => {
    const rows = [row()];
    expect(() =>
      reconcilePlan({
        entries: buildMigrationManifest(rows).entries,
        rows,
        tables: ["DYNAMIC_COMPONENTS", "COMP_HERO"],
        // Keyed as Nextly stored them, not as the catalog reports them.
        columns: columnsFor(["dynamic_components", "comp_hero"]),
        run: { recorded: false },
        direction: "up",
        identifierCase: FOLDING,
      })
    ).not.toThrow();
  });
});

describe("reconciling a rollback", () => {
  const rows = [row()];
  // The applied plan, reversed: registry first, then the column while its table
  // still carries the migrated name, then the table itself.
  const down = invertManifest(buildMigrationManifest(rows).entries).entries;
  const COLUMN_POSITION = 2;

  function reconcile(columnOnTable: string[]) {
    // The table revert has committed, so the table is back to `comp_hero`, and
    // the column entry still names `fg_hero`.
    const tables = ["dynamic_components", "comp_hero"];
    return reconcilePlan({
      entries: down,
      rows,
      tables,
      columns: columnsFor(tables, { comp_hero: columnOnTable }),
      run: { recorded: true, direction: "down", step: down.length },
      direction: "down",
      identifierCase: PRESERVING,
    });
  }

  it("inverts into the order the rollback runs", () => {
    expect(down.map(e => e.kind)).toEqual(["registry", "column", "table"]);
    expect(down[COLUMN_POSITION - 1]?.table).toBe("fg_hero");
  });

  // The column entry names the pre-revert table, so once the table revert has
  // applied that name is gone and the columns have to be found under the name
  // the revert produced. Without that, the step reads as satisfied and a
  // rollback that never reverted the discriminator settles legacy storage
  // carrying `_field_group_type`.
  it("refuses a rollback that left the migrated discriminator in place", () => {
    const refusal = capture(() => reconcile([TARGET_COLUMN]));
    expect(refusal.logContext?.reason).toMatch(
      /column rename the marker records as verified/
    );
    expect(refusal.logContext?.table).toBe("comp_hero");
  });

  it("accepts a rollback that reverted the discriminator", () => {
    const out = reconcile([LEGACY_COLUMN]);
    expect(out[COLUMN_POSITION - 1]?.satisfied).toBe(true);
  });
});

describe("ownership on a settled marker", () => {
  // Two custom-named rows that are one table on a folding server. A settled
  // marker is not exempt from ownership: reporting this complete would let the
  // verdict authorise both field groups against the same storage.
  const rows = [
    row({ slug: "alpha", tableName: "SHARED" }),
    row({ slug: "beta", tableName: "shared" }),
  ];

  function probe(identifierCase: typeof PRESERVING, tables: readonly string[]) {
    return probeStorage({
      rows,
      tables,
      columns: columnsFor(tables, {
        SHARED: [TARGET_COLUMN],
        shared: [TARGET_COLUMN],
      }),
      identifierCase,
      generation: "field-groups-v2",
    });
  }

  it("refuses two rows resolving to one table", () => {
    const refusal = capture(() =>
      probe(FOLDING, ["dynamic_field_groups", "SHARED"])
    );
    expect(refusal.logContext?.reason).toMatch(/claimed by two field groups/);
    expect(refusal.logContext?.table).toBe("SHARED");
  });

  // Where the server keeps the spellings apart they are two tables, and each row
  // owns its own, so the same registry is complete.
  it("accepts them where the server keeps the names apart", () => {
    expect(
      probe(PRESERVING, ["dynamic_field_groups", "SHARED", "shared"])
        .migratedObjects
    ).toEqual({ complete: true });
  });
});

describe("a registry row repointed at a target the run has not reached", () => {
  // Two groups, so the plan has a table step well past the crash window.
  const rows = [
    row({ slug: "alpha", tableName: "comp_alpha" }),
    row({ slug: "beta", tableName: "comp_beta" }),
  ];
  const entries = buildMigrationManifest(rows).entries;
  // [table alpha, column alpha, table beta, column beta, registry]
  const BETA_TABLE_POSITION = 3;

  // The catalog has to agree with the recorded step, or the refusal under test
  // is masked by a different one: a source still present at a position the
  // marker calls verified is itself a refusal.
  function reconcile(step: number, betaPointsAt: string) {
    const alphaTable = step >= 1 ? "fg_alpha" : "comp_alpha";
    const alphaColumn = step >= 2 ? TARGET_COLUMN : LEGACY_COLUMN;
    const tables = ["dynamic_components", alphaTable, betaPointsAt];
    return reconcilePlan({
      entries,
      rows: [
        { ...rows[0]!, tableName: alphaTable },
        { ...rows[1]!, tableName: betaPointsAt },
      ],
      tables,
      columns: columnsFor(tables, { [alphaTable]: [alphaColumn] }),
      run: { recorded: true, direction: "up", step },
      direction: "up",
      identifierCase: PRESERVING,
    });
  }

  // Repointing a field group's storage leaves its id, slug and companion flag
  // untouched, so the registry hash still matches and the resume proceeds. What
  // stops the migration adopting the author's table is that no recorded progress
  // reaches this position — the same test the catalog side already applies to
  // objects, which is why no separate pointer check is needed for it.
  it("refuses when the pointer moved before its step was reached", () => {
    const refusal = capture(() => reconcile(0, "fg_beta"));
    expect(refusal.logContext?.reason).toMatch(
      /no recorded progress accounts for it/
    );
    expect(refusal.logContext?.to).toBe("fg_beta");
    expect(refusal.logContext?.position).toBe(BETA_TABLE_POSITION);
  });

  // Inside the crash window the pointer having moved is exactly what a committed
  // step looks like, so it must still resume.
  it("accepts the pointer at its target once that step is reachable", () => {
    expect(() => reconcile(BETA_TABLE_POSITION - 1, "fg_beta")).not.toThrow();
  });

  // MySQL commits DDL implicitly, so within the window a row may still address
  // its source while the table has already moved. Refusing that would block the
  // resume that repairs it.
  it("accepts a pointer that has not moved yet", () => {
    expect(() => reconcile(0, "comp_beta")).not.toThrow();
  });
});

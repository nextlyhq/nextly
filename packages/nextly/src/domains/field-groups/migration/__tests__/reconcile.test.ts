import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { buildMigrationManifest, type RegistryRow } from "../manifest";
import { probeStorage, reconcilePlan } from "../reconcile";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return { slug: "hero", tableName: "comp_hero", hasCompanion: false, ...over };
}

/** A pre-migration catalog: the legacy registry plus the row's own table. */
const BEFORE = ["dynamic_components", "comp_hero"];
/** After the run: everything renamed. */
const AFTER = ["dynamic_field_groups", "fg_hero"];

function capture(run: () => unknown): NextlyError {
  try {
    run();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    expect.fail(`expected a NextlyError, received ${String(error)}`);
  }
  expect.fail("expected a refusal, but the call returned normally");
}

describe("field-group migration reconciliation", () => {
  const rows = [row()];
  const plan = buildMigrationManifest(rows).entries;

  it("leaves outstanding work unmarked on an untouched database", () => {
    const out = reconcilePlan({
      entries: plan,
      rows,
      tables: BEFORE,
      run: { recorded: false },
    });
    expect(out).toHaveLength(plan.length);
    expect(out.every(e => e.satisfied === undefined)).toBe(true);
  });

  // The plan is indexed by position and identified by hash, so progress must not
  // change its length or its order.
  it("annotates applied work instead of removing it", () => {
    // After the run the registry has been rewritten too, so a rebuilt plan reads
    // rows that already carry migrated names.
    const migrated = [row({ tableName: "fg_hero" })];
    const rebuilt = buildMigrationManifest(migrated).entries;
    const out = reconcilePlan({
      entries: rebuilt,
      rows: migrated,
      tables: AFTER,
      run: { recorded: true },
    });
    expect(out).toHaveLength(rebuilt.length);
    expect(out.map(e => e.kind)).toEqual(rebuilt.map(e => e.kind));
    expect(out.filter(e => e.satisfied).length).toBeGreaterThan(0);
  });

  // Source gone and target present means completed work only when a run is on
  // record. With none, the target belongs to something else and adopting it
  // would treat a stranger's table as migrated field-group storage.
  it("refuses an occupied target when no run is recorded", () => {
    const refusal = capture(() =>
      reconcilePlan({
        entries: plan,
        rows,
        // The row's own storage is intact; something else is sitting on the
        // registry's target name with no run on record to explain it.
        tables: [
          ...BEFORE.filter(t => t !== "dynamic_components"),
          "dynamic_field_groups",
        ],
        run: { recorded: false },
      })
    );
    expect(refusal.logContext?.reason).toMatch(/no migration recorded it/);
  });

  // The same pair with a run on record is this migration's own finished work.
  it("accepts an occupied target when a run is recorded", () => {
    const out = reconcilePlan({
      entries: plan,
      rows,
      tables: [
        ...BEFORE.filter(t => t !== "dynamic_components"),
        "dynamic_field_groups",
      ],
      run: { recorded: true },
    });
    expect(out.find(e => e.kind === "registry")?.satisfied).toBe(true);
  });

  it("refuses when source and target both exist", () => {
    const refusal = capture(() =>
      reconcilePlan({
        entries: plan,
        rows,
        tables: [...BEFORE, ...AFTER],
        run: { recorded: true },
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
        // `my_seo_block` is absent.
        tables: BEFORE,
        run: { recorded: false },
      })
    );
    expect(refusal.logContext?.reason).toMatch(
      /name storage that does not exist/
    );
    expect(refusal.logContext?.missing).toEqual(["my_seo_block"]);
  });

  // MySQL under `lower_case_table_names` reports a verbatim name folded, so an
  // exact-only lookup would call a table that exists missing.
  it("resolves a stored name the catalog reports in a different case", () => {
    const mixed = [row({ slug: "hero", tableName: "comp_hero" })];
    expect(() =>
      reconcilePlan({
        entries: buildMigrationManifest(mixed).entries,
        rows: mixed,
        tables: ["DYNAMIC_COMPONENTS", "COMP_HERO"],
        run: { recorded: false },
      })
    ).not.toThrow();
  });

  // The column names its post-rename table, absent from a pre-migration catalog,
  // so it must survive on the strength of the rename that creates it.
  it("keeps a column rename for a table the plan is about to create", () => {
    const out = reconcilePlan({
      entries: plan,
      rows,
      tables: BEFORE,
      run: { recorded: false },
    });
    const column = out.find(e => e.kind === "column");
    expect(column).toBeDefined();
    expect(column?.satisfied).toBeUndefined();
  });
});

describe("field-group storage probe", () => {
  it("reports complete when every referenced object is present", () => {
    const rows = [row({ hasCompanion: true })];
    const probe = probeStorage({
      rows,
      tables: ["dynamic_components", "comp_hero", "comp_hero_locales"],
    });
    expect(probe.migratedObjects).toEqual({ complete: true });
    expect(probe.legacyRegistryPresent).toBe(true);
    expect(probe.targetRegistryPresent).toBe(false);
  });

  // The read path turns a missing data table into an empty result, so an
  // incomplete rename would serve blank content rather than fail. Naming what is
  // missing is the point: an operator needs to know what to restore.
  it("names every object it could not find", () => {
    const rows = [row({ hasCompanion: true })];
    const probe = probeStorage({ rows, tables: ["dynamic_components"] });
    expect(probe.migratedObjects).toEqual({
      complete: false,
      missing: ["comp_hero", "comp_hero_locales"],
    });
  });

  it("does not look for a companion a row does not have", () => {
    const probe = probeStorage({
      rows: [row({ hasCompanion: false })],
      tables: ["dynamic_components", "comp_hero"],
    });
    expect(probe.migratedObjects).toEqual({ complete: true });
  });

  it("reports each registry independently", () => {
    const probe = probeStorage({
      rows: [],
      tables: ["dynamic_field_groups"],
    });
    expect(probe.targetRegistryPresent).toBe(true);
    expect(probe.legacyRegistryPresent).toBe(false);
  });
});

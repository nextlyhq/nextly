import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildMigrationManifest,
  hashManifest,
  invertManifest,
  MIGRATION_TARGET,
  retargetName,
  type RegistryRow,
} from "../manifest";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    slug: "hero",
    tableName: "comp_hero",
    hasCompanion: false,
    hasTypeColumn: false,
    ...over,
  };
}

describe("field-group migration manifest", () => {
  it("moves a prefixed table onto the new prefix", () => {
    expect(retargetName("comp_hero")).toBe("fg_hero");
  });

  // A table named through `dbName` was never named after the concept, so there
  // is no vocabulary in it to retire. Renaming it would change a name its
  // author chose, for no benefit.
  it("leaves a custom-named table alone", () => {
    expect(retargetName("my_seo_block")).toBeNull();
  });

  it("renames the table and, when localized, its companion", () => {
    const { entries } = buildMigrationManifest([row({ hasCompanion: true })]);
    expect(entries).toEqual([
      { kind: "table", from: "comp_hero", to: "fg_hero" },
      { kind: "companion", from: "comp_hero_locales", to: "fg_hero_locales" },
      {
        kind: "registry",
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
    ]);
  });

  // The companion name is built from the table name that was read, so a table
  // with an unexpected name still has its companion found.
  it("derives the companion from the read table name", () => {
    const { entries } = buildMigrationManifest([
      row({ tableName: "comp_odd_name", hasCompanion: true }),
    ]);
    expect(entries).toContainEqual({
      kind: "companion",
      from: `comp_odd_name${STORAGE_FORMAT.companionSuffix}`,
      to: `fg_odd_name${STORAGE_FORMAT.companionSuffix}`,
    });
  });

  // Only dynamic zones carry the discriminator column.
  it("renames the type column only where it exists", () => {
    const without = buildMigrationManifest([row()]);
    expect(without.entries.some(e => e.kind === "column")).toBe(false);

    const withColumn = buildMigrationManifest([row({ hasTypeColumn: true })]);
    expect(withColumn.entries).toContainEqual({
      kind: "column",
      from: STORAGE_FORMAT.columns.type,
      to: MIGRATION_TARGET.columnType,
      table: "fg_hero",
    });
  });

  // The column rename runs after its table's, so addressing it by the old name
  // would fail: by then the old name resolves to nothing.
  it("addresses the column by its post-rename table", () => {
    const { entries } = buildMigrationManifest([row({ hasTypeColumn: true })]);
    const column = entries.find(e => e.kind === "column");
    const table = entries.findIndex(e => e.kind === "table");
    const columnAt = entries.findIndex(e => e.kind === "column");
    expect(column?.table).toBe("fg_hero");
    expect(columnAt).toBeGreaterThan(table);
  });

  // A custom-named table is not renamed, so its column keeps being addressed by
  // the name it already has.
  it("addresses a custom-named table's column by its unchanged name", () => {
    const { entries } = buildMigrationManifest([
      row({ tableName: "my_seo_block", hasTypeColumn: true }),
    ]);
    expect(entries).toContainEqual({
      kind: "column",
      from: STORAGE_FORMAT.columns.type,
      to: MIGRATION_TARGET.columnType,
      table: "my_seo_block",
    });
    expect(entries.some(e => e.kind === "table")).toBe(false);
  });

  // While the registry answers to its old name a resumed run can rebuild this
  // plan from it. Renaming it first would strand the resume.
  it("renames the registry last", () => {
    const { entries } = buildMigrationManifest([
      row({ tableName: "comp_a", hasCompanion: true }),
      row({ tableName: "comp_b" }),
    ]);
    expect(entries[entries.length - 1]).toEqual({
      kind: "registry",
      from: STORAGE_FORMAT.registryTable,
      to: MIGRATION_TARGET.registryTable,
    });
    expect(entries.filter(e => e.kind === "registry")).toHaveLength(1);
  });

  // Step numbers index into this list, so an order that varied between runs
  // would make a resumed step point at a different object.
  it("orders the plan the same way regardless of row order", () => {
    const a = buildMigrationManifest([
      row({ tableName: "comp_b" }),
      row({ tableName: "comp_a" }),
    ]);
    const b = buildMigrationManifest([
      row({ tableName: "comp_a" }),
      row({ tableName: "comp_b" }),
    ]);
    expect(a.entries).toEqual(b.entries);
    expect(a.hash).toBe(b.hash);
  });

  it("changes the hash when the object map changes", () => {
    const before = buildMigrationManifest([row()]);
    const after = buildMigrationManifest([row(), row({ tableName: "comp_x" })]);
    expect(after.hash).not.toBe(before.hash);
  });

  // Same objects renamed in a different order is a different plan: a recorded
  // step position would mean something else under it.
  it("changes the hash when only the order changes", () => {
    const a = hashManifest([
      { kind: "table", from: "comp_a", to: "fg_a" },
      { kind: "table", from: "comp_b", to: "fg_b" },
    ]);
    const b = hashManifest([
      { kind: "table", from: "comp_b", to: "fg_b" },
      { kind: "table", from: "comp_a", to: "fg_a" },
    ]);
    expect(a).not.toBe(b);
  });

  // A localized group with no translatable fields has no companion table, and
  // the create path accepts exactly that. Naming one would make the step fail.
  it("does not rename a companion that was never created", () => {
    const { entries } = buildMigrationManifest([row({ hasCompanion: false })]);
    expect(entries.some(e => e.kind === "companion")).toBe(false);
  });

  // `table_name` is unique but unconstrained, so a generated `comp_hero` and an
  // author-named `fg_hero` can both exist today. The second is left alone by
  // design, so the first would rename onto an occupied name mid-run.
  it("refuses when a target name is taken by a row it leaves alone", () => {
    expect(() =>
      buildMigrationManifest([
        row({ tableName: "comp_hero" }),
        row({ slug: "other", tableName: "fg_hero" }),
      ])
    ).toThrowError(NextlyError);
  });

  it("refuses when a target name is taken by a table outside the registry", () => {
    try {
      buildMigrationManifest([row({ tableName: "comp_hero" })], {
        // A complete catalog: the source, the squatter, and the registry.
        existingTables: ["comp_hero", "fg_hero", "dynamic_components"],
      });
      expect.fail("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
      expect((error as NextlyError).logContext?.to).toBe("fg_hero");
    }
  });

  // Renaming a table away frees its name, so a plan that moves comp_a to fg_a
  // while something else vacates fg_a is not a collision.
  it("allows a target whose occupant is itself being renamed away", () => {
    expect(() =>
      buildMigrationManifest([row({ tableName: "comp_hero" })], {
        existingTables: ["comp_hero", "dynamic_components"],
      })
    ).not.toThrow();
  });

  // A run that crashed after a rename committed but before its marker write
  // must rebuild the plan and find that step already satisfied, rather than
  // reading its own finished work as a conflict.
  it("marks a completed rename satisfied instead of removing it", () => {
    const { entries } = buildMigrationManifest(
      [row({ tableName: "comp_hero" })],
      {
        existingTables: ["fg_hero", "dynamic_field_groups"],
      }
    );
    expect(entries).toEqual([
      { kind: "table", from: "comp_hero", to: "fg_hero", satisfied: true },
      {
        kind: "registry",
        from: "dynamic_components",
        to: "dynamic_field_groups",
        satisfied: true,
      },
    ]);
  });

  // The plan is positionally indexed and hash-identified, so progress must not
  // change its identity: a resume would otherwise refuse the plan it resumes.
  it("keeps the same hash once steps have been applied", () => {
    const rows = [row({ tableName: "comp_a" }), row({ tableName: "comp_b" })];
    const fresh = buildMigrationManifest(rows, {
      existingTables: ["comp_a", "comp_b", "dynamic_components"],
    });
    const partlyDone = buildMigrationManifest(rows, {
      existingTables: ["fg_a", "comp_b", "dynamic_components"],
    });
    expect(partlyDone.hash).toBe(fresh.hash);
    expect(partlyDone.entries).toHaveLength(fresh.entries.length);
    expect(partlyDone.entries[0]?.satisfied).toBe(true);
    expect(partlyDone.entries[1]?.satisfied).toBeUndefined();
  });

  // The column names its post-rename table, which is legitimately absent from a
  // pre-migration catalog. Dropping it would migrate the table and leave its
  // discriminator behind.
  it("keeps the column rename for a table this plan is about to create", () => {
    const { entries } = buildMigrationManifest(
      [row({ tableName: "comp_hero", hasTypeColumn: true })],
      { existingTables: ["comp_hero", "dynamic_components"] }
    );
    const column = entries.find(e => e.kind === "column");
    expect(column).toBeDefined();
    expect(column?.satisfied).toBeUndefined();
    expect(column?.table).toBe("fg_hero");
  });

  // Presence is matched exactly: on Postgres a quoted COMP_HERO is a different
  // table, and folding would hide a genuinely missing source.
  it("does not let a case-variant table mask a missing source", () => {
    expect(() =>
      buildMigrationManifest([row({ tableName: "comp_hero" })], {
        existingTables: ["COMP_HERO", "dynamic_components"],
      })
    ).toThrowError(NextlyError);
  });

  // The registry names a table that is gone. Renaming it would fail after the
  // marker had been written, so it is refused before the run starts.
  it("refuses when the source table is missing entirely", () => {
    expect(() =>
      buildMigrationManifest([row({ tableName: "comp_hero" })], {
        existingTables: ["dynamic_components"],
      })
    ).toThrowError(NextlyError);
  });

  // SQLite matches table names case-insensitively, as does MySQL under the
  // usual settings, so a case-different squatter is still a squatter.
  it("catches a target collision that differs only in case", () => {
    expect(() =>
      buildMigrationManifest([row({ tableName: "comp_hero" })], {
        existingTables: ["comp_hero", "FG_HERO", "dynamic_components"],
      })
    ).toThrowError(NextlyError);
  });

  // A rollback inverts what was applied. It is never derived from the prefix,
  // because a prefix rule cannot tell a name this migration created from one an
  // author chose before it existed.
  it("inverts an applied plan for rollback, in reverse order", () => {
    const up = buildMigrationManifest([
      row({ tableName: "comp_hero", hasCompanion: true, hasTypeColumn: true }),
    ]);
    const down = invertManifest(up.entries);
    expect(down.entries).toEqual([
      {
        kind: "registry",
        from: "dynamic_field_groups",
        to: "dynamic_components",
      },
      {
        kind: "column",
        from: MIGRATION_TARGET.columnType,
        to: STORAGE_FORMAT.columns.type,
        // Still the migrated name: the column reverts before its table does.
        table: "fg_hero",
      },
      { kind: "companion", from: "fg_hero_locales", to: "comp_hero_locales" },
      { kind: "table", from: "fg_hero", to: "comp_hero" },
    ]);
  });

  // The case this protects: an author whose dbName was already `fg_hero` before
  // any migration. Up leaves it alone, so nothing about it is in the plan, so a
  // rollback cannot rename it either.
  it("never touches a custom name the up plan left alone", () => {
    const up = buildMigrationManifest([row({ tableName: "fg_hero" })]);
    const down = invertManifest(up.entries);
    expect(
      down.entries.some(e => e.from === "fg_hero" || e.to === "fg_hero")
    ).toBe(false);
  });

  // A plan rebuilt after a partial run must contain only outstanding work, so a
  // row already carrying a migrated name contributes nothing.
  it("produces no rename for a row already migrated", () => {
    const { entries } = buildMigrationManifest([row({ tableName: "fg_hero" })]);
    expect(entries.filter(e => e.kind !== "registry")).toEqual([]);
  });

  it("targets a prefix no longer than the one it replaces", () => {
    // Guarantees the migration cannot push a name past an identifier limit:
    // Postgres caps at 63 bytes and MySQL at 64, and every name that fits today
    // gets shorter rather than longer.
    expect(MIGRATION_TARGET.tablePrefix.length).toBeLessThanOrEqual(
      STORAGE_FORMAT.tablePrefix.length
    );
  });
});

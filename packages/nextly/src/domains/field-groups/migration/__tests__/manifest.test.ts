import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildMigrationManifest,
  hashManifest,
  invertManifest,
  MIGRATION_TARGET,
  retargetName,
  type ManifestEntry,
  type RegistryRow,
} from "../manifest";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return { slug: "hero", tableName: "comp_hero", hasCompanion: false, ...over };
}

const COLUMN_RENAME = {
  from: STORAGE_FORMAT.columns.type,
  to: MIGRATION_TARGET.columnType,
};

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

  it("renames the table, its companion, and its discriminator", () => {
    const { entries } = buildMigrationManifest([row({ hasCompanion: true })]);
    expect(entries).toEqual([
      { kind: "table", from: "comp_hero", to: "fg_hero" },
      { kind: "companion", from: "comp_hero_locales", to: "fg_hero_locales" },
      { kind: "column", ...COLUMN_RENAME, table: "fg_hero" },
      {
        kind: "registry",
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
    ]);
  });

  // The schema service emits the discriminator unconditionally and so do all
  // three runtime schemas, so every field-group table has one. Renaming it only
  // for some would leave the rest reachable under the wrong name.
  it("renames the discriminator on every field group", () => {
    const { entries } = buildMigrationManifest([
      row({ tableName: "comp_a" }),
      row({ tableName: "comp_b" }),
      row({ tableName: "my_seo_block" }),
    ]);
    const columns = entries.filter(e => e.kind === "column");
    expect(columns).toHaveLength(3);
    expect(columns.map(c => c.table)).toEqual([
      "fg_a",
      "fg_b",
      // Not renamed, so its column is addressed by the name it keeps.
      "my_seo_block",
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

  // A localized group with no translatable fields has no companion table, and
  // the create path accepts exactly that. Naming one would make the step fail.
  it("does not rename a companion that was never created", () => {
    const { entries } = buildMigrationManifest([row({ hasCompanion: false })]);
    expect(entries.some(e => e.kind === "companion")).toBe(false);
  });

  // The column rename runs after its table's, so addressing it by the old name
  // would fail: by then the old name resolves to nothing.
  it("addresses the column by its post-rename table", () => {
    const { entries } = buildMigrationManifest([row()]);
    const tableAt = entries.findIndex(e => e.kind === "table");
    const columnAt = entries.findIndex(e => e.kind === "column");
    expect(entries[columnAt]?.table).toBe("fg_hero");
    expect(columnAt).toBeGreaterThan(tableAt);
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

  // Progress is not identity. Reconciliation marks applied entries elsewhere,
  // and the plan must still be recognised by the hash the marker recorded.
  it("hashes a plan the same whether or not steps have been applied", () => {
    const plan: ManifestEntry[] = [
      { kind: "table", from: "comp_a", to: "fg_a" },
      {
        kind: "registry",
        from: "dynamic_components",
        to: "dynamic_field_groups",
      },
    ];
    const applied: ManifestEntry[] = [
      { ...plan[0], satisfied: true } as ManifestEntry,
      plan[1] as ManifestEntry,
    ];
    expect(hashManifest(applied)).toBe(hashManifest(plan));
  });

  // `table_name` is unique but unconstrained, so a generated `comp_hero` and an
  // author-named `fg_hero` can both exist. The second is left alone by design,
  // so the first would rename onto an occupied name mid-run.
  it("refuses when a target is taken by a row it leaves alone", () => {
    try {
      buildMigrationManifest([
        row({ tableName: "comp_hero" }),
        row({ slug: "other", tableName: "fg_hero" }),
      ]);
      expect.fail("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
      expect((error as NextlyError).logContext?.to).toBe("fg_hero");
    }
  });

  // SQLite matches table names case-insensitively, as does MySQL under the
  // usual settings, so a case-different name still occupies the target.
  it("refuses a target conflict that differs only in case", () => {
    expect(() =>
      buildMigrationManifest([
        row({ tableName: "comp_hero" }),
        row({ slug: "other", tableName: "FG_HERO" }),
      ])
    ).toThrowError(NextlyError);
  });

  // A kept row occupies its companion's name as well as its own. `fg_x` staying
  // put means `fg_x_locales` stays put too, so another row's table cannot be
  // renamed onto it.
  it("refuses when a target is taken by a kept row's companion", () => {
    try {
      buildMigrationManifest([
        row({ tableName: "fg_x", hasCompanion: true }),
        row({ slug: "other", tableName: "comp_x_locales" }),
      ]);
      expect.fail("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
      expect((error as NextlyError).logContext?.to).toBe("fg_x_locales");
    }
  });

  // A kept row without a companion reserves only its own name; the companion
  // name is free, and refusing there would block a legitimate rename.
  it("does not reserve a companion name for a row that has none", () => {
    expect(() =>
      buildMigrationManifest([
        row({ tableName: "fg_y", hasCompanion: false }),
        row({ slug: "other", tableName: "comp_y_locales" }),
      ])
    ).not.toThrow();
  });

  // Renaming a table away frees its name, so two rows swapping prefixes is not
  // a conflict.
  it("allows a target whose occupant is itself renamed away", () => {
    expect(() =>
      buildMigrationManifest([
        row({ tableName: "comp_a" }),
        row({ slug: "b", tableName: "comp_b" }),
      ])
    ).not.toThrow();
  });

  // A rollback inverts what was applied. It is never derived from the prefix,
  // because a prefix rule cannot tell a name this migration created from one an
  // author chose before it existed.
  it("inverts an applied plan for rollback, in reverse order", () => {
    const up = buildMigrationManifest([
      row({ tableName: "comp_hero", hasCompanion: true }),
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
  // any migration. Up leaves the table alone, so a rollback cannot rename it.
  it("never renames a custom table the up plan left alone", () => {
    const up = buildMigrationManifest([row({ tableName: "fg_hero" })]);
    const down = invertManifest(up.entries);
    expect(
      down.entries.some(
        e => e.kind !== "column" && (e.from === "fg_hero" || e.to === "fg_hero")
      )
    ).toBe(false);
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

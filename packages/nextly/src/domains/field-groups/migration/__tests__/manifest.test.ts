import { describe, expect, it } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildMigrationManifest,
  hashManifest,
  MIGRATION_TARGET,
  retargetName,
  type RegistryRow,
} from "../manifest";

function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    slug: "hero",
    tableName: "comp_hero",
    localized: false,
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
    const { entries } = buildMigrationManifest([row({ localized: true })]);
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
      row({ tableName: "comp_odd_name", localized: true }),
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
      row({ tableName: "comp_a", localized: true }),
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

  it("targets a prefix no longer than the one it replaces", () => {
    // Guarantees the migration cannot push a name past an identifier limit:
    // Postgres caps at 63 bytes and MySQL at 64, and every name that fits today
    // gets shorter rather than longer.
    expect(MIGRATION_TARGET.tablePrefix.length).toBeLessThanOrEqual(
      STORAGE_FORMAT.tablePrefix.length
    );
  });
});

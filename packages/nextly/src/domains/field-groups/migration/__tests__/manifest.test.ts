import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  buildMigrationManifest,
  hashSlugSet,
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
  it("moves a canonically named table onto the new prefix", () => {
    expect(retargetName({ slug: "hero", tableName: "comp_hero" })).toBe(
      "fg_hero"
    );
  });

  // A table named through `dbName` was never named after the concept, so there
  // is no vocabulary in it to retire. Renaming it would change a name its
  // author chose, for no benefit.
  it("leaves a custom-named table alone", () => {
    expect(retargetName({ slug: "seo", tableName: "my_seo_block" })).toBeNull();
  });

  // Ownership is decided against the canonical name for the slug, not the
  // prefix. `dbName` was taken verbatim for field groups, so an author could
  // name a table `comp_archive` under the slug `hero`; a prefix rule reads that
  // as generated and renames an identifier this migration never created.
  it("leaves a custom name alone even when it carries the legacy prefix", () => {
    expect(
      retargetName({ slug: "hero", tableName: "comp_archive" })
    ).toBeNull();
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
      row({ slug: "a", tableName: "comp_a" }),
      row({ slug: "b", tableName: "comp_b" }),
      row({ slug: "seo", tableName: "my_seo_block" }),
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

  // The companion name is built from the table name that was read, so a slug
  // whose canonical name was normalized still has its companion found.
  it("derives the companion from the read table name", () => {
    const { entries } = buildMigrationManifest([
      row({ slug: "odd-name", tableName: "comp_odd_name", hasCompanion: true }),
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
      row({ slug: "a", tableName: "comp_a", hasCompanion: true }),
      row({ slug: "b", tableName: "comp_b" }),
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
      row({ slug: "b", tableName: "comp_b" }),
      row({ slug: "a", tableName: "comp_a" }),
    ]);
    const b = buildMigrationManifest([
      row({ slug: "a", tableName: "comp_a" }),
      row({ slug: "b", tableName: "comp_b" }),
    ]);
    expect(a.entries).toEqual(b.entries);
    expect(a.hash).toBe(b.hash);
  });

  it("changes the hash when the object map changes", () => {
    const before = buildMigrationManifest([row()]);
    const after = buildMigrationManifest([
      row(),
      row({ slug: "x", tableName: "comp_x" }),
    ]);
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
        row({ slug: "hero", tableName: "comp_hero" }),
        row({ slug: "hero2", tableName: "fg_hero" }),
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
        row({ slug: "hero", tableName: "comp_hero" }),
        row({ slug: "hero2", tableName: "FG_HERO" }),
      ])
    ).toThrowError(NextlyError);
  });

  // A kept row occupies its companion's name as well as its own. `fg_x` staying
  // put means `fg_x_locales` stays put too, so another row's table cannot be
  // renamed onto it.
  it("refuses when a target is taken by a kept row's companion", () => {
    try {
      buildMigrationManifest([
        row({ slug: "x", tableName: "fg_x", hasCompanion: true }),
        row({ slug: "x_locales", tableName: "comp_x_locales" }),
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
        row({ slug: "y", tableName: "fg_y", hasCompanion: false }),
        row({ slug: "y_locales", tableName: "comp_y_locales" }),
      ])
    ).not.toThrow();
  });

  // A companion name is derived, not stored, so it can collide with another
  // row's stored table name. `comp_hero`'s companion computes to
  // `comp_hero_locales`, which an author could have chosen as their own table.
  // The unique constraint on `table_name` does not prevent it, because the
  // companion is not a registry row. Two rows then claim one physical table.
  it("refuses when a companion name aliases another row's table", () => {
    try {
      buildMigrationManifest([
        row({ slug: "hero", tableName: "comp_hero", hasCompanion: true }),
        row({ slug: "archive", tableName: "comp_hero_locales" }),
      ]);
      expect.fail("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
      expect((error as NextlyError).logContext?.reason).toMatch(
        /claimed by more than one field group/
      );
    }
  });

  // The check must not fire on the ordinary case. No self-collision is possible
  // -- a name cannot equal itself plus a suffix -- so a lone row with a
  // companion has to plan cleanly.
  it("does not refuse a lone row that has a companion", () => {
    expect(() =>
      buildMigrationManifest([
        row({ slug: "hero", tableName: "comp_hero", hasCompanion: true }),
      ])
    ).not.toThrow();
  });

  // A row naming a system table is malformed. It is left unrenamed, so its
  // discriminator rename would be issued against the registry itself -- and the
  // registry's own rename puts that name among the plan's sources, so nothing
  // else flags the overlap.
  it.each(["dynamic_components", "dynamic_field_groups"])(
    "refuses a row whose table is the system registry (%s)",
    table => {
      try {
        buildMigrationManifest([row({ slug: "x", tableName: table })]);
        expect.fail("expected a refusal");
      } catch (error) {
        expect((error as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
        expect((error as NextlyError).logContext?.reason).toMatch(
          /names a system table/
        );
      }
    }
  );

  // The system-table check asks whether a row IS the registry, which is an
  // identity question. Folding it would refuse a legitimate Postgres table
  // quoted as DYNAMIC_COMPONENTS and block that installation permanently.
  it("does not refuse a custom table that differs from the registry only in case", () => {
    expect(() =>
      buildMigrationManifest([
        row({ slug: "x", tableName: "DYNAMIC_COMPONENTS" }),
      ])
    ).not.toThrow();
  });

  // Companion ownership is an identity question, so it compares exactly. On
  // Postgres a quoted COMP_HERO_LOCALES is a different table, and folding would
  // refuse that installation permanently.
  it("does not treat a case-different table as a companion alias", () => {
    expect(() =>
      buildMigrationManifest([
        row({ slug: "hero", tableName: "comp_hero", hasCompanion: true }),
        row({ slug: "other", tableName: "COMP_HERO_LOCALES" }),
      ])
    ).not.toThrow();
  });

  // Renaming a table away frees its name, so two rows swapping prefixes is not
  // a conflict.
  it("allows a target whose occupant is itself renamed away", () => {
    expect(() =>
      buildMigrationManifest([
        row({ slug: "a", tableName: "comp_a" }),
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
    const up = buildMigrationManifest([
      row({ slug: "hero", tableName: "fg_hero" }),
    ]);
    const down = invertManifest(up.entries);
    expect(
      down.entries.some(
        e => e.kind !== "column" && (e.from === "fg_hero" || e.to === "fg_hero")
      )
    ).toBe(false);
  });

  // `table_name` is an unconstrained varchar, so a name containing the old
  // delimiters made two different plans serialize to the same bytes -- and a
  // resume would then accept a plan whose step positions address other work.
  it("cannot be made to collide by a name containing delimiters", () => {
    const one = hashManifest([
      {
        kind: "column",
        table: "a:_component_type>_field_group_type\ncolumn:b",
        from: "_component_type",
        to: "_field_group_type",
      },
    ]);
    const two = hashManifest([
      {
        kind: "column",
        table: "a",
        from: "_component_type",
        to: "_field_group_type",
      },
      {
        kind: "column",
        table: "b",
        from: "_component_type",
        to: "_field_group_type",
      },
    ]);
    expect(one).not.toBe(two);
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

describe("hashSlugSet", () => {
  // Identity of the *set*, so row order from the registry must not change it.
  it("does not depend on row order", () => {
    expect(hashSlugSet([{ slug: "a" }, { slug: "b" }])).toBe(
      hashSlugSet([{ slug: "b" }, { slug: "a" }])
    );
  });

  // The question it answers: did a field group appear or disappear underneath an
  // interrupted run? Either leaves storage the recorded plan never mentions.
  it("changes when a field group is added or removed", () => {
    const base = hashSlugSet([{ slug: "a" }, { slug: "b" }]);
    expect(hashSlugSet([{ slug: "a" }, { slug: "b" }, { slug: "c" }])).not.toBe(
      base
    );
    expect(hashSlugSet([{ slug: "a" }])).not.toBe(base);
  });

  // The core property: which slugs, not how many. A group deleted and another
  // created between runs leaves the count identical while the set is different,
  // and the recorded plan mentions storage that is now absent.
  it("distinguishes different sets of the same size", () => {
    expect(hashSlugSet([{ slug: "a" }])).not.toBe(hashSlugSet([{ slug: "b" }]));
    expect(hashSlugSet([{ slug: "a" }, { slug: "b" }])).not.toBe(
      hashSlugSet([{ slug: "a" }, { slug: "c" }])
    );
  });

  // Slugs rather than table names, because `table_name` is rewritten as each
  // rename commits: a name-based hash would stop matching partway through a run
  // and refuse the resume it exists to protect.
  it("ignores everything except the slugs", () => {
    const rows = [{ slug: "a", tableName: "comp_a" }];
    const renamed = [{ slug: "a", tableName: "fg_a" }];
    expect(hashSlugSet(renamed)).toBe(hashSlugSet(rows));
  });
});

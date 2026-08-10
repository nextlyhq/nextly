/**
 * loadDynamicTables boot-pass regression test.
 *
 * Pins the contract that:
 *  - Empty `fields: []` rows still call `register` (so freshly-created UI
 *    Singles whose user-field array is still empty get their physical
 *    table re-registered after a server restart).
 *  - The `status` column drives the `hasStatus` argument passed to the
 *    register callback (sqlite returns 0/1, postgres returns booleans).
 *  - The `localized` column drives the `localized` argument (i18n M3b-2).
 *  - The Components SELECT never asks for a `status` / `localized` column.
 *  - Adapter errors (table doesn't exist on a fresh DB) don't throw.
 */
import { describe, it, expect, vi } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import {
  forgetFieldGroupStorageNames,
  resolveFieldGroupRegistryName,
} from "../../domains/field-groups/storage/resolve-storage-names";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { loadDynamicTables } from "../load-dynamic-tables";

function makeAdapter(rows: unknown[], opts: { throwOnSelect?: boolean } = {}) {
  const calls: string[] = [];
  const adapter = {
    executeQuery: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (opts.throwOnSelect) {
        throw new Error("no such table: dynamic_singles");
      }
      return rows;
    }),
  } as unknown as Parameters<typeof loadDynamicTables>[0];
  return { adapter, calls };
}

describe("loadDynamicTables — empty-fields rows still register", () => {
  it("calls register for a row with fields: [] (UI Single without user fields yet)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "single_banner", fields: "[]", slug: "banner", status: 0 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_singles", register);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      "single_banner",
      [],
      false,
      false,
      undefined
    );
  });

  it("skips rows where the JSON parses to a non-array", async () => {
    // Defensive: garbage `fields` values shouldn't crash the boot pass,
    // they just shouldn't register either.
    const { adapter } = makeAdapter([
      { table_name: "single_x", fields: '"not-an-array"', slug: "x" },
      {
        table_name: "single_ok",
        fields: "[]",
        slug: "ok",
        status: 0,
      },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_singles", register);

    // Only the array-shaped row registers.
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      "single_ok",
      [],
      false,
      false,
      undefined
    );
  });

  it("forwards hasStatus=true when status=1 (sqlite)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "single_a", fields: "[]", slug: "a", status: 1 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_singles", register);

    expect(register).toHaveBeenCalledWith(
      "single_a",
      [],
      true,
      false,
      undefined
    );
  });

  it("forwards hasStatus=true when status=true (postgres)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_a", fields: "[]", slug: "a", status: true },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], true, false, undefined);
  });

  it("forwards hasStatus=false for legacy rows without a status field", async () => {
    const { adapter } = makeAdapter([
      // status column existed but was never set (legacy row).
      { table_name: "dc_a", fields: "[]", slug: "a" },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], false, false, undefined);
  });

  it("forwards localized=true when localized=1 (sqlite)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_pages", fields: "[]", slug: "pages", localized: 1 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith(
      "dc_pages",
      [],
      false,
      true,
      undefined
    );
  });

  it("forwards localized=true when localized=true (postgres)", async () => {
    const { adapter } = makeAdapter([
      {
        table_name: "dc_pages",
        fields: "[]",
        slug: "pages",
        status: true,
        localized: true,
      },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith(
      "dc_pages",
      [],
      true,
      true,
      undefined
    );
  });

  it("forwards localized=false for legacy rows without a localized field", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_a", fields: "[]", slug: "a", status: 0 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], false, false, undefined);
  });
});

describe("loadDynamicTables — SELECT shape", () => {
  it("excludes status but includes localized in the SELECT for dynamic_components", async () => {
    const { adapter, calls } = makeAdapter([]);
    await loadDynamicTables(adapter, "dynamic_components", vi.fn());
    // Components have no Draft/Published status column, but they do carry the
    // i18n `localized` flag, so it must be part of the select.
    expect(calls[0]).toBe(
      "SELECT table_name, fields, slug, localized, source, locked FROM dynamic_components"
    );
  });

  it("includes status in the SELECT for dynamic_collections / dynamic_singles", async () => {
    const { adapter, calls } = makeAdapter([]);
    await loadDynamicTables(adapter, "dynamic_singles", vi.fn());
    expect(calls[0]).toBe(
      "SELECT table_name, fields, slug, status, localized, source, locked FROM dynamic_singles"
    );

    const second = makeAdapter([]);
    await loadDynamicTables(second.adapter, "dynamic_collections", vi.fn());
    expect(second.calls[0]).toBe(
      "SELECT table_name, fields, slug, status, localized, source, locked FROM dynamic_collections"
    );
  });
});

describe("loadDynamicTables — fault tolerance", () => {
  it("does not throw if the source table doesn't exist (fresh DB)", async () => {
    const { adapter } = makeAdapter([], { throwOnSelect: true });
    const register = vi.fn(async () => {});

    await expect(
      loadDynamicTables(adapter, "dynamic_singles", register)
    ).resolves.toBeUndefined();
    expect(register).not.toHaveBeenCalled();
  });

  it("isolates failures per row — a thrown register continues with the next row", async () => {
    const { adapter } = makeAdapter([
      { table_name: "single_bad", fields: "[]", slug: "bad", status: 0 },
      { table_name: "single_ok", fields: "[]", slug: "ok", status: 0 },
    ]);
    const register = vi.fn(async (tableName: string) => {
      if (tableName === "single_bad") throw new Error("synthetic");
    });

    await loadDynamicTables(adapter, "dynamic_singles", register);

    // Both attempts happen; only the second succeeds, but the first
    // failure is swallowed and doesn't block the rest.
    expect(register).toHaveBeenCalledTimes(2);
  });

  // An existing DB that predates the i18n `localized` column must not lose all
  // its dynamic tables. The select falls back to one without `localized` rather
  // than letting the missing column throw into the outer catch.
  it("falls back to a select without `localized` on a pre-i18n DB", async () => {
    const calls: string[] = [];
    const adapter = {
      executeQuery: vi.fn(async (sql: string) => {
        calls.push(sql);
        // A pre-i18n database has neither the ownership columns nor `localized`, so both of
        // the first two rungs fail and the third is the one that answers.
        if (/,\s*source,\s*locked\s+FROM/.test(sql)) {
          throw new Error('column "source" does not exist');
        }
        if (/,\s*localized\s+FROM/.test(sql)) {
          throw new Error('column "localized" does not exist');
        }
        return [
          { table_name: "dc_pages", fields: "[]", slug: "pages", status: 1 },
        ];
      }),
    } as unknown as Parameters<typeof loadDynamicTables>[0];
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    // First (full) select threw; the fallback (no `localized`) succeeded and the
    // row still registered — with localized defaulting to false.
    expect(calls[0]).toContain("source");
    expect(calls[1]).toContain("localized");
    expect(calls[2]).toBe(
      "SELECT table_name, fields, slug, status FROM dynamic_collections"
    );
    // Ownership is `undefined` rather than false: the registry could not say, which is not the
    // same as saying the Builder does not own it.
    expect(register).toHaveBeenCalledWith(
      "dc_pages",
      [],
      true,
      false,
      undefined
    );
  });
});

/**
 * 🔴 The boot pass has to address the registry that is actually there.
 *
 * `loadDynamicTables` treats a failed read as the fresh-database case — correct
 * for a database that has no registry yet, and silent for one whose registry
 * has been renamed. Addressing the legacy name on a migrated database therefore
 * registers NOTHING and raises nothing, leaving every field-group table
 * unaddressable until someone notices reads coming back empty.
 */
describe("loadDynamicTables — the field-group registry is resolved, not assumed", () => {
  function catalogAdapter(tables: string[], rows: unknown[]) {
    const selected: string[] = [];
    return {
      selected,
      adapter: {
        dialect: "sqlite" as const,
        listTables: vi.fn(async () => tables),
        getDrizzle: <T>(): T => ({}) as T,
        executeQuery: vi.fn(async (sql: string) => {
          selected.push(sql);
          // Only the table this database actually has answers; anything else
          // fails the way a real driver fails, which is what the boot pass
          // swallows.
          const target = tables.find(table => sql.includes(table));
          if (target === undefined) throw new Error("no such table");
          return rows;
        }),
      },
    };
  }

  const componentRow = {
    table_name: "fg_hero",
    fields: JSON.stringify([{ name: "heading", type: "text" }]),
    slug: "hero",
    localized: 0,
  };

  it("registers components from the migrated registry after a rename", async () => {
    forgetFieldGroupStorageNames();
    const { adapter, selected } = catalogAdapter(
      [MIGRATION_TARGET.registryTable],
      [componentRow]
    );
    const register = vi.fn(async () => {});

    await loadDynamicTables(
      adapter as unknown as Parameters<typeof loadDynamicTables>[0],
      await resolveFieldGroupRegistryName(adapter),
      register
    );

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(
      "fg_hero",
      [{ name: "heading", type: "text" }],
      false,
      false,
      undefined
    );
    expect(selected.join("\n")).toContain(MIGRATION_TARGET.registryTable);
  });

  // The migrated registry has no `status` column either, so a branch that only
  // recognises the legacy spelling would select one that is not there.
  it("never selects a status column from the migrated registry", async () => {
    forgetFieldGroupStorageNames();
    const { adapter, selected } = catalogAdapter(
      [MIGRATION_TARGET.registryTable],
      [componentRow]
    );

    await loadDynamicTables(
      adapter as unknown as Parameters<typeof loadDynamicTables>[0],
      await resolveFieldGroupRegistryName(adapter),
      async () => {}
    );

    expect(selected.join("\n")).not.toContain("status");
  });

  it("still addresses the legacy registry on a database that has not migrated", async () => {
    forgetFieldGroupStorageNames();
    const { adapter, selected } = catalogAdapter(
      [STORAGE_FORMAT.registryTable],
      [{ ...componentRow, table_name: "comp_hero" }]
    );
    const register = vi.fn(async () => {});

    await loadDynamicTables(
      adapter as unknown as Parameters<typeof loadDynamicTables>[0],
      await resolveFieldGroupRegistryName(adapter),
      register
    );

    expect(register).toHaveBeenCalledTimes(1);
    expect(selected.join("\n")).toContain(STORAGE_FORMAT.registryTable);
  });
});

/**
 * These registries hold code-first and plugin rows beside Builder ones.
 *
 * A caller that goes on to emit DDL has to describe a column the way its creator built it, and the
 * two creators size an unstated text field differently. Assumed rather than read, every code-first
 * and plugin-owned table was described as the Builder's — so a companion created during an upgrade
 * or a recovery got Builder widths for a table the pipeline had made.
 */
describe("loadDynamicTables — ownership comes from the row", () => {
  const ownershipFor = async (
    row: Record<string, unknown>
  ): Promise<boolean | undefined> => {
    const { adapter } = makeAdapter([
      { table_name: "dc_pages", fields: "[]", slug: "pages", ...row },
    ]);
    // Typed to the callback's real signature so the ownership argument is reachable by index
    // rather than asserted through a cast.
    const register = vi.fn(
      async (
        _tableName: string,
        _fields: unknown[],
        _hasStatus: boolean,
        _localized: boolean,
        _builderOwned: boolean | undefined
      ) => {}
    );
    await loadDynamicTables(adapter, "dynamic_collections", register);
    return register.mock.calls[0]?.[4];
  };

  it("reports the Schema Builder as the owner of an unlocked UI row", async () => {
    expect(await ownershipFor({ source: "ui", locked: false })).toBe(true);
  });

  it.each([
    ["a locked row", { source: "ui", locked: true }],
    ["a code-first row", { source: "code", locked: false }],
    ["a plugin-owned row", { source: "plugin:acme-seo", locked: false }],
  ])("does not report the Builder as the owner of %s", async (_label, row) => {
    expect(await ownershipFor(row)).toBe(false);
  });

  // Distinct from `false` on purpose: a registry too old to carry these columns has said nothing
  // about ownership, and the caller reads that as the pipeline's rather than as a Builder denial.
  it("reports nothing when the registry carries no ownership columns", async () => {
    expect(await ownershipFor({})).toBeUndefined();
  });
});

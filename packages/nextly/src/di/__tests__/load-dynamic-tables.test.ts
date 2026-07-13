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
    expect(register).toHaveBeenCalledWith("single_banner", [], false, false);
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
    expect(register).toHaveBeenCalledWith("single_ok", [], false, false);
  });

  it("forwards hasStatus=true when status=1 (sqlite)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "single_a", fields: "[]", slug: "a", status: 1 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_singles", register);

    expect(register).toHaveBeenCalledWith("single_a", [], true, false);
  });

  it("forwards hasStatus=true when status=true (postgres)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_a", fields: "[]", slug: "a", status: true },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], true, false);
  });

  it("forwards hasStatus=false for legacy rows without a status field", async () => {
    const { adapter } = makeAdapter([
      // status column existed but was never set (legacy row).
      { table_name: "dc_a", fields: "[]", slug: "a" },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], false, false);
  });

  it("forwards localized=true when localized=1 (sqlite)", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_pages", fields: "[]", slug: "pages", localized: 1 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_pages", [], false, true);
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

    expect(register).toHaveBeenCalledWith("dc_pages", [], true, true);
  });

  it("forwards localized=false for legacy rows without a localized field", async () => {
    const { adapter } = makeAdapter([
      { table_name: "dc_a", fields: "[]", slug: "a", status: 0 },
    ]);
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    expect(register).toHaveBeenCalledWith("dc_a", [], false, false);
  });
});

describe("loadDynamicTables — SELECT shape", () => {
  it("excludes status from the SELECT for dynamic_components", async () => {
    const { adapter, calls } = makeAdapter([]);
    await loadDynamicTables(adapter, "dynamic_components", vi.fn());
    expect(calls[0]).toBe(
      "SELECT table_name, fields, slug FROM dynamic_components"
    );
  });

  it("includes status in the SELECT for dynamic_collections / dynamic_singles", async () => {
    const { adapter, calls } = makeAdapter([]);
    await loadDynamicTables(adapter, "dynamic_singles", vi.fn());
    expect(calls[0]).toBe(
      "SELECT table_name, fields, slug, status, localized FROM dynamic_singles"
    );

    const second = makeAdapter([]);
    await loadDynamicTables(second.adapter, "dynamic_collections", vi.fn());
    expect(second.calls[0]).toBe(
      "SELECT table_name, fields, slug, status, localized FROM dynamic_collections"
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

  // M8: an existing DB that predates the i18n `localized` column must not lose
  // all its dynamic tables. The select falls back to one without `localized`
  // rather than letting the missing column throw into the outer catch.
  it("falls back to a select without `localized` on a pre-i18n DB", async () => {
    const calls: string[] = [];
    const adapter = {
      executeQuery: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/,\s*localized\s+FROM/.test(sql)) {
          throw new Error('column "localized" does not exist');
        }
        return [{ table_name: "dc_pages", fields: "[]", slug: "pages", status: 1 }];
      }),
    } as unknown as Parameters<typeof loadDynamicTables>[0];
    const register = vi.fn(async () => {});

    await loadDynamicTables(adapter, "dynamic_collections", register);

    // First (full) select threw; the fallback (no `localized`) succeeded and the
    // row still registered — with localized defaulting to false.
    expect(calls[0]).toContain("localized");
    expect(calls[1]).toBe(
      "SELECT table_name, fields, slug, status FROM dynamic_collections"
    );
    expect(register).toHaveBeenCalledWith("dc_pages", [], true, false);
  });
});

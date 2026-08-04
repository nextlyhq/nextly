// The lazy singles runtime-table registration. Three behaviours are pinned
// here: a resolver miss registers from the row (the multi-worker gap this
// exists for); a registration made by boot/create-time/the reconcile is
// ADOPTED, never overridden on first touch (they build from config, this
// builds from the row, and the row can lag); and a row that moves after
// this helper accounted for the table re-registers main + companion. A
// broken resolver degrades to a no-op instead of throwing.

import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { ensureSingleRuntimeTable } from "./ensure-runtime-table";

/** Minimal adapter double: a dialect and a Map-backed resolver. */
function makeAdapter(prefill?: Record<string, unknown>) {
  const tables = new Map<string, unknown>(Object.entries(prefill ?? {}));
  const registered: string[] = [];
  const adapter = {
    dialect: "sqlite",
    tableResolver: {
      getTable: (name: string) => tables.get(name) ?? null,
      registerDynamicSchema: (name: string, table: unknown) => {
        tables.set(name, table);
        registered.push(name);
      },
    },
  } as unknown as DrizzleAdapter;
  return { adapter, tables, registered };
}

const localizedMeta = {
  slug: "test-page",
  tableName: "single_test_page",
  fields: [
    { name: "title", type: "text" }, // text-like → localized by default
    { name: "views", type: "number" }, // shared → stays on main
  ],
  status: true,
  localized: true,
};

describe("ensureSingleRuntimeTable", () => {
  it("registers the main table and companion on a resolver miss", () => {
    const { adapter, tables, registered } = makeAdapter();
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([
      "single_test_page",
      "single_test_page_locales",
    ]);
    expect(tables.get("single_test_page")).toBeTruthy();
    expect(tables.get("single_test_page_locales")).toBeTruthy();
  });

  it("omits translatable columns from the lazily registered main table", () => {
    const { adapter, tables } = makeAdapter();
    ensureSingleRuntimeTable(adapter, localizedMeta);
    const main = tables.get("single_test_page") as Record<string, unknown>;
    // Drizzle tables expose columns as own properties: the shared field is a
    // column, the translatable one is not (it lives on the companion).
    expect(main.views).toBeTruthy();
    expect(main.title).toBeUndefined();
  });

  it("registers nothing on a repeat call with an unchanged shape", () => {
    const { adapter, registered } = makeAdapter();
    ensureSingleRuntimeTable(adapter, localizedMeta);
    const afterFirst = registered.length;
    ensureSingleRuntimeTable(adapter, localizedMeta);
    ensureSingleRuntimeTable(adapter, { ...localizedMeta });
    expect(registered.length).toBe(afterFirst);
  });

  it("adopts a registration made elsewhere instead of overriding it", () => {
    // Boot / create-time / the HMR reconcile build from the CONFIG; this
    // helper builds from the ROW, and the row can lag. A registration this
    // helper did not make is left in place on first touch.
    const sentinel = { already: true };
    const companionSentinel = { alsoAlready: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
      single_test_page_locales: companionSentinel,
    });
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([]);
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("still catches a row change that lands after adopting a foreign registration", () => {
    // Adopting records the baseline, so the localization toggle another
    // worker performs later is detected on the next read.
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
      single_test_page_locales: sentinel,
    });
    ensureSingleRuntimeTable(adapter, { ...localizedMeta, schemaVersion: 3 });
    expect(registered).toEqual([]);

    ensureSingleRuntimeTable(adapter, { ...localizedMeta, schemaVersion: 4 });
    expect(registered).toContain("single_test_page");
    expect(tables.get("single_test_page")).not.toBe(sentinel);
  });

  it("backfills only the missing companion when the main table is foreign", () => {
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
    });
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual(["single_test_page_locales"]);
    // The foreign main-table registration survives the backfill.
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("uses schemaVersion as the signature when the row carries one", () => {
    // The cheap key: the same saves that change the field set bump it, so
    // an unchanged version short-circuits without stringifying the fields.
    const { adapter, registered } = makeAdapter();
    ensureSingleRuntimeTable(adapter, { ...localizedMeta, schemaVersion: 7 });
    const afterFirst = registered.length;
    // Different field payload, same version → treated as unchanged.
    ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 7,
      fields: [{ name: "totally", type: "text" }],
    });
    expect(registered.length).toBe(afterFirst);

    // Bumped version → re-registered.
    ensureSingleRuntimeTable(adapter, { ...localizedMeta, schemaVersion: 8 });
    expect(registered.length).toBeGreaterThan(afterFirst);
  });

  it("re-registers when a storage-affecting field OPTION changes (same type)", () => {
    // The column generator branches on more than name/type — a relationship
    // flipping to hasMany stores JSON instead of an FK column — so the
    // signature must move when any field property does.
    const relMeta = {
      ...localizedMeta,
      localized: false,
      fields: [{ name: "author", type: "relationship", relationTo: "users" }],
    };
    const { adapter, registered } = makeAdapter();
    ensureSingleRuntimeTable(adapter, relMeta);
    const afterFirst = registered.length;
    ensureSingleRuntimeTable(adapter, {
      ...relMeta,
      fields: [
        {
          name: "author",
          type: "relationship",
          relationTo: "users",
          hasMany: true,
        },
      ],
    });
    expect(registered.length).toBeGreaterThan(afterFirst);
  });

  it("re-registers when the row's shape changes (localization toggled)", () => {
    const { adapter, registered, tables } = makeAdapter();
    ensureSingleRuntimeTable(adapter, { ...localizedMeta, localized: false });
    // Non-localized: the full field set lives on the main table.
    const before = tables.get("single_test_page") as Record<string, unknown>;
    expect(before.title).toBeTruthy();

    // Another worker enables localization: the row now says localized and
    // the physical main table no longer carries the translatable column.
    ensureSingleRuntimeTable(adapter, localizedMeta);
    const after = tables.get("single_test_page") as Record<string, unknown>;
    expect(after.title).toBeUndefined();
    expect(registered).toContain("single_test_page_locales");
  });

  it("registers no companion for a non-localized single", () => {
    const { adapter, registered } = makeAdapter();
    ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      localized: false,
    });
    expect(registered).toEqual(["single_test_page"]);
  });

  it("is a no-op when the adapter has no resolver", () => {
    const adapter = { dialect: "sqlite" } as unknown as DrizzleAdapter;
    expect(() =>
      ensureSingleRuntimeTable(adapter, localizedMeta)
    ).not.toThrow();
  });

  it("swallows registration failures but leaves a trace for the next reader", () => {
    const adapter = {
      dialect: "sqlite",
      tableResolver: {
        getTable: () => null,
        registerDynamicSchema: () => {
          throw new Error("registry exploded");
        },
      },
    } as unknown as DrizzleAdapter;
    const debug = vi.fn();
    const logger = {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    expect(() =>
      ensureSingleRuntimeTable(adapter, localizedMeta, logger)
    ).not.toThrow();
    // Degrading is intended; degrading silently is what hid the original
    // registration gap.
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[1]).toMatchObject({
      tableName: "single_test_page",
      error: "registry exploded",
    });
  });
});

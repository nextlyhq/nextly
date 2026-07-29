// The lazy singles runtime-table registration: given the registry row, a
// resolver miss OR a row whose shape moved past the recorded registration
// re-derives the main table (localized-aware) and the `_locales` companion;
// an unchanged shape registers nothing on repeat calls; a broken resolver
// degrades to a no-op instead of throwing.

import { describe, expect, it } from "vitest";

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

  it("re-derives a registration made elsewhere once, then goes quiet", () => {
    // A boot/create-time registration has no recorded signature, so the
    // first pass replaces it with an identical row-derived table; the
    // recorded signature then makes later calls free.
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
    });
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([
      "single_test_page",
      "single_test_page_locales",
    ]);
    expect(tables.get("single_test_page")).not.toBe(sentinel);
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered.length).toBe(2);
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

  it("swallows registration failures (adapter falls back to its own error)", () => {
    const adapter = {
      dialect: "sqlite",
      tableResolver: {
        getTable: () => null,
        registerDynamicSchema: () => {
          throw new Error("registry exploded");
        },
      },
    } as unknown as DrizzleAdapter;
    expect(() =>
      ensureSingleRuntimeTable(adapter, localizedMeta)
    ).not.toThrow();
  });
});

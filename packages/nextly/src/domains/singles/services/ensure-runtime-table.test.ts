// The lazy singles runtime-table registration: given the registry row, a
// resolver miss registers the main table (localized-aware) and the
// `_locales` companion; a resolver hit registers nothing (idempotent); a
// broken resolver degrades to a no-op instead of throwing.

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

  it("registers nothing when the table is already resolvable", () => {
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
      single_test_page_locales: sentinel,
    });
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([]);
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("backfills a missing companion even when the main table is registered", () => {
    const { adapter, registered } = makeAdapter({
      single_test_page: { already: true },
    });
    ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual(["single_test_page_locales"]);
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

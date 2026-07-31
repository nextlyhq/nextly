/**
 * Where a reload believes its field groups are physically stored.
 *
 * 🔴 `resolveComponentTableName` answers what this release's creator WOULD name
 * a table; the registry records what it is actually called. They differ for an
 * author-chosen `dbName`, and after the storage migration for every field
 * group. A reload that derives the name diffs against a table that is not
 * there, reads the field group as new, and creates an EMPTY one beside the
 * populated one it meant to edit — silently, and looking exactly like content
 * loss.
 *
 * The second property is the subtler one: a registry that is absent and a
 * registry that is present but unreadable need different answers, and only the
 * first may be guessed past.
 */
import { describe, expect, it, vi } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import { forgetFieldGroupStorageNames } from "../../domains/field-groups/storage/resolve-storage-names";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { readStoredFieldGroupTables } from "../reload-config";

/**
 * A SQLite adapter double.
 *
 * SQLite so the identifier-case rules come from the dialect alone and no extra
 * query is needed to establish them.
 */
function adapterDouble(opts: {
  catalog?: string[];
  rows?: Array<Record<string, unknown>>;
  readFails?: boolean;
  catalogFails?: boolean;
}) {
  return {
    dialect: "sqlite" as const,
    getDrizzle: <T>(): T => ({}) as T,
    executeQuery: vi.fn(async () => []),
    listTables: vi.fn(async () => {
      if (opts.catalogFails) throw new Error("catalog unavailable");
      return opts.catalog ?? [];
    }),
    queryStatement: vi.fn(async () => {
      if (opts.readFails) throw new Error("registry read failed");
      return opts.rows ?? [];
    }),
  };
}

describe("readStoredFieldGroupTables", () => {
  it("returns the stored name for each field group", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [MIGRATION_TARGET.registryTable],
      rows: [{ slug: "hero", table_name: "fg_hero" }],
    });

    const stored = await readStoredFieldGroupTables(adapter as never);

    expect(stored.usable).toBe(true);
    expect(stored.tables.get("hero")).toBe("fg_hero");
  });

  it("reads the migrated registry when that is the one present", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [MIGRATION_TARGET.registryTable],
      rows: [{ slug: "hero", table_name: "fg_hero" }],
    });

    await readStoredFieldGroupTables(adapter as never);

    // One statement, against the registry the catalog reported. The name is not
    // asserted from the SQL text: the statement is a Drizzle object, and the
    // resolution it used is what the previous test already pins.
    expect(adapter.queryStatement).toHaveBeenCalledTimes(1);
    expect(adapter.listTables).toHaveBeenCalled();
  });

  // A fresh database. Deriving `comp_*` names is correct here, so the caller is
  // told the derived names may be used.
  it("is usable when the registry is genuinely absent", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({ catalog: ["users"], readFails: true });

    const stored = await readStoredFieldGroupTables(adapter as never);

    expect(stored.usable).toBe(true);
    expect(stored.tables.size).toBe(0);
  });

  // 🔴 The case the type exists for. The registry is there and the read failed,
  // so the physical names are UNKNOWN — and deriving them is what creates the
  // empty table.
  it("is NOT usable when the registry is present but unreadable", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [STORAGE_FORMAT.registryTable],
      readFails: true,
    });

    const stored = await readStoredFieldGroupTables(adapter as never);

    expect(stored.usable).toBe(false);
  });

  // Not even the catalog could answer, so absence was never established. The
  // unsafe direction must not be the default.
  it("is NOT usable when the catalog itself cannot be read", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({ readFails: true, catalogFails: true });

    const stored = await readStoredFieldGroupTables(adapter as never);

    expect(stored.usable).toBe(false);
  });

  it("ignores rows whose slug or table name is not a string", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [STORAGE_FORMAT.registryTable],
      rows: [
        { slug: "hero", table_name: "comp_hero" },
        { slug: 7, table_name: "comp_seven" },
        { slug: "no-table", table_name: null },
      ],
    });

    const stored = await readStoredFieldGroupTables(adapter as never);

    expect([...stored.tables.keys()]).toEqual(["hero"]);
  });
});

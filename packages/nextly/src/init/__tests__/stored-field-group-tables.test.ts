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
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { MIGRATION_TARGET } from "../../domains/field-groups/migration/manifest";
import { forgetFieldGroupStorageNames } from "../../domains/field-groups/storage/resolve-storage-names";
import { STORAGE_FORMAT } from "../../schemas/storage-format";
import { readStoredFieldGroupTables } from "../reload-config";

/**
 * The identifiers a Drizzle statement addresses.
 *
 * `sql.identifier(name)` compiles to a `Name` chunk carrying the raw name, so
 * this reads what the statement actually targets without rendering it to a
 * dialect-specific string.
 */
function identifiersIn(statement: SQL): string[] {
  const chunks = (statement as unknown as { queryChunks?: unknown[] })
    .queryChunks;
  if (!Array.isArray(chunks)) return [];
  return chunks
    .map(chunk =>
      chunk !== null && typeof chunk === "object" && "value" in chunk
        ? (chunk as { value: unknown }).value
        : undefined
    )
    .filter((value): value is string => typeof value === "string");
}

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
    // 🔴 Answers only for a table the catalog lists, and throws `no such table`
    // otherwise — the same way a real driver behaves. That is what gives the
    // assertions below their meaning: a double that returned these rows
    // whatever name it was handed would be satisfied by code addressing the
    // legacy or the derived registry just as readily as the right one.
    queryStatement: vi.fn(async (statement: SQL) => {
      if (opts.readFails) throw new Error("registry read failed");
      const addressed = identifiersIn(statement);
      const held = opts.catalog ?? [];
      const target = addressed.find(name => name.startsWith("dynamic_"));
      if (target !== undefined && !held.includes(target)) {
        throw new Error(`no such table: ${target}`);
      }
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

  it("addresses the migrated registry when that is the one present", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [MIGRATION_TARGET.registryTable],
      rows: [{ slug: "hero", table_name: "fg_hero" }],
    });

    const stored = await readStoredFieldGroupTables(adapter as never);

    // The identifier the statement targets, not merely that a statement ran.
    const addressed = identifiersIn(
      adapter.queryStatement.mock.calls[0]?.[0] as SQL
    );
    expect(addressed).toContain(MIGRATION_TARGET.registryTable);
    expect(addressed).not.toContain(STORAGE_FORMAT.registryTable);
    expect(stored.usable).toBe(true);
  });

  // The mirror of the case above, and not redundant with it: the resolution
  // must pick each generation from the catalog rather than favouring either, so
  // both directions are pinned. A rule that always answered "migrated" would
  // satisfy the previous test on its own.
  it("addresses the legacy registry when that is the one present", async () => {
    forgetFieldGroupStorageNames();
    const adapter = adapterDouble({
      catalog: [STORAGE_FORMAT.registryTable],
      rows: [{ slug: "hero", table_name: "comp_hero" }],
    });

    const stored = await readStoredFieldGroupTables(adapter as never);

    const addressed = identifiersIn(
      adapter.queryStatement.mock.calls[0]?.[0] as SQL
    );
    expect(addressed).toContain(STORAGE_FORMAT.registryTable);
    expect(addressed).not.toContain(MIGRATION_TARGET.registryTable);
    expect(stored.tables.get("hero")).toBe("comp_hero");
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
    // The cause travels with the verdict, so the caller's log can name it. A
    // deferral whose reason is lost tells an operator only that something went
    // wrong, on the one path that skips an entire reload.
    expect(stored.reason).toContain("registry read failed");
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

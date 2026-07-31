import { describe, expect, it, vi } from "vitest";

import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { identifierCaseRules } from "../../../schema/utils/resolve-catalog-name";
import { MIGRATION_TARGET } from "../../migration/manifest";
import type { TableColumns } from "../../migration/reconcile";
import {
  chooseRegistryTable,
  chooseTypeColumns,
  forgetFieldGroupStorageNames,
  resolveFieldGroupRegistryTable,
  resolveRegistryTableName,
  type StorageNameAdapter,
} from "../resolve-storage-names";

const LEGACY_REGISTRY = STORAGE_FORMAT.registryTable;
const MIGRATED_REGISTRY = MIGRATION_TARGET.registryTable;
const LEGACY_COLUMN = STORAGE_FORMAT.columns.type;
const MIGRATED_COLUMN = MIGRATION_TARGET.columnType;

/** Postgres: every identifier is quoted, so case is significant. */
const PRESERVING = identifierCaseRules({ dialect: "postgresql" });
/** SQLite, and MySQL under lower_case_table_names=1. */
const FOLDING = identifierCaseRules({ dialect: "sqlite" });

describe("chooseRegistryTable", () => {
  it("addresses the legacy registry when only it is present", () => {
    expect(chooseRegistryTable([LEGACY_REGISTRY, "users"], PRESERVING)).toEqual(
      {
        name: LEGACY_REGISTRY,
        migrated: false,
      }
    );
  });

  it("addresses the migrated registry when only it is present", () => {
    expect(
      chooseRegistryTable([MIGRATED_REGISTRY, "users"], PRESERVING)
    ).toEqual({ name: MIGRATED_REGISTRY, migrated: true });
  });

  // 🔴 The whole preference order in one case. Both present is a database the
  // migration guard refuses to migrate, but a reader still has to serve it, and
  // the legacy one is the table every write in this release has been going to.
  // Preferring the migrated name here would read an object this process never
  // moved while continuing to write to the other.
  it("prefers the legacy registry when both are present", () => {
    expect(
      chooseRegistryTable([MIGRATED_REGISTRY, LEGACY_REGISTRY], PRESERVING)
    ).toEqual({ name: LEGACY_REGISTRY, migrated: false });
  });

  // A fresh database has neither. The legacy name is the answer rather than a
  // refusal because it is the name the system-table DDL is about to create.
  it("falls back to the legacy name on a database holding neither", () => {
    expect(chooseRegistryTable(["users"], PRESERVING)).toEqual({
      name: LEGACY_REGISTRY,
      migrated: false,
    });
  });

  // MySQL under lower_case_table_names=1 reports whatever case it stored. An
  // exact-only lookup would call a present registry missing and fall through to
  // the legacy default, addressing a table that is not there.
  it("finds a registry the server reported under another case", () => {
    expect(
      chooseRegistryTable([MIGRATED_REGISTRY.toUpperCase()], FOLDING)
    ).toEqual({ name: MIGRATED_REGISTRY, migrated: true });
  });

  // The mirror of the case above: on a preserving server the two spellings are
  // two different objects, so folding would report a missing table as present.
  it("does not fold on a case-preserving server", () => {
    expect(
      chooseRegistryTable([MIGRATED_REGISTRY.toUpperCase()], PRESERVING)
    ).toEqual({ name: LEGACY_REGISTRY, migrated: false });
  });
});

describe("chooseTypeColumns", () => {
  function catalog(entries: Record<string, string[]>): TableColumns[] {
    return Object.entries(entries).map(([table, columns]) => ({
      table,
      columns,
    }));
  }

  it("reads the legacy discriminator on an unmigrated table", () => {
    const resolved = chooseTypeColumns(
      catalog({ comp_hero: ["id", LEGACY_COLUMN] }),
      ["comp_hero"],
      PRESERVING
    );
    expect(resolved.get("comp_hero")).toBe(LEGACY_COLUMN);
  });

  it("reads the migrated discriminator on a migrated table", () => {
    const resolved = chooseTypeColumns(
      catalog({ fg_hero: ["id", MIGRATED_COLUMN] }),
      ["fg_hero"],
      PRESERVING
    );
    expect(resolved.get("fg_hero")).toBe(MIGRATED_COLUMN);
  });

  // 🔴 The case a single per-database generation cannot express, and the reason
  // this resolution is per table. It is reachable three ways: mid-run before the
  // registry's own rename, after a crash between two table steps, and — for a
  // whole release — whenever a field group is created after a migration, since
  // the DDL still writes the legacy spelling.
  it("resolves each table independently when the two generations are mixed", () => {
    const resolved = chooseTypeColumns(
      catalog({
        fg_hero: ["id", MIGRATED_COLUMN],
        comp_late: ["id", LEGACY_COLUMN],
      }),
      ["fg_hero", "comp_late"],
      PRESERVING
    );
    expect(resolved.get("fg_hero")).toBe(MIGRATED_COLUMN);
    expect(resolved.get("comp_late")).toBe(LEGACY_COLUMN);
  });

  // Same preference order as the registry, for the same reason: a user column
  // named like our migrated one must not be adopted while ours is still there.
  it("prefers the legacy discriminator when a table carries both", () => {
    const resolved = chooseTypeColumns(
      catalog({ comp_hero: [MIGRATED_COLUMN, LEGACY_COLUMN] }),
      ["comp_hero"],
      PRESERVING
    );
    expect(resolved.get("comp_hero")).toBe(LEGACY_COLUMN);
  });

  it("falls back to the legacy spelling for a table the catalog omits", () => {
    const resolved = chooseTypeColumns(catalog({}), ["comp_unborn"], FOLDING);
    expect(resolved.get("comp_unborn")).toBe(LEGACY_COLUMN);
  });

  // MySQL folds column names on every server whatever lower_case_table_names
  // says, so a catalog reporting a folded spelling still names our column.
  it("finds a discriminator the server reported under another case", () => {
    const resolved = chooseTypeColumns(
      catalog({ fg_hero: [MIGRATED_COLUMN.toUpperCase()] }),
      ["fg_hero"],
      FOLDING
    );
    expect(resolved.get("fg_hero")).toBe(MIGRATED_COLUMN);
  });

  it("matches a table the server reported under another case", () => {
    const resolved = chooseTypeColumns(
      catalog({ FG_HERO: [MIGRATED_COLUMN] }),
      ["fg_hero"],
      FOLDING
    );
    expect(resolved.get("fg_hero")).toBe(MIGRATED_COLUMN);
  });

  it("answers for every requested table, present or not", () => {
    const resolved = chooseTypeColumns(
      catalog({ fg_hero: [MIGRATED_COLUMN] }),
      ["fg_hero", "fg_missing"],
      PRESERVING
    );
    expect([...resolved.keys()]).toEqual(["fg_hero", "fg_missing"]);
  });
});

describe("resolveFieldGroupRegistryTable", () => {
  /**
   * A SQLite adapter double.
   *
   * SQLite so `readIdentifierCaseRules` decides from the dialect alone and
   * never reaches `getDrizzle`, which lets these tests count catalog reads
   * without standing up a database.
   */
  function adapterDouble(tables: string[]): StorageNameAdapter & {
    listTables: ReturnType<typeof vi.fn>;
  } {
    return {
      dialect: "sqlite",
      listTables: vi.fn(async () => tables),
      getDrizzle: <T>() => ({}) as T,
    };
  }

  it("reads the catalog once and answers from the memo afterwards", async () => {
    const adapter = adapterDouble([MIGRATED_REGISTRY]);

    await expect(resolveRegistryTableName(adapter)).resolves.toBe(
      MIGRATED_REGISTRY
    );
    await expect(resolveRegistryTableName(adapter)).resolves.toBe(
      MIGRATED_REGISTRY
    );

    expect(adapter.listTables).toHaveBeenCalledTimes(1);
  });

  // Concurrent boot paths resolve at the same moment. Caching the promise
  // rather than the value is what keeps that one read instead of several.
  it("shares one catalog read between concurrent callers", async () => {
    const adapter = adapterDouble([LEGACY_REGISTRY]);

    await Promise.all([
      resolveRegistryTableName(adapter),
      resolveRegistryTableName(adapter),
      resolveRegistryTableName(adapter),
    ]);

    expect(adapter.listTables).toHaveBeenCalledTimes(1);
  });

  it("re-reads the catalog after the memo is dropped", async () => {
    const adapter = adapterDouble([LEGACY_REGISTRY]);
    await resolveRegistryTableName(adapter);

    forgetFieldGroupStorageNames(adapter);
    await resolveRegistryTableName(adapter);

    expect(adapter.listTables).toHaveBeenCalledTimes(2);
  });

  it("clears every memo when called without an adapter", async () => {
    const first = adapterDouble([LEGACY_REGISTRY]);
    const second = adapterDouble([MIGRATED_REGISTRY]);
    await resolveRegistryTableName(first);
    await resolveRegistryTableName(second);

    forgetFieldGroupStorageNames();
    await resolveRegistryTableName(first);
    await resolveRegistryTableName(second);

    expect(first.listTables).toHaveBeenCalledTimes(2);
    expect(second.listTables).toHaveBeenCalledTimes(2);
  });

  it("keeps two adapters' resolutions apart", async () => {
    const legacy = adapterDouble([LEGACY_REGISTRY]);
    const migrated = adapterDouble([MIGRATED_REGISTRY]);

    await expect(resolveFieldGroupRegistryTable(legacy)).resolves.toEqual({
      name: LEGACY_REGISTRY,
      migrated: false,
    });
    await expect(resolveFieldGroupRegistryTable(migrated)).resolves.toEqual({
      name: MIGRATED_REGISTRY,
      migrated: true,
    });
  });

  // 🔴 A transient catalog error must not become the process's permanent
  // answer. Remembering the rejected promise would pin every later read to it.
  it("does not remember a failed probe", async () => {
    const adapter = adapterDouble([LEGACY_REGISTRY]);
    adapter.listTables.mockRejectedValueOnce(new Error("catalog unavailable"));

    await expect(resolveRegistryTableName(adapter)).rejects.toThrow(
      "catalog unavailable"
    );
    await expect(resolveRegistryTableName(adapter)).resolves.toBe(
      LEGACY_REGISTRY
    );
  });
});

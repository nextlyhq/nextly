/**
 * How `nextly migrate` keeps a database's field-group storage and the project's history on the
 * same names: which file needs moved storage, when a moved database behind a legacy history may
 * go on, and how its legacy snapshots are read while the move is pending.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The registry the database holds, and the tables its rows name. */
const database = vi.hoisted(() => ({
  registry: "dynamic_field_groups" as
    | "dynamic_field_groups"
    | "dynamic_components",
  tables: new Map<string, string>(),
}));
vi.mock(
  "../../../field-groups/storage/resolve-storage-names",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../field-groups/storage/resolve-storage-names")
    >()),
    resolveRegistryNameFromCatalog: vi.fn(async () => database.registry),
  })
);
vi.mock(
  "../../../field-groups/services/field-group-stored-tables",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../field-groups/services/field-group-stored-tables")
    >()),
    readStoredFieldGroupTables: vi.fn(async () => ({
      tables: database.tables,
      usable: true,
      naming: "current",
    })),
  })
);

import {
  isFieldGroupTransition,
  refuseMovedStorageBehindLegacyHistory,
  underDatabaseFieldGroupNames,
} from "../field-group-history";

const adapter = {} as DrizzleAdapter;
const CURRENT = { fieldGroupStorage: "current" as const };
const LEGACY = {};

beforeEach(() => {
  database.registry = "dynamic_field_groups";
  database.tables = new Map();
});

describe("the file that needs moved field-group storage", () => {
  it("is the first on the current names, after legacy files or at the start of a history", () => {
    expect(isFieldGroupTransition(LEGACY, CURRENT)).toBe(true);
    // A history that starts on the current names, as a baseline of a moved database writes one.
    expect(isFieldGroupTransition(null, CURRENT)).toBe(true);
    expect(isFieldGroupTransition(CURRENT, CURRENT)).toBe(false);
    expect(isFieldGroupTransition(LEGACY, LEGACY)).toBe(false);
    expect(isFieldGroupTransition(null, LEGACY)).toBe(false);
  });
});

describe("a moved database behind a legacy history", () => {
  it("goes on when the next file to apply is the move to the current names", async () => {
    await expect(
      refuseMovedStorageBehindLegacyHistory({
        adapter,
        newestApplied: "legacy",
        nextPending: "current",
      })
    ).resolves.toBeUndefined();
  });

  it("is refused while a legacy file is still to apply before the move", async () => {
    await expect(
      refuseMovedStorageBehindLegacyHistory({
        adapter,
        newestApplied: "legacy",
        nextPending: "legacy",
      })
    ).rejects.toThrow(/nextly migrate:create --field-group-names=current/);
  });

  it("is not refused on a database that has not moved", async () => {
    database.registry = "dynamic_components";
    await expect(
      refuseMovedStorageBehindLegacyHistory({
        adapter,
        newestApplied: "legacy",
        nextPending: undefined,
      })
    ).resolves.toBeUndefined();
  });
});

describe("a legacy snapshot read under a moved database's names", () => {
  const legacySnapshot = {
    fieldGroupNaming: "legacy" as const,
    snapshot: {
      tables: [
        {
          name: "comp_card",
          columns: [{ name: "_component_type", type: "text", nullable: true }],
        },
        {
          // A collection's own table name that shares the prefix, which the storage migration
          // never renamed.
          name: "comp_archive",
          columns: [{ name: "title", type: "text", nullable: true }],
        },
      ],
    },
  };

  it("renames only the tables the moved registry holds, never by the prefix alone", async () => {
    database.tables = new Map([["card", "fg_card"]]);

    const [read] = await underDatabaseFieldGroupNames(adapter, [
      legacySnapshot,
    ]);

    expect(read?.snapshot.tables.map(table => table.name)).toEqual([
      "fg_card",
      "comp_archive",
    ]);
    expect(read?.snapshot.tables[0]?.columns.map(c => c.name)).toEqual([
      "_field_group_type",
    ]);
  });

  it("reads them as they are on a database that has not moved", async () => {
    database.registry = "dynamic_components";
    const [read] = await underDatabaseFieldGroupNames(adapter, [
      legacySnapshot,
    ]);
    expect(read?.snapshot.tables.map(table => table.name)).toEqual([
      "comp_card",
      "comp_archive",
    ]);
  });
});

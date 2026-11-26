/**
 * Where a database has no field-group registry, the declared groups' storage is named for a new
 * site, and whether it has one is read once.
 *
 * During a concurrent first start another process can create the registry between two looks at the
 * catalog. Asked a second time, the answer contradicted the first: the groups were named as a
 * legacy site's though nothing legacy was ever read, and extensions compiled against tables the
 * database does not have.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../storage/resolve-storage-names", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../storage/resolve-storage-names")
  >()),
  // What an empty database's catalog answers.
  resolveFieldGroupRegistryName: async () => "dynamic_components",
  resolveKnownTypeColumns: async () => new Map<string, string>(),
}));

import {
  declaredFieldGroupStorage,
  readStoredFieldGroupTables,
} from "../field-group-stored-tables";

/** Each look at the catalog, in turn; the last one answers every look after it. */
let looks: string[][] = [];
let asked = 0;
let rows: Array<{ slug: string; table_name: string }> | undefined;

const adapter = {
  dialect: "sqlite" as const,
  getDrizzle: <T>() => ({}) as T,
  listTables: async () => {
    const look = looks[Math.min(asked, looks.length - 1)] ?? [];
    asked += 1;
    return look;
  },
  queryStatement: async <T>() => {
    if (rows === undefined) throw new Error("no such table");
    return rows as T[];
  },
};

beforeEach(() => {
  looks = [[]];
  asked = 0;
  rows = undefined;
});

const GROUPS = [{ slug: "card" }];

describe("the declared groups' storage on a database with no registry", () => {
  it("is named for the new site, though another process creates the registry meanwhile", async () => {
    looks = [[], ["dynamic_field_groups"]];

    const storage = await declaredFieldGroupStorage(adapter, GROUPS, "current");

    expect(storage?.tables.get("card")).toBe("fg_card");
    expect(asked).toBe(1);
  });

  it("is named for the new site's legacy history where that is what it starts on", async () => {
    const storage = await declaredFieldGroupStorage(adapter, GROUPS, "legacy");

    expect(storage?.tables.get("card")).toBe("comp_card");
  });

  it("says in one reading that the registry is absent", async () => {
    expect(await readStoredFieldGroupTables(adapter)).toMatchObject({
      usable: true,
      absent: true,
    });
    expect(asked).toBe(1);
  });

  // The controls: a registry that is there is followed, and one that cannot be read is refused.
  it("follows the registry where there is one, whatever a new site would start on", async () => {
    rows = [{ slug: "card", table_name: "comp_card" }];

    const storage = await declaredFieldGroupStorage(adapter, GROUPS, "current");

    expect(storage?.tables.get("card")).toBe("comp_card");
  });

  it("refuses where the registry is there and cannot be read", async () => {
    looks = [["dynamic_components"]];

    await expect(
      declaredFieldGroupStorage(adapter, GROUPS, "current")
    ).rejects.toThrow(/field-group registry could not be read/);
  });
});

/**
 * A stored registry record is read whole or refused: a row that is not a
 * record, an owned permission missing a field the comparison reads included,
 * is never taken for a record, nor for no record at all.
 */
import { describe, expect, it, vi } from "vitest";

import { readRegistryRecord } from "../registry-record";

// The table the record's row lives in is only named here, never queried.
vi.mock("../../../../database/dialect-tables", () => ({
  loadedDialect: () => ({
    tables: { nextlyMeta: { key: "key", value: "value" } },
  }),
}));
vi.mock("drizzle-orm", async importOriginal => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: () => ({}),
}));

/** A handle whose `nextly_meta` holds `value` under the record's key. */
const holding = (value: unknown) => ({
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => [{ value: JSON.stringify(value) }] }),
    }),
  }),
});

const owned = {
  slug: "export-reports",
  action: "export",
  resource: "reports",
  name: "Export reports",
  description: null,
  permissionGroup: null,
  owner: "app",
};

describe("readRegistryRecord", () => {
  it("reads a record that keeps its owned permissions, with or without a baseline", async () => {
    const bare = { point: "0001_one", ownedPermissions: [owned] };
    expect(await readRegistryRecord(holding(bare), "sqlite")).toEqual(bare);
    const withBaseline = {
      point: null,
      baseline: {
        collections: {},
        singles: {},
        fieldGroups: {},
        permissions: ["export-reports"],
        ownedPermissions: [owned],
      },
    };
    expect(await readRegistryRecord(holding(withBaseline), "sqlite")).toEqual(
      withBaseline
    );
  });

  it.each([
    ["no action", { ...owned, action: undefined }],
    ["a resource that is not text", { ...owned, resource: 7 }],
    ["no name", { ...owned, name: undefined }],
    [
      "a description that is neither text nor null",
      { ...owned, description: 3 },
    ],
    [
      "a group that is neither text nor null",
      { ...owned, permissionGroup: {} },
    ],
    ["no owner", { ...owned, owner: null }],
  ])(
    "refuses a record whose owned permission has %s",
    async (_what, damaged) => {
      for (const record of [
        { point: "0001_one", ownedPermissions: [damaged] },
        {
          point: null,
          baseline: {
            collections: {},
            singles: {},
            fieldGroups: {},
            permissions: [],
            ownedPermissions: [damaged],
          },
        },
      ]) {
        await expect(
          readRegistryRecord(holding(record), "sqlite")
        ).rejects.toThrow();
      }
    }
  );
});

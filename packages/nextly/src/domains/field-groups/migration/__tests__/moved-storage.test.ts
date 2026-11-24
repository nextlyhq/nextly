/**
 * How a running server tells field-group storage the migration moved under it from any other
 * failure, and what it does then.
 *
 * What separates a correct follow from a plausibly broken one:
 * - only the database saying a table or column is missing counts as a move, however the error
 *   was wrapped; a refusal already decided (a NextlyError raised for its own reason) never does,
 *   so it is never replaced;
 * - a registry lookup that failed as a move runs once more after forgetting what the process
 *   resolved, and never a third time, so a failure that is not a move cannot loop.
 *
 * @module domains/field-groups/migration/__tests__/moved-storage.test
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { registerComponentRuntimeSchema } from "../../services/field-group-table-provisioning";
import {
  followingMovedRegistry,
  followMovedFieldGroupTables,
  hasMovedStorageCause,
  isMovedStorageError,
  storageMovingRefusal,
} from "../moved-storage";

// What a follow registers, and the columns it reads, stand in for the catalog: these cases are
// about which tables are followed, not how one is registered.
vi.mock("../../services/field-group-table-provisioning", () => ({
  registerComponentRuntimeSchema: vi.fn(() => ({ registered: true })),
}));
vi.mock("../../storage/resolve-storage-names", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../storage/resolve-storage-names")
  >()),
  resolveTableColumns: vi.fn(
    async (_adapter: unknown, names: readonly string[]) =>
      new Map(
        names.map(name => [
          name,
          { typeColumn: "_field_group_type", columns: [] },
        ])
      )
  ),
}));

const ADAPTER = {} as never;

describe("hasMovedStorageCause", () => {
  it("finds a missing table or column the database reported, however it was wrapped", () => {
    const driver = new Error("no such table: dynamic_components");
    expect(hasMovedStorageCause(driver)).toBe(true);
    expect(hasMovedStorageCause(NextlyError.internal({ cause: driver }))).toBe(
      true
    );
    expect(
      hasMovedStorageCause(
        new Error("select failed", {
          cause: new Error("Unknown column '_component_type' in 'field list'"),
        })
      )
    ).toBe(true);
  });

  it("never reads a decided refusal as a move, whatever its message names", () => {
    const refusal = NextlyError.validation({
      errors: [
        {
          path: "",
          code: "UNREGISTERED",
          message: "The table comp_hero does not exist in this process.",
        },
      ],
    });
    expect(hasMovedStorageCause(refusal)).toBe(false);
    expect(hasMovedStorageCause(new Error("connection reset"))).toBe(false);
  });
});

describe("isMovedStorageError", () => {
  it("counts a name this process has not registered, as a read meets after a move", () => {
    expect(
      isMovedStorageError(
        new Error('Table "fg_hero" not found in schema registry')
      )
    ).toBe(true);
    expect(isMovedStorageError(new Error("connection reset"))).toBe(false);
  });
});

describe("followingMovedRegistry", () => {
  it("looks up once more after a lookup failed as a move, and answers what that finds", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValueOnce(
        NextlyError.internal({
          cause: new Error("no such table: dynamic_components"),
        })
      )
      .mockResolvedValueOnce({ slug: "hero", tableName: "fg_hero" });
    const registry = followingMovedRegistry({ getComponent }, ADAPTER);

    await expect(registry.getComponent("hero")).resolves.toEqual({
      slug: "hero",
      tableName: "fg_hero",
    });
    expect(getComponent).toHaveBeenCalledTimes(2);
  });

  it("does not look up again after any other failure", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValue(new Error("connection reset"));
    const registry = followingMovedRegistry({ getComponent }, ADAPTER);

    await expect(registry.getComponent("hero")).rejects.toThrow(
      "connection reset"
    );
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("looks up at most twice, so a move that does not resolve cannot loop", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValue(new Error("no such table: dynamic_components"));
    const registry = followingMovedRegistry({ getComponent }, ADAPTER);

    await expect(registry.getComponent("hero")).rejects.toThrow(
      "dynamic_components"
    );
    expect(getComponent).toHaveBeenCalledTimes(2);
  });
});

describe("followingMovedRegistry on a caller's transaction", () => {
  it("refuses to be retried without looking up again, as the failure aborted the transaction", async () => {
    const getComponent = vi
      .fn()
      .mockRejectedValue(new Error("no such table: dynamic_components"));
    const registry = followingMovedRegistry({ getComponent }, ADAPTER);
    // A Drizzle transaction, as a lookup on one is handed it.
    const executor = { select: () => undefined };

    await expect(registry.getComponent("hero", executor)).rejects.toMatchObject(
      { publicData: { errors: [{ code: "FIELD_GROUP_STORAGE_MOVING" }] } }
    );
    expect(getComponent).toHaveBeenCalledTimes(1);
  });
});

describe("followMovedFieldGroupTables", () => {
  it("follows every table it is given, past one that answers without having moved", async () => {
    // `comp_cta` is where it was; `comp_hero` moved to `fg_hero`. A follow that stopped at the
    // first answer registered `comp_cta` alone and left the table that failed unregistered.
    const existing = new Set(["comp_cta", "fg_hero"]);
    const adapter = {
      tableExists: async (name: string) => existing.has(name),
      getCapabilities: () => ({ dialect: "sqlite" }),
    } as never;
    const rows = {
      getAllComponents: async () =>
        [
          { slug: "cta", tableName: "comp_cta", fields: [] },
          { slug: "hero", tableName: "fg_hero", fields: [] },
        ] as never,
    };

    await expect(
      followMovedFieldGroupTables({
        adapter,
        rows,
        tableNames: ["comp_cta", "comp_hero"],
      })
    ).resolves.toEqual(["comp_cta", "fg_hero"]);
    expect(
      vi.mocked(registerComponentRuntimeSchema).mock.calls.map(call => call[2])
    ).toContain("fg_hero");
  });
});

describe("storageMovingRefusal", () => {
  it("carries the code a caller retries on, and keeps the table out of what the caller is told", () => {
    const refusal = storageMovingRefusal("fg_hero");
    expect(refusal.publicData).toMatchObject({
      errors: [{ code: "FIELD_GROUP_STORAGE_MOVING" }],
    });
    expect(JSON.stringify(refusal.publicData)).not.toContain("fg_hero");
    expect(refusal.publicMessage).toMatch(/retry the save/i);
  });
});

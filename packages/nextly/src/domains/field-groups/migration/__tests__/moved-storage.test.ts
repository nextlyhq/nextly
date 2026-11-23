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
import {
  followingMovedRegistry,
  hasMovedStorageCause,
  isMovedStorageError,
  storageMovingRefusal,
} from "../moved-storage";

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

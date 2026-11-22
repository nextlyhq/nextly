/**
 * A user field created while its column could not be made is taken back, then the cached user
 * fields are loaded again. Each failure is logged as what it is: a failed reload is not a failed
 * undo, and an undo that failed is not followed by a reload of fields it did not take back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  errors: [] as string[],
  reloads: 0,
  reloadFails: false,
  undoFails: false,
}));

vi.mock("../../../domains/schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: async (
    _args: unknown,
    work: () => Promise<unknown>
  ) => work(),
}));

vi.mock("../../helpers/di", () => ({
  getAdapterFromDI: () => undefined,
  getConfigFromDI: () => ({}),
  getLoggerFromDI: () => ({
    info: () => {},
    warn: () => {},
    error: (line: string) => {
      world.errors.push(line);
    },
  }),
  getUserFieldDefinitionServiceFromDI: () => ({
    createField: async () => ({ id: "f1", name: "nickname" }),
    deleteField: async () => {
      if (world.undoFails) throw new Error("delete refused");
    },
  }),
  getUserExtSchemaServiceFromDI: () => ({
    reloadMergedFields: async () => {
      world.reloads += 1;
      // The sync's own reload, before its column, succeeds; the one after the undo may not.
      if (world.reloads > 1 && world.reloadFails) {
        throw new Error("registry unreadable");
      }
    },
    ensureUserExtSchema: async () => {
      throw new Error("column could not be made");
    },
  }),
}));

import { dispatchUserFields } from "../user-field-dispatcher";

const create = () =>
  dispatchUserFields(
    "createField",
    {},
    { name: "nickname", label: "Nickname", type: "text" }
  ).then(
    () => undefined,
    (error: unknown) => error
  );

beforeEach(() => {
  world.errors = [];
  world.reloads = 0;
  world.reloadFails = false;
  world.undoFails = false;
});

describe("a user field taken back after its column failed", () => {
  it("logs a failed reload as a failed reload, not a failed undo", async () => {
    world.reloadFails = true;
    const error = await create();
    expect((error as Error).message).toBe("column could not be made");
    expect(world.reloads).toBe(2);
    expect(world.errors).toHaveLength(1);
    expect(world.errors[0]).not.toContain("could not be taken back");
    expect(world.errors[0]).toContain("registry unreadable");
  });

  it("logs a failed undo, and loads no fields after it", async () => {
    world.undoFails = true;
    await create();
    expect(world.reloads).toBe(1);
    expect(world.errors).toHaveLength(1);
    expect(world.errors[0]).toContain("could not be taken back");
  });
});

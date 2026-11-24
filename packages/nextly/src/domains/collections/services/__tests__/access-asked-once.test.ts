/**
 * The collection gate within one entry write (`WriteTries`): a write made again after a save it
 * waited for keeps each answer its first try had, the plain gate's and the one that applies a rule's
 * filter, and asks afresh what its first try never asked, what another caller asks, and what is asked
 * on the write's transaction. Outside a write, every question is asked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadDialectTables } from "../../../../database/dialect-tables";
import { hasPermission } from "../../../../services/lib/permissions";
import {
  createMockAdapter,
  createMockDb,
  silentLogger,
} from "../../__tests__/collection-test-helpers";
import { CollectionAccessService } from "../collection-access-service";
import { WriteTries } from "../write-tries";

// The postgresql tables this file reads; the unit setup loads only the run's own dialect.
beforeAll(async () => {
  await loadDialectTables("postgresql");
});

vi.mock("../../../../services/lib/permissions", () => ({
  hasPermission: vi.fn(),
}));

const grants = vi.mocked(hasPermission);
const serviceDb = createMockDb({ rows: [] });
const service = new CollectionAccessService(
  createMockAdapter(serviceDb) as never,
  silentLogger as never
);
const editor = { id: "user-1", roles: ["editor"] };
const author = { id: "user-2", roles: ["author"] };

/** Runs `ask` in two tries of one write, the first refused as made from an earlier definition. */
async function inTwoTries(ask: (made: number) => Promise<unknown>) {
  const tries = new WriteTries();
  let made = 0;
  await tries.make(
    async () => {
      made += 1;
      await ask(made);
      tries.compared(made === 1);
      return undefined;
    },
    async () => true
  );
  expect(made).toBe(2);
}

describe("the collection gate within a write made again", () => {
  beforeEach(() => {
    grants.mockReset();
    grants.mockResolvedValue(true);
  });

  it("asks the plain gate once", async () => {
    await inTwoTries(() =>
      service.checkCollectionAccess({
        collectionName: "posts",
        operation: "create",
        user: editor,
      })
    );
    expect(grants).toHaveBeenCalledTimes(1);
  });

  it("asks the gate that applies a rule's filter once", async () => {
    await inTwoTries(() =>
      service.checkCollectionWrite({
        collectionName: "posts",
        operation: "update",
        user: editor,
        entryId: "e1",
      })
    );
    expect(grants).toHaveBeenCalledTimes(1);
  });

  it("asks afresh for another operation, another caller, another entry and on a transaction", async () => {
    await inTwoTries(async made => {
      await service.checkCollectionWrite({
        collectionName: "posts",
        operation: "update",
        user: editor,
        entryId: "e1",
      });
      if (made === 1) return;
      for (const asked of [
        { operation: "publish" as const, user: editor, entryId: "e1" },
        { operation: "update" as const, user: author, entryId: "e1" },
        { operation: "update" as const, user: editor, entryId: "e2" },
        {
          operation: "update" as const,
          user: editor,
          entryId: "e1",
          executor: serviceDb,
        },
      ]) {
        await service.checkCollectionWrite({
          collectionName: "posts",
          ...asked,
        });
      }
    });
    expect(grants).toHaveBeenCalledTimes(5);
  });

  it("asks every time outside a write", async () => {
    for (let i = 0; i < 2; i += 1) {
      await service.checkCollectionAccess({
        collectionName: "posts",
        operation: "create",
        user: editor,
      });
    }
    expect(grants).toHaveBeenCalledTimes(2);
  });
});

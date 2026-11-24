/**
 * The registry row a batch write is made for (`loadedRegistryRowFor`): its id, its version, and
 * the fields of its definition any of the batch's items sets, which the batch's hold compares with
 * the row it holds.
 *
 * A batch has no upper size, and its items are read in turn as the batch runs them. So the fields
 * the items set are gathered one item at a time: a reading that passes every item to one call at
 * once is refused by the engine for a large enough batch, before the batch begins.
 */
import { describe, expect, it } from "vitest";

import { CollectionMutationService } from "../collection-mutation-service";

describe("the registry row a batch write is made for", () => {
  it("reads the fields a very large batch sets, each item in turn", async () => {
    const row = {
      id: "c1",
      schemaVersion: 3,
      fields: [
        { name: "title", type: "text" },
        { name: "note", type: "text" },
        { name: "unset", type: "text" },
      ],
    };
    // Only the last item sets `note`, so every item is read.
    const items = Array.from({ length: 500_000 }, (_, index) =>
      index === 499_999 ? { note: "n" } : { title: "t" }
    );
    const service = {
      collectionService: { getCollection: () => Promise.resolve(row) },
    } as unknown as CollectionMutationService;

    const loaded =
      await CollectionMutationService.prototype.loadedRegistryRowFor.call(
        service,
        "posts",
        items
      );

    expect(loaded).toMatchObject({
      id: "c1",
      schemaVersion: 3,
      setsFields: ["title", "note"],
    });
  });
});

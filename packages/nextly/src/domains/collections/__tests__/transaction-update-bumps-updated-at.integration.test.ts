/**
 * The transaction update path bumps `updated_at`.
 *
 * `updateEntryWrite` — behind `updateEntryInTransaction` and every batch
 * update — passed the timestamp under the property name `updatedAt`. A dynamic
 * table keys its system columns by SQL name, so no column answered to it, and
 * the query builder dropped the key without a word: the row's timestamp never
 * moved on this path. The adapter-built update refuses a key that names no
 * column instead, which is what turned the silence into a failing test, and
 * this pins the write now that the key is spelled as the column is.
 *
 * The stored value is parked at the epoch first, through the pooled update,
 * so the assertion does not depend on a second elapsing between the create
 * and the update.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const TABLE = "dc_bumpnotes";

const notes = () =>
  defineCollection({
    slug: "bumpnotes",
    fields: [text({ name: "title" })],
  });

const byId = (id: string) => ({
  and: [{ column: "id", op: "=" as const, value: id }],
});

async function storedUpdatedAt(t: TestNextly, id: string): Promise<Date> {
  const rows = await t.adapter.select<{ id: string; updated_at: Date }>(TABLE, {
    where: byId(id),
  });
  const value = rows[0]?.updated_at;
  expect(value).toBeInstanceOf(Date);
  return value;
}

describe("the transaction update path and updated_at", () => {
  it("moves the timestamp off the value it found", async () => {
    current = await createTestNextly({ collections: [notes()] });
    const handler = current.getService("collectionsHandler");
    const created = await handler.createEntry(
      { collectionName: "bumpnotes", overrideAccess: true },
      { title: "First" }
    );
    const id = (created.data as { id: string }).id;

    await current.adapter.update(TABLE, { updated_at: new Date(0) }, byId(id));
    expect((await storedUpdatedAt(current, id)).getTime()).toBe(0);

    const before = Date.now();
    const result = await current.adapter.transaction(tx =>
      handler
        .getEntryService()
        .updateEntryInTransaction(
          tx as never,
          { collectionName: "bumpnotes", entryId: id, overrideAccess: true },
          { title: "Second" }
        )
    );
    expect(result.success).toBe(true);

    const after = await storedUpdatedAt(current, id);
    // Whole seconds on SQLite, so the bound is the second the update began.
    expect(after.getTime()).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000
    );
  });
});
